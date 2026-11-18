import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { LogLevel } from './processManager'

export interface SingleRunInfo {
    runId: string
    email: string
    pid: number | null
    startedAt: string
    uptimeSec: number
    state: 'STARTING' | 'RUNNING' | 'STOPPING'
}

export interface QueuedSingleRun {
    runId: string
    email: string
    enqueuedAt: string
}

export interface SinglePoolSnapshot {
    maxConcurrent: number
    activeCount: number
    queuedCount: number
    active: SingleRunInfo[]
    queue: QueuedSingleRun[]
}

export interface SingleRunFinishEvent {
    runId: string
    email: string
    state: 'OK' | 'ERROR' | 'STOPPED'
    exitCode: number | null
    signal: NodeJS.Signals | null
    startedAt: string
    endedAt: string
    stopRequested: boolean
}

export interface SingleRunLogEvent {
    email: string
    runId: string
    level: LogLevel
    source: 'stdout' | 'stderr' | 'controller'
    message: string
}

export interface SingleAccountPoolOptions {
    command?: string
    args?: string[]
    cwd: string
    env?: NodeJS.ProcessEnv
    getEnv?: () => NodeJS.ProcessEnv
    maxConcurrent?: number
    stopTimeoutMs?: number
}

interface InternalSingleRun {
    runId: string
    email: string
    startedAt: string
    state: 'STARTING' | 'RUNNING' | 'STOPPING'
    stopRequested: boolean
    child: ChildProcess
    stopWaiters: Array<() => void>
}

export class SingleAccountPool extends EventEmitter {
    private readonly command: string
    private readonly args: string[]
    private readonly cwd: string
    private readonly env?: NodeJS.ProcessEnv
    private readonly getEnv?: () => NodeJS.ProcessEnv
    private maxConcurrent: number
    private readonly stopTimeoutMs: number
    private readonly activeRuns = new Map<string, InternalSingleRun>()
    private readonly queue: QueuedSingleRun[] = []
    private stoppingAll = false

    constructor(options: SingleAccountPoolOptions) {
        super()
        const distIndex = path.resolve('dist/index.js')
        const defaultCommand = fs.existsSync(distIndex)
            ? process.execPath
            : process.platform === 'win32'
              ? 'npm.cmd'
              : 'npm'
        const defaultArgs = fs.existsSync(distIndex) ? [distIndex] : ['run', 'ts-start']

        this.command = options.command ?? defaultCommand
        this.args = options.args ?? defaultArgs
        this.cwd = options.cwd
        this.env = options.env
        this.getEnv = options.getEnv
        this.maxConcurrent = Math.min(2, Math.max(1, options.maxConcurrent ?? 2))
        this.stopTimeoutMs = Math.max(1000, options.stopTimeoutMs ?? 15000)
    }

    setMaxConcurrent(limit: number): void {
        this.maxConcurrent = Math.min(2, Math.max(1, Math.trunc(limit)))
        this.pumpQueue()
        this.emitStatus()
    }

    getMaxConcurrent(): number {
        return this.maxConcurrent
    }

    isActive(): boolean {
        return this.activeRuns.size > 0 || this.queue.length > 0
    }

    getActiveEmails(): string[] {
        return Array.from(this.activeRuns.values()).map(run => run.email)
    }

    getQueuedEmails(): string[] {
        return this.queue.map(item => item.email)
    }

    hasEmail(email: string): boolean {
        const key = email.trim().toLowerCase()
        return this.activeRuns.has(key) || this.queue.some(item => item.email.toLowerCase() === key)
    }

    getSnapshot(): SinglePoolSnapshot {
        const now = Date.now()
        const active: SingleRunInfo[] = Array.from(this.activeRuns.values()).map(run => ({
            runId: run.runId,
            email: run.email,
            pid: run.child.pid ?? null,
            startedAt: run.startedAt,
            uptimeSec: Math.max(0, Math.floor((now - Date.parse(run.startedAt)) / 1000)),
            state: run.state
        }))

        return {
            maxConcurrent: this.maxConcurrent,
            activeCount: active.length,
            queuedCount: this.queue.length,
            active,
            queue: [...this.queue]
        }
    }

    async enqueueOrStart(email: string): Promise<{
        status: 'started' | 'queued'
        runId: string
        position?: number
        snapshot: SinglePoolSnapshot
    }> {
        const trimmed = email.trim()
        if (!trimmed) {
            throw new Error('Email tài khoản không hợp lệ.')
        }

        const key = trimmed.toLowerCase()
        if (this.activeRuns.has(key)) {
            throw new Error(`Tài khoản ${trimmed} đang chạy đơn rồi.`)
        }
        if (this.queue.some(item => item.email.toLowerCase() === key)) {
            throw new Error(`Tài khoản ${trimmed} đã nằm trong hàng đợi.`)
        }

        if (this.activeRuns.size < this.maxConcurrent) {
            const runId = randomUUID()
            this.spawnSingleRun(trimmed, runId)
            return {
                status: 'started',
                runId,
                snapshot: this.getSnapshot()
            }
        }

        const queued: QueuedSingleRun = {
            runId: randomUUID(),
            email: trimmed,
            enqueuedAt: new Date().toISOString()
        }
        this.queue.push(queued)
        this.emitLog(trimmed, queued.runId, 'info', 'controller', `Đã xếp hàng đợi vị trí #${this.queue.length} (đang chạy ${this.activeRuns.size}/${this.maxConcurrent} slot đơn)`)
        this.emitStatus()

        return {
            status: 'queued',
            runId: queued.runId,
            position: this.queue.length,
            snapshot: this.getSnapshot()
        }
    }

    async stopAccount(email: string): Promise<{ stopped: boolean; removedFromQueue: boolean; snapshot: SinglePoolSnapshot }> {
        const key = email.trim().toLowerCase()
        const qIdx = this.queue.findIndex(item => item.email.toLowerCase() === key)
        if (qIdx !== -1) {
            const [removed] = this.queue.splice(qIdx, 1)
            if (removed) {
                this.emitLog(removed.email, removed.runId, 'info', 'controller', 'Đã huỷ khỏi hàng đợi chạy đơn.')
            }
            this.emitStatus()
            return { stopped: false, removedFromQueue: true, snapshot: this.getSnapshot() }
        }

        const active = this.activeRuns.get(key)
        if (!active) {
            return { stopped: false, removedFromQueue: false, snapshot: this.getSnapshot() }
        }

        await this.terminateRun(active)
        return { stopped: true, removedFromQueue: false, snapshot: this.getSnapshot() }
    }

    async stopAll(): Promise<SinglePoolSnapshot> {
        this.stoppingAll = true
        try {
            if (this.queue.length > 0) {
                const count = this.queue.length
                this.queue.splice(0, count)
                this.emitLog('SINGLE-POOL', 'pool', 'info', 'controller', `Đã xoá ${count} tài khoản khỏi hàng đợi chạy đơn.`)
            }

            const runs = Array.from(this.activeRuns.values())
            await Promise.all(runs.map(run => this.terminateRun(run)))
            this.emitStatus()
            return this.getSnapshot()
        } finally {
            this.stoppingAll = false
        }
    }

    private spawnSingleRun(email: string, runId: string): void {
        const key = email.toLowerCase()
        const startedAt = new Date().toISOString()
        const extraArgs = ['-email', email]
        const isNpm = /npm(\.cmd)?$/i.test(this.command)
        const spawnArgs = isNpm ? [...this.args, '--', ...extraArgs] : [...this.args, ...extraArgs]
        const isWindowsBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(this.command)
        const dynamicEnv = this.getEnv ? this.getEnv() : { ...process.env, ...this.env }

        this.emitLog(email, runId, 'info', 'controller', `Bắt đầu chạy đơn (${this.activeRuns.size + 1}/${this.maxConcurrent} slot)`)

        let child: ChildProcess
        try {
            child = spawn(this.command, spawnArgs, {
                cwd: this.cwd,
                env: dynamicEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: isWindowsBatch
            })
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            this.emitLog(email, runId, 'error', 'controller', `Không thể khởi tạo tiến trình: ${msg}`)
            this.emit('finished', {
                runId,
                email,
                state: 'ERROR',
                exitCode: null,
                signal: null,
                startedAt,
                endedAt: new Date().toISOString(),
                stopRequested: false
            } satisfies SingleRunFinishEvent)
            this.pumpQueue()
            this.emitStatus()
            return
        }

        const run: InternalSingleRun = {
            runId,
            email,
            startedAt,
            state: 'RUNNING',
            stopRequested: false,
            child,
            stopWaiters: []
        }

        this.activeRuns.set(key, run)
        this.bindChild(run)
        this.emitStatus()
    }

    private bindChild(run: InternalSingleRun): void {
        let finalized = false

        const finalize = (code: number | null, signal: NodeJS.Signals | null, errMsg?: string) => {
            if (finalized) return
            finalized = true

            if (errMsg) {
                this.emitLog(run.email, run.runId, 'error', 'controller', errMsg)
            }

            const key = run.email.toLowerCase()
            this.activeRuns.delete(key)

            const endedAt = new Date().toISOString()
            const state: SingleRunFinishEvent['state'] = run.stopRequested
                ? 'STOPPED'
                : code === 0 && !errMsg
                  ? 'OK'
                  : 'ERROR'

            this.emitLog(
                run.email,
                run.runId,
                state === 'ERROR' ? 'error' : 'info',
                'controller',
                `Kết thúc chạy đơn [${state}] (code=${code ?? 'n/a'})`
            )

            for (const waiter of run.stopWaiters) {
                waiter()
            }
            run.stopWaiters.length = 0

            this.emit('finished', {
                runId: run.runId,
                email: run.email,
                state,
                exitCode: code,
                signal,
                startedAt: run.startedAt,
                endedAt,
                stopRequested: run.stopRequested
            } satisfies SingleRunFinishEvent)

            this.pumpQueue()
            this.emitStatus()
        }

        run.child.stdout?.on('data', chunk => this.consumeOutput(run, String(chunk), 'stdout'))
        run.child.stderr?.on('data', chunk => this.consumeOutput(run, String(chunk), 'stderr'))
        run.child.on('error', error => finalize(null, null, error.message))
        run.child.on('close', (code, signal) => finalize(code, signal))
    }

    private consumeOutput(run: InternalSingleRun, raw: string, source: 'stdout' | 'stderr'): void {
        for (const line of raw
            .split(/\r?\n/)
            .map(v => v.trim())
            .filter(Boolean)) {
            const level = this.detectLevel(line, source)
            this.emitLog(run.email, run.runId, level, source, line)
        }
    }

    private detectLevel(message: string, source: 'stdout' | 'stderr'): LogLevel {
        if (source === 'stderr' || /\b(error|failed|failure|exception|fatal)\b/i.test(message)) return 'error'
        if (/\b(warn|warning|retry)\b/i.test(message)) return 'warn'
        if (/\b(debug|trace)\b/i.test(message)) return 'debug'
        return 'info'
    }

    private pumpQueue(): void {
        if (this.stoppingAll) return
        while (this.activeRuns.size < this.maxConcurrent && this.queue.length > 0) {
            const next = this.queue.shift()
            if (!next) break
            const key = next.email.toLowerCase()
            if (this.activeRuns.has(key)) continue
            this.spawnSingleRun(next.email, next.runId)
        }
    }

    private terminateRun(run: InternalSingleRun): Promise<void> {
        if (run.child.exitCode !== null || run.child.signalCode !== null) {
            return Promise.resolve()
        }

        run.stopRequested = true
        run.state = 'STOPPING'
        this.emitLog(run.email, run.runId, 'info', 'controller', 'Đang gửi lệnh dừng chạy đơn...')
        this.emitStatus()
        run.child.kill('SIGINT')

        return new Promise<void>(resolve => {
            let killTimer: NodeJS.Timeout | null = null
            const termTimer = setTimeout(() => {
                if (run.child.exitCode === null && run.child.signalCode === null) {
                    this.emitLog(run.email, run.runId, 'warn', 'controller', 'Graceful stop timeout; sending SIGTERM')
                    run.child.kill('SIGTERM')
                    killTimer = setTimeout(() => {
                        if (run.child.exitCode === null && run.child.signalCode === null) {
                            this.emitLog(run.email, run.runId, 'error', 'controller', 'Force killing with SIGKILL')
                            run.child.kill('SIGKILL')
                        }
                    }, 2000)
                    killTimer.unref()
                }
            }, this.stopTimeoutMs)
            termTimer.unref()

            run.stopWaiters.push(() => {
                clearTimeout(termTimer)
                if (killTimer) clearTimeout(killTimer)
                resolve()
            })
        })
    }

    private emitLog(
        email: string,
        runId: string,
        level: LogLevel,
        source: 'stdout' | 'stderr' | 'controller',
        message: string
    ): void {
        this.emit('log', {
            email,
            runId,
            level,
            source,
            message: message.includes(email) ? message : `[${email}] ${message}`
        } satisfies SingleRunLogEvent)
    }

    private emitStatus(): void {
        this.emit('status', this.getSnapshot())
    }
}

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export type RunState = 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'OK' | 'ERROR' | 'STOPPED'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RunLogEntry {
    id: number
    runId: string | null
    timestamp: string
    level: LogLevel
    source: 'stdout' | 'stderr' | 'controller'
    message: string
}

export interface RunSummary {
    runId: string
    startedAt: string
    endedAt: string | null
    state: Exclude<RunState, 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING'>
    exitCode: number | null
    signal: NodeJS.Signals | null
    logCount: number
    errorCount: number
}

export interface ProcessStatus {
    state: RunState
    runId: string | null
    pid: number | null
    startedAt: string | null
    endedAt: string | null
    exitCode: number | null
    signal: NodeJS.Signals | null
    uptimeSec: number
    active: boolean
}

export interface ProcessManagerOptions {
    command?: string
    args?: string[]
    cwd: string
    env?: NodeJS.ProcessEnv
    stopTimeoutMs?: number
    logBufferSize?: number
    historySize?: number
}

interface ActiveRun {
    runId: string
    startedAt: string
    stopRequested: boolean
    errorCount: number
    logCount: number
}

export class ProcessManager extends EventEmitter {
    private readonly command: string
    private readonly args: string[]
    private readonly cwd: string
    private readonly env?: NodeJS.ProcessEnv
    private readonly stopTimeoutMs: number
    private readonly logBufferSize: number
    private readonly historySize: number
    private child: ChildProcess | null = null
    private activeRun: ActiveRun | null = null
    private currentStatus: ProcessStatus = {
        state: 'IDLE',
        runId: null,
        pid: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        signal: null,
        uptimeSec: 0,
        active: false
    }
    private nextLogId = 1
    private logs: RunLogEntry[] = []
    private history: RunSummary[] = []

    constructor(options: ProcessManagerOptions) {
        super()
        const distIndex = path.resolve('dist/index.js')
        const defaultCommand = fs.existsSync(distIndex) ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm')
        const defaultArgs = fs.existsSync(distIndex) ? [distIndex] : ['run', 'ts-start']

        this.command = options.command ?? defaultCommand
        this.args = options.args ?? defaultArgs
        this.cwd = options.cwd
        this.env = options.env
        this.stopTimeoutMs = Math.max(1000, options.stopTimeoutMs ?? 15000)
        this.logBufferSize = Math.max(50, options.logBufferSize ?? 2000)
        this.historySize = Math.max(1, options.historySize ?? 20)
    }

    public log(level: LogLevel, message: string): void {
        this.appendLog(level, message, 'controller')
    }

    getStatus(): ProcessStatus {
        const startedAt = this.currentStatus.startedAt ? Date.parse(this.currentStatus.startedAt) : null
        const active = this.isActive()
        return {
            ...this.currentStatus,
            active,
            uptimeSec: startedAt && active ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0
        }
    }

    getLogs(options: { limit?: number; afterId?: number; minLevel?: LogLevel } = {}): RunLogEntry[] {
        const minLevel = options.minLevel
        const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
        const minimum = minLevel ? levels.indexOf(minLevel) : 0
        const filtered = this.logs.filter(entry => {
            if (options.afterId !== undefined && entry.id <= options.afterId) return false
            return levels.indexOf(entry.level) >= minimum
        })
        const limit = Math.min(this.logBufferSize, Math.max(1, options.limit ?? 200))
        return filtered.slice(-limit)
    }

    getErrors(limit = 100): RunLogEntry[] {
        return this.logs.filter(entry => entry.level === 'error').slice(-Math.max(1, limit))
    }

    getHistory(limit = this.historySize): RunSummary[] {
        return this.history.slice(-Math.max(1, limit))
    }

    async start(extraArgs?: string[]): Promise<ProcessStatus> {
        if (this.isActive()) {
            throw new Error('Bot process is already running.')
        }

        const runId = randomUUID()
        const startedAt = new Date().toISOString()
        this.activeRun = { runId, startedAt, stopRequested: false, errorCount: 0, logCount: 0 }
        this.currentStatus = {
            state: 'STARTING',
            runId,
            pid: null,
            startedAt,
            endedAt: null,
            exitCode: null,
            signal: null,
            uptimeSec: 0,
            active: true
        }
        try {
            this.emitStatus()
            this.appendLog('info', `Starting bot process${extraArgs ? ' with: ' + extraArgs.join(' ') : ''}`, 'controller')

            const isNpm = /npm(\.cmd)?$/i.test(this.command)
            const spawnArgs = extraArgs && extraArgs.length > 0
                ? (isNpm ? [...this.args, '--', ...extraArgs] : [...this.args, ...extraArgs])
                : this.args
            const isWindowsBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(this.command)
            this.child = spawn(this.command, spawnArgs, {
                cwd: this.cwd,
                env: { ...process.env, ...this.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: isWindowsBatch
            })
        } catch (error) {
            this.finish(null, null, error instanceof Error ? error.message : String(error))
            throw error
        }

        this.currentStatus = { ...this.currentStatus, state: 'RUNNING', pid: this.child.pid ?? null }
        this.bindChild(this.child, runId)
        this.emitStatus()
        return this.getStatus()
    }

    async stop(): Promise<ProcessStatus> {
        if (!this.child || !this.isActive()) {
            return this.getStatus()
        }

        if (this.activeRun) this.activeRun.stopRequested = true
        this.currentStatus = { ...this.currentStatus, state: 'STOPPING' }
        this.appendLog('info', 'Stopping bot process gracefully', 'controller')
        this.emitStatus()
        this.child.kill('SIGINT')

        await new Promise<void>(resolve => {
            let killTimer: NodeJS.Timeout | null = null
            const timer = setTimeout(() => {
                if (this.child && this.isActive()) {
                    this.appendLog('warn', 'Graceful stop timed out; sending SIGTERM', 'controller')
                    this.child.kill('SIGTERM')
                    killTimer = setTimeout(() => {
                        if (this.child && this.isActive()) {
                            this.appendLog('error', 'Forced stop required after SIGTERM timeout', 'controller')
                            this.child.kill('SIGKILL')
                        }
                    }, 2000)
                    killTimer.unref()
                }
            }, this.stopTimeoutMs)
            timer.unref()
            this.once('finished', () => {
                clearTimeout(timer)
                if (killTimer) clearTimeout(killTimer)
                resolve()
            })
        })
        return this.getStatus()
    }

    async restart(): Promise<ProcessStatus> {
        if (this.isActive()) await this.stop()
        return this.start()
    }

    async shutdown(): Promise<void> {
        if (this.isActive()) await this.stop()
    }

    private bindChild(child: ChildProcess, runId: string): void {
        child.stdout?.on('data', chunk => this.consumeOutput(String(chunk), 'stdout', runId))
        child.stderr?.on('data', chunk => this.consumeOutput(String(chunk), 'stderr', runId))
        child.on('error', error => this.finish(null, null, error.message))
        child.on('close', (code, signal) => this.finish(code, signal, null))
    }

    private consumeOutput(raw: string, source: 'stdout' | 'stderr', runId: string): void {
        for (const line of raw
            .split(/\r?\n/)
            .map(value => value.trim())
            .filter(Boolean)) {
            const level = this.detectLevel(line, source)
            this.appendLog(level, line, source, runId)
        }
    }

    private detectLevel(message: string, source: 'stdout' | 'stderr'): LogLevel {
        if (source === 'stderr' || /\b(error|failed|failure|exception|fatal)\b/i.test(message)) return 'error'
        if (/\b(warn|warning|retry)\b/i.test(message)) return 'warn'
        if (/\b(debug|trace)\b/i.test(message)) return 'debug'
        return 'info'
    }

    private appendLog(
        level: LogLevel,
        message: string,
        source: RunLogEntry['source'],
        runId: string | null = this.activeRun?.runId ?? null
    ): void {
        const entry: RunLogEntry = {
            id: this.nextLogId++,
            runId,
            timestamp: new Date().toISOString(),
            level,
            source,
            message
        }
        this.logs.push(entry)
        if (this.logs.length > this.logBufferSize) this.logs.splice(0, this.logs.length - this.logBufferSize)
        if (this.activeRun && runId === this.activeRun.runId) {
            this.activeRun.logCount += 1
            if (level === 'error') this.activeRun.errorCount += 1
        }
        this.emit('log', entry)
    }

    private finish(code: number | null, signal: NodeJS.Signals | null, error: string | null): void {
        const run = this.activeRun
        if (!run) return
        if (error) this.appendLog('error', error, 'controller', run.runId)
        const endedAt = new Date().toISOString()
        const state: RunSummary['state'] = run.stopRequested ? 'STOPPED' : code === 0 && !error ? 'OK' : 'ERROR'
        const summary: RunSummary = {
            runId: run.runId,
            startedAt: run.startedAt,
            endedAt,
            state,
            exitCode: code,
            signal,
            logCount: run.logCount,
            errorCount: run.errorCount
        }
        this.history.push(summary)
        if (this.history.length > this.historySize) this.history.splice(0, this.history.length - this.historySize)
        this.currentStatus = {
            state,
            runId: run.runId,
            pid: null,
            startedAt: run.startedAt,
            endedAt,
            exitCode: code,
            signal,
            uptimeSec: 0,
            active: false
        }
        this.child = null
        this.activeRun = null
        this.emitStatus()
        this.emit('finished', summary)
    }

    private isActive(): boolean {
        return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null)
    }

    private emitStatus(): void {
        this.emit('status', this.getStatus())
    }
}

import { randomInt as cryptoRandomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { atomicWriteFileSync } from '../util/FileLock'

export type SchedulerPhase =
    | 'DISABLED'
    | 'WAITING_NEW_DAY'
    | 'WAITING_LOCAL_HOUR'
    | 'COUNTDOWN'
    | 'WAITING_BOT_IDLE'
    | 'WAITING_PROXY'
    | 'RUNNING'
    | 'DONE_TODAY'

export interface SchedulerConfig {
    enabled: boolean
    vpsTimezone: string
    localTimezone: string
    minLocalHour: number
    maxLocalHour: number
    minJitterMinutes: number
    maxJitterMinutes: number
    requireProxy: boolean
}

export interface PersistedSchedulerState {
    config: SchedulerConfig
    lastRunVpsDate: string | null
    lastRunLocalDate: string | null
    lastAutoRunAt: string | null
    plannedTargetAt: string | null
    plannedVpsDate: string | null
    plannedLocalDate: string | null
    plannedJitterMinutes: number | null
    lastError: string | null
    updatedAt: string | null
}

export interface ClockSnapshot {
    timeZone: string
    dateStr: string
    timeStr: string
    hourDecimal: number
}

export interface SchedulerConditions {
    vpsNewDay: boolean
    localNewDay: boolean
    localHourOk: boolean
    botIdle: boolean
    proxyAvailable: boolean | null
    proxyOk: boolean | null
}

export interface SchedulerStatus {
    phase: SchedulerPhase
    config: SchedulerConfig
    vpsDate: string
    vpsTime: string
    localDate: string
    localTime: string
    plannedTargetAt: string | null
    plannedJitterMinutes: number | null
    countdownSec: number | null
    lastRunVpsDate: string | null
    lastRunLocalDate: string | null
    lastAutoRunAt: string | null
    lastError: string | null
    conditions: SchedulerConditions
}

export interface SchedulerServiceOptions {
    statePath?: string
    tickIntervalMs?: number
    proxyRetryIntervalMs?: number
    startErrorBackoffMs?: number
    isBotBusy?: () => boolean
    startBatch?: () => Promise<void>
    checkProxy?: () => Promise<{ ok: boolean; reason?: string }>
    randomInt?: (min: number, max: number) => number
    onChange?: (status: SchedulerStatus) => void
    onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
}

function isValidTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
        return true
    } catch {
        return false
    }
}

function resolveSafeTimeZone(tz: unknown, fallback: string): string {
    if (typeof tz === 'string') {
        const trimmed = tz.trim()
        if (trimmed && isValidTimeZone(trimmed)) {
            return trimmed
        }
    }
    return isValidTimeZone(fallback) ? fallback : 'UTC'
}

export function getClockSnapshot(timeZone: string, now: Date = new Date()): ClockSnapshot {
    const safeTz = resolveSafeTimeZone(timeZone, 'UTC')
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: safeTz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    })

    const partsMap: Record<string, string> = {}
    for (const part of formatter.formatToParts(now)) {
        if (part.type !== 'literal') {
            partsMap[part.type] = part.value
        }
    }

    const year = partsMap.year || '1970'
    const month = (partsMap.month || '01').padStart(2, '0')
    const day = (partsMap.day || '01').padStart(2, '0')
    const rawHour = Number.parseInt(partsMap.hour || '0', 10)
    const hourNum = Number.isFinite(rawHour) ? ((rawHour % 24) + 24) % 24 : 0
    const minuteNum = Number.parseInt(partsMap.minute || '0', 10) || 0
    const secondNum = Number.parseInt(partsMap.second || '0', 10) || 0

    const hourStr = String(hourNum).padStart(2, '0')
    const minStr = String(minuteNum).padStart(2, '0')
    const secStr = String(secondNum).padStart(2, '0')

    return {
        timeZone: safeTz,
        dateStr: `${year}-${month}-${day}`,
        timeStr: `${hourStr}:${minStr}:${secStr}`,
        hourDecimal: hourNum + minuteNum / 60 + secondNum / 3600
    }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function detectSystemTimeZone(): string {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        return resolveSafeTimeZone(tz, 'UTC')
    } catch {
        return 'UTC'
    }
}

export class SchedulerService {
    private readonly statePath: string
    private readonly tickIntervalMs: number
    private readonly proxyRetryIntervalMs: number
    private readonly startErrorBackoffMs: number
    private readonly deps: {
        isBotBusy: () => boolean
        startBatch: () => Promise<void>
        checkProxy: () => Promise<{ ok: boolean; reason?: string }>
        randomInt: (min: number, max: number) => number
        onChange?: (status: SchedulerStatus) => void
        onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
    }

    private state: PersistedSchedulerState
    private timer: NodeJS.Timeout | null = null
    private evalChain: Promise<unknown> = Promise.resolve()
    private autoRunActive = false
    private cachedProxyOk: boolean | null = null
    private lastProxyProbeAt: number | null = null
    private lastProxyFailAt: number | null = null
    private startRetryAfterMs: number | null = null
    private lastEmittedKey = ''

    constructor(options: SchedulerServiceOptions = {}) {
        this.statePath = path.resolve(options.statePath || 'src/dashboard/scheduler-state.json')
        this.tickIntervalMs = Math.max(1000, options.tickIntervalMs ?? 30_000)
        this.proxyRetryIntervalMs = Math.max(0, options.proxyRetryIntervalMs ?? 60_000)
        this.startErrorBackoffMs = Math.max(0, options.startErrorBackoffMs ?? 120_000)
        this.deps = {
            isBotBusy: options.isBotBusy ?? (() => false),
            startBatch: options.startBatch ?? (async () => undefined),
            checkProxy: options.checkProxy ?? (async () => ({ ok: true })),
            randomInt:
                options.randomInt ??
                ((min: number, max: number) => {
                    const low = Math.min(min, max)
                    const high = Math.max(min, max)
                    if (low === high) return low
                    return cryptoRandomInt(low, high + 1)
                }),
            onChange: options.onChange,
            onLog: options.onLog
        }
        this.state = this.loadState()
    }

    private defaultConfig(): SchedulerConfig {
        return {
            enabled: false,
            vpsTimezone: detectSystemTimeZone(),
            localTimezone: 'Asia/Ho_Chi_Minh',
            minLocalHour: 7,
            maxLocalHour: 21,
            minJitterMinutes: 15,
            maxJitterMinutes: 180,
            requireProxy: true
        }
    }

    private normalizeConfig(input: Record<string, unknown>, base: SchedulerConfig): SchedulerConfig {
        const vpsTzRaw = input.vpsTimezone ?? input.vpsTz
        const localTzRaw = input.localTimezone ?? input.localTz
        const minHourRaw = input.minLocalHour ?? input.minHour
        const maxHourRaw = input.maxLocalHour ?? input.maxHour
        const minJitterRaw = input.minJitterMinutes ?? input.minJitterMin
        const maxJitterRaw = input.maxJitterMinutes ?? input.maxJitterMin
        const requireProxyRaw = input.requireProxy ?? input.requireProxyReady

        const minLocalHour = clampInt(minHourRaw, base.minLocalHour, 0, 22)
        const maxLocalHour = clampInt(maxHourRaw, base.maxLocalHour, minLocalHour + 1, 24)
        const minJitterMinutes = clampInt(minJitterRaw, base.minJitterMinutes, 0, 720)
        const maxJitterMinutes = clampInt(maxJitterRaw, base.maxJitterMinutes, minJitterMinutes, 720)

        return {
            enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
            vpsTimezone: vpsTzRaw !== undefined ? resolveSafeTimeZone(vpsTzRaw, base.vpsTimezone) : base.vpsTimezone,
            localTimezone:
                localTzRaw !== undefined ? resolveSafeTimeZone(localTzRaw, base.localTimezone) : base.localTimezone,
            minLocalHour,
            maxLocalHour,
            minJitterMinutes,
            maxJitterMinutes,
            requireProxy: typeof requireProxyRaw === 'boolean' ? requireProxyRaw : base.requireProxy
        }
    }

    private loadState(): PersistedSchedulerState {
        const defaults = this.defaultConfig()
        const empty: PersistedSchedulerState = {
            config: defaults,
            lastRunVpsDate: null,
            lastRunLocalDate: null,
            lastAutoRunAt: null,
            plannedTargetAt: null,
            plannedVpsDate: null,
            plannedLocalDate: null,
            plannedJitterMinutes: null,
            lastError: null,
            updatedAt: null
        }

        if (!fs.existsSync(this.statePath)) {
            return empty
        }

        try {
            const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf-8')) as Partial<PersistedSchedulerState>
            const rawCfg =
                raw.config && typeof raw.config === 'object' ? (raw.config as unknown as Record<string, unknown>) : {}
            return {
                config: this.normalizeConfig(rawCfg, defaults),
                lastRunVpsDate: typeof raw.lastRunVpsDate === 'string' ? raw.lastRunVpsDate : null,
                lastRunLocalDate: typeof raw.lastRunLocalDate === 'string' ? raw.lastRunLocalDate : null,
                lastAutoRunAt: typeof raw.lastAutoRunAt === 'string' ? raw.lastAutoRunAt : null,
                plannedTargetAt: typeof raw.plannedTargetAt === 'string' ? raw.plannedTargetAt : null,
                plannedVpsDate: typeof raw.plannedVpsDate === 'string' ? raw.plannedVpsDate : null,
                plannedLocalDate: typeof raw.plannedLocalDate === 'string' ? raw.plannedLocalDate : null,
                plannedJitterMinutes:
                    typeof raw.plannedJitterMinutes === 'number' && Number.isFinite(raw.plannedJitterMinutes)
                        ? raw.plannedJitterMinutes
                        : null,
                lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
                updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
            }
        } catch {
            return empty
        }
    }

    private saveState(): void {
        try {
            this.state.updatedAt = new Date().toISOString()
            atomicWriteFileSync(this.statePath, `${JSON.stringify(this.state, null, 4)}\n`, 0o600)
        } catch (error) {
            this.deps.onLog?.(
                'warn',
                `[Auto-Scheduler] Lỗi lưu trạng thái: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private clearPlannedFields(): boolean {
        const hadPlan =
            this.state.plannedTargetAt !== null ||
            this.state.plannedVpsDate !== null ||
            this.state.plannedLocalDate !== null ||
            this.state.plannedJitterMinutes !== null
        this.state.plannedTargetAt = null
        this.state.plannedVpsDate = null
        this.state.plannedLocalDate = null
        this.state.plannedJitterMinutes = null
        return hadPlan
    }

    private hasStalePlan(vpsDate: string, localDate: string): boolean {
        if (!this.state.plannedTargetAt) return false
        return this.state.plannedVpsDate !== vpsDate || this.state.plannedLocalDate !== localDate
    }

    private rollJitter(minJitter: number, maxJitter: number): number {
        const low = Math.max(0, Math.min(minJitter, maxJitter))
        const high = Math.max(low, maxJitter)
        const rolled = this.deps.randomInt(low, high)
        return Math.min(high, Math.max(low, Math.trunc(rolled)))
    }

    private computeClampedTargetMs(
        nowMs: number,
        jitterMinutes: number,
        localHourDecimal: number,
        maxLocalHour: number
    ): number {
        const desiredMs = nowMs + jitterMinutes * 60_000
        const windowRemainingMs = Math.max(0, (maxLocalHour - localHourDecimal) * 3_600_000)
        const tenMinutesMs = 10 * 60_000

        if (windowRemainingMs > tenMinutesMs) {
            const latestSafeMs = nowMs + (windowRemainingMs - tenMinutesMs)
            return Math.min(desiredMs, latestSafeMs)
        }

        const smallWindowMs = Math.max(15_000, Math.floor(windowRemainingMs * 0.4))
        return nowMs + Math.min(jitterMinutes * 60_000, smallWindowMs)
    }

    private buildStatus(
        phase: SchedulerPhase,
        vps: ClockSnapshot,
        local: ClockSnapshot,
        flags: { vpsNewDay: boolean; localNewDay: boolean; localHourOk: boolean; botIdle: boolean },
        countdownSec: number | null
    ): SchedulerStatus {
        const proxyStatus = this.state.config.requireProxy ? this.cachedProxyOk : this.cachedProxyOk ?? true
        return {
            phase,
            config: { ...this.state.config },
            vpsDate: vps.dateStr,
            vpsTime: vps.timeStr,
            localDate: local.dateStr,
            localTime: local.timeStr,
            plannedTargetAt: this.state.plannedTargetAt,
            plannedJitterMinutes: this.state.plannedJitterMinutes,
            countdownSec,
            lastRunVpsDate: this.state.lastRunVpsDate,
            lastRunLocalDate: this.state.lastRunLocalDate,
            lastAutoRunAt: this.state.lastAutoRunAt,
            lastError: this.state.lastError,
            conditions: {
                vpsNewDay: flags.vpsNewDay,
                localNewDay: flags.localNewDay,
                localHourOk: flags.localHourOk,
                botIdle: flags.botIdle,
                proxyAvailable: proxyStatus,
                proxyOk: proxyStatus
            }
        }
    }

    private emitIfChanged(status: SchedulerStatus, force = false): SchedulerStatus {
        const key = [
            status.phase,
            status.config.enabled,
            status.config.vpsTimezone,
            status.config.localTimezone,
            status.config.requireProxy,
            status.plannedTargetAt ?? '',
            status.lastRunVpsDate ?? '',
            status.lastRunLocalDate ?? '',
            status.lastError ?? '',
            String(status.conditions.proxyAvailable),
            String(status.conditions.botIdle)
        ].join('|')

        if (force || key !== this.lastEmittedKey) {
            this.lastEmittedKey = key
            this.deps.onChange?.(status)
        }
        return status
    }

    public start(): void {
        if (this.timer) return
        this.timer = setInterval(() => {
            void this.tick()
        }, this.tickIntervalMs)
        this.timer.unref()
        if (this.state.config.enabled) {
            void this.tick()
        }
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
    }

    public async tick(): Promise<SchedulerStatus> {
        return this.evaluate(new Date())
    }

    public getStatus(nowDate: Date = new Date()): SchedulerStatus {
        const config = this.state.config
        const vps = getClockSnapshot(config.vpsTimezone, nowDate)
        const local = getClockSnapshot(config.localTimezone, nowDate)
        const botBusy = Boolean(this.deps.isBotBusy())
        const botIdle = !botBusy
        const vpsNewDay = !this.state.lastRunVpsDate || vps.dateStr > this.state.lastRunVpsDate
        const localNewDay = !this.state.lastRunLocalDate || local.dateStr > this.state.lastRunLocalDate
        const localHourOk = local.hourDecimal >= config.minLocalHour && local.hourDecimal < config.maxLocalHour
        const flags = { vpsNewDay, localNewDay, localHourOk, botIdle }

        if (!config.enabled) {
            return this.buildStatus('DISABLED', vps, local, flags, null)
        }
        if (this.autoRunActive && botBusy) {
            return this.buildStatus('RUNNING', vps, local, flags, null)
        }
        if (!vpsNewDay || !localNewDay) {
            const phase: SchedulerPhase = !vpsNewDay && !localNewDay ? 'DONE_TODAY' : 'WAITING_NEW_DAY'
            return this.buildStatus(phase, vps, local, flags, null)
        }
        if (!localHourOk) {
            const phase: SchedulerPhase =
                local.hourDecimal < config.minLocalHour ? 'WAITING_LOCAL_HOUR' : 'WAITING_NEW_DAY'
            return this.buildStatus(phase, vps, local, flags, null)
        }

        if (
            this.state.plannedTargetAt &&
            this.state.plannedVpsDate === vps.dateStr &&
            this.state.plannedLocalDate === local.dateStr
        ) {
            const targetMs = Date.parse(this.state.plannedTargetAt)
            const nowMs = nowDate.getTime()
            if (Number.isFinite(targetMs) && nowMs < targetMs) {
                return this.buildStatus('COUNTDOWN', vps, local, flags, Math.ceil((targetMs - nowMs) / 1000))
            }
            if (!botIdle) {
                return this.buildStatus('WAITING_BOT_IDLE', vps, local, flags, 0)
            }
            if (config.requireProxy && this.cachedProxyOk === false) {
                return this.buildStatus('WAITING_PROXY', vps, local, flags, 0)
            }
            return this.buildStatus('COUNTDOWN', vps, local, flags, 0)
        }

        return this.buildStatus('COUNTDOWN', vps, local, flags, null)
    }

    public async evaluate(nowDate?: Date): Promise<SchedulerStatus> {
        const run = this.evalChain.then(() => this.evaluateInternal(nowDate))
        this.evalChain = run.then(
            () => undefined,
            () => undefined
        )
        return run
    }

    private async evaluateInternal(nowDate: Date = new Date()): Promise<SchedulerStatus> {
        const nowMs = nowDate.getTime()
        const config = this.state.config
        const vps = getClockSnapshot(config.vpsTimezone, nowDate)
        const local = getClockSnapshot(config.localTimezone, nowDate)
        const botBusy = Boolean(this.deps.isBotBusy())
        const botIdle = !botBusy
        const vpsNewDay = !this.state.lastRunVpsDate || vps.dateStr > this.state.lastRunVpsDate
        const localNewDay = !this.state.lastRunLocalDate || local.dateStr > this.state.lastRunLocalDate
        const localHourOk = local.hourDecimal >= config.minLocalHour && local.hourDecimal < config.maxLocalHour
        const flags = { vpsNewDay, localNewDay, localHourOk, botIdle }

        if (!config.enabled) {
            if (this.clearPlannedFields()) {
                this.saveState()
            }
            return this.emitIfChanged(this.buildStatus('DISABLED', vps, local, flags, null))
        }

        if (this.autoRunActive) {
            if (botBusy) {
                return this.emitIfChanged(this.buildStatus('RUNNING', vps, local, flags, null))
            }
            this.autoRunActive = false
        }

        if (!vpsNewDay || !localNewDay) {
            if (this.clearPlannedFields()) {
                this.saveState()
            }
            const phase: SchedulerPhase = !vpsNewDay && !localNewDay ? 'DONE_TODAY' : 'WAITING_NEW_DAY'
            return this.emitIfChanged(this.buildStatus(phase, vps, local, flags, null))
        }

        if (!localHourOk) {
            if (local.hourDecimal < config.minLocalHour) {
                if (this.hasStalePlan(vps.dateStr, local.dateStr) && this.clearPlannedFields()) {
                    this.saveState()
                }
                return this.emitIfChanged(this.buildStatus('WAITING_LOCAL_HOUR', vps, local, flags, null))
            }
            if (this.clearPlannedFields()) {
                this.saveState()
            }
            return this.emitIfChanged(this.buildStatus('WAITING_NEW_DAY', vps, local, flags, null))
        }

        if (
            !this.state.plannedTargetAt ||
            this.state.plannedVpsDate !== vps.dateStr ||
            this.state.plannedLocalDate !== local.dateStr
        ) {
            const jitterMin = this.rollJitter(config.minJitterMinutes, config.maxJitterMinutes)
            const targetMs = this.computeClampedTargetMs(nowMs, jitterMin, local.hourDecimal, config.maxLocalHour)
            this.state.plannedTargetAt = new Date(targetMs).toISOString()
            this.state.plannedVpsDate = vps.dateStr
            this.state.plannedLocalDate = local.dateStr
            this.state.plannedJitterMinutes = Math.max(0, Math.round((targetMs - nowMs) / 60_000))
            this.state.lastError = null
            this.saveState()

            const targetLocal = getClockSnapshot(config.localTimezone, new Date(targetMs))
            this.deps.onLog?.(
                'info',
                `[Auto-Scheduler] Đã lên lịch chạy ngẫu nhiên lúc ${targetLocal.dateStr} ${targetLocal.timeStr} (${local.timeZone}, +${this.state.plannedJitterMinutes} phút).`
            )
        }

        const targetMs = Date.parse(this.state.plannedTargetAt)
        if (Number.isFinite(targetMs) && nowMs < targetMs) {
            if (
                config.requireProxy &&
                (this.lastProxyProbeAt === null || Math.abs(nowMs - this.lastProxyProbeAt) >= this.proxyRetryIntervalMs)
            ) {
                try {
                    const probe = await this.deps.checkProxy()
                    this.cachedProxyOk = Boolean(probe.ok)
                } catch {
                    this.cachedProxyOk = false
                }
                this.lastProxyProbeAt = nowMs
            }
            const countdownSec = Math.max(1, Math.ceil((targetMs - nowMs) / 1000))
            return this.emitIfChanged(this.buildStatus('COUNTDOWN', vps, local, flags, countdownSec))
        }

        if (!botIdle) {
            return this.emitIfChanged(this.buildStatus('WAITING_BOT_IDLE', vps, local, flags, 0))
        }

        if (this.startRetryAfterMs !== null && nowMs < this.startRetryAfterMs) {
            return this.emitIfChanged(this.buildStatus('WAITING_BOT_IDLE', vps, local, flags, 0))
        }

        if (config.requireProxy) {
            if (
                this.lastProxyFailAt !== null &&
                nowMs >= this.lastProxyFailAt &&
                nowMs - this.lastProxyFailAt < this.proxyRetryIntervalMs
            ) {
                return this.emitIfChanged(this.buildStatus('WAITING_PROXY', vps, local, flags, 0))
            }

            let proxyRes: { ok: boolean; reason?: string }
            try {
                proxyRes = await this.deps.checkProxy()
            } catch (error) {
                proxyRes = { ok: false, reason: error instanceof Error ? error.message : String(error) }
            }

            this.lastProxyProbeAt = nowMs
            this.cachedProxyOk = Boolean(proxyRes.ok)

            if (!proxyRes.ok) {
                this.lastProxyFailAt = nowMs
                const reason = proxyRes.reason || 'Proxy offline — đang chờ proxy sẵn sàng.'
                if (this.state.lastError !== reason) {
                    this.state.lastError = reason
                    this.saveState()
                }
                return this.emitIfChanged(this.buildStatus('WAITING_PROXY', vps, local, flags, 0))
            }

            this.lastProxyFailAt = null
        }

        return this.launchBatchWithRollback(nowDate, vps, local, localHourOk)
    }

    private async launchBatchWithRollback(
        nowDate: Date,
        vps: ClockSnapshot,
        local: ClockSnapshot,
        localHourOk: boolean
    ): Promise<SchedulerStatus> {
        const nowMs = nowDate.getTime()
        const prevSnapshot = {
            lastRunVpsDate: this.state.lastRunVpsDate,
            lastRunLocalDate: this.state.lastRunLocalDate,
            lastAutoRunAt: this.state.lastAutoRunAt,
            plannedTargetAt: this.state.plannedTargetAt,
            plannedVpsDate: this.state.plannedVpsDate,
            plannedLocalDate: this.state.plannedLocalDate,
            plannedJitterMinutes: this.state.plannedJitterMinutes
        }

        this.state.lastRunVpsDate = vps.dateStr
        this.state.lastRunLocalDate = local.dateStr
        this.state.lastAutoRunAt = nowDate.toISOString()
        this.clearPlannedFields()
        this.state.lastError = null
        this.saveState()

        this.autoRunActive = true
        this.startRetryAfterMs = null
        this.deps.onLog?.(
            'info',
            `[Auto-Scheduler] Bắt đầu tự động chạy Batch (${local.dateStr} ${local.timeStr} ${local.timeZone}).`
        )

        try {
            await this.deps.startBatch()
            return this.emitIfChanged(
                this.buildStatus(
                    'RUNNING',
                    vps,
                    local,
                    { vpsNewDay: false, localNewDay: false, localHourOk, botIdle: false },
                    null
                ),
                true
            )
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            this.autoRunActive = false
            this.state.lastRunVpsDate = prevSnapshot.lastRunVpsDate
            this.state.lastRunLocalDate = prevSnapshot.lastRunLocalDate
            this.state.lastAutoRunAt = prevSnapshot.lastAutoRunAt
            this.state.plannedTargetAt = prevSnapshot.plannedTargetAt
            this.state.plannedVpsDate = prevSnapshot.plannedVpsDate
            this.state.plannedLocalDate = prevSnapshot.plannedLocalDate
            this.state.plannedJitterMinutes = prevSnapshot.plannedJitterMinutes
            this.state.lastError = msg
            this.startRetryAfterMs = nowMs + this.startErrorBackoffMs
            this.saveState()

            this.deps.onLog?.('error', `[Auto-Scheduler] Lỗi khởi chạy Batch: ${msg}`)
            return this.emitIfChanged(
                this.buildStatus(
                    'WAITING_BOT_IDLE',
                    vps,
                    local,
                    { vpsNewDay: true, localNewDay: true, localHourOk, botIdle: true },
                    0
                ),
                true
            )
        }
    }

    public async updateConfig(
        partial: Partial<SchedulerConfig> & Record<string, unknown>,
        nowDate?: Date
    ): Promise<SchedulerStatus> {
        const prev = this.state.config
        const next = this.normalizeConfig(partial as Record<string, unknown>, prev)

        const timingChanged =
            next.vpsTimezone !== prev.vpsTimezone ||
            next.localTimezone !== prev.localTimezone ||
            next.minLocalHour !== prev.minLocalHour ||
            next.maxLocalHour !== prev.maxLocalHour ||
            next.minJitterMinutes !== prev.minJitterMinutes ||
            next.maxJitterMinutes !== prev.maxJitterMinutes

        this.state.config = next
        if (!next.enabled || timingChanged) {
            this.clearPlannedFields()
        }
        if (next.enabled && !prev.enabled) {
            this.state.lastError = null
            this.lastProxyFailAt = null
            this.startRetryAfterMs = null
        }
        this.saveState()

        const status = await this.evaluate(nowDate)
        return this.emitIfChanged(status, true)
    }

    public async reroll(nowDate: Date = new Date()): Promise<SchedulerStatus> {
        if (!this.state.config.enabled) {
            throw new Error('Auto-Scheduler đang tắt. Hãy bật trước khi random lại giờ chạy.')
        }
        this.clearPlannedFields()
        this.state.lastError = null
        this.startRetryAfterMs = null
        this.saveState()

        const status = await this.evaluate(nowDate)
        return this.emitIfChanged(status, true)
    }

    public async runNow(nowDate: Date = new Date()): Promise<SchedulerStatus> {
        if (this.deps.isBotBusy()) {
            throw new Error('Bot đang chạy rồi.')
        }
        if (this.state.config.requireProxy) {
            let proxyRes: { ok: boolean; reason?: string }
            try {
                proxyRes = await this.deps.checkProxy()
            } catch (error) {
                proxyRes = { ok: false, reason: error instanceof Error ? error.message : String(error) }
            }
            this.cachedProxyOk = Boolean(proxyRes.ok)
            this.lastProxyProbeAt = nowDate.getTime()
            if (!proxyRes.ok) {
                const reason = proxyRes.reason || 'Proxy chưa sẵn sàng.'
                this.state.lastError = reason
                this.saveState()
                throw new Error(reason)
            }
            this.lastProxyFailAt = null
        }

        const vps = getClockSnapshot(this.state.config.vpsTimezone, nowDate)
        const local = getClockSnapshot(this.state.config.localTimezone, nowDate)
        const localHourOk =
            local.hourDecimal >= this.state.config.minLocalHour &&
            local.hourDecimal < this.state.config.maxLocalHour

        return this.launchBatchWithRollback(nowDate, vps, local, localHourOk)
    }

    public notifyBatchFinished(): void {
        this.autoRunActive = false
        const status = this.getStatus(new Date())
        this.emitIfChanged(status, true)
    }

    public recordProxyHeartbeat(ok: boolean, nowDate: Date = new Date()): void {
        const nowMs = nowDate.getTime()
        this.cachedProxyOk = ok
        this.lastProxyProbeAt = nowMs
        if (ok) {
            this.lastProxyFailAt = null
            if (this.state.lastError && /proxy/i.test(this.state.lastError)) {
                this.state.lastError = null
                this.saveState()
            }
        } else {
            this.lastProxyFailAt = nowMs
        }
        this.emitIfChanged(this.getStatus(nowDate))
    }
}

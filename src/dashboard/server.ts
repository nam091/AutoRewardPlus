import Fastify, { type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'

import axios from 'axios'
import AxiosClient from '../util/Axios'
import type { AccountProxy } from '../interface/Account'
import { stateService } from '../services/stateService'
import { runCheckpointService } from '../services/runCheckpointService'
import { sheetService } from '../services/sheetService'
import { ProcessManager, type LogLevel, type ProcessStatus, type RunLogEntry } from './processManager'
import { SingleAccountPool, type SinglePoolSnapshot, type SingleRunFinishEvent, type SingleRunLogEvent } from './singleAccountPool'
import { DiagnosticService } from './diagnosticService'
import { SessionService } from './sessionService'
import { ConfigService } from './configService'
import { AccountService, type AccountUpsertPayload } from './accountService'
import { SettingsService, type DashboardSettings } from './settingsService'
import { calculateAccountAge, extractStreak } from '../util/RewardUtils'

export interface AccountStatus {
    id: number
    email: string
    totalPoints: number
    dailyPoints: number
    pcProgress: string
    mobileProgress: string
    status: 'IDLE' | 'RUNNING' | 'OK' | 'ERROR' | 'STOPPED' | 'SUSPENDED'
    accountAge: string
    streak: string
    updatedAt: string
    onlineStatus?: string
    level?: string
    lifetimePoints?: number
    questPoints?: number
    redeemGoalTitle?: string
    redeemGoalPrice?: number
    proxy?: string
    geoLocale?: string
    lastError?: string
    enabled?: boolean
    tag?: string
    hasSession?: boolean
    hasDesktopSession?: boolean
    hasMobileSession?: boolean
    singleRunning?: boolean
    queued?: boolean
    queuePosition?: number | null
}

interface DashboardSocket {
    readyState: number
    send(data: string): void
    on(event: 'close', listener: () => void): void
}

interface LogQuery {
    limit?: string
    afterId?: string
    level?: LogLevel
}

interface SessionParams {
    account: string
}

interface DiagnosticFileQuery {
    dir?: string
    file?: string
}

interface ProxyTestBody {
    url?: string
    port?: number | string
    username?: string
    password?: string
}

function constantTimeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    if (leftBuffer.length !== rightBuffer.length) return false
    return timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeClientIp(rawIp: string | undefined): string {
    if (!rawIp) return ''
    return rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp
}

function isTrustedIp(rawIp: string | undefined): boolean {
    const ip = normalizeClientIp(rawIp)
    if (!ip) return false
    if (ip === '127.0.0.1' || ip === '::1') return true

    const parts = ip.split('.').map(p => Number.parseInt(p, 10))
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
    const [a, b] = parts as [number, number, number, number]

    // RFC1918 private LAN + Tailscale CGNAT (100.64.0.0/10)
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
}

export class DashboardServer {
    private readonly app = Fastify({ logger: false })
    private readonly settingsService = new SettingsService()
    private readonly accountService = new AccountService()
    private readonly processManager: ProcessManager
    private readonly singlePool: SingleAccountPool
    private readonly diagnosticService = new DiagnosticService()
    private readonly sessionService = new SessionService()
    private readonly configService = new ConfigService()
    private readonly apiToken = process.env.DASHBOARD_API_TOKEN?.trim() || null
    private readonly host = process.env.DASHBOARD_HOST?.trim() || '127.0.0.1'
    private readonly logSubscribers: Set<DashboardSocket> = new Set()
    private accounts: AccountStatus[] = []
    private liveCheckAt = 0
    private liveCheckResult = false
    private sessionMapCache = new Map<string, { hasDesktop: boolean; hasMobile: boolean }>()

    constructor() {
        const runtimeSettings = this.settingsService.getRaw()
        this.processManager = new ProcessManager({
            cwd: process.cwd(),
            getEnv: () => this.settingsService.buildChildEnv(process.env)
        })
        this.singlePool = new SingleAccountPool({
            cwd: process.cwd(),
            maxConcurrent: runtimeSettings.maxConcurrentSingleRuns,
            getEnv: () => this.settingsService.buildChildEnv(process.env)
        })
        this.loadAccounts()
        void this.refreshSessionCache()
        this.bindProcessEvents()
        this.setupRoutes()
    }

    private isAnyBotRunning(): boolean {
        return this.processManager.getStatus().active || this.singlePool.isActive()
    }

    private canWriteConfig(request: FastifyRequest): boolean {
        if (process.env.DASHBOARD_ALLOW_CONFIG_WRITE === '0') return false
        if (process.env.DASHBOARD_ALLOW_CONFIG_WRITE === '1') return true
        if (this.apiToken && this.isAuthorized(request)) return true
        return isTrustedIp(request.ip || request.socket?.remoteAddress)
    }

    private async refreshSessionCache(): Promise<void> {
        try {
            const sessions = await this.sessionService.list()
            const nextMap = new Map<string, { hasDesktop: boolean; hasMobile: boolean }>()
            for (const entry of sessions) {
                nextMap.set(entry.account.toLowerCase(), {
                    hasDesktop: entry.hasDesktop,
                    hasMobile: entry.hasMobile
                })
            }
            this.sessionMapCache = nextMap
        } catch {
            // Keep existing cache on transient read failure
        }
    }

    private bindProcessEvents(): void {
        this.processManager.on('log', (entry: RunLogEntry) => {
            const display = `[${new Date(entry.timestamp).toLocaleTimeString('vi-VN')}] ${entry.message}`
            this.broadcast({ type: 'LOG', data: display, entry })
        })
        this.processManager.on('status', (status: ProcessStatus) => {
            this.applyProcessStatus(status)
            this.broadcast({ type: 'STATUS', data: status, singlePool: this.singlePool.getSnapshot() })
        })
        this.processManager.on('finished', () => {
            try {
                const states = stateService.getStates()
                let changed = false
                const activeSingle = new Set(this.singlePool.getActiveEmails().map(e => e.toLowerCase()))
                for (const s of states) {
                    if (s.status === 'RUNNING' && !activeSingle.has(s.email.toLowerCase())) {
                        s.status = 'IDLE'
                        changed = true
                    }
                }
                if (changed) {
                    stateService.saveStates(states)
                }
            } catch {}
            this.loadAccounts()
            this.broadcast({ type: 'ACCOUNTS_CHANGED' })
            void this.syncToSheets()
        })

        this.singlePool.on('log', (evt: SingleRunLogEvent) => {
            this.processManager.recordExternalLog(evt.level, evt.message, evt.source, evt.runId)
        })
        this.singlePool.on('status', (snapshot: SinglePoolSnapshot) => {
            this.loadAccounts()
            this.broadcast({
                type: 'SINGLE_POOL',
                data: snapshot,
                status: this.processManager.getStatus()
            })
        })
        this.singlePool.on('finished', (evt: SingleRunFinishEvent) => {
            this.processManager.recordExternalHistory({
                runId: evt.runId,
                startedAt: evt.startedAt,
                endedAt: evt.endedAt,
                state: evt.state,
                exitCode: evt.exitCode,
                signal: evt.signal,
                logCount: 0,
                errorCount: evt.state === 'ERROR' ? 1 : 0,
                mode: 'single',
                email: evt.email
            })

            try {
                const states = stateService.getStates()
                const target = states.find(s => s.email.toLowerCase() === evt.email.toLowerCase())
                if (target && target.status === 'RUNNING') {
                    stateService.applyAccountState(evt.email, {
                        status: evt.stopRequested ? 'STOPPED' : evt.state === 'ERROR' ? 'ERROR' : 'IDLE',
                        ...(evt.state === 'ERROR' && !target.lastError
                            ? { lastError: `Tiến trình thoát với mã lỗi ${evt.exitCode ?? 'unknown'}` }
                            : {})
                    })
                }
            } catch {}

            void this.refreshSessionCache().then(() => {
                this.loadAccounts()
                this.broadcast({ type: 'ACCOUNTS_CHANGED' })
            })
            void this.syncToSheets()
        })
    }

    private loadAccounts(includeBanned = false): void {
        try {
            const isBatchActive = this.processManager.getStatus().active
            const isProcessActive = isBatchActive || this.singlePool.isActive()
            const activeSingleEmails = new Set(this.singlePool.getActiveEmails().map(e => e.toLowerCase()))
            const queuedList = this.singlePool.getQueuedEmails()
            const queuePosMap = new Map(queuedList.map((e, i) => [e.toLowerCase(), i + 1]))

            const rawAccountsMap = new Map(
                this.accountService.readRawAccounts().map(a => [a.email.toLowerCase(), a])
            )
            const runtimeSettings = this.settingsService.getRaw()
            const defaultProxyStr = runtimeSettings.defaultProxyUrl
                ? `${runtimeSettings.defaultProxyUrl}:${runtimeSettings.defaultProxyPort || 10808}`
                : 'Direct'

            const states = stateService.getStates()
            const visibleStates = includeBanned ? states : states.filter(s => s.status !== 'SUSPENDED')
            this.accounts = visibleStates.map((state, index) => {
                const lower = state.email.toLowerCase()
                const staleRunning = state.status === 'RUNNING' && !isProcessActive && !this.hasLiveBotProcess()
                const isSingleRunningHere = activeSingleEmails.has(lower)
                const staleWhileOtherSingleRuns =
                    this.singlePool.isActive() &&
                    !isBatchActive &&
                    state.status === 'RUNNING' &&
                    !isSingleRunningHere &&
                    !this.hasLiveBotProcess()

                const effectiveStatus = staleRunning || staleWhileOtherSingleRuns ? 'IDLE' : state.status
                const rawAcc = rawAccountsMap.get(lower)
                const accProxy = rawAcc?.proxy?.url
                    ? `${rawAcc.proxy.url}:${rawAcc.proxy.port}`
                    : state.proxy && state.proxy !== 'Direct'
                      ? state.proxy
                      : defaultProxyStr
                const sessMeta = this.sessionMapCache.get(lower)
                const qPos = queuePosMap.get(lower) ?? null

                return {
                    id: index + 1,
                    email: state.email,
                    totalPoints: state.totalPoints,
                    dailyPoints: state.dailyPoints,
                    pcProgress: state.pcProgress,
                    mobileProgress: state.mobileProgress,
                    status: effectiveStatus,
                    accountAge: state.accountAge,
                    streak: state.streak,
                    updatedAt: state.updatedAt,
                    onlineStatus: effectiveStatus === 'RUNNING' ? 'ONLINE' : 'OFFLINE',
                    level: state.level || 'Level 1',
                    lifetimePoints: state.lifetimePoints || 0,
                    questPoints: state.questPoints || 0,
                    redeemGoalTitle: state.redeemGoalTitle || 'None',
                    redeemGoalPrice: state.redeemGoalPrice || 0,
                    geoLocale: rawAcc?.geoLocale || state.geoLocale || 'vn',
                    proxy: accProxy,
                    lastError: state.lastError,
                    enabled: rawAcc ? rawAcc.enabled !== false : true,
                    tag: rawAcc?.tag || '',
                    hasSession: Boolean(sessMeta?.hasDesktop || sessMeta?.hasMobile),
                    hasDesktopSession: Boolean(sessMeta?.hasDesktop),
                    hasMobileSession: Boolean(sessMeta?.hasMobile),
                    singleRunning: isSingleRunningHere,
                    queued: qPos !== null,
                    queuePosition: qPos
                }
            })
        } catch (error) {
            this.processManager.log(
                'error',
                `Error loading accounts: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    /**
     * True when any bot process is alive, whoever started it.
     */
    private hasLiveBotProcess(): boolean {
        const now = Date.now()
        if (now - this.liveCheckAt < 5000) return this.liveCheckResult
        this.liveCheckAt = now

        try {
            const out = execFileSync('pgrep', ['-af', 'dist/index.js'], { encoding: 'utf-8', timeout: 2000 })
            this.liveCheckResult = out
                .split('\n')
                .map(line => line.trim())
                .some(line => line.length > 0 && !line.includes('pgrep') && !line.includes('dist/dashboard'))
        } catch {
            this.liveCheckResult = false
        }
        return this.liveCheckResult
    }

    private applyProcessStatus(status: ProcessStatus): void {
        this.loadAccounts()
        for (const account of this.accounts) {
            account.onlineStatus = status.active || account.singleRunning ? 'ONLINE' : 'OFFLINE'
        }
    }

    private broadcast(event: object): void {
        const payload = JSON.stringify(event)
        for (const socket of this.logSubscribers) {
            if (socket && typeof socket.send === 'function' && socket.readyState === 1) {
                try {
                    socket.send(payload)
                } catch {
                    this.logSubscribers.delete(socket)
                }
            } else if (!socket || socket.readyState > 1) {
                this.logSubscribers.delete(socket)
            }
        }
    }

    public broadcastLog(message: string): void {
        this.processManager.log('info', message)
    }

    private isProtectedPath(url: string): boolean {
        return url.startsWith('/api/') || url === '/api' || url.startsWith('/ws/')
    }

    private isAuthorized(request: FastifyRequest): boolean {
        if (!this.apiToken) return true
        const authorization = request.headers.authorization
        const supplied = authorization?.startsWith('Bearer ')
            ? authorization.slice(7).trim()
            : request.headers['x-api-key']
        return typeof supplied === 'string' && constantTimeEquals(supplied, this.apiToken)
    }

    private setupRoutes(): void {
        const allowedOrigin = process.env.DASHBOARD_ALLOWED_ORIGIN?.trim()
        this.app.register(cors, { origin: allowedOrigin || false })
        this.app.register(websocket)

        this.app.addHook('onRequest', async (request, reply) => {
            if (this.isProtectedPath(request.url) && !this.isAuthorized(request)) {
                await reply.code(401).send({ success: false, message: 'Dashboard authentication required.' })
            }
        })

        const webDir = path.resolve('src/dashboard/web')
        if (fs.existsSync(webDir)) {
            this.app.register(fastifyStatic, { root: webDir, prefix: '/' })
        }

        this.app.get('/favicon.ico', async (_request, reply) => reply.code(204).send())

        // Accounts list + runtime metadata
        this.app.get<{ Querystring: { showBanned?: string } }>('/api/accounts', async request => {
            await this.refreshSessionCache()
            const includeBanned = request.query.showBanned === '1' || request.query.showBanned === 'true'
            this.loadAccounts(includeBanned)
            const allStates = stateService.getStates()
            const rawAccounts = this.accountService.readRawAccounts()
            const settings = this.settingsService.get()

            return {
                success: true,
                data: this.accounts,
                meta: {
                    bannedCount: allStates.filter(s => s.status === 'SUSPENDED').length,
                    disabledCount: rawAccounts.filter(a => a.enabled === false).length,
                    resumeEmail: runCheckpointService.getResumeEmail(),
                    singlePool: this.singlePool.getSnapshot(),
                    batchStatus: this.processManager.getStatus(),
                    settings
                }
            }
        })

        // Manage accounts CRUD
        this.app.get('/api/accounts/manage', async () => {
            await this.refreshSessionCache()
            const entries = this.accountService.list().map(acc => {
                const sess = this.sessionMapCache.get(acc.email.toLowerCase())
                return {
                    ...acc,
                    hasSession: Boolean(sess?.hasDesktop || sess?.hasMobile),
                    hasDesktopSession: Boolean(sess?.hasDesktop),
                    hasMobileSession: Boolean(sess?.hasMobile)
                }
            })
            return { success: true, data: entries }
        })

        this.app.post<{ Body: AccountUpsertPayload }>('/api/accounts/manage', async (request, reply) => {
            if (!this.canWriteConfig(request)) {
                return reply.code(403).send({ success: false, message: 'Account writes are restricted to trusted hosts.' })
            }
            if (this.processManager.getStatus().active) {
                return reply.code(409).send({ success: false, message: 'Dừng bot chạy hàng loạt trước khi thêm tài khoản.' })
            }
            try {
                const created = await this.accountService.create(request.body || {})
                this.loadAccounts()
                this.broadcast({ type: 'ACCOUNTS_CHANGED' })
                return { success: true, data: created, message: `Đã thêm tài khoản ${created.email}.` }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                const code = message.includes('đã tồn tại') ? 409 : 400
                return reply.code(code).send({ success: false, message })
            }
        })

        this.app.post<{
            Body: { rawText?: string; geoLocale?: string; langCode?: string; tag?: string; enabled?: boolean }
        }>('/api/accounts/bulk-import', async (request, reply) => {
            if (!this.canWriteConfig(request)) {
                return reply.code(403).send({ success: false, message: 'Account writes are restricted to trusted hosts.' })
            }
            if (this.processManager.getStatus().active) {
                return reply.code(409).send({ success: false, message: 'Dừng bot chạy hàng loạt trước khi import.' })
            }
            try {
                const body = request.body || {}
                const res = await this.accountService.bulkImport(body.rawText || '', {
                    geoLocale: body.geoLocale,
                    langCode: body.langCode,
                    tag: body.tag,
                    enabled: body.enabled
                })
                this.loadAccounts()
                this.broadcast({ type: 'ACCOUNTS_CHANGED' })
                return {
                    success: true,
                    data: res,
                    message: `Import xong: +${res.added} mới, bỏ qua ${res.skipped} trùng${res.errors.length ? `, ${res.errors.length} lỗi` : ''}.`
                }
            } catch (error) {
                return reply.code(400).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
        })

        this.app.put<{ Params: SessionParams; Body: AccountUpsertPayload }>(
            '/api/accounts/manage/:account',
            async (request, reply) => {
                if (!this.canWriteConfig(request)) {
                    return reply
                        .code(403)
                        .send({ success: false, message: 'Account writes are restricted to trusted hosts.' })
                }
                const target = decodeURIComponent(request.params.account)
                if (this.processManager.getStatus().active || this.singlePool.hasEmail(target)) {
                    return reply
                        .code(409)
                        .send({ success: false, message: `Không thể sửa ${target} khi tài khoản đang chạy.` })
                }
                try {
                    const updated = await this.accountService.update(target, request.body || {})
                    this.loadAccounts()
                    this.broadcast({ type: 'ACCOUNTS_CHANGED' })
                    return { success: true, data: updated, message: `Đã cập nhật tài khoản ${updated.email}.` }
                } catch (error) {
                    return reply.code(400).send({
                        success: false,
                        message: error instanceof Error ? error.message : String(error)
                    })
                }
            }
        )

        this.app.patch<{ Params: SessionParams; Body: { enabled?: boolean } }>(
            '/api/accounts/manage/:account/toggle',
            async (request, reply) => {
                if (!this.canWriteConfig(request)) {
                    return reply
                        .code(403)
                        .send({ success: false, message: 'Account writes are restricted to trusted hosts.' })
                }
                const target = decodeURIComponent(request.params.account)
                try {
                    const updated = await this.accountService.toggleEnabled(target, request.body?.enabled)
                    this.loadAccounts()
                    this.broadcast({ type: 'ACCOUNTS_CHANGED' })
                    return {
                        success: true,
                        data: updated,
                        message: `${updated.email}: ${updated.enabled ? 'ĐÃ BẬT' : 'ĐÃ TẮT'}.`
                    }
                } catch (error) {
                    return reply.code(400).send({
                        success: false,
                        message: error instanceof Error ? error.message : String(error)
                    })
                }
            }
        )

        this.app.delete<{ Params: SessionParams }>('/api/accounts/manage/:account', async (request, reply) => {
            if (!this.canWriteConfig(request)) {
                return reply
                    .code(403)
                    .send({ success: false, message: 'Account writes are restricted to trusted hosts.' })
            }
            const target = decodeURIComponent(request.params.account)
            if (this.processManager.getStatus().active || this.singlePool.hasEmail(target)) {
                return reply
                    .code(409)
                    .send({ success: false, message: `Không thể xoá ${target} khi đang chạy.` })
            }
            const removed = await this.accountService.remove(target)
            if (!removed) {
                return reply.code(404).send({ success: false, message: `Không tìm thấy ${target}.` })
            }
            await this.sessionService.remove(target).catch(() => {})
            await this.refreshSessionCache()
            this.loadAccounts()
            this.broadcast({ type: 'ACCOUNTS_CHANGED' })
            return { success: true, message: `Đã xoá tài khoản ${target}.` }
        })

        // Status & Logs
        this.app.get('/api/status', async () => {
            const batch = this.processManager.getStatus()
            const singlePool = this.singlePool.getSnapshot()
            const mode = batch.active ? 'batch' : singlePool.activeCount > 0 || singlePool.queuedCount > 0 ? 'single' : 'idle'
            return {
                success: true,
                data: {
                    ...batch,
                    active: batch.active || singlePool.activeCount > 0,
                    mode,
                    singlePool
                }
            }
        })

        this.app.get<{ Querystring: LogQuery }>('/api/logs', async request => {
            const query = request.query
            const limit = query.limit ? Number.parseInt(query.limit, 10) : 200
            const afterId = query.afterId ? Number.parseInt(query.afterId, 10) : undefined
            return {
                success: true,
                data: this.processManager.getLogs({
                    limit: Number.isFinite(limit) ? limit : 200,
                    afterId: Number.isFinite(afterId) ? afterId : undefined,
                    minLevel: query.level
                })
            }
        })

        this.app.get('/api/errors', async () => ({ success: true, data: this.processManager.getErrors() }))
        this.app.get('/api/history', async () => ({ success: true, data: this.processManager.getHistory() }))

        // Diagnostics
        this.app.get('/api/diagnostics', async () => ({ success: true, data: await this.diagnosticService.list() }))
        this.app.get<{ Querystring: DiagnosticFileQuery }>('/api/diagnostics/file', async (request, reply) => {
            const dir = request.query.dir || '.'
            const file = request.query.file || ''
            try {
                const result = await this.diagnosticService.readFile(dir, file)
                return reply.header('Content-Type', result.contentType).send(result.buffer)
            } catch (error) {
                return reply.code(404).send({
                    success: false,
                    message: error instanceof Error ? error.message : 'Diagnostic file not found.'
                })
            }
        })
        this.app.delete('/api/diagnostics', async (request, reply) => {
            if (!this.canWriteConfig(request)) {
                return reply.code(403).send({ success: false, message: 'Forbidden.' })
            }
            await this.diagnosticService.clearAll()
            return { success: true, message: 'Đã xoá toàn bộ diagnostics.' }
        })

        // Sessions
        this.app.get('/api/sessions', async () => {
            const data = await this.sessionService.list()
            return { success: true, data }
        })
        this.app.delete<{ Params: SessionParams }>('/api/sessions/:account', async (request, reply) => {
            const account = decodeURIComponent(request.params.account)
            if (this.processManager.getStatus().active || this.singlePool.hasEmail(account)) {
                return reply.code(409).send({ success: false, message: 'Stop the bot before deleting a session.' })
            }
            const knownInAccounts = this.accountService
                .readRawAccounts()
                .some(entry => entry.email.toLowerCase() === account.toLowerCase())
            const knownInStates = this.accounts.some(entry => entry.email.toLowerCase() === account.toLowerCase())
            if (!knownInAccounts && !knownInStates) {
                return reply
                    .code(404)
                    .send({ success: false, message: 'Account was not found in the loaded account list.' })
            }
            await this.sessionService.remove(account)
            await this.refreshSessionCache()
            this.loadAccounts()
            return { success: true, message: `Đã xoá session của ${account}.` }
        })

        // Bot Config & Runtime Settings
        this.app.get('/api/config', async () => ({ success: true, data: await this.configService.snapshot() }))
        this.app.put<{ Body: unknown }>('/api/config', async (request, reply) => {
            if (!this.canWriteConfig(request)) {
                return reply.code(403).send({ success: false, message: 'Config writes are disabled.' })
            }
            if (this.isAnyBotRunning()) {
                return reply.code(409).send({ success: false, message: 'Stop the bot before changing config.' })
            }
            try {
                const snapshot = await this.configService.write(request.body)
                return { success: true, data: snapshot, message: 'Đã lưu cấu hình bot (config.json) thành công.' }
            } catch (error) {
                return reply.code(400).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
        })

        this.app.get('/api/settings', async () => ({ success: true, data: this.settingsService.get() }))
        this.app.put<{ Body: Partial<DashboardSettings> & { clearProxyPassword?: boolean } }>(
            '/api/settings',
            async (request, reply) => {
                if (!this.canWriteConfig(request)) {
                    return reply.code(403).send({ success: false, message: 'Settings writes are disabled.' })
                }
                try {
                    const updated = await this.settingsService.write(request.body || {})
                    this.singlePool.setMaxConcurrent(updated.maxConcurrentSingleRuns)
                    this.loadAccounts()
                    this.broadcast({ type: 'ACCOUNTS_CHANGED' })
                    return { success: true, data: updated, message: 'Đã lưu cài đặt Proxy & Dashboard.' }
                } catch (error) {
                    return reply.code(400).send({
                        success: false,
                        message: error instanceof Error ? error.message : String(error)
                    })
                }
            }
        )

        // Proxy telemetry & live end-to-end check from VPS -> Windows Proxy -> Internet
        this.app.get('/api/proxy/status', async () => {
            const settings = this.settingsService.getRaw()
            const rawAccounts = this.accountService.readRawAccounts()
            const customProxyAccounts = rawAccounts.filter(a => Boolean(a.proxy?.url)).length
            const result = await this.checkProxyEndpoint(settings)
            return {
                success: true,
                data: {
                    ...result,
                    defaultProxyUrl: settings.defaultProxyUrl,
                    defaultProxyPort: settings.defaultProxyPort,
                    hasAuth: Boolean(settings.defaultProxyUsername),
                    customProxyAccounts,
                    totalAccounts: rawAccounts.length
                }
            }
        })

        this.app.post<{ Body: ProxyTestBody }>('/api/proxy/test', async request => {
            const settings = this.settingsService.getRaw()
            const body = request.body || {}
            const rawUrl = typeof body.url === 'string' ? body.url.trim() : settings.defaultProxyUrl
            const rawPort =
                body.port !== undefined ? Number.parseInt(String(body.port), 10) : settings.defaultProxyPort
            const username = typeof body.username === 'string' ? body.username.trim() : settings.defaultProxyUsername
            const password =
                typeof body.password === 'string' && body.password !== '[REDACTED]' && body.password !== ''
                    ? body.password
                    : settings.defaultProxyPassword

            const testSettings: DashboardSettings = {
                ...settings,
                defaultProxyUrl: rawUrl,
                defaultProxyPort: Number.isFinite(rawPort) ? rawPort : 0,
                defaultProxyUsername: username,
                defaultProxyPassword: password
            }

            const result = await this.testProxyEndToEnd(testSettings)
            return { success: result.ok, data: result, message: result.message }
        })

        // Execution controls
        this.app.post('/api/start', async (_request, reply) => {
            if (this.singlePool.isActive()) {
                return reply.code(409).send({
                    success: false,
                    message: 'Đang có tài khoản chạy đơn hoặc đang chờ trong hàng đợi. Hãy dừng hoặc chờ xong trước khi Chạy Tất Cả.'
                })
            }
            try {
                const status = await this.processManager.start()
                this.applyProcessStatus(status)
                await this.syncToSheets()
                return { success: true, data: status, message: 'Đã khởi động chạy toàn bộ dàn tài khoản.' }
            } catch (error) {
                return reply.code(409).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
        })

        this.app.post('/api/stop', async (_request, reply) => {
            const batchActive = this.processManager.getStatus().active
            const singleActive = this.singlePool.isActive()
            if (!batchActive && !singleActive) {
                return reply.code(409).send({ success: false, message: 'Không có tiến trình nào đang chạy.' })
            }
            if (batchActive) {
                await this.processManager.stop()
            }
            if (singleActive) {
                await this.singlePool.stopAll()
            }
            this.loadAccounts()
            await this.syncToSheets()
            return {
                success: true,
                data: { ...this.processManager.getStatus(), singlePool: this.singlePool.getSnapshot() },
                message: 'Đã dừng toàn bộ tiến trình bot.'
            }
        })

        this.app.post('/api/restart', async (_request, reply) => {
            try {
                if (this.singlePool.isActive()) {
                    await this.singlePool.stopAll()
                }
                const status = await this.processManager.restart()
                await this.syncToSheets()
                return { success: true, data: status, message: 'Đã restart bot thành công.' }
            } catch (error) {
                return reply.code(409).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
        })

        this.app.post<{ Params: SessionParams }>('/api/run-account/:account', async (request, reply) => {
            if (this.processManager.getStatus().active) {
                return reply.code(409).send({
                    success: false,
                    message: 'Bot đang chạy hàng loạt (Chạy Tất Cả). Hãy dừng trước khi chạy đơn lẻ.'
                })
            }
            const targetAccount = decodeURIComponent(request.params.account)
            try {
                const result = await this.singlePool.enqueueOrStart(targetAccount)
                this.loadAccounts()
                const msg =
                    result.status === 'queued'
                        ? `Đã đạt 2/${result.snapshot.maxConcurrent} acc đơn đang chạy — đã xếp ${targetAccount} vào hàng đợi (#${result.position}).`
                        : `Đang chạy đơn: ${targetAccount} (${result.snapshot.activeCount}/${result.snapshot.maxConcurrent} slot).`
                return {
                    success: true,
                    queued: result.status === 'queued',
                    position: result.position ?? null,
                    data: result.snapshot,
                    message: msg
                }
            } catch (error) {
                return reply.code(409).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
        })

        this.app.post<{ Params: SessionParams }>('/api/stop-account/:account', async (request, reply) => {
            const targetAccount = decodeURIComponent(request.params.account)
            const res = await this.singlePool.stopAccount(targetAccount)
            this.loadAccounts()
            if (!res.stopped && !res.removedFromQueue) {
                return reply.code(404).send({
                    success: false,
                    message: `${targetAccount} không nằm trong danh sách đang chạy đơn hoặc hàng đợi.`
                })
            }
            return {
                success: true,
                data: res.snapshot,
                message: res.removedFromQueue
                    ? `Đã huỷ ${targetAccount} khỏi hàng đợi.`
                    : `Đã gửi lệnh dừng tài khoản ${targetAccount}.`
            }
        })

        this.app.post('/api/run-unfinished', async (_request, reply) => {
            if (this.processManager.getStatus().active) {
                return reply.code(409).send({
                    success: false,
                    message: 'Bot đang chạy hàng loạt. Hãy dừng trước.'
                })
            }
            const rawAccounts = this.accountService.readRawAccounts().filter(a => a.enabled !== false)
            const statesByEmail = new Map(stateService.getStates().map(s => [s.email.toLowerCase(), s]))
            const candidates = rawAccounts
                .filter(acc => {
                    const st = statesByEmail.get(acc.email.toLowerCase())
                    return !st || (st.status !== 'OK' && st.status !== 'SUSPENDED')
                })
                .map(acc => acc.email)

            if (candidates.length === 0) {
                return { success: true, queued: 0, message: 'Không có tài khoản lỗi/chờ nào cần chạy.' }
            }

            let started = 0
            let queued = 0
            for (const email of candidates) {
                if (this.singlePool.hasEmail(email)) continue
                const res = await this.singlePool.enqueueOrStart(email)
                if (res.status === 'started') started++
                else queued++
            }
            this.loadAccounts()
            return {
                success: true,
                started,
                queued,
                data: this.singlePool.getSnapshot(),
                message: `Đã kích hoạt ${started} acc chạy ngay và xếp ${queued} acc vào hàng đợi (tối đa ${this.singlePool.getMaxConcurrent()} acc cùng lúc).`
            }
        })

        this.app.post('/api/checkpoint/clear', async () => {
            runCheckpointService.clear()
            return { success: true, message: 'Đã xoá checkpoint — lần Chạy Tất Cả tiếp theo sẽ chạy từ đầu.' }
        })

        this.app.post<{ Params: SessionParams }>('/api/refresh-account/:account', async (request, reply) => {
            const email = decodeURIComponent(request.params.account)
            try {
                const updated = await this.refreshAccountInfo(email)
                this.loadAccounts()
                return { success: true, data: updated, message: `Đã làm mới thông tin cho: ${email}` }
            } catch (error) {
                return reply.code(400).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
        })

        this.app.post('/api/refresh-all', async () => {
            const rawAccounts = this.accountService.readRawAccounts().filter(a => a.enabled !== false)
            const statesByEmail = new Map(stateService.getStates().map(s => [s.email.toLowerCase(), s]))
            const targets = rawAccounts.filter(a => statesByEmail.get(a.email.toLowerCase())?.status !== 'SUSPENDED')

            let okCount = 0
            let failCount = 0
            const CONCURRENCY = 3
            for (let i = 0; i < targets.length; i += CONCURRENCY) {
                const batch = targets.slice(i, i + CONCURRENCY)
                const settled = await Promise.allSettled(batch.map(acc => this.refreshAccountInfo(acc.email)))
                for (const r of settled) {
                    if (r.status === 'fulfilled') okCount++
                    else failCount++
                }
            }
            this.loadAccounts()
            this.broadcast({ type: 'ACCOUNTS_CHANGED' })
            return {
                success: true,
                okCount,
                failCount,
                message: `Làm mới hoàn tất: ${okCount} thành công, ${failCount} lỗi/chưa có session.`
            }
        })

        this.app.post('/api/sync-sheets', async () => {
            await this.syncToSheets()
            return { success: true, message: 'Đồng bộ Google Sheets hoàn tất.' }
        })

        this.app.register(async instance => {
            instance.get('/ws/logs', { websocket: true }, (rawSocket: any) => {
                const socket: DashboardSocket = rawSocket?.socket ?? rawSocket
                if (!socket || typeof socket.send !== 'function') return

                this.logSubscribers.add(socket)
                for (const entry of this.processManager.getLogs({ limit: 200 })) {
                    try {
                        socket.send(JSON.stringify({ type: 'LOG', data: entry.message, entry }))
                    } catch {
                        // ignore
                    }
                }
                try {
                    socket.send(
                        JSON.stringify({
                            type: 'STATUS',
                            data: this.processManager.getStatus(),
                            singlePool: this.singlePool.getSnapshot()
                        })
                    )
                } catch {
                    // ignore
                }
                if (typeof socket.on === 'function') {
                    socket.on('close', () => this.logSubscribers.delete(socket))
                }
            })
        })
    }

    private resolveEffectiveProxy(email?: string): AccountProxy {
        const rawAcc = email ? this.accountService.getRawAccount(email) : null
        if (rawAcc?.proxy?.url) {
            return rawAcc.proxy
        }
        const settings = this.settingsService.getRaw()
        return {
            proxyAxios: true,
            url: settings.defaultProxyUrl,
            port: settings.defaultProxyPort || 0,
            username: settings.defaultProxyUsername,
            password: settings.defaultProxyPassword
        }
    }

    private async checkProxyEndpoint(settings: DashboardSettings): Promise<{
        configured: boolean
        tcpReachable: boolean
        latencyMs: number | null
        proxyStats: unknown
        error?: string
    }> {
        if (!settings.defaultProxyUrl || !settings.defaultProxyPort) {
            return { configured: false, tcpReachable: false, latencyMs: null, proxyStats: null }
        }

        let host = settings.defaultProxyUrl
        let port = settings.defaultProxyPort
        try {
            const parsed = new URL(
                settings.defaultProxyUrl.includes('://') ? settings.defaultProxyUrl : `http://${settings.defaultProxyUrl}`
            )
            host = parsed.hostname
            port = settings.defaultProxyPort || Number.parseInt(parsed.port || '10808', 10)
        } catch {
            return {
                configured: true,
                tcpReachable: false,
                latencyMs: null,
                proxyStats: null,
                error: 'Invalid proxy URL'
            }
        }

        const start = Date.now()
        const tcpReachable = await new Promise<boolean>(resolve => {
            const socket = net.createConnection({ host, port, timeout: settings.proxyHealthTimeoutMs }, () => {
                socket.destroy()
                resolve(true)
            })
            socket.on('timeout', () => {
                socket.destroy()
                resolve(false)
            })
            socket.on('error', () => {
                socket.destroy()
                resolve(false)
            })
        })
        const latencyMs = tcpReachable ? Date.now() - start : null

        let proxyStats: unknown = null
        if (tcpReachable && !settings.defaultProxyUrl.toLowerCase().startsWith('socks')) {
            try {
                const headers: Record<string, string> = {}
                if (settings.defaultProxyUsername) {
                    const token = Buffer.from(
                        `${settings.defaultProxyUsername}:${settings.defaultProxyPassword}`
                    ).toString('base64')
                    headers['Proxy-Authorization'] = `Basic ${token}`
                }
                const res = await axios.get(`http://${host}:${port}/stats`, {
                    headers,
                    timeout: settings.proxyHealthTimeoutMs
                })
                proxyStats = res.data
            } catch {
                // Non-AutoReward proxy servers may not expose /stats
            }
        }

        return {
            configured: true,
            tcpReachable,
            latencyMs,
            proxyStats,
            ...(tcpReachable ? {} : { error: `Không kết nối được tới ${host}:${port}` })
        }
    }

    private async testProxyEndToEnd(settings: DashboardSettings): Promise<{
        ok: boolean
        proxyServer: string
        externalIp: string | null
        latencyMs: number | null
        rewardsReachable: boolean
        proxyStats: unknown
        message: string
        error?: string
    }> {
        const proxyLabel = settings.defaultProxyUrl
            ? `${settings.defaultProxyUrl}:${settings.defaultProxyPort || 10808}`
            : 'Direct (VPS IP)'

        const health = await this.checkProxyEndpoint(settings)
        if (settings.defaultProxyUrl && !health.tcpReachable) {
            return {
                ok: false,
                proxyServer: proxyLabel,
                externalIp: null,
                latencyMs: null,
                rewardsReachable: false,
                proxyStats: null,
                error: health.error || 'TCP unreachable',
                message: `Proxy offline: không kết nối được ${proxyLabel}`
            }
        }

        const proxyConfig: AccountProxy = {
            proxyAxios: Boolean(settings.defaultProxyUrl),
            url: settings.defaultProxyUrl,
            port: settings.defaultProxyPort || 0,
            username: settings.defaultProxyUsername,
            password: settings.defaultProxyPassword
        }

        const client = new AxiosClient(proxyConfig)
        const start = Date.now()
        let externalIp: string | null = null
        let rewardsReachable = false

        try {
            const ipRes = await client.request({
                url: 'https://api.ipify.org?format=json',
                method: 'GET',
                timeout: 10000
            })
            externalIp = ipRes.data?.ip ? String(ipRes.data.ip) : null
        } catch (err) {
            const errText = err instanceof Error ? err.message : String(err)
            return {
                ok: false,
                proxyServer: proxyLabel,
                externalIp: null,
                latencyMs: null,
                rewardsReachable: false,
                proxyStats: health.proxyStats,
                error: errText,
                message: `Proxy mở cổng nhưng tunnel HTTPS lỗi: ${errText}`
            }
        }

        const latencyMs = Date.now() - start

        try {
            const bingRes = await client.request({
                url: 'https://rewards.bing.com/',
                method: 'HEAD',
                timeout: 8000,
                validateStatus: s => s >= 200 && s < 400
            })
            rewardsReachable = bingRes.status >= 200 && bingRes.status < 400
        } catch {
            rewardsReachable = false
        }

        return {
            ok: true,
            proxyServer: proxyLabel,
            externalIp,
            latencyMs,
            rewardsReachable,
            proxyStats: health.proxyStats,
            message: `Proxy OK (${latencyMs}ms) | Exit IP: ${externalIp || 'unknown'}`
        }
    }

    private async syncToSheets(): Promise<void> {
        try {
            const status = this.processManager.getStatus()
            const rows = this.accounts.map(account => ({
                email: account.email,
                totalPoints: account.totalPoints,
                dailyPoints: account.dailyPoints,
                pcProgress: account.pcProgress,
                mobileProgress: account.mobileProgress,
                status: account.status,
                accountAge: account.accountAge,
                updatedAt: account.updatedAt,
                streak: account.streak,
                onlineStatus: account.onlineStatus || (status.active ? 'ONLINE' : 'OFFLINE')
            }))
            await sheetService.syncAccountsToSheet(rows)
        } catch (error) {
            this.processManager.log(
                'warn',
                `Google Sheets sync skipped: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    public async refreshAccountInfo(email: string): Promise<Partial<AccountStatus>> {
        const sessionDirs = [
            path.resolve('dist/browser/sessions', email),
            path.resolve('src/browser/sessions', email),
            path.resolve('sessions', email)
        ]
        let sessionFile = ''
        for (const dir of sessionDirs) {
            const candidateDesktop = path.join(dir, 'session_desktop.json')
            const candidateMobile = path.join(dir, 'session_mobile.json')
            if (fs.existsSync(candidateDesktop)) {
                sessionFile = candidateDesktop
                break
            }
            if (fs.existsSync(candidateMobile)) {
                sessionFile = candidateMobile
                break
            }
        }
        if (!sessionFile) {
            throw new Error(
                `Tài khoản ${email} chưa có session (chưa đăng nhập). Hãy bấm nút ⚡ (Chạy đơn) để bot đăng nhập và lưu session.`
            )
        }

        const cookies = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'))
        const allowedDomains = ['bing.com', 'live.com', 'microsoftonline.com']
        const cookieStr = cookies
            .filter((c: any) => allowedDomains.some(d => c.domain && c.domain.includes(d)))
            .map((c: any) => `${c.name}=${c.value}`)
            .join('; ')

        const effectiveProxy = this.resolveEffectiveProxy(email)
        const client = new AxiosClient(effectiveProxy)
        const res = await client.request({
            url: 'https://rewards.bing.com/api/getuserinfo?type=1',
            method: 'GET',
            headers: {
                Cookie: cookieStr,
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
                Referer: 'https://rewards.bing.com/',
                Origin: 'https://rewards.bing.com'
            },
            timeout: 15000
        })

        const dashboard = res.data?.dashboard
        if (!dashboard) {
            throw new Error('Không lấy được dữ liệu dashboard. Cookie có thể đã hết hạn.')
        }

        const streak = extractStreak(dashboard)
        const accountCreated = dashboard.created || dashboard.userProfile?.attributes?.created
        const accountAge = calculateAccountAge(accountCreated)
        const level =
            dashboard.userStatus?.levelInfo?.activeLevelName ||
            dashboard.userStatus?.levelInfo?.activeLevel ||
            dashboard.userProfile?.attributes?.level ||
            'Level 1'
        const lifetimePoints = dashboard.userStatus?.lifetimePoints || 0
        const totalPoints = dashboard.userStatus?.availablePoints || 0
        const redeemGoalTitle = dashboard.userStatus?.redeemGoal?.title || 'None'
        const redeemGoalPrice = dashboard.userStatus?.redeemGoal?.price || 0
        const geoLocale = dashboard.userProfile?.attributes?.country?.toLowerCase() || 'vn'

        const sumCounters = (entries: Array<{ pointProgress?: number; pointProgressMax?: number }> | undefined) =>
            (entries ?? []).reduce(
                (acc, x) => ({
                    progress: acc.progress + (x.pointProgress ?? 0),
                    max: acc.max + (x.pointProgressMax ?? 0)
                }),
                { progress: 0, max: 0 }
            )
        const pcCounters = sumCounters(dashboard.userStatus?.counters?.pcSearch)
        const mobCounters = sumCounters(dashboard.userStatus?.counters?.mobileSearch)
        const dailyCounter = sumCounters(dashboard.userStatus?.counters?.dailyPoint)

        const existingState = stateService.getStates().find(s => s.email.toLowerCase() === email.toLowerCase())
        const nextStatus =
            existingState?.status === 'SUSPENDED'
                ? 'SUSPENDED'
                : existingState?.status === 'RUNNING'
                  ? 'RUNNING'
                  : 'OK'

        const updateData: Partial<AccountStatus> = {
            totalPoints,
            ...(dailyCounter.progress > 0 ? { dailyPoints: dailyCounter.progress } : {}),
            ...(pcCounters.max > 0 ? { pcProgress: `${pcCounters.progress}/${pcCounters.max}` } : {}),
            ...(mobCounters.max > 0 ? { mobileProgress: `${mobCounters.progress}/${mobCounters.max}` } : {}),
            streak,
            accountAge,
            level,
            lifetimePoints,
            redeemGoalTitle,
            redeemGoalPrice,
            geoLocale,
            proxy: effectiveProxy.url ? `${effectiveProxy.url}:${effectiveProxy.port}` : 'Direct',
            status: nextStatus,
            lastError: ''
        }

        stateService.updateAccountState(email, updateData)
        return updateData
    }

    public async start(port = 3000): Promise<void> {
        const isTailscaleOrAllowed = process.env.DASHBOARD_ALLOW_NO_AUTH === '1' || this.host.startsWith('100.')
        if (!this.apiToken && !['127.0.0.1', '::1', 'localhost'].includes(this.host) && !isTailscaleOrAllowed) {
            throw new Error('DASHBOARD_API_TOKEN is required when DASHBOARD_HOST is not local.')
        }
        try {
            await this.app.listen({ port, host: this.host })
            console.log(`[DashboardServer] Running at http://${this.host}:${port}`)
        } catch (error) {
            console.error(error)
            throw error
        }
    }

    public async close(): Promise<void> {
        await this.singlePool.stopAll()
        await this.processManager.shutdown()
        await this.app.close()
    }
}

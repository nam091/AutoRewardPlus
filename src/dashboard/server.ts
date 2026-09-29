import Fastify, { type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'

import axios from 'axios'
import { stateService } from '../services/stateService'
import { sheetService } from '../services/sheetService'
import { ProcessManager, type LogLevel, type ProcessStatus, type RunLogEntry } from './processManager'
import { DiagnosticService } from './diagnosticService'
import { SessionService } from './sessionService'
import { ConfigService } from './configService'
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

function constantTimeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    if (leftBuffer.length !== rightBuffer.length) return false
    return timingSafeEqual(leftBuffer, rightBuffer)
}

export class DashboardServer {
    private readonly app = Fastify({ logger: false })
    private readonly processManager: ProcessManager
    private readonly diagnosticService = new DiagnosticService()
    private readonly sessionService = new SessionService()
    private readonly configService = new ConfigService()
    private readonly apiToken = process.env.DASHBOARD_API_TOKEN?.trim() || null
    private readonly host = process.env.DASHBOARD_HOST?.trim() || '127.0.0.1'
    private readonly logSubscribers: Set<DashboardSocket> = new Set()
    private accounts: AccountStatus[] = []

    constructor() {
        this.processManager = new ProcessManager({ cwd: process.cwd() })
        this.loadAccounts()
        this.bindProcessEvents()
        this.setupRoutes()
    }

    private bindProcessEvents(): void {
        this.processManager.on('log', (entry: RunLogEntry) => {
            const display = `[${new Date(entry.timestamp).toLocaleTimeString('vi-VN')}] ${entry.message}`
            this.broadcast({ type: 'LOG', data: display, entry })
        })
        this.processManager.on('status', (status: ProcessStatus) => {
            this.applyProcessStatus(status)
            this.broadcast({ type: 'STATUS', data: status })
        })
        this.processManager.on('finished', () => {
            try {
                const states = stateService.getStates()
                let changed = false
                for (const s of states) {
                    if (s.status === 'RUNNING') {
                        s.status = 'IDLE'
                        changed = true
                    }
                }
                if (changed) {
                    stateService.saveStates(states)
                }
            } catch {}
            this.loadAccounts()
            void this.syncToSheets()
        })
    }

    private loadAccounts(): void {
        try {
            const isProcessActive = this.processManager.getStatus().active
            const states = stateService.getStates()
            this.accounts = states.map((state, index) => {
                const effectiveStatus = (!isProcessActive && state.status === 'RUNNING') ? 'IDLE' : state.status
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
                    geoLocale: state.geoLocale || 'vn',
                    proxy:
                        state.proxy && state.proxy !== 'Direct'
                            ? state.proxy
                            : process.env.DEFAULT_PROXY_URL
                              ? `${process.env.DEFAULT_PROXY_URL}:${process.env.DEFAULT_PROXY_PORT || 10808}`
                              : 'Direct',
                    lastError: state.lastError
                }
            })
        } catch (error) {
            this.processManager.log(
                'error',
                `Error loading accounts: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private applyProcessStatus(status: ProcessStatus): void {
        this.loadAccounts()
        for (const account of this.accounts) {
            account.onlineStatus = status.active ? 'ONLINE' : 'OFFLINE'
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

        this.app.get('/api/accounts', async () => {
            this.loadAccounts()
            return { success: true, data: this.accounts }
        })

        this.app.get('/api/status', async () => ({ success: true, data: this.processManager.getStatus() }))

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
        this.app.get('/api/diagnostics', async () => ({ success: true, data: await this.diagnosticService.list() }))
        this.app.get('/api/sessions', async () => ({ success: true, data: await this.sessionService.list() }))
        this.app.get('/api/config', async () => ({ success: true, data: await this.configService.snapshot() }))
        this.app.put<{ Body: unknown }>('/api/config', async (request, reply) => {
            if (process.env.DASHBOARD_ALLOW_CONFIG_WRITE !== '1') {
                return reply.code(403).send({ success: false, message: 'Config writes are disabled.' })
            }
            if (this.processManager.getStatus().active) {
                return reply.code(409).send({ success: false, message: 'Stop the bot before changing config.' })
            }
            try {
                const snapshot = await this.configService.write(request.body)
                return { success: true, data: snapshot, message: 'Config saved with an atomic write.' }
            } catch (error) {
                return reply.code(400).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
        })
        this.app.delete<{ Params: SessionParams }>('/api/sessions/:account', async (request, reply) => {
            if (this.processManager.getStatus().active) {
                return reply.code(409).send({ success: false, message: 'Stop the bot before deleting a session.' })
            }
            const account = decodeURIComponent(request.params.account)
            if (!this.accounts.some(entry => entry.email.toLowerCase() === account.toLowerCase())) {
                return reply
                    .code(404)
                    .send({ success: false, message: 'Account was not found in the loaded account list.' })
            }
            await this.sessionService.remove(account)
            return { success: true, message: 'Session deleted.' }
        })

        this.app.post('/api/start', async (_request, reply) => {
            try {
                const status = await this.processManager.start()
                this.applyProcessStatus(status)
                await this.syncToSheets()
                return { success: true, data: status, message: 'Đã khởi động bot thành công.' }
            } catch (error) {
                return reply.code(409).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
        })

        this.app.post('/api/stop', async (_request, reply) => {
            const before = this.processManager.getStatus()
            if (!before.active) {
                return reply.code(409).send({ success: false, message: 'Không có tiến trình nào đang chạy.' })
            }
            const status = await this.processManager.stop()
            await this.syncToSheets()
            return { success: true, data: status, message: 'Đã dừng bot.' }
        })

        this.app.post('/api/restart', async (_request, reply) => {
            try {
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
            const targetAccount = decodeURIComponent(request.params.account)
            try {
                const status = await this.processManager.start(['-email', targetAccount])
                this.applyProcessStatus(status)
                return { success: true, data: status, message: `Đã khởi động chạy riêng tài khoản: ${targetAccount}` }
            } catch (error) {
                return reply.code(409).send({
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                })
            }
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
                    socket.send(JSON.stringify({ type: 'STATUS', data: this.processManager.getStatus() }))
                } catch {
                    // ignore
                }
                if (typeof socket.on === 'function') {
                    socket.on('close', () => this.logSubscribers.delete(socket))
                }
            })
        })
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
            throw new Error(`Tài khoản ${email} chưa có session (chưa đăng nhập). Hãy bấm nút ⚡ (Chạy riêng) để bot tự động đăng nhập và lưu session trước.`)
        }

        const cookies = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'))
        const allowedDomains = ['bing.com', 'live.com', 'microsoftonline.com']
        const cookieStr = cookies
            .filter((c: any) => allowedDomains.some(d => c.domain && c.domain.includes(d)))
            .map((c: any) => `${c.name}=${c.value}`)
            .join('; ')

        const res = await axios.get('https://rewards.bing.com/api/getuserinfo?type=1', {
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

        const updateData: Partial<AccountStatus> = {
            totalPoints,
            streak,
            accountAge,
            level,
            lifetimePoints,
            redeemGoalTitle,
            redeemGoalPrice,
            geoLocale,
            status: 'OK'
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
        await this.processManager.shutdown()
        await this.app.close()
    }
}

import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import cluster, { Worker } from 'cluster'
import type { BrowserContext, Cookie, Page } from 'patchright'
import pkg from '../package.json'

import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'

import Browser from './browser/Browser'
import BrowserFunc from './browser/BrowserFunc'
import BrowserUtils from './browser/BrowserUtils'

import { IpcLog, Logger } from './logging/Logger'
import Utils, { errMsg } from './util/Utils'
import { loadAccounts, loadConfig, saveSessionData } from './util/Load'
import { checkNodeVersion } from './util/Validator'
import {
    calculateAccountAge,
    extractStreak,
    hasZeroRedemptionEvidence,
    isNewAccountAge,
    syncNewTagByAge
} from './util/RewardUtils'

import { Login } from './browser/auth/Login'
import { Workers } from './functions/Workers'
import Activities from './functions/Activities'
import { SearchManager } from './functions/SearchManager'

import type { Account } from './interface/Account'
import type { ExecutionMode } from './interface/Config'
import AxiosClient from './util/Axios'
import { sendDiscord, sendDiscordSummary, sendDiscordAccountNotification, flushDiscordQueue } from './logging/Discord'
import { sendNtfy, sendNtfyAccountNotification, flushNtfyQueue } from './logging/Ntfy'
import type { DashboardData } from './interface/DashboardData'
import type { AppDashboardData } from './interface/AppDashBoardData'
import type { AppEarnablePoints } from './interface/Points'
import { sheetService } from './services/sheetService'
import {
    isAccountTagSyncMessage,
    isStateUpdateMessage,
    stateService,
    type AccountTagSyncMessage
} from './services/stateService'
import { runCheckpointService } from './services/runCheckpointService'
import { AccountService } from './dashboard/accountService'
import { getAccountStartDelayMs, maskAccount } from './browser/humanize/BehaviorPolicy'
import { resolveExecutionProfile, type ResolvedExecutionProfile } from './browser/humanize/ExecutionProfile'
import { SeededRandom } from './browser/humanize/SeededRandom'

interface ExecutionContext {
    isMobile: boolean
    account: Account
}

interface BrowserSession {
    context: BrowserContext
    fingerprint: BrowserFingerprintWithHeaders
}

interface AccountStats {
    email: string
    initialPoints: number
    finalPoints: number
    collectedPoints: number
    pcPoints: number
    mobilePoints: number
    questPoints: number
    claimedPoints: number
    pcProgress: string
    mobileProgress: string
    duration: number
    success: boolean
    error?: string
    streak?: string
    accountAge?: string
    level?: string
    lifetimePoints?: number
    redeemGoalTitle?: string
    redeemGoalPrice?: number
    proxy?: string
    geoLocale?: string
    tag?: string
    redemptionCount?: number
    lifetimePointsRedeemed?: number
    syncedLifetimeRedeemed?: number
    lastOrderTitle?: string
    lastOrderDate?: string
    executionMode?: ExecutionMode
}

interface AccountRunResult {
    initialPoints: number
    finalPoints?: number
    collectedPoints: number
    pcPoints: number
    mobilePoints: number
    questPoints: number
    pcProgress: string
    mobileProgress: string
    streak: string
    accountAge: string
    level?: string
    lifetimePoints?: number
    redeemGoalTitle?: string
    redeemGoalPrice?: number
    tag?: string
    redemptionCount?: number
    lifetimePointsRedeemed?: number
    syncedLifetimeRedeemed?: number
    lastOrderTitle?: string
    lastOrderDate?: string
    executionMode?: ExecutionMode
}

/** Retries per account for transient infrastructure failures. */
const ACCOUNT_MAX_ATTEMPTS = 3
const ACCOUNT_RETRY_BASE_DELAY_MS = 30_000

/**
 * Credential and configuration problems will fail identically on every attempt,
 * so only network/timeout style failures are worth retrying.
 */
function isRetryableAccountError(error: unknown): boolean {
    const message = errMsg(error).toLowerCase()

    const permanentSignals = [
        'password',
        'invalid credentials',
        'account locked',
        'account suspended',
        'banned',
        'verify your identity',
        '2fa',
        'totp'
    ]
    if (permanentSignals.some(signal => message.includes(signal))) {
        return false
    }

    const retryableSignals = [
        'timeout',
        'timed out',
        'econnreset',
        'econnrefused',
        'enotfound',
        'etimedout',
        'socket hang up',
        'network',
        'net::err',
        'target closed',
        'browser has been closed',
        'protocol error',
        '429',
        '431',
        '502',
        '503',
        '504'
    ]
    return retryableSignals.some(signal => message.includes(signal))
}

const executionContext = new AsyncLocalStorage<ExecutionContext>()

/**
 * Returns the active account context, or throws.
 *
 * This used to fabricate `{ account: {} as any }` when no context was set, which
 * turned a missing context into an `undefined` email surfacing far from the
 * cause. Callers that need the account should fail here instead.
 */
export function getCurrentContext(): ExecutionContext {
    const context = executionContext.getStore()
    if (!context) {
        throw new Error(
            'No execution context available. Account work must run inside executionContext.run({ isMobile, account }, ...).'
        )
    }
    return context
}

/** Device flag for logging, safe to call outside an account context. */
export function isMobileContext(): boolean {
    return executionContext.getStore()?.isMobile ?? false
}

async function flushAllWebhooks(timeoutMs = 5000): Promise<void> {
    await Promise.allSettled([flushDiscordQueue(timeoutMs), flushNtfyQueue(timeoutMs)])
}

interface UserData {
    userName: string
    geoLocale: string
    langCode: string
    initialPoints: number
    currentPoints: number
    gainedPoints: number
    claimedPoints: number
    modernQuestPoints?: number
}

export class MicrosoftRewardsBot {
    public logger: Logger
    public config
    public utils: Utils
    public activities: Activities = new Activities(this)
    public browser: { func: BrowserFunc; utils: BrowserUtils }

    public mainMobilePage!: Page
    public mainDesktopPage!: Page

    public userData: UserData
    public currentExecutionProfile: ResolvedExecutionProfile

    public rewardsVersion: 'legacy' | 'modern' = 'legacy'

    public accessToken = ''
    public requestToken = ''
    public cookies: { mobile: Cookie[]; desktop: Cookie[] }
    public fingerprint!: BrowserFingerprintWithHeaders

    private pointsCanCollect = 0

    private activeWorkers: number
    private exitedWorkers: number[]
    private browserFactory: Browser = new Browser(this)
    private accounts: Account[]
    private workers: Workers
    private login = new Login(this)
    private searchManager: SearchManager

    public axios!: AxiosClient

    constructor() {
        this.userData = {
            userName: '',
            geoLocale: 'vn',
            langCode: 'en',
            initialPoints: 0,
            currentPoints: 0,
            gainedPoints: 0,
            claimedPoints: 0,
            modernQuestPoints: 0
        }
        this.logger = new Logger(this)
        this.accounts = []
        this.cookies = { mobile: [], desktop: [] }
        this.utils = new Utils()
        this.workers = new Workers(this)
        this.searchManager = new SearchManager(this)
        this.browser = {
            func: new BrowserFunc(this),
            utils: new BrowserUtils(this)
        }
        this.config = loadConfig()
        this.currentExecutionProfile = resolveExecutionProfile({ config: this.config })
        this.activeWorkers = this.config.clusters
        this.exitedWorkers = []
    }

    get isMobile(): boolean {
        return isMobileContext()
    }

    async initialize(): Promise<void> {
        this.accounts = loadAccounts()
        const emailArgIdx = process.argv.findIndex(arg => arg === '-email' || arg === '--email')
        let isSingleAccount = false
        if (emailArgIdx !== -1 && process.argv[emailArgIdx + 1]) {
            const targetEmail = process.argv[emailArgIdx + 1]!.trim().toLowerCase()
            const filtered = this.accounts.filter(a => a.email.toLowerCase() === targetEmail)
            if (filtered.length > 0) {
                this.accounts = filtered
                isSingleAccount = true
                this.logger.info('main', 'FILTER', `Filtered for single account: ${targetEmail}`)
            } else {
                this.logger.warn('main', 'FILTER', `Target account ${targetEmail} not found in accounts.json, running all`)
            }
        }

        if (!isSingleAccount) {
            const disabledCount = this.accounts.filter(a => a.enabled === false).length
            if (disabledCount > 0) {
                this.accounts = this.accounts.filter(a => a.enabled !== false)
                this.logger.info('main', 'FILTER', `Skipped ${disabledCount} disabled account(s) (enabled=false)`)
            }
        }

        // A single-account run is an explicit user choice and must not move
        // the batch resume point. Batch runs resume from the last account they
        // reached on the same local day.
        const batchRun = !isSingleAccount && this.accounts.length > 1
        runCheckpointService.enabled = batchRun
        if (batchRun) {
            let resumeEmail = runCheckpointService.getResumeEmail()

            // First launch after adding the checkpoint feature (or after the
            // file was lost): fall back to today's first ERROR row still in
            // db.json so the batch starts where the previous run broke.
            if (!resumeEmail) {
                const today = new Date()
                const stamp = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`
                resumeEmail =
                    stateService
                        .getStates()
                        .find(s => ['ERROR', 'RUNNING'].includes(s.status) && (s.updatedAt || '').includes(stamp))?.email || null
                if (resumeEmail) {
                    this.logger.info('main', 'RESUME', `No checkpoint file — using today's unfinished row: ${resumeEmail}`)
                }
            }

            if (resumeEmail) {
                const totalBeforeResume = this.accounts.length
                const idx = this.accounts.findIndex(a => a.email.toLowerCase() === resumeEmail.toLowerCase())
                if (idx >= 0) {
                    // Only run this account and the ones after it. Accounts
                    // before the checkpoint already succeeded this day.
                    this.accounts = this.accounts.slice(idx)
                    this.logger.info(
                        'main',
                        'RESUME',
                        `Same-day resume: starting from ${resumeEmail} (${idx + 1}/${totalBeforeResume})`
                    )
                }
            }
        }
    }

    async run(): Promise<void> {
        const totalAccounts = this.accounts.length
        const runStartTime = Date.now()

        this.logger.info(
            'main',
            'RUN-START',
            `Starting Microsoft Rewards Script | v${pkg.version} | Accounts: ${totalAccounts} | Clusters: ${this.config.clusters}`
        )

        if (totalAccounts === 0) {
            this.logger.warn('main', 'RUN-END', 'No enabled accounts to run. Exiting.')
            await flushAllWebhooks()
            process.exit(0)
        }

        if (this.config.clusters > 1) {
            if (cluster.isPrimary) {
                await this.runMaster(runStartTime)
            } else {
                this.runWorker(runStartTime)
            }
        } else {
            await this.runTasks(this.accounts, runStartTime)
        }
    }

    private async runMaster(runStartTime: number): Promise<void> {
        void this.logger.info('main', 'CLUSTER-PRIMARY', `Primary process started | PID: ${process.pid}`)

        const rawChunks = this.utils.chunkArray(this.accounts, this.config.clusters)
        const accountChunks = rawChunks.filter(c => c && c.length > 0)
        this.activeWorkers = accountChunks.length

        if (accountChunks.length === 0) {
            this.logger.warn('main', 'CLUSTER-PRIMARY', 'No account chunks to schedule. Exiting.')
            await flushAllWebhooks()
            process.exit(0)
        }

        const allAccountStats: AccountStats[] = []
        let hadWorkerFailure = false

        const distEntry = path.resolve('dist/index.js')
        const execFile = fs.existsSync(distEntry) ? distEntry : (process.argv[1] || path.resolve('src/index.ts'))
        cluster.setupPrimary({ exec: execFile })

        const accountService = new AccountService()
        for (const chunk of accountChunks) {
            const worker = cluster.fork()
            worker.send?.({ chunk, runStartTime })

            worker.on('message', (msg: { __ipcLog?: IpcLog; __stats?: AccountStats[] }) => {
                if (msg.__stats) {
                    allAccountStats.push(...msg.__stats)
                }

                // Only the primary writes db.json; workers forward their state
                // changes here so concurrent clusters cannot clobber each other.
                if (isStateUpdateMessage(msg)) {
                    const { email, update } = msg.__stateUpdate
                    stateService.applyAccountState(email, update)
                }

                if (isAccountTagSyncMessage(msg)) {
                    accountService.syncNewTagByEmailSync(msg.__accountAgeSync.email, msg.__accountAgeSync.isNew)
                }

                const log = msg.__ipcLog
                if (log && typeof log.content === 'string') {
                    const { webhook } = this.config
                    const { content, level } = log

                    // Webhooks, for later expansion?
                    if (webhook.discord?.enabled && webhook.discord.url) {
                        sendDiscord(webhook.discord.url, content, level)
                    }
                    if (webhook.ntfy?.enabled && webhook.ntfy.url) {
                        sendNtfy(webhook.ntfy, content, level)
                    }
                }
            })

            // Startup delay for clusters due to resource usage
            if (accountChunks.indexOf(chunk) !== accountChunks.length - 1) {
                await this.utils.wait(5000)
            }
        }

        const onWorkerExit = async (worker: Worker, code?: number, signal?: string): Promise<void> => {
            const { pid } = worker.process

            if (!pid || this.exitedWorkers.includes(pid)) {
                return
            }

            this.exitedWorkers.push(pid)
            this.activeWorkers -= 1

            // exit 0 = good, exit 1 = crash
            const failed = (code ?? 0) !== 0 || Boolean(signal)
            if (failed) {
                hadWorkerFailure = true
            }

            this.logger.warn(
                'main',
                'CLUSTER-WORKER-EXIT',
                `Worker ${pid} exit | Code: ${code ?? 'n/a'} | Signal: ${signal ?? 'n/a'} | Active workers: ${this.activeWorkers}`
            )

            if (this.activeWorkers <= 0) {
                const totalCollectedPoints = allAccountStats.reduce((sum, s) => sum + s.collectedPoints, 0)
                const totalInitialPoints = allAccountStats.reduce((sum, s) => sum + s.initialPoints, 0)
                const totalFinalPoints = allAccountStats.reduce((sum, s) => sum + s.finalPoints, 0)
                const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1)

                this.logger.info(
                    'main',
                    'RUN-END',
                    `Completed all accounts | Accounts processed: ${allAccountStats.length} | Total points collected: +${totalCollectedPoints} | Old total: ${totalInitialPoints} → New total: ${totalFinalPoints} | Total runtime: ${totalDurationMinutes}min`,
                    'green'
                )

                // Send Discord summary embed
                if (this.config.webhook.discord?.enabled && this.config.webhook.discord.url) {
                    await sendDiscordSummary(
                        this.config.webhook.discord.url,
                        allAccountStats,
                        totalDurationMinutes,
                        this.logger.errorCount,
                        this.logger.warningCount
                    )
                }

                await this.syncToGoogleSheets(allAccountStats)
                await flushAllWebhooks()

                const runnableCount = stateService
                    .getStates()
                    .filter(s => this.accounts.some(a => a.email.toLowerCase() === s.email.toLowerCase()) && s.status !== 'SUSPENDED')
                    .length
                const allSucceeded =
                    allAccountStats.length >= runnableCount &&
                    allAccountStats.every(stat => stat.success)
                if (allSucceeded && !hadWorkerFailure) {
                    runCheckpointService.clear()
                    this.logger.info('main', 'RESUME-CLEAR', 'Full batch succeeded — checkpoint cleared')
                }

                process.exit(hadWorkerFailure ? 1 : 0)
            }
        }

        cluster.on('exit', (worker, code, signal) => {
            void onWorkerExit(worker, code ?? undefined, signal ?? undefined)
        })

        cluster.on('disconnect', worker => {
            const pid = worker.process?.pid
            this.logger.warn('main', 'CLUSTER-WORKER-DISCONNECT', `Worker ${pid ?? '?'} disconnected`) // <-- Warning only
        })
    }

    private runWorker(runStartTimeFromMaster?: number): void {
        void this.logger.info('main', 'CLUSTER-WORKER-START', `Worker spawned | PID: ${process.pid}`)

        process.on('message', async ({ chunk, runStartTime }: { chunk: Account[]; runStartTime: number }) => {
            void this.logger.info(
                'main',
                'CLUSTER-WORKER-TASK',
                `Worker ${process.pid} received ${chunk.length} accounts.`
            )

            try {
                const stats = await this.runTasks(chunk, runStartTime ?? runStartTimeFromMaster ?? Date.now())

                // Send and flush before exit
                if (process.send) {
                    process.send({ __stats: stats })
                }

                await flushAllWebhooks()
                process.exit(0)
            } catch (error) {
                this.logger.error('main', 'CLUSTER-WORKER-ERROR', `Worker task crash: ${errMsg(error)}`)

                await flushAllWebhooks()
                process.exit(1)
            }
        })
    }

    private async runTasks(accounts: Account[], runStartTime: number): Promise<AccountStats[]> {
        const accountStats: AccountStats[] = []

        for (const account of accounts) {
            const accountStartTime = Date.now()
            const accountEmail = account.email
            const proxyDisplay = account.proxy?.url ? `${account.proxy.url}:${account.proxy.port}` : 'Direct'

            // Skip accounts known to be suspended during batch runs (can still be re-tested individually)
            if (accounts.length > 1) {
                const existingState = stateService
                    .getStates()
                    .find(s => s.email.toLowerCase() === accountEmail.toLowerCase())
                if (existingState?.status === 'SUSPENDED') {
                    this.logger.warn(
                        'main',
                        'ACCOUNT-SKIP',
                        `[ACCOUNT-SUSPENDED] ${accountEmail} — Microsoft Rewards account suspended. Skipping batch run.`
                    )
                    continue
                }
            }

            this.userData.userName = this.utils.getEmailUsername(accountEmail)
            this.userData.claimedPoints = 0 // Reset for each account
            this.userData.modernQuestPoints = 0

            try {
                const startDelay = this.config.behavior?.accountStartDelay
                if (startDelay) {
                    const delayMs = getAccountStartDelayMs(
                        accountEmail,
                        new Date(runStartTime).toISOString().slice(0, 10),
                        this.utils.stringToNumber(startDelay.min),
                        this.utils.stringToNumber(startDelay.max)
                    )
                    if (this.config.behavior?.telemetry) {
                        this.logger.info(
                            'main',
                            'ACCOUNT-SCHEDULE',
                            `account=${maskAccount(accountEmail)} | delayMs=${delayMs}`
                        )
                    }
                    await this.utils.wait(delayMs)
                }
                this.logger.info(
                    'main',
                    'ACCOUNT-START',
                    `Starting account: ${accountEmail} | geoLocale: ${account.geoLocale}`
                )
                stateService.updateAccountState(accountEmail, {
                    status: 'RUNNING',
                    proxy: proxyDisplay,
                    geoLocale: account.geoLocale || 'vn'
                })

                this.axios = new AxiosClient(account.proxy)

                const { result, lastError } = await this.runAccountWithRetry(account, accountEmail)

                const durationSeconds = ((Date.now() - accountStartTime) / 1000).toFixed(1)

                if (result) {
                    const collectedPoints = result.collectedPoints ?? 0
                    const accountInitialPoints = result.initialPoints ?? 0
                    const accountFinalPoints = result.finalPoints ?? (accountInitialPoints + collectedPoints)
                    const accountClaimedPoints = this.userData.claimedPoints ?? 0
                    const accountPcPoints = result.pcPoints ?? 0
                    const accountMobilePoints = result.mobilePoints ?? 0
                    const accountQuestPoints = result.questPoints ?? 0

                    accountStats.push({
                        email: accountEmail,
                        initialPoints: accountInitialPoints,
                        finalPoints: accountFinalPoints,
                        collectedPoints: collectedPoints,
                        pcPoints: accountPcPoints,
                        mobilePoints: accountMobilePoints,
                        questPoints: accountQuestPoints,
                        claimedPoints: accountClaimedPoints,
                        pcProgress: result.pcProgress,
                        mobileProgress: result.mobileProgress,
                        duration: parseFloat(durationSeconds),
                        success: true,
                        streak: result.streak,
                        accountAge: result.accountAge,
                        level: result.level,
                        lifetimePoints: result.lifetimePoints,
                        redeemGoalTitle: result.redeemGoalTitle,
                        redeemGoalPrice: result.redeemGoalPrice,
                        proxy: account.proxy?.url ? `${account.proxy.url}:${account.proxy.port}` : 'Direct',
                        geoLocale: account.geoLocale,
                        tag: result.tag,
                        redemptionCount: result.redemptionCount,
                        lifetimePointsRedeemed: result.lifetimePointsRedeemed,
                        syncedLifetimeRedeemed: result.syncedLifetimeRedeemed,
                        lastOrderTitle: result.lastOrderTitle,
                        lastOrderDate: result.lastOrderDate,
                        executionMode: result.executionMode
                    })

                    stateService.updateAccountState(accountEmail, {
                        status: 'OK',
                        totalPoints: accountFinalPoints,
                        dailyPoints: collectedPoints,
                        pcProgress: result.pcProgress,
                        mobileProgress: result.mobileProgress,
                        streak: result.streak,
                        accountAge: result.accountAge,
                        level: result.level,
                        lifetimePoints: result.lifetimePoints,
                        questPoints: accountQuestPoints,
                        redeemGoalTitle: result.redeemGoalTitle,
                        redeemGoalPrice: result.redeemGoalPrice,
                        proxy: account.proxy?.url ? `${account.proxy.url}:${account.proxy.port}` : 'Direct',
                        geoLocale: account.geoLocale,
                        tag: result.tag,
                        redemptionCount: result.redemptionCount,
                        lifetimePointsRedeemed: result.lifetimePointsRedeemed,
                        syncedLifetimeRedeemed: result.syncedLifetimeRedeemed,
                        lastOrderTitle: result.lastOrderTitle,
                        lastOrderDate: result.lastOrderDate,
                        executionMode: result.executionMode,
                        lastError: ''
                    })

                    this.logger.info(
                        'main',
                        'ACCOUNT-END',
                        `Completed account: ${accountEmail} | Total: +${collectedPoints} | Old: ${accountInitialPoints} → New: ${accountFinalPoints} | Streak: 🔥 ${result.streak} | Age: ${result.accountAge} | PC: ${result.pcProgress} | Mobile: ${result.mobileProgress} | Duration: ${durationSeconds}s`,
                        'green'
                    )
                } else {
                    const errString = lastError ? errMsg(lastError) : 'Flow failed'
                    const isSuspended =
                        errString.toLowerCase().includes('suspended') ||
                        errString.toLowerCase().includes('đình chỉ')
                    accountStats.push({
                        email: accountEmail,
                        initialPoints: 0,
                        finalPoints: 0,
                        collectedPoints: 0,
                        pcPoints: 0,
                        mobilePoints: 0,
                        questPoints: 0,
                        claimedPoints: 0,
                        pcProgress: 'N/A',
                        mobileProgress: 'N/A',
                        duration: parseFloat(durationSeconds),
                        success: false,
                        error: errString
                    })
                    stateService.updateAccountState(accountEmail, {
                        status: isSuspended ? 'SUSPENDED' : 'ERROR',
                        lastError: errString,
                        proxy: proxyDisplay,
                        geoLocale: account.geoLocale || 'vn'
                    })
                }
            } catch (error) {
                const durationSeconds = ((Date.now() - accountStartTime) / 1000).toFixed(1)
                const errString = errMsg(error)
                const isSuspended =
                    errString.toLowerCase().includes('suspended') ||
                    errString.toLowerCase().includes('đình chỉ')
                this.logger.error('main', 'ACCOUNT-ERROR', `${accountEmail}: ${errString}`)

                accountStats.push({
                    email: accountEmail,
                    initialPoints: 0,
                    finalPoints: 0,
                    collectedPoints: 0,
                    pcPoints: 0,
                    mobilePoints: 0,
                    questPoints: 0,
                    claimedPoints: 0,
                    pcProgress: 'N/A',
                    mobileProgress: 'N/A',
                    duration: parseFloat(durationSeconds),
                    success: false,
                    error: errString
                })
                stateService.updateAccountState(accountEmail, {
                    status: isSuspended ? 'SUSPENDED' : 'ERROR',
                    lastError: errString,
                    proxy: proxyDisplay,
                    geoLocale: account.geoLocale || 'vn'
                })
            }

            // Send per-account webhook notification
            const lastStat = accountStats[accountStats.length - 1]
            if (lastStat && cluster.isPrimary) {
                if (this.config.webhook.discord?.enabled && this.config.webhook.discord.url) {
                    await sendDiscordAccountNotification(this.config.webhook.discord.url, lastStat)
                }
                if (this.config.webhook.ntfy?.enabled && this.config.webhook.ntfy.url) {
                    await sendNtfyAccountNotification(this.config.webhook.ntfy, lastStat)
                }
            }
        }

        if (this.config.clusters <= 1 && cluster.isPrimary) {
            const totalCollectedPoints = accountStats.reduce((sum, s) => sum + s.collectedPoints, 0)
            const totalInitialPoints = accountStats.reduce((sum, s) => sum + s.initialPoints, 0)
            const totalFinalPoints = accountStats.reduce((sum, s) => sum + s.finalPoints, 0)
            const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1)

            this.logger.info(
                'main',
                'RUN-END',
                `Completed all accounts | Accounts processed: ${accountStats.length} | Total points collected: +${totalCollectedPoints} | Old total: ${totalInitialPoints} → New total: ${totalFinalPoints} | Total runtime: ${totalDurationMinutes}min`,
                'green'
            )

            // Send Discord summary embed
            if (this.config.webhook.discord?.enabled && this.config.webhook.discord.url) {
                await sendDiscordSummary(
                    this.config.webhook.discord.url,
                    accountStats,
                    totalDurationMinutes,
                    this.logger.errorCount,
                    this.logger.warningCount
                )
            }

            await this.syncToGoogleSheets(accountStats)
            await flushAllWebhooks()

            const runnableCount = stateService
                .getStates()
                .filter(s => this.accounts.some(a => a.email.toLowerCase() === s.email.toLowerCase()) && s.status !== 'SUSPENDED')
                .length
            if (accountStats.length >= runnableCount && accountStats.every(stat => stat.success)) {
                runCheckpointService.clear()
                this.logger.info('main', 'RESUME-CLEAR', 'Full batch succeeded — checkpoint cleared')
            }

            process.exit(0)
        }

        return accountStats
    }

    /**
     * Runs one account, retrying transient infrastructure failures.
     *
     * A dropped connection or a browser timeout used to cost the account its
     * entire daily run, which matters for a bot scheduled once per day.
     * Credential and lockout failures are not retried — they fail identically
     * every time and repeated login attempts add account risk.
     */
    private async runAccountWithRetry(
        account: Account,
        accountEmail: string
    ): Promise<{ result?: AccountRunResult; lastError?: unknown }> {
        let lastError: unknown
        const maxAttempts = Math.max(1, this.config.maxAccountRetries ?? ACCOUNT_MAX_ATTEMPTS)

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await this.Main(account)
                if (attempt > 1) {
                    this.logger.info(
                        'main',
                        'ACCOUNT-RETRY',
                        `Succeeded for ${accountEmail} on attempt ${attempt}/${maxAttempts}`,
                        'green'
                    )
                }
                return { result }
            } catch (error) {
                lastError = error
                this.logger.error(
                    'main',
                    'FLOW',
                    `Flow failed for ${accountEmail} (attempt ${attempt}/${maxAttempts}): ${errMsg(error)}`
                )

                const canRetry = attempt < maxAttempts && isRetryableAccountError(error)
                if (!canRetry) {
                    if (attempt < maxAttempts) {
                        this.logger.warn(
                            'main',
                            'ACCOUNT-RETRY',
                            `Not retrying ${accountEmail}: failure looks permanent (credentials, lockout or configuration)`
                        )
                    }
                    break
                }

                const backoffMs = ACCOUNT_RETRY_BASE_DELAY_MS * attempt
                this.logger.warn(
                    'main',
                    'ACCOUNT-RETRY',
                    `Retrying ${accountEmail} in ${Math.round(backoffMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
                )
                await this.utils.wait(backoffMs)

                // A retry must not inherit cached dashboard data or a stale token.
                this.browser.func.invalidateDashboardCache()
                this.accessToken = ''
                this.cookies = { mobile: [], desktop: [] }
                this.userData.claimedPoints = 0
                this.userData.modernQuestPoints = 0
            }
        }

        return { lastError }
    }

    async Main(account: Account): Promise<AccountRunResult> {
        const accountEmail = account.email
        this.logger.info('main', 'FLOW', `Starting session for ${accountEmail}`)

        let mobileSession: BrowserSession | null = null
        let mobileContextClosed = false

        try {
            return await executionContext.run({ isMobile: true, account }, async () => {
                mobileSession = await this.browserFactory.createBrowser(account)
                const initialContext: BrowserContext = mobileSession.context
                this.mainMobilePage = await initialContext.newPage()

                this.logger.info('main', 'BROWSER', `Mobile Browser started | ${accountEmail}`)

                await this.login.login(this.mainMobilePage, account)

                try {
                    this.accessToken = await this.login.getAppAccessToken(this.mainMobilePage, accountEmail)
                } catch (error) {
                    this.logger.error('main', 'FLOW', `Failed to get mobile access token: ${errMsg(error)}`)
                }

                this.cookies.mobile = await initialContext.cookies()
                this.fingerprint = mobileSession.fingerprint

                // Detect UI version
                if (await this.browser.func.isModernUI(this.mainMobilePage)) {
                    this.rewardsVersion = 'modern'
                    this.logger.info('main', 'UI-DETECTION', 'Modern Microsoft Rewards UI detected.')
                    await this.browser.func.getModernSearchBreakdown(this.mainMobilePage).catch(err => {
                        this.logger.warn('main', 'MODERN-BREAKDOWN', `Failed to get points breakdown: ${errMsg(err)}`)
                    })
                } else {
                    this.rewardsVersion = 'legacy'
                    this.logger.info('main', 'UI-DETECTION', 'Legacy Microsoft Rewards UI detected.')
                }

                const data: DashboardData = await this.browser.func.getDashboardData(false, this.mainMobilePage)
                let appData: AppDashboardData | null = null
                try {
                    appData = await this.browser.func.getAppDashboardData()
                } catch (appErr: any) {
                    if (appErr?.message?.includes('Account Suspended')) throw appErr
                    this.logger.warn(
                        'main',
                        'APP-DASHBOARD',
                        `Optional mobile app dashboard unavailable: ${errMsg(appErr)}`
                    )
                }

                // Set geo & language
                this.userData.geoLocale =
                    account.geoLocale && account.geoLocale !== 'auto'
                        ? account.geoLocale.toLowerCase()
                        : (data.userProfile?.attributes?.country?.toLowerCase() || 'vn')
                this.userData.langCode = (
                    account.langCode || (this.userData.geoLocale === 'vn' ? 'vi' : 'en')
                ).toLowerCase()
                this.userData.modernQuestPoints = 0
                if (this.userData.geoLocale.length > 2) {
                    this.logger.warn(
                        'main',
                        'GEO-LOCALE',
                        `The provided geoLocale is longer than 2 (${this.userData.geoLocale} | auto=${account.geoLocale === 'auto'}), this is likely invalid and can cause errors!`
                    )
                }

                const initialPoints = data.userStatus?.availablePoints ?? 0
                this.userData.initialPoints = initialPoints
                this.userData.currentPoints = initialPoints

                const streak = extractStreak(data)
                const accountCreated =
                    data.created || data.userProfile?.attributes?.created || appData?.response?.profile?.attributes?.created
                const accountAge = calculateAccountAge(accountCreated)
                const level =
                    data.userStatus?.levelInfo?.activeLevelName ||
                    data.userStatus?.levelInfo?.activeLevel ||
                    data.userProfile?.attributes?.level ||
                    'Level 1'
                const lifetimePoints = data.userStatus?.lifetimePoints || 0
                const redeemGoalTitle = data.userStatus?.redeemGoal?.title || appData?.response?.goal_item?.name || 'None'
                const redeemGoalPrice = data.userStatus?.redeemGoal?.price || appData?.response?.goal_item?.price || 0

                // Sync 'new' tag based on account creation/age (< 90 days)
                const isNew = isNewAccountAge(accountCreated || accountAge)
                if (isNew !== null) {
                    if (cluster.isWorker && process.send) {
                        const msg: AccountTagSyncMessage = { __accountAgeSync: { email: accountEmail, isNew } }
                        process.send(msg)
                    } else {
                        new AccountService().syncNewTagByEmailSync(accountEmail, isNew)
                    }
                }
                const effectiveTag = syncNewTagByAge(account.tag, isNew).tag

                const existingState = stateService
                    .getStates()
                    .find(s => s.email.toLowerCase() === accountEmail.toLowerCase())
                const lifetimePointsRedeemed = Number(
                    data.userStatus?.lifetimePointsRedeemed ?? existingState?.lifetimePointsRedeemed ?? 0
                )
                let lastOrderTitle = data.userStatus?.lastOrder?.catalogItem?.title || existingState?.lastOrderTitle
                let lastOrderDate = data.userStatus?.lastOrder?.timestamp
                    ? String(data.userStatus.lastOrder.timestamp)
                    : existingState?.lastOrderDate

                let redemptionCount: number | undefined = existingState?.redemptionCount
                let syncedLifetimeRedeemed: number | undefined = existingState?.syncedLifetimeRedeemed

                if (hasZeroRedemptionEvidence(data.userStatus)) {
                    redemptionCount = 0
                    syncedLifetimeRedeemed = 0
                } else if (
                    existingState?.redemptionCount !== undefined &&
                    existingState?.syncedLifetimeRedeemed === lifetimePointsRedeemed
                ) {
                    redemptionCount = existingState.redemptionCount
                } else {
                    await saveSessionData(this.config.sessionPath, this.cookies.mobile, accountEmail, true)
                    let orderSession: BrowserSession | null = null
                    try {
                        orderSession = await executionContext.run({ isMobile: false, account }, async () =>
                            this.browserFactory.createBrowser(account)
                        )
                        const orderResult = await executionContext.run({ isMobile: false, account }, async () => {
                            if (this.cookies.mobile.length > 0) {
                                await orderSession!.context.addCookies(this.cookies.mobile).catch(() => {})
                            }
                            const tmpPage = await orderSession!.context.newPage()
                            try {
                                return await this.browser.func.syncRedemptionCount(tmpPage)
                            } finally {
                                await tmpPage.close().catch(() => {})
                            }
                        })
                        if (orderResult.redemptionCount !== null) {
                            redemptionCount = orderResult.redemptionCount
                            syncedLifetimeRedeemed = lifetimePointsRedeemed
                        }
                        if (orderResult.lastOrderTitle) lastOrderTitle = orderResult.lastOrderTitle
                        if (orderResult.lastOrderDate) lastOrderDate = orderResult.lastOrderDate
                    } catch (orderErr) {
                        this.logger.warn(
                            'main',
                            'ORDER-HISTORY',
                            `Could not scrape redemption count for ${accountEmail}: ${errMsg(orderErr)}`
                        )
                    } finally {
                        if (orderSession) {
                            await executionContext
                                .run({ isMobile: false, account }, async () => {
                                    await this.browser.func.closeBrowser(orderSession!.context, accountEmail)
                                })
                                .catch(() => {})
                        }
                    }
                }

                const profile = resolveExecutionProfile({
                    tag: effectiveTag,
                    redemptionCount,
                    config: this.config,
                    random: SeededRandom.fromParts(accountEmail, new Date().toISOString().slice(0, 10), 'profile')
                })
                this.currentExecutionProfile = profile
                this.logger.info(
                    'main',
                    'PROFILE',
                    `[PROFILE] mode=${profile.mode} | tag="${effectiveTag}" | redemptions=${redemptionCount ?? '?'}`
                )

                stateService.updateAccountState(accountEmail, {
                    totalPoints: data.userStatus.availablePoints,
                    streak,
                    accountAge,
                    level,
                    lifetimePoints,
                    redeemGoalTitle,
                    redeemGoalPrice,
                    geoLocale: this.userData.geoLocale,
                    proxy: account.proxy?.url ? `${account.proxy.url}:${account.proxy.port}` : 'Direct',
                    tag: effectiveTag,
                    redemptionCount,
                    lifetimePointsRedeemed,
                    syncedLifetimeRedeemed,
                    lastOrderTitle,
                    lastOrderDate,
                    executionMode: profile.mode
                })

                const browserEarnable = await this.browser.func.getBrowserEarnablePoints()
                let appEarnable: AppEarnablePoints | null = null
                try {
                    appEarnable = await this.browser.func.getAppEarnablePoints()
                } catch (appErr: any) {
                    if (appErr?.message?.includes('Account Suspended')) throw appErr
                    this.logger.warn(
                        'main',
                        'APP-POINTS',
                        `Optional app earnable points unavailable: ${errMsg(appErr)}`
                    )
                }

                this.pointsCanCollect = browserEarnable.mobileSearchPoints + (appEarnable?.totalEarnablePoints ?? 0)

                this.logger.info(
                    'main',
                    'POINTS',
                    `Earnable today | Mobile: ${this.pointsCanCollect} | Browser: ${
                        browserEarnable.mobileSearchPoints
                    } | App: ${appEarnable?.totalEarnablePoints ?? 0} | ${accountEmail} | locale: ${this.userData.geoLocale}`
                )

                // Track points before quest activities
                const pointsBeforeQuests = await this.browser.func.getCurrentPoints()
                this.logger.info('main', 'QUEST-TRACK', `Points before quests: ${pointsBeforeQuests} | ${accountEmail}`)

                if (this.config.workers.doAppPromotions) {
                    if (appData && Array.isArray(appData.response?.promotions)) {
                        await this.workers.doAppPromotions(appData)
                    } else {
                        this.logger.info(
                            this.isMobile,
                            'APP-PROMOTIONS',
                            'Skipping: App promotions data unavailable'
                        )
                    }
                }

                // Modern UI: Daily Set + Keep Earning run in desktop phase (mobile can't detect properly)
                // Legacy UI: run as usual in mobile phase
                if (this.rewardsVersion !== 'modern') {
                    if (this.config.workers.doDailySet) await this.workers.doDailySet(data, this.mainMobilePage)
                    if (this.config.workers.doMorePromotions)
                        await this.workers.doMorePromotions(data, this.mainMobilePage)
                    if (this.config.workers.doPunchCards)
                        await this.workers.doPunchCards(data, this.mainMobilePage)
                }

                if (this.config.workers.doSpecialPromotions) await this.workers.doSpecialPromotions(data)
                if (this.config.workers.doDailyCheckIn) await this.activities.doDailyCheckIn()
                if (this.config.workers.doReadToEarn) await this.activities.doReadToEarn()

                // Track points after mobile quest activities
                const pointsAfterQuests = await this.browser.func.getCurrentPoints()
                const mobileQuestPoints = Math.max(0, pointsAfterQuests - pointsBeforeQuests)
                this.logger.info(
                    'main',
                    'QUEST-TRACK',
                    `Points after quests: ${pointsAfterQuests} | Mobile quest earned: +${mobileQuestPoints} | ${accountEmail}`
                )

                const searchPoints = await this.browser.func.getSearchPoints()
                const missingSearchPoints = this.browser.func.missingSearchPoints(searchPoints, true)

                this.cookies.mobile = await initialContext.cookies()

                const { mobilePoints, desktopPoints } = await this.searchManager.doSearches(
                    data,
                    missingSearchPoints,
                    mobileSession,
                    account,
                    accountEmail
                )

                mobileContextClosed = true

                this.userData.gainedPoints = mobilePoints + desktopPoints

                this.browser.func.updateModernSearchBreakdownProgress(mobilePoints, desktopPoints)

                let finalPoints = 0
                try {
                    finalPoints = await this.browser.func.getCurrentPoints(true)
                } catch {
                    finalPoints = Number(this.userData.currentPoints ?? initialPoints)
                }
                let collectedPoints = Math.max(0, finalPoints - initialPoints)

                let modernQuestPoints = this.userData.modernQuestPoints ?? 0
                if (this.config.searchSettings.parallelSearching && finalPoints > initialPoints) {
                    const maxNonSearch = Math.max(0, finalPoints - initialPoints - mobilePoints - desktopPoints)
                    modernQuestPoints = Math.min(modernQuestPoints, Math.max(0, maxNonSearch - mobileQuestPoints))
                }
                const questPoints = mobileQuestPoints + modernQuestPoints

                // Authoritative today's points from Bing Modern Breakdown
                const breakdown = this.browser.func.getSearchBreakdown()
                if (breakdown?.todayPoints && breakdown.todayPoints > 0) {
                    collectedPoints = breakdown.todayPoints
                } else {
                    // Try reading official dailyPoint progress from Microsoft Counters
                    try {
                        const searchPoints = await this.browser.func.getSearchPoints()
                        const msDaily = searchPoints?.dailyPoint?.[0]?.pointProgress
                        if (typeof msDaily === 'number' && msDaily > 0 && msDaily <= 500) {
                            collectedPoints = msDaily
                        }
                    } catch {
                        // Fall back to finalPoints - initialPoints
                    }
                }

                // Sanity check: Daily points realistically cannot exceed 500 in one day
                if (collectedPoints > 500 && finalPoints > 500) {
                    collectedPoints = Math.min(500, Math.max(0, finalPoints - initialPoints))
                }

                // Real search progress, reported instead of the previous hardcoded 90/90 and 60/60.
                let searchProgress = { pcProgress: 'N/A', mobileProgress: 'N/A' }
                try {
                    searchProgress = this.browser.func.formatSearchProgress(await this.browser.func.getSearchPoints())
                } catch (error) {
                    this.logger.warn(
                        'main',
                        'SEARCH-PROGRESS',
                        `Could not read final search progress for ${accountEmail}: ${errMsg(error)}`
                    )
                }

                this.logger.info(
                    'main',
                    'FLOW',
                    `Collected: +${collectedPoints} | Mobile: +${mobilePoints} | Desktop: +${desktopPoints} | Quest: +${questPoints} | PC search: ${searchProgress.pcProgress} | Mobile search: ${searchProgress.mobileProgress} | ${accountEmail}`
                )

                return {
                    initialPoints,
                    finalPoints,
                    collectedPoints: collectedPoints || 0,
                    pcPoints: desktopPoints || 0,
                    mobilePoints: mobilePoints || 0,
                    questPoints: questPoints || 0,
                    pcProgress: searchProgress.pcProgress,
                    mobileProgress: searchProgress.mobileProgress,
                    streak,
                    accountAge,
                    level,
                    lifetimePoints,
                    redeemGoalTitle,
                    redeemGoalPrice,
                    tag: effectiveTag,
                    redemptionCount,
                    lifetimePointsRedeemed,
                    syncedLifetimeRedeemed,
                    lastOrderTitle,
                    lastOrderDate,
                    executionMode: profile.mode
                }
            })
        } finally {
            if (mobileSession && !mobileContextClosed) {
                try {
                    await executionContext.run({ isMobile: true, account }, async () => {
                        await this.browser.func.closeBrowser(mobileSession!.context, accountEmail)
                    })
                } catch (closeError) {
                    // Swallowed so cleanup never masks the original failure, but
                    // a failed close leaves a browser process behind and is
                    // worth knowing about.
                    this.logger.warn(
                        'main',
                        'CLEANUP',
                        `Failed to close mobile session for ${accountEmail}: ${errMsg(closeError)}`
                    )
                }
            }
        }
    }

    public async syncToGoogleSheets(stats: AccountStats[]) {
        try {
            const rows = stats.map(s => ({
                email: s.email,
                totalPoints: s.finalPoints,
                dailyPoints: s.collectedPoints,
                pcProgress: s.pcProgress,
                mobileProgress: s.mobileProgress,
                status: s.success ? 'OK' : 'ERROR',
                accountAge: s.accountAge || 'N/A',
                updatedAt: new Date().toLocaleString('vi-VN'),
                streak: s.streak || '0',
                onlineStatus: s.success ? 'ONLINE' : 'OFFLINE',
                tag: s.tag,
                redemptionCount: s.redemptionCount,
                executionMode: s.executionMode,
                level: s.level,
                lifetimePoints: s.lifetimePoints,
                geoLocale: s.geoLocale,
                proxy: s.proxy,
                redeemGoalTitle: s.redeemGoalTitle,
                lastError: s.error
            }))
            const onlineEmails = new Set(stats.filter(s => s.success).map(s => s.email.toLowerCase()))
            await sheetService.syncAllFromDisk({ onlineEmails, statsOverride: rows })
            this.logger.info('main', 'SHEETS', `Successfully synchronized ${rows.length} accounts to Google Sheets.`)
        } catch (e) {
            this.logger.error('main', 'SHEETS', `Failed to sync to Google Sheets: ${(e as Error).message}`)
        }
    }
}

export { executionContext }

async function main(): Promise<void> {
    // Check before doing anything
    checkNodeVersion()
    const rewardsBot = new MicrosoftRewardsBot()

    process.on('beforeExit', () => {
        void flushAllWebhooks()
    })
    process.on('SIGINT', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', 'SIGINT received, flushing and exiting...')
        await flushAllWebhooks()
        process.exit(130)
    })
    process.on('SIGTERM', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', 'SIGTERM received, flushing and exiting...')
        await flushAllWebhooks()
        process.exit(143)
    })
    process.on('uncaughtException', async error => {
        rewardsBot.logger.error('main', 'UNCAUGHT-EXCEPTION', error)
        await flushAllWebhooks()
        process.exit(1)
    })
    process.on('unhandledRejection', async reason => {
        rewardsBot.logger.error('main', 'UNHANDLED-REJECTION', reason as Error)
        await flushAllWebhooks()
        process.exit(1)
    })

    try {
        await rewardsBot.initialize()
        await rewardsBot.run()
    } catch (error) {
        rewardsBot.logger.error('main', 'MAIN-ERROR', error as Error)
        await flushAllWebhooks()
        process.exit(1)
    }
}

main().catch(async error => {
    const tmpBot = new MicrosoftRewardsBot()
    tmpBot.logger.error('main', 'MAIN-ERROR', error as Error)
    await flushAllWebhooks()
    process.exit(1)
})

/**
 * Rebuilds dashboard state (db.json) from live Microsoft Rewards data.
 *
 * The dashboard cache is disposable, but the source of truth lives on
 * Microsoft's side. Reading `/api/getuserinfo` from an already-authenticated
 * session and writing the result back into db.json restores real points,
 * streaks and level without running a full earning cycle for every account.
 *
 * Usage (from the project root, after `npm run build`):
 *   node dist/services/refreshDashboardState.js            # all enabled accounts
 *   node dist/services/refreshDashboardState.js --only a@b  # one account
 *   node dist/services/refreshDashboardState.js --concurrency 2
 */
import fs from 'fs'
import path from 'path'
import { chromium, type Browser } from 'patchright'

import type { Account } from '../interface/Account'
import type { AccountState } from './stateService'
import { calculateAccountAge, extractStreak } from '../util/RewardUtils'

interface UserStatusShape {
    availablePoints?: number
    lifetimePoints?: number
    redeemGoal?: { title?: string; price?: number }
    levelInfo?: { activeLevelName?: string; activeLevel?: string }
}

interface DashboardShape {
    userStatus?: UserStatusShape
    created?: string
    userProfile?: { attributes?: { created?: string; level?: string } }
    streakPromotion?: unknown
    streakBonusPromotions?: unknown
    streakProtectionPromo?: unknown
}

interface RefreshResult {
    email: string
    ok: boolean
    points?: number
    reason?: string
}

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const DB_PATH = path.resolve(PROJECT_ROOT, 'src/dashboard/db.json')
const SESSIONS_DIR = path.resolve(PROJECT_ROOT, 'sessions')
const API_URL = 'https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest'

function parseArgs(argv: string[]) {
    const args = { only: [] as string[], concurrency: 1, headless: true }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--only' && argv[i + 1]) args.only.push(argv[++i]!.toLowerCase())
        else if (arg === '--concurrency' && argv[i + 1]) args.concurrency = Math.max(1, parseInt(argv[++i]!, 10) || 1)
        else if (arg === '--headed') args.headless = false
    }
    return args
}

function loadAccounts(): Account[] {
    const candidates = [
        path.resolve(PROJECT_ROOT, 'dist/accounts.json'),
        path.resolve(PROJECT_ROOT, 'accounts.json'),
        path.resolve(PROJECT_ROOT, 'src/accounts.json')
    ]
    const file = candidates.find(candidate => fs.existsSync(candidate))
    if (!file) throw new Error('accounts.json not found')
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Account[]
}

function loadStates(): AccountState[] {
    if (!fs.existsSync(DB_PATH)) return []
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) as AccountState[]
    } catch {
        return []
    }
}

function saveStates(states: AccountState[]) {
    const temp = `${DB_PATH}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(states, null, 4), 'utf-8')
    fs.renameSync(temp, DB_PATH)
}

function readCookies(email: string): any[] | null {
    for (const variant of ['session_desktop.json', 'session_mobile.json']) {
        const file = path.join(SESSIONS_DIR, email, variant)
        if (!fs.existsSync(file)) continue
        try {
            const cookies = JSON.parse(fs.readFileSync(file, 'utf-8'))
            if (Array.isArray(cookies) && cookies.length > 0) return cookies
        } catch {
            /* try the next variant */
        }
    }
    return null
}

function proxyConfig(url?: string, port?: number) {
    if (!url) return undefined
    const server = url.includes('://') ? url : `http://${url}`
    return { server: port ? `${server}:${port}` : server }
}

async function refreshOne(browser: Browser, account: Account, args: ReturnType<typeof parseArgs>): Promise<RefreshResult> {
    const cookies = readCookies(account.email)
    if (!cookies) return { email: account.email, ok: false, reason: 'no session cookies' }

    const context = await browser.newContext({
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
    })
    try {
        await context.addCookies(cookies)
        const page = await context.newPage()
        await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })

        const payload = await page.evaluate(async (url: string) => {
            const response = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            if (!response.ok) return { error: `HTTP ${response.status}` }
            const json = await response.json()
            return { dashboard: json?.dashboard ?? null }
        }, API_URL)

        if (!payload?.dashboard) {
            return { email: account.email, ok: false, reason: payload?.error ?? 'empty dashboard payload' }
        }

        const dashboard = payload.dashboard as DashboardShape
        const userStatus = dashboard.userStatus ?? {}
        const levelInfo = userStatus.levelInfo ?? {}
        const created = dashboard.created ?? dashboard.userProfile?.attributes?.created

        return {
            email: account.email,
            ok: true,
            points: userStatus.availablePoints ?? 0,
            reason: JSON.stringify({
                lifetimePoints: userStatus.lifetimePoints ?? 0,
                level: levelInfo.activeLevelName || levelInfo.activeLevel || 'Level 1',
                streak: extractStreak(dashboard),
                accountAge: calculateAccountAge(created),
                redeemGoalTitle: userStatus.redeemGoal?.title || 'None',
                redeemGoalPrice: userStatus.redeemGoal?.price || 0
            })
        }
    } catch (error) {
        return { email: account.email, ok: false, reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown' }
    } finally {
        await context.close().catch(() => {})
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    const accounts = loadAccounts().filter(account => {
        if (account.enabled === false) return false
        if (!args.only.length) return true
        return args.only.includes(account.email.toLowerCase())
    })

    if (!accounts.length) {
        console.log('[refresh] nothing to do')
        return
    }

    const states = loadStates()
    const byEmail = new Map(states.map(state => [state.email.toLowerCase(), state]))

    console.log(`[refresh] ${accounts.length} account(s) | concurrency=${args.concurrency}`)

    const BATCH = args.concurrency
    for (let i = 0; i < accounts.length; i += BATCH) {
        const batch = accounts.slice(i, i + BATCH)
        const browsers = await Promise.all(
            batch.map(account =>
                chromium.launch({
                    headless: args.headless,
                    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
                    proxy: proxyConfig(account.proxy?.url, account.proxy?.port)
                })
            )
        )

        const results = await Promise.all(batch.map((account, index) => refreshOne(browsers[index]!, account, args)))
        await Promise.all(browsers.map(browser => browser.close().catch(() => {})))

        for (const result of results) {
            if (!result.ok) {
                console.log(`[refresh] ✗ ${result.email} — ${result.reason}`)
                continue
            }

            const extra = JSON.parse(result.reason!)
            const existing = byEmail.get(result.email.toLowerCase())
            const next: AccountState = {
                email: result.email,
                totalPoints: result.points ?? 0,
                dailyPoints: existing?.dailyPoints ?? 0,
                pcProgress: existing?.pcProgress ?? '0/90',
                mobileProgress: existing?.mobileProgress ?? '0/60',
                status: existing?.status === 'SUSPENDED' ? 'SUSPENDED' : existing?.status === 'OK' ? 'OK' : 'IDLE',
                accountAge: extra.accountAge,
                streak: extra.streak,
                updatedAt: new Date().toLocaleString('vi-VN'),
                level: extra.level,
                lifetimePoints: extra.lifetimePoints,
                questPoints: existing?.questPoints ?? 0,
                redeemGoalTitle: extra.redeemGoalTitle,
                redeemGoalPrice: extra.redeemGoalPrice,
                geoLocale: existing?.geoLocale ?? 'vn',
                proxy: existing?.proxy ?? 'Direct',
                lastError: ''
            }
            byEmail.set(result.email.toLowerCase(), next)
            console.log(`[refresh] ✓ ${result.email} — ${next.totalPoints} pts | ${next.level} | streak ${next.streak}`)
        }

        saveStates(Array.from(byEmail.values()))
    }

    console.log('[refresh] done')
}

main().catch(error => {
    console.error('[refresh] fatal:', error)
    process.exit(1)
})

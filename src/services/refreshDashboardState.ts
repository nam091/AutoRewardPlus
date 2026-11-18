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
import { chromium, type Browser, type Page } from 'patchright'

import { resolveExecutionProfile } from '../browser/humanize/ExecutionProfile'
import { AccountService } from '../dashboard/accountService'
import type { Account } from '../interface/Account'
import type { Config } from '../interface/Config'
import { loadConfig } from '../util/Load'
import {
    calculateAccountAge,
    extractStreak,
    hasZeroRedemptionEvidence,
    isNewAccountAge,
    parseOrderHistoryText,
    syncNewTagByAge
} from '../util/RewardUtils'
import { stateService, type AccountState } from './stateService'

interface UserStatusShape {
    availablePoints?: number
    lifetimePoints?: number
    lifetimePointsRedeemed?: number
    lastOrder?: {
        id?: string | null
        timestamp?: string | Date | null
        catalogItem?: { title?: string } | null
    } | null
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

interface RefreshPayload {
    lifetimePoints: number
    level: string
    streak: string
    accountAge: string
    redeemGoalTitle: string
    redeemGoalPrice: number
    isNew: boolean | null
    redemptionCount?: number
    lifetimePointsRedeemed: number
    syncedLifetimeRedeemed?: number
    lastOrderTitle?: string
    lastOrderDate?: string
}

interface RefreshResult {
    email: string
    ok: boolean
    points?: number
    reason?: string
    data?: RefreshPayload
}

const PROJECT_ROOT = path.resolve(__dirname, '../..')
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

async function scrapeOrderHistory(
    page: Page
): Promise<{ redemptionCount: number | null; lastOrderTitle?: string; lastOrderDate?: string }> {
    try {
        await page.goto('https://rewards.bing.com/redeem/orderhistory', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        })

        await page
            .waitForFunction(
                () => {
                    const body = document.body
                    if (!body) return false
                    const hasBusy = Boolean(
                        document.querySelector('[aria-busy="true"], [class*="skeleton" i], [class*="spinner" i]')
                    )
                    const text = (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
                    if (!text || text.startsWith('loading') || text.includes('đang tải')) return false
                    const hasMarker =
                        /results?|orders?|order\s+no\.|no\s+orders|haven't\s+placed|kết\s*quả|đơn\s*hàng|mã\s+đơn/i.test(
                            text
                        )
                    return hasMarker && !hasBusy
                },
                { timeout: 8000 }
            )
            .catch(() => {})

        await new Promise(resolve => setTimeout(resolve, 800))

        const extracted = await page.evaluate(() => {
            const main = document.querySelector('main') || document.body
            const mainText = ((main as HTMLElement)?.innerText || main?.textContent || '').trim()

            let lastOrderTitle: string | undefined
            let lastOrderDate: string | undefined

            const firstRow =
                document.querySelector(
                    'table tbody tr, [role="row"]:not(:first-child), [class*="order" i][class*="item" i], [class*="order" i][class*="card" i]'
                ) ?? null
            if (firstRow) {
                const cells = Array.from(firstRow.querySelectorAll('td, [role="cell"], p, span, h3, h4'))
                    .map(el => (el.textContent || '').trim())
                    .filter(Boolean)

                for (const cell of cells) {
                    if (
                        !lastOrderDate &&
                        /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i.test(
                            cell
                        )
                    ) {
                        lastOrderDate = cell
                        continue
                    }
                    if (
                        !lastOrderTitle &&
                        cell.length >= 3 &&
                        cell.length <= 120 &&
                        !/^(?:order\s*no\.|mã\s+đơn|sent|shipped|completed|pending|canceled|cancelled|đã\s+gửi|hoàn\s+thành|\d+\s*(?:pts|points|điểm))$/i.test(
                            cell
                        ) &&
                        !/^\d{4,}$/.test(cell)
                    ) {
                        lastOrderTitle = cell
                    }
                }
            }

            return { mainText, lastOrderTitle, lastOrderDate }
        })

        return {
            redemptionCount: parseOrderHistoryText(extracted.mainText),
            ...(extracted.lastOrderTitle ? { lastOrderTitle: extracted.lastOrderTitle } : {}),
            ...(extracted.lastOrderDate ? { lastOrderDate: extracted.lastOrderDate } : {})
        }
    } catch {
        return { redemptionCount: null }
    }
}

async function refreshOne(
    browser: Browser,
    account: Account,
    existing?: AccountState
): Promise<RefreshResult> {
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
        const accountAge = calculateAccountAge(created)
        const isNew = isNewAccountAge(created || accountAge)

        const lifetimePointsRedeemed = Number(
            userStatus.lifetimePointsRedeemed ?? existing?.lifetimePointsRedeemed ?? 0
        )
        let lastOrderTitle = userStatus.lastOrder?.catalogItem?.title || existing?.lastOrderTitle
        let lastOrderDate = userStatus.lastOrder?.timestamp
            ? String(userStatus.lastOrder.timestamp)
            : existing?.lastOrderDate

        let redemptionCount: number | undefined = existing?.redemptionCount
        let syncedLifetimeRedeemed: number | undefined = existing?.syncedLifetimeRedeemed

        if (hasZeroRedemptionEvidence(userStatus)) {
            redemptionCount = 0
            syncedLifetimeRedeemed = 0
        } else if (
            existing?.redemptionCount !== undefined &&
            existing?.syncedLifetimeRedeemed === lifetimePointsRedeemed
        ) {
            redemptionCount = existing.redemptionCount
        } else {
            const orderRes = await scrapeOrderHistory(page)
            if (orderRes.redemptionCount !== null) {
                redemptionCount = orderRes.redemptionCount
                syncedLifetimeRedeemed = lifetimePointsRedeemed
            }
            if (orderRes.lastOrderTitle) lastOrderTitle = orderRes.lastOrderTitle
            if (orderRes.lastOrderDate) lastOrderDate = orderRes.lastOrderDate
        }

        return {
            email: account.email,
            ok: true,
            points: userStatus.availablePoints ?? 0,
            data: {
                lifetimePoints: userStatus.lifetimePoints ?? 0,
                level: levelInfo.activeLevelName || levelInfo.activeLevel || 'Level 1',
                streak: extractStreak(dashboard),
                accountAge,
                redeemGoalTitle: userStatus.redeemGoal?.title || 'None',
                redeemGoalPrice: userStatus.redeemGoal?.price || 0,
                isNew,
                redemptionCount,
                lifetimePointsRedeemed,
                syncedLifetimeRedeemed,
                lastOrderTitle,
                lastOrderDate
            }
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

    let config: Config | undefined
    try {
        config = loadConfig()
    } catch {
        config = undefined
    }

    const accountService = new AccountService()
    const states = stateService.getStates()
    const byEmail = new Map(states.map(state => [state.email.toLowerCase(), state]))
    const accountByEmail = new Map(accounts.map(acc => [acc.email.toLowerCase(), acc]))

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

        const results = await Promise.all(
            batch.map((account, index) => refreshOne(browsers[index]!, account, byEmail.get(account.email.toLowerCase())))
        )
        await Promise.all(browsers.map(browser => browser.close().catch(() => {})))

        for (const result of results) {
            if (!result.ok || !result.data) {
                console.log(`[refresh] ✗ ${result.email} — ${result.reason}`)
                continue
            }

            const extra = result.data
            const emailKey = result.email.toLowerCase()
            const existing = byEmail.get(emailKey)
            const account = accountByEmail.get(emailKey)

            const synced = accountService.syncNewTagByEmailSync(result.email, extra.isNew)
            const effectiveTag = synced?.tag ?? syncNewTagByAge(account?.tag, extra.isNew).tag
            const profile = resolveExecutionProfile({
                tag: effectiveTag,
                redemptionCount: extra.redemptionCount,
                config
            })

            const nextUpdate: Partial<AccountState> = {
                totalPoints: result.points ?? 0,
                dailyPoints: existing?.dailyPoints ?? 0,
                pcProgress: existing?.pcProgress ?? '0/90',
                mobileProgress: existing?.mobileProgress ?? '0/60',
                status: existing?.status === 'SUSPENDED' ? 'SUSPENDED' : existing?.status === 'OK' ? 'OK' : 'IDLE',
                accountAge: extra.accountAge,
                streak: extra.streak,
                level: extra.level,
                lifetimePoints: extra.lifetimePoints,
                questPoints: existing?.questPoints ?? 0,
                redeemGoalTitle: extra.redeemGoalTitle,
                redeemGoalPrice: extra.redeemGoalPrice,
                geoLocale: existing?.geoLocale ?? account?.geoLocale ?? 'vn',
                proxy: existing?.proxy ?? (account?.proxy?.url ? `${account.proxy.url}:${account.proxy.port}` : 'Direct'),
                lastError: '',
                tag: effectiveTag,
                redemptionCount: extra.redemptionCount,
                lifetimePointsRedeemed: extra.lifetimePointsRedeemed,
                syncedLifetimeRedeemed: extra.syncedLifetimeRedeemed,
                lastOrderTitle: extra.lastOrderTitle,
                lastOrderDate: extra.lastOrderDate,
                executionMode: profile.mode
            }

            stateService.applyAccountState(result.email, nextUpdate)
            console.log(
                `[refresh] ✓ ${result.email} — ${result.points ?? 0} pts | ${extra.level} | streak ${extra.streak} | mode=${profile.mode} | redemptions=${extra.redemptionCount ?? '?'}`
            )
        }
    }

    console.log('[refresh] done')
}

main().catch(error => {
    console.error('[refresh] fatal:', error)
    process.exit(1)
})

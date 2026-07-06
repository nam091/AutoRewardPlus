/**
 * Browser-driven integration checks for v8 risk + InPrivate stack.
 * Usage: npm run verify-v8 (chained after structural wiring checks)
 */
import Browser from '../src/browser/Browser'
import { SessionRiskController } from '../src/browser/humanize/SessionRiskController'
import { MicrosoftRewardsBot } from '../src/index'
import { loadAccounts } from '../src/util/Load'

interface CheckResult {
    name: string
    pass: boolean
    detail: string
}

async function main(): Promise<void> {
    const checks: CheckResult[] = []
    const bot = new MicrosoftRewardsBot()
    await bot.initialize()

    const accounts = loadAccounts()
    const account = accounts[0]
    if (!account) {
        console.error('[verify-v8-integration] No accounts found in accounts.json')
        process.exit(1)
    }

    const browserFactory = new Browser(bot)
    const { context, fingerprint } = await browserFactory.createBrowser(account)
    const page = await context.newPage()

    try {
        await page.goto('about:blank')

        const risk = new SessionRiskController()
        const cleanDecision = await risk.evaluatePage(page)
        checks.push({
            name: 'risk-evaluatePage-clean',
            pass: !risk.isCaptchaDetected() && cleanDecision.action !== 'stop',
            detail: `action=${cleanDecision.action} captcha=${risk.isCaptchaDetected()}`
        })

        await page.setContent(
            '<html><head><title>Verify your identity</title></head><body><iframe src="https://example.com/recaptcha"></iframe></body></html>'
        )
        const challengeRisk = new SessionRiskController()
        const challengeDecision = await challengeRisk.evaluatePage(page)
        checks.push({
            name: 'risk-evaluatePage-challenge',
            pass: challengeRisk.isCaptchaDetected(),
            detail: `action=${challengeDecision.action} captcha=${challengeRisk.isCaptchaDetected()} reason=${challengeRisk.getChallengeReason() ?? 'none'}`
        })

        bot.desktopFingerprint = fingerprint
        const inPrivateContext = await browserFactory.createInPrivateContext(page, account, fingerprint)
        const inPrivatePage = await inPrivateContext.newPage()

        const webdriver = await inPrivatePage.evaluate(() => navigator.webdriver)
        checks.push({
            name: 'inprivate-webdriver',
            pass: webdriver === false,
            detail: String(webdriver)
        })

        const touchPoints = await inPrivatePage.evaluate(() => navigator.maxTouchPoints)
        checks.push({
            name: 'inprivate-maxTouchPoints',
            pass: touchPoints === 0,
            detail: String(touchPoints)
        })

        await inPrivatePage.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
        const storageAfterInit = await inPrivatePage.evaluate(() => ({
            local: localStorage.length,
            session: sessionStorage.length
        }))
        checks.push({
            name: 'inprivate-storage-cleared',
            pass: storageAfterInit.local === 0 && storageAfterInit.session === 0,
            detail: `local=${storageAfterInit.local} session=${storageAfterInit.session}`
        })

        const isolatedFromParent = inPrivateContext !== page.context()
        checks.push({
            name: 'inprivate-isolated-context',
            pass: isolatedFromParent,
            detail: `same=${!isolatedFromParent}`
        })

        await inPrivatePage.close()
        await inPrivateContext.close()
    } finally {
        await context.close()
        const browser = context.browser()
        await browser?.close().catch(() => {})
    }

    let failed = 0
    for (const check of checks) {
        const status = check.pass ? 'PASS' : 'FAIL'
        if (!check.pass) failed++
        console.log(`[verify-v8-integration] ${status} | ${check.name} | ${check.detail}`)
    }

    if (failed > 0) {
        console.error(`[verify-v8-integration] ${failed} check(s) failed`)
        process.exit(1)
    }

    console.log('[verify-v8-integration] All checks passed')
}

main().catch(error => {
    console.error('[verify-v8-integration] Fatal error:', error)
    process.exit(1)
})
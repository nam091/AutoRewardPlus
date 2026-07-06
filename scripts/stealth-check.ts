/**
 * Lightweight stealth regression check.
 * Launches a browser with the same anti-detection stack and verifies key signals.
 *
 * Usage: npm run stealth-check
 */
import Browser from '../src/browser/Browser'
import { MicrosoftRewardsBot } from '../src/index'
import { loadAccounts } from '../src/util/Load'

async function main(): Promise<void> {
    const bot = new MicrosoftRewardsBot()
    await bot.initialize()

    const accounts = loadAccounts()
    const account = accounts[0]
    if (!account) {
        console.error('[stealth-check] No accounts found in accounts.json')
        process.exit(1)
    }

    const browserFactory = new Browser(bot)
    const { context } = await browserFactory.createBrowser(account)
    const page = await context.newPage()

    const checks: Array<{ name: string; pass: boolean; detail: string }> = []

    const webdriver = await page.evaluate(() => navigator.webdriver)
    checks.push({
        name: 'navigator.webdriver',
        pass: webdriver === false,
        detail: String(webdriver)
    })

    const touchPoints = await page.evaluate(() => navigator.maxTouchPoints)
    checks.push({
        name: 'maxTouchPoints',
        pass: typeof touchPoints === 'number',
        detail: String(touchPoints)
    })

    await page.goto('https://abrahamjuliot.github.io/creepjs/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(5000)

    const title = await page.title()
    checks.push({
        name: 'creepjs-load',
        pass: title.length > 0,
        detail: title
    })

    let failed = 0
    for (const check of checks) {
        const status = check.pass ? 'PASS' : 'FAIL'
        if (!check.pass) failed++
        console.log(`[stealth-check] ${status} | ${check.name} | ${check.detail}`)
    }

    const browser = context.browser()
    await context.close()
    await browser?.close().catch(() => {})
    process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
    console.error('[stealth-check] Fatal error:', error)
    process.exit(1)
})
import type { Page } from 'patchright'

import type { MicrosoftRewardsBot } from '../../index'
import { errMsg } from '../../util/Utils'
import type { CardInfo } from './types'
import { humanClickInSection, humanExpandSection, humanPause } from './CardActions'

export async function closeAllExtraTabs(bot: MicrosoftRewardsBot, page: Page): Promise<void> {
    try {
        const context = page.context()
        const pages = context.pages()

        if (pages.length <= 1) return

        for (const p of pages) {
            if (p !== page) {
                await p.close().catch(() => {})
            }
        }

        if (pages.length > 1) {
            bot.logger.debug(bot.isMobile, 'MODERN-UI', `Closed ${pages.length - 1} extra tab(s)`)
        }
    } catch (error) {
        bot.logger.debug(bot.isMobile, 'MODERN-UI', `Error closing extra tabs: ${errMsg(error)}`)
    }
}

export async function expandDashboardSection(
    bot: MicrosoftRewardsBot,
    page: Page,
    sectionHeading: string
): Promise<boolean> {
    try {
        const expanded = await humanExpandSection(page, sectionHeading)

        if (expanded === 'expanded') {
            bot.logger.info(bot.isMobile, 'MODERN-UI', `Expanded section: "${sectionHeading}"`)
            await humanPause(bot, 1200, 2000)
            return true
        }
        if (expanded === 'already-expanded') {
            bot.logger.debug(bot.isMobile, 'MODERN-UI', `Section already expanded: "${sectionHeading}"`)
            return true
        }

        bot.logger.warn(bot.isMobile, 'MODERN-UI', `Section not found: "${sectionHeading}"`)
        return false
    } catch (error) {
        bot.logger.error(bot.isMobile, 'MODERN-UI', `Error expanding "${sectionHeading}": ${errMsg(error)}`)
        return false
    }
}

export async function clickCardInSection(
    bot: MicrosoftRewardsBot,
    page: Page,
    sectionHeading: string,
    card: CardInfo,
    tag: string
): Promise<void> {
    await closeAllExtraTabs(bot, page)

    const clicked = await humanClickInSection(page, sectionHeading, card.index)
    if (!clicked) {
        throw new Error(`Could not click card "${card.title}" in section "${sectionHeading}"`)
    }

    bot.logger.info(bot.isMobile, tag, `✔ Clicked: "${card.title}" (${card.points})`, 'green')

    await humanPause(bot, 2500, 4000)

    const newTab = await bot.browser.utils.getLatestTab(page)
    if (newTab !== page) {
        await newTab.waitForLoadState('domcontentloaded').catch(() => {})
        await humanPause(bot, 3000, 6000)
    }

    await closeAllExtraTabs(bot, page)
    await humanPause(bot, 2000, 5000)
}

export async function processCards(
    bot: MicrosoftRewardsBot,
    page: Page,
    cards: CardInfo[],
    sectionHeading: string,
    tag: string
): Promise<void> {
    for (const card of cards) {
        try {
            await clickCardInSection(bot, page, sectionHeading, card, tag)
        } catch (error) {
            bot.logger.error(bot.isMobile, tag, `Error on "${card.title}": ${errMsg(error)}`)
            await closeAllExtraTabs(bot, page)
        }
    }
}

export async function navigateAndPrepare(bot: MicrosoftRewardsBot, page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await humanPause(bot, 2500, 4000)
    await bot.browser.utils.tryDismissAllMessages(page)
}

export async function verifyAndRetry(
    bot: MicrosoftRewardsBot,
    page: Page,
    sectionHeading: string,
    tag: string,
    url: string,
    findRemaining: () => Promise<CardInfo[]>
): Promise<void> {
    try {
        bot.logger.info(bot.isMobile, tag, `Verifying ${sectionHeading} completion...`)

        await closeAllExtraTabs(bot, page)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await humanPause(bot, 2500, 4000)

        if (sectionHeading === 'Daily set') {
            await expandDashboardSection(bot, page, sectionHeading)
            await humanPause(bot, 1500, 2500)
        } else {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await humanPause(bot, 1500, 2500)
            await page.evaluate(() => window.scrollTo(0, 0))
            await humanPause(bot, 800, 1500)
        }

        const remaining = await findRemaining()

        if (remaining.length === 0) {
            bot.logger.info(bot.isMobile, tag, `✔ Verification passed: All ${sectionHeading} tasks completed`, 'green')
            return
        }

        bot.logger.warn(
            bot.isMobile,
            tag,
            `Verification: ${remaining.length} task(s) still remaining: ${remaining.map(c => `${c.title}(${c.points})`).join(', ')}`
        )

        await processCards(bot, page, remaining, sectionHeading, tag)
    } catch (error) {
        bot.logger.error(bot.isMobile, tag, `Verification error: ${errMsg(error)}`)
    }
}
import type { Page } from 'patchright'

import type { MicrosoftRewardsBot } from '../../index'
import { HumanizeEngine } from '../../browser/humanize/HumanizeEngine'
import { errMsg } from '../../util/Utils'
import { humanClickClaimCard, humanPause } from './CardActions'
import { closeAllExtraTabs, navigateAndPrepare } from './shared'

async function findClaimCard(page: Page): Promise<{ points: number } | null> {
    return await page.evaluate(() => {
        const cards = document.querySelectorAll('div[class*="bg-bgCardOnPrimaryDefaultRest"]')

        for (const card of cards) {
            const fullText = card.textContent?.trim() || ''
            if (!fullText.includes('Ready to claim')) continue

            const pointsEl = card.querySelector('p[class*="text-pageHeader"]')
            if (!pointsEl) continue

            const points = parseInt(pointsEl.textContent?.trim() || '')
            if (!isNaN(points) && points > 0) {
                return { points }
            }
        }

        return null
    })
}

export async function doClaimPoints(
    bot: MicrosoftRewardsBot,
    page: Page
): Promise<{ claimed: boolean; points: number }> {
    bot.logger.info(bot.isMobile, 'MODERN-CLAIM', 'Starting auto claim points')

    try {
        await navigateAndPrepare(bot, page, 'https://rewards.bing.com/dashboard')

        const claimCard = await findClaimCard(page)
        if (!claimCard) {
            bot.logger.info(bot.isMobile, 'MODERN-CLAIM', 'No points ready to claim')
            return { claimed: false, points: 0 }
        }

        bot.logger.info(bot.isMobile, 'MODERN-CLAIM', `Found ${claimCard.points} points ready to claim`, 'green')

        const clicked = await humanClickClaimCard(page, claimCard.points)
        if (!clicked) {
            bot.logger.warn(bot.isMobile, 'MODERN-CLAIM', 'Could not click claim card')
            return { claimed: false, points: 0 }
        }

        await humanPause(bot, 1500, 2500)

        const claimButton = page.locator('button[data-rac]:has-text("Claim points")').first()
        if (await claimButton.isVisible().catch(() => false)) {
            await HumanizeEngine.humanClickLocator(page, claimButton)
            bot.logger.info(bot.isMobile, 'MODERN-CLAIM', `✔ Claimed ${claimCard.points} points`, 'green')
            await humanPause(bot, 2500, 4000)
            await closeAllExtraTabs(bot, page)
            return { claimed: true, points: claimCard.points }
        }

        bot.logger.warn(bot.isMobile, 'MODERN-CLAIM', 'Claim button not found in flyout')
        await closeAllExtraTabs(bot, page)
        return { claimed: false, points: 0 }
    } catch (error) {
        bot.logger.error(bot.isMobile, 'MODERN-CLAIM', `Error: ${errMsg(error)}`)
        await closeAllExtraTabs(bot, page)
        return { claimed: false, points: 0 }
    }
}
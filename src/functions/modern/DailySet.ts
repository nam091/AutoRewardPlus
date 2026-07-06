import type { Page } from 'patchright'

import type { MicrosoftRewardsBot } from '../../index'
import { errMsg } from '../../util/Utils'
import type { CardInfo } from './types'
import {
    closeAllExtraTabs,
    expandDashboardSection,
    navigateAndPrepare,
    processCards,
    verifyAndRetry
} from './shared'

async function findDailySetCards(page: Page): Promise<CardInfo[]> {
    return await page.evaluate(() => {
        const result: { index: number; title: string; points: string; completed: boolean }[] = []
        const headings = document.querySelectorAll('h2, h3')

        for (const h of headings) {
            if (h.textContent?.trim()?.startsWith('Daily set')) {
                const section = h.closest('section') || h.parentElement?.parentElement
                if (!section) continue

                const cardLinks = section.querySelectorAll('a[target="_blank"]')
                cardLinks.forEach((card, i) => {
                    const anchor = card as HTMLAnchorElement
                    const fullText = anchor.textContent?.trim() || ''

                    const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
                    const title = titleEl?.textContent?.trim() || fullText.substring(0, 60)

                    let points = ''
                    anchor.querySelectorAll('span, div, p').forEach(el => {
                        const text = el.textContent?.trim() || ''
                        if (/^\+\d+$/.test(text)) points = text
                    })

                    const isCompleted =
                        fullText.includes('Completed') ||
                        !!anchor.querySelector('[class*="statusSuccessRewards"], [class*="StatusSuccess"]')

                    result.push({ index: i, title, points, completed: isCompleted })
                })
                break
            }
        }
        return result
    })
}

export async function doDailySet(bot: MicrosoftRewardsBot, page: Page): Promise<void> {
    bot.logger.info(bot.isMobile, 'MODERN-DAILY-SET', 'Starting Daily Set (Modern UI)')

    try {
        await navigateAndPrepare(bot, page, 'https://rewards.bing.com/dashboard')
        await expandDashboardSection(bot, page, 'Your progress')

        const expanded = await expandDashboardSection(bot, page, 'Daily set')
        if (!expanded) {
            bot.logger.warn(bot.isMobile, 'MODERN-DAILY-SET', 'Could not expand Daily Set section')
            return
        }

        const cards = await findDailySetCards(page)
        const uncompletedCards = cards.filter(c => !c.completed && c.points)

        bot.logger.info(
            bot.isMobile,
            'MODERN-DAILY-SET',
            `Found ${cards.length} cards, ${uncompletedCards.length} uncompleted with points`
        )

        if (!uncompletedCards.length) {
            bot.logger.info(bot.isMobile, 'MODERN-DAILY-SET', 'All Daily Set items already completed')
            return
        }

        await processCards(bot, page, uncompletedCards, 'Daily set', 'MODERN-DAILY-SET')
        await verifyAndRetry(bot, page, 'Daily set', 'MODERN-DAILY-SET', 'https://rewards.bing.com/dashboard', () =>
            findDailySetCards(page).then(c => c.filter(x => !x.completed && x.points))
        )

        bot.logger.info(bot.isMobile, 'MODERN-DAILY-SET', 'Daily Set completed')
    } catch (error) {
        bot.logger.error(bot.isMobile, 'MODERN-DAILY-SET', `Error: ${errMsg(error)}`)
        await closeAllExtraTabs(bot, page)
    }
}
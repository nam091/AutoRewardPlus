import type { Page } from 'patchright'

import type { MicrosoftRewardsBot } from '../../index'
import { errMsg } from '../../util/Utils'
import { humanPause } from './CardActions'
import type { CardInfo } from './types'
import { closeAllExtraTabs, navigateAndPrepare, processCards, verifyAndRetry } from './shared'

async function findKeepEarningCards(page: Page): Promise<CardInfo[]> {
    return await page.evaluate(() => {
        const result: { index: number; title: string; points: string; href: string }[] = []

        const headings = document.querySelectorAll('h2, h3')
        let keepEarningSection: Element | null = null

        for (const h of headings) {
            if (h.textContent?.trim()?.startsWith('Keep earning')) {
                keepEarningSection = h.closest('section') || h.parentElement?.parentElement || null
                break
            }
        }

        if (!keepEarningSection) return result

        const allCards = keepEarningSection.querySelectorAll('a[target="_blank"]')

        allCards.forEach((card, i) => {
            const anchor = card as HTMLAnchorElement
            const fullText = anchor.textContent?.trim() || ''

            if (fullText.includes('Completed')) return
            if (anchor.querySelector('[class*="statusSuccessRewards"], [class*="StatusSuccess"]')) return
            if (fullText.includes('level required') || fullText.includes('locked')) return
            if (/\d+\/\d+\s+tasks?/i.test(fullText)) return

            let pointsText = ''
            anchor.querySelectorAll('span, div, p').forEach(el => {
                const text = el.textContent?.trim() || ''
                if (/^\+\d+$/.test(text)) pointsText = text
            })

            if (!pointsText) {
                const descEl = anchor.querySelector('p[class*="Secondary"], p[class*="secondary"]')
                const descText = descEl?.textContent?.trim() || fullText
                const descMatch = descText.match(
                    /(?:earn|pick\s*up|get|collect)\s+(\d+)\s+(?:bonus\s+)?(?:Rewards\s+)?points?/i
                )
                if (descMatch) pointsText = `+${descMatch[1]}`
            }

            if (!pointsText) {
                const match = fullText.match(/(\d+)\s+points?\b/i)
                if (match && match[1] && parseInt(match[1]) > 0 && parseInt(match[1]) <= 500) {
                    if (!fullText.includes('lifetime points')) {
                        pointsText = `+${match[1]}`
                    }
                }
            }

            if (!pointsText) return

            const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
            const title = titleEl?.textContent?.trim()?.substring(0, 60) || ''
            const fallbackTitle = title || fullText.replace(pointsText, '').trim().substring(0, 60)

            result.push({
                index: i,
                title: fallbackTitle,
                points: pointsText,
                href: anchor.href
            })
        })

        return result
    })
}

export async function doKeepEarning(bot: MicrosoftRewardsBot, page: Page): Promise<void> {
    bot.logger.info(bot.isMobile, 'MODERN-KEEP-EARNING', 'Starting Keep Earning (Modern UI)')

    try {
        await navigateAndPrepare(bot, page, 'https://rewards.bing.com/earn')

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await humanPause(bot, 1500, 2500)
        await page.evaluate(() => window.scrollTo(0, 0))
        await humanPause(bot, 800, 1500)

        const earnableCards = await findKeepEarningCards(page)

        bot.logger.info(bot.isMobile, 'MODERN-KEEP-EARNING', `Found ${earnableCards.length} earnable card(s)`)

        if (!earnableCards.length) {
            bot.logger.info(bot.isMobile, 'MODERN-KEEP-EARNING', 'No earnable cards found')
            return
        }

        await processCards(bot, page, earnableCards, 'Keep earning', 'MODERN-KEEP-EARNING')
        await verifyAndRetry(
            bot,
            page,
            'Keep earning',
            'MODERN-KEEP-EARNING',
            'https://rewards.bing.com/earn',
            () => findKeepEarningCards(page)
        )

        bot.logger.info(bot.isMobile, 'MODERN-KEEP-EARNING', 'Keep Earning completed')
    } catch (error) {
        bot.logger.error(bot.isMobile, 'MODERN-KEEP-EARNING', `Error: ${errMsg(error)}`)
        await closeAllExtraTabs(bot, page)
    }
}
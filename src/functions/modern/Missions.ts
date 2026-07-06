import type { Page } from 'patchright'

import type { MicrosoftRewardsBot } from '../../index'
import { HumanizeEngine } from '../../browser/humanize/HumanizeEngine'
import { errMsg } from '../../util/Utils'
import {
    humanClickMissionTarget,
    humanClickSubTaskByIndex,
    humanPause
} from './CardActions'
import type { CardInfo, MissionInfo } from './types'
import { closeAllExtraTabs, navigateAndPrepare } from './shared'

async function findMissionCards(page: Page): Promise<MissionInfo[]> {
    return await page.evaluate(() => {
        const result: {
            index: number
            title: string
            points: string
            totalTasks: number
            completedTasks: number
            href: string
        }[] = []

        const allElements = Array.from(document.querySelectorAll('*'))
        const taskElements = allElements.filter(el => {
            const childNodes = Array.from(el.childNodes)
            return childNodes.some(
                node =>
                    node.nodeType === 3 &&
                    /(\d+)\/(\d+)\s*(?:tasks?|nhiệm\s*vụ|nv)/i.test(node.textContent || '')
            )
        })

        const seen = new Set<string>()

        taskElements.forEach((taskEl, i) => {
            const el = taskEl as HTMLElement
            const fullText = el.textContent?.trim() || ''

            let temp: HTMLElement | null = el
            let isCompleted = false
            while (temp && temp.tagName !== 'BODY') {
                if (
                    temp.querySelector('[class*="bg-statusSuccessRewardsBg"]') ||
                    temp.querySelector('[class*="statusSuccess"]') ||
                    temp.className.toLowerCase().includes('success')
                ) {
                    isCompleted = true
                    break
                }
                temp = temp.parentElement
            }
            if (isCompleted) return

            const taskMatch = fullText.match(/(\d+)\/(\d+)\s*(?:tasks?|nhiệm\s*vụ|nv)/i)
            if (!taskMatch) return

            const completedTasks = parseInt(taskMatch[1] ?? '0')
            const totalTasks = parseInt(taskMatch[2] ?? '0')
            if (completedTasks >= totalTasks || totalTasks === 0) return

            let card: HTMLElement | null = el
            while (card && card.tagName !== 'BODY') {
                if (
                    card.tagName === 'A' ||
                    card.getAttribute('role') === 'link' ||
                    card.tagName === 'LI' ||
                    card.className.toLowerCase().includes('card') ||
                    card.className.toLowerCase().includes('item')
                ) {
                    break
                }
                card = card.parentElement
            }
            if (!card) card = el.parentElement || el

            const anchor = card.tagName === 'A' ? (card as HTMLAnchorElement) : card.querySelector('a[href]')
            const rawHref = anchor ? (anchor as HTMLAnchorElement).href : card.getAttribute('href') || ''
            const href = rawHref.startsWith('http')
                ? rawHref
                : rawHref
                  ? `${window.location.origin}${rawHref}`
                  : ''

            let pointsText = ''
            card.querySelectorAll('span, div, p').forEach(sub => {
                const text = sub.textContent?.trim() || ''
                if (/^\+\d+$/.test(text)) pointsText = text
            })

            if (!pointsText) {
                const cardText = card.textContent || ''
                const match = cardText.match(/(\d+)\s+points?\b/i)
                if (match && match[1] && parseInt(match[1]) > 0) {
                    pointsText = `+${match[1]}`
                }
            }

            const titleEl = card.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"], h3, h4')
            const title =
                titleEl?.textContent?.trim()?.substring(0, 60) ||
                card.textContent
                    ?.replace(/\d+\/\d+\s*(?:tasks?|nhiệm\s*vụ|nv)/i, '')
                    .replace(/\+\d+/, '')
                    .replace(/Expires in.*?$/i, '')
                    .trim()
                    .substring(0, 60) ||
                `Quest_${i}`

            const dedupeKey = href || title
            if (seen.has(dedupeKey)) return
            seen.add(dedupeKey)

            result.push({
                index: result.length,
                title,
                points: pointsText || '+0',
                totalTasks,
                completedTasks,
                href
            })
        })

        return result
    })
}

async function findMissionSubTasks(page: Page): Promise<CardInfo[]> {
    return await page.evaluate(() => {
        const result: { index: number; title: string; points: string; completed: boolean }[] = []
        const allLinks = document.querySelectorAll('a[href], button, [role="link"], div[class*="cursor-pointer"]')
        const seen = new Set<string>()
        let logicalIndex = 0

        allLinks.forEach(link => {
            const el = link as HTMLElement
            const fullText = el.textContent?.trim() || ''

            if (el.getAttribute('aria-disabled') === 'true') return
            if (el.getAttribute('data-disabled') === 'true') return
            if (el.closest('[aria-disabled="true"], [data-disabled="true"]')) return
            if (fullText.includes('Completed') || fullText.includes('Hoàn thành')) return

            const parentRow = el.closest('div, li, article')
            if (parentRow?.querySelector('[class*="bg-statusSuccessRewardsBg"]')) return
            if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) return

            const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href : el.getAttribute('href') || ''
            if (href) {
                try {
                    const path = new URL(href, window.location.origin).pathname
                    if (path === '/earn' || path === '/earn/' || path === '/dashboard' || path === '/dashboard/') return
                } catch {}
            }

            if (fullText.length < 2) return

            const dedupeKey = href || fullText.substring(0, 40)
            if (seen.has(dedupeKey)) return
            seen.add(dedupeKey)

            let taskContainer: Element | null = el.parentElement
            for (let depth = 0; depth < 6 && taskContainer; depth++) {
                if (taskContainer.querySelector('h3, h4, p[class*="Body2Strong"]')) break
                taskContainer = taskContainer.parentElement
            }

            let title = ''
            if (taskContainer) {
                const titleEl = taskContainer.querySelector('h3, h4, p[class*="Body2Strong"], p[class*="body2Strong"]')
                title = titleEl?.textContent?.trim()?.substring(0, 60) || ''
            }
            if (!title) {
                const innerEl = el.querySelector('span, h3, h4')
                title = innerEl?.textContent?.trim()?.substring(0, 60) || fullText.substring(0, 60)
            }

            result.push({ index: logicalIndex, title, points: '', completed: false })
            logicalIndex++
        })

        return result
    })
}

async function completeMissionTasks(bot: MicrosoftRewardsBot, missionPage: Page, missionTitle: string): Promise<void> {
    bot.logger.info(
        bot.isMobile,
        'MODERN-MISSIONS',
        `On mission detail page for "${missionTitle}": ${missionPage.url()}`
    )

    await bot.browser.utils.tryDismissAllMessages(missionPage)
    await humanPause(bot, 800, 1500)

    await missionPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await humanPause(bot, 1200, 2000)
    await missionPage.evaluate(() => window.scrollTo(0, 0))
    await humanPause(bot, 800, 1500)

    for (let attempt = 0; attempt < 3; attempt++) {
        const tasks = await findMissionSubTasks(missionPage)
        if (!tasks.length) break

        bot.logger.info(
            bot.isMobile,
            'MODERN-MISSIONS',
            `Found ${tasks.length} incomplete task(s) for "${missionTitle}" (attempt ${attempt + 1})`
        )

        for (const task of tasks) {
            try {
                const clicked = await humanClickSubTaskByIndex(missionPage, task.index)
                if (clicked) {
                    bot.logger.info(
                        bot.isMobile,
                        'MODERN-MISSIONS',
                        `✔ Clicked sub-task: "${task.title}"`,
                        'green'
                    )
                }
                await humanPause(bot, 2500, 4000)

                const newTab = await bot.browser.utils.getLatestTab(missionPage)
                if (newTab !== missionPage) {
                    await newTab.waitForLoadState('domcontentloaded').catch(() => {})
                    await humanPause(bot, 3000, 6000)
                }
                await closeAllExtraTabs(bot, missionPage)
                await humanPause(bot, 2000, 5000)
            } catch (error) {
                bot.logger.error(bot.isMobile, 'MODERN-MISSIONS', `Error on sub-task "${task.title}": ${errMsg(error)}`)
                await closeAllExtraTabs(bot, missionPage)
            }
        }

        await missionPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
        await humanPause(bot, 2500, 4000)
    }
}

async function completeMission(bot: MicrosoftRewardsBot, page: Page, mission: MissionInfo): Promise<void> {
    await closeAllExtraTabs(bot, page)

    let clicked = await humanClickMissionTarget(page, mission)
    if (!clicked) {
        const box = await page.evaluate((idx: number) => {
            const cards = document.querySelectorAll('a[href*="/earn/quest/"], a[href*="/quest"], [role="link"]')
            const target = cards[idx] as HTMLElement | undefined
            if (!target) return null
            const rect = target.getBoundingClientRect()
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }, mission.index)
        if (box && box.width > 0) {
            await HumanizeEngine.humanClickBox(page, box)
            clicked = true
        }
    }

    await humanPause(bot, 2500, 4000)

    const latestPage = await bot.browser.utils.getLatestTab(page)

    if (latestPage !== page) {
        await latestPage.waitForLoadState('domcontentloaded').catch(() => {})
        await humanPause(bot, 2500, 4000)
        await completeMissionTasks(bot, latestPage, mission.title)
        await closeAllExtraTabs(bot, page)
    } else {
        const currentUrl = page.url()
        const hasNavigated = !currentUrl.endsWith('/earn') && !currentUrl.endsWith('/earn/')
        const isQuestPage =
            currentUrl.includes('/quest') || currentUrl.includes('/mission') || currentUrl.includes('/challenge')

        if (hasNavigated || isQuestPage) {
            await completeMissionTasks(bot, page, mission.title)
            await page.goto('https://rewards.bing.com/earn', { waitUntil: 'domcontentloaded', timeout: 30000 })
            await humanPause(bot, 1500, 2500)
        }
    }

    await humanPause(bot, 2000, 5000)
}

async function verifyMissions(bot: MicrosoftRewardsBot, page: Page): Promise<void> {
    await closeAllExtraTabs(bot, page)
    await page.goto('https://rewards.bing.com/earn', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await humanPause(bot, 2500, 4000)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await humanPause(bot, 1500, 2500)
    await page.evaluate(() => window.scrollTo(0, 0))
    await humanPause(bot, 800, 1500)

    const remaining = await findMissionCards(page)
    if (remaining.length === 0) {
        bot.logger.info(bot.isMobile, 'MODERN-MISSIONS', '✔ Verification passed: All missions completed', 'green')
        return
    }

    for (const mission of remaining) {
        try {
            await completeMission(bot, page, mission)
        } catch (error) {
            bot.logger.error(bot.isMobile, 'MODERN-MISSIONS', `Retry error on "${mission.title}": ${errMsg(error)}`)
            await closeAllExtraTabs(bot, page)
        }
    }
}

export async function doMissions(bot: MicrosoftRewardsBot, page: Page): Promise<void> {
    bot.logger.info(bot.isMobile, 'MODERN-MISSIONS', 'Starting Missions (Modern UI)')

    try {
        await navigateAndPrepare(bot, page, 'https://rewards.bing.com/earn')

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await humanPause(bot, 1500, 2500)
        await page.evaluate(() => window.scrollTo(0, 0))
        await humanPause(bot, 800, 1500)

        const missions = await findMissionCards(page)
        bot.logger.info(bot.isMobile, 'MODERN-MISSIONS', `Found ${missions.length} mission card(s)`)

        if (!missions.length) {
            bot.logger.info(bot.isMobile, 'MODERN-MISSIONS', 'No incomplete missions found')
            return
        }

        for (const mission of missions) {
            try {
                bot.logger.info(
                    bot.isMobile,
                    'MODERN-MISSIONS',
                    `Processing mission: "${mission.title}" (${mission.points}) - ${mission.completedTasks}/${mission.totalTasks} tasks`
                )
                await completeMission(bot, page, mission)
            } catch (error) {
                bot.logger.error(
                    bot.isMobile,
                    'MODERN-MISSIONS',
                    `Error on mission "${mission.title}": ${errMsg(error)}`
                )
                await closeAllExtraTabs(bot, page)
            }
        }

        await verifyMissions(bot, page)
        bot.logger.info(bot.isMobile, 'MODERN-MISSIONS', 'Missions completed')
    } catch (error) {
        bot.logger.error(bot.isMobile, 'MODERN-MISSIONS', `Error: ${errMsg(error)}`)
        await closeAllExtraTabs(bot, page)
    }
}
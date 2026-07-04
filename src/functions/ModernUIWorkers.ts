import type { Page } from 'patchright'
import type { MicrosoftRewardsBot } from '../index'
import { errMsg } from '../util/Utils'

/**
 * ModernUIWorkers handles the new Microsoft Rewards UI (April 2026+)
 *
 * Dashboard (/dashboard) sections:
 *   - "Your progress": expand (green) → shows streak/bonus info
 *   - "Daily set": expand → click each card to earn points
 *   - "Your activity": do NOT expand (no earnable points)
 *   - "Achievements": do NOT expand (no earnable points)
 *
 * Earn (/earn) sections:
 *   - "Keep earning": click each card WITH points badge (+5, +10, etc.)
 *   - Skip cards with "Silver level required" or no points badge
 *   - MUST click the card element (not visit URL) to trigger tracking
 *
 * DOM structure (April 2026):
 *   - Card title: <p class="text-globalBody2Strong">
 *   - Points badge: <p class="text-statusInformativeTintFg"> containing "+5", "+10"
 *   - Locked indicator: text "Silver level required" or lock icon
 *   - Expand button: button[slot="trigger"] or button[aria-expanded]
 */

interface CardInfo {
    index: number
    title: string
    points: string
    completed?: boolean
    href?: string
}

interface MissionInfo {
    index: number
    title: string
    points: string
    totalTasks: number
    completedTasks: number
    href: string
}

export class ModernUIWorkers {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    private async closeAllExtraTabs(page: Page): Promise<void> {
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
                this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Closed ${pages.length - 1} extra tab(s)`)
            }
        } catch (error) {
            this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Error closing extra tabs: ${errMsg(error)}`)
        }
    }

    async expandDashboardSection(page: Page, sectionHeading: string): Promise<boolean> {
        try {
            const expanded = await page.evaluate((heading: string) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (!section) continue

                        const btn =
                            section.querySelector('button[aria-expanded]') ||
                            section.querySelector('button[slot="trigger"]') ||
                            section.querySelector(`button[aria-label="${heading}"]`)

                        if (btn) {
                            const state = btn.getAttribute('aria-expanded')
                            if (state === 'false') {
                                ;(btn as HTMLElement).click()
                                return 'expanded'
                            }
                            return 'already-expanded'
                        }
                    }
                }
                return 'not-found'
            }, sectionHeading)

            if (expanded === 'expanded') {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-UI', `Expanded section: "${sectionHeading}"`)
                await this.bot.utils.wait(1500)
                return true
            } else if (expanded === 'already-expanded') {
                this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Section already expanded: "${sectionHeading}"`)
                return true
            }

            this.bot.logger.warn(this.bot.isMobile, 'MODERN-UI', `Section not found: "${sectionHeading}"`)
            return false
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-UI',
                `Error expanding "${sectionHeading}": ${errMsg(error)}`
            )
            return false
        }
    }

    /**
     * Scroll to and click a card inside a section, handle new tab, close extras.
     * Shared by doDailySet, doKeepEarning, and their verification retries.
     */
    private async clickCardInSection(page: Page, sectionHeading: string, card: CardInfo, tag: string): Promise<void> {
        await this.closeAllExtraTabs(page)

        // Scroll to card
        await page.evaluate(
            ({ heading, cardIndex }: { heading: string; cardIndex: number }) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (section) {
                            const target = section.querySelectorAll('a[target="_blank"]')[cardIndex] as HTMLElement
                            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }
                        break
                    }
                }
            },
            { heading: sectionHeading, cardIndex: card.index }
        )

        await this.bot.utils.wait(1000)

        // Click card
        await page.evaluate(
            ({ heading, cardIndex }: { heading: string; cardIndex: number }) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (section) {
                            const target = section.querySelectorAll('a[target="_blank"]')[
                                cardIndex
                            ] as HTMLAnchorElement
                            if (target) target.click()
                        }
                        break
                    }
                }
            },
            { heading: sectionHeading, cardIndex: card.index }
        )

        this.bot.logger.info(this.bot.isMobile, tag, `✔ Clicked: "${card.title}" (${card.points})`, 'green')

        await this.bot.utils.wait(3000)

        const newTab = await this.bot.browser.utils.getLatestTab(page)
        if (newTab !== page) {
            await newTab.waitForLoadState('domcontentloaded').catch(() => {})
            await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
        }

        await this.closeAllExtraTabs(page)
        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
    }

    /**
     * Process a list of cards: click each, handle errors, close tabs on failure.
     */
    private async processCards(page: Page, cards: CardInfo[], sectionHeading: string, tag: string): Promise<void> {
        for (const card of cards) {
            try {
                await this.clickCardInSection(page, sectionHeading, card, tag)
            } catch (error) {
                this.bot.logger.error(this.bot.isMobile, tag, `Error on "${card.title}": ${errMsg(error)}`)
                await this.closeAllExtraTabs(page)
            }
        }
    }

    /**
     * Navigate to a page, wait for content, dismiss messages.
     */
    private async navigateAndPrepare(page: Page, url: string): Promise<void> {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await this.bot.utils.wait(3000)
        await this.bot.browser.utils.tryDismissAllMessages(page)
    }

    /**
     * Complete Daily Set tasks on /dashboard
     */
    async doDailySet(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Starting Daily Set (Modern UI)')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/dashboard')

            await this.expandDashboardSection(page, 'Your progress')

            const expanded = await this.expandDashboardSection(page, 'Daily set')
            if (!expanded) {
                this.bot.logger.warn(this.bot.isMobile, 'MODERN-DAILY-SET', 'Could not expand Daily Set section')
                return
            }

            await this.bot.utils.wait(2000)

            const cards = await this.findDailySetCards(page)
            const uncompletedCards = cards.filter(c => !c.completed && c.points)

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-DAILY-SET',
                `Found ${cards.length} cards, ${uncompletedCards.length} uncompleted with points`
            )

            if (!uncompletedCards.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'All Daily Set items already completed')
                return
            }

            await this.processCards(page, uncompletedCards, 'Daily set', 'MODERN-DAILY-SET')

            await this.verifyAndRetry(page, 'Daily set', 'MODERN-DAILY-SET', 'https://rewards.bing.com/dashboard', () =>
                this.findDailySetCards(page).then(c => c.filter(x => !x.completed && x.points))
            )

            this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Daily Set completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-DAILY-SET', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findDailySetCards(page: Page): Promise<CardInfo[]> {
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

    /**
     * Generic verify-and-retry: reload page, re-expand section, find remaining cards, retry.
     */
    private async verifyAndRetry(
        page: Page,
        sectionHeading: string,
        tag: string,
        url: string,
        findRemaining: () => Promise<CardInfo[]>
    ): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, tag, `Verifying ${sectionHeading} completion...`)

            await this.closeAllExtraTabs(page)
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await this.bot.utils.wait(3000)

            if (sectionHeading === 'Daily set') {
                await this.expandDashboardSection(page, sectionHeading)
                await this.bot.utils.wait(2000)
            } else {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                await this.bot.utils.wait(2000)
                await page.evaluate(() => window.scrollTo(0, 0))
                await this.bot.utils.wait(1000)
            }

            const remaining = await findRemaining()

            if (remaining.length === 0) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    tag,
                    `✔ Verification passed: All ${sectionHeading} tasks completed`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    tag,
                    `Verification: ${remaining.length} task(s) still remaining: ${remaining.map(c => `${c.title}(${c.points})`).join(', ')}`
                )

                for (const card of remaining) {
                    try {
                        await this.clickCardInSection(page, sectionHeading, card, tag)
                        this.bot.logger.info(
                            this.bot.isMobile,
                            tag,
                            `✔ Retry clicked: "${card.title}" (${card.points})`,
                            'green'
                        )
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            tag,
                            `Retry error on "${card.title}": ${errMsg(error)}`
                        )
                        await this.closeAllExtraTabs(page)
                    }
                }
            }
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, tag, `Verification error: ${errMsg(error)}`)
        }
    }

    /**
     * Complete "Keep earning" tasks on /earn
     */
    async doKeepEarning(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Starting Keep Earning (Modern UI)')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/earn')

            // Scroll to load lazy content
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            const earnableCards = await this.findKeepEarningCards(page)

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-KEEP-EARNING',
                `Found ${earnableCards.length} earnable card(s)`
            )

            if (!earnableCards.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'No earnable cards found')
                return
            }

            await this.processCards(page, earnableCards, 'Keep earning', 'MODERN-KEEP-EARNING')

            await this.verifyAndRetry(
                page,
                'Keep earning',
                'MODERN-KEEP-EARNING',
                'https://rewards.bing.com/earn',
                () => this.findKeepEarningCards(page)
            )

            this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Keep Earning completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-KEEP-EARNING', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findKeepEarningCards(page: Page): Promise<CardInfo[]> {
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

                // Skip mission cards (handled by doMissions)
                if (/\d+\/\d+\s+tasks?/i.test(fullText)) return

                // Method 1: Badge-style points (+5, +10, +15, +20)
                let pointsText = ''
                anchor.querySelectorAll('span, div, p').forEach(el => {
                    const text = el.textContent?.trim() || ''
                    if (/^\+\d+$/.test(text)) pointsText = text
                })

                // Method 2: Description-style points ("earn 30 points", "pick up 20 points")
                if (!pointsText) {
                    const descEl = anchor.querySelector('p[class*="Secondary"], p[class*="secondary"]')
                    const descText = descEl?.textContent?.trim() || fullText
                    const descMatch = descText.match(
                        /(?:earn|pick\s*up|get|collect)\s+(\d+)\s+(?:bonus\s+)?(?:Rewards\s+)?points?/i
                    )
                    if (descMatch) {
                        pointsText = `+${descMatch[1]}`
                    }
                }

                // Method 3: Fallback - any "N points" pattern
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

    /**
     * Complete mission/challenge cards on /earn page.
     * These are cards with sub-tasks (e.g., "0/4 tasks") that require
     * clicking into the mission detail page to complete each task.
     * Missions change periodically (every few days).
     */
    async doMissions(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'Starting Missions (Modern UI)')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/earn')

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            const missions = await this.findMissionCards(page)

            this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', `Found ${missions.length} mission card(s)`)

            if (!missions.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'No incomplete missions found')
                return
            }

            for (const mission of missions) {
                try {
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Processing mission: "${mission.title}" (${mission.points}) - ${mission.completedTasks}/${mission.totalTasks} tasks`
                    )

                    await this.completeMission(page, mission)
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Error on mission "${mission.title}": ${errMsg(error)}`
                    )
                    await this.closeAllExtraTabs(page)
                }
            }

            // Verify: reload /earn page and check for remaining missions
            await this.verifyMissions(page)

            this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'Missions completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-MISSIONS', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findMissionCards(page: Page): Promise<MissionInfo[]> {
        return await page.evaluate(() => {
            const result: {
                index: number
                title: string
                points: string
                totalTasks: number
                completedTasks: number
                href: string
            }[] = []

            // Find all elements containing the task pattern (X/Y tasks/nhiệm vụ)
            const allElements = Array.from(document.querySelectorAll('*'))
            const taskElements = allElements.filter(el => {
                const childNodes = Array.from(el.childNodes)
                return childNodes.some(node => 
                    node.nodeType === 3 && // Node.TEXT_NODE
                    /(\d+)\/(\d+)\s*(?:tasks?|nhiệm\s*vụ|nv)/i.test(node.textContent || '')
                )
            })

            const seen = new Set<string>()

            taskElements.forEach((taskEl, i) => {
                const el = taskEl as HTMLElement
                const fullText = el.textContent?.trim() || ''

                // Skip if completed badge present in parent elements
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

                // Traverse up to find the container card/link
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

    private async completeMission(page: Page, mission: MissionInfo): Promise<void> {
        await this.closeAllExtraTabs(page)

        const clicked = await page.evaluate((m: MissionInfo) => {
            const elements = document.querySelectorAll('a[href], [role="link"], div[class*="Card"], li')
            for (const el of elements) {
                const fullText = el.textContent?.trim() || ''
                if (/\d+\/\d+\s*(?:tasks?|nhiệm\s*vụ|nv)/i.test(fullText)) {
                    const anchor = el.tagName === 'A' ? (el as HTMLAnchorElement) : el.querySelector('a[href]')
                    const href = anchor ? (anchor as HTMLAnchorElement).href : el.getAttribute('href') || ''
                    if ((m.href && href === m.href) || fullText.includes(m.title)) {
                        const target = (anchor || el) as HTMLElement
                        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        target.click()
                        return true
                    }
                }
            }
            return false
        }, mission)

        if (!clicked) {
            await page.evaluate((idx: number) => {
                const cards = document.querySelectorAll('a[href*="/earn/quest/"], a[href*="/quest"], [role="link"]')
                const target = cards[idx] as HTMLElement
                if (target) target.click()
            }, mission.index)
        }

        await this.bot.utils.wait(3000)

        const latestPage = await this.bot.browser.utils.getLatestTab(page)

        if (latestPage !== page) {
            await latestPage.waitForLoadState('domcontentloaded').catch(() => {})
            await this.bot.utils.wait(3000)
            await this.completeMissionTasks(latestPage, mission.title)
            await this.closeAllExtraTabs(page)
        } else {
            await page.waitForLoadState('domcontentloaded').catch(() => {})
            await this.bot.utils.wait(2000)
            const currentUrl = page.url()
            const hasNavigated = !currentUrl.endsWith('/earn') && !currentUrl.endsWith('/earn/')
            const isQuestPage = currentUrl.includes('/quest') || currentUrl.includes('/mission') || currentUrl.includes('/challenge')

            if (hasNavigated || isQuestPage) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'MODERN-MISSIONS',
                    `Navigated to quest detail: ${currentUrl}`
                )

                await this.completeMissionTasks(page, mission.title)

                await page.goto('https://rewards.bing.com/earn', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                })
                await this.bot.utils.wait(2000)
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'MODERN-MISSIONS',
                    `Quest "${mission.title}" did not navigate to detail page (URL: ${currentUrl})`
                )
            }
        }

        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
    }

    private async completeMissionTasks(missionPage: Page, missionTitle: string): Promise<void> {
        this.bot.logger.info(
            this.bot.isMobile,
            'MODERN-MISSIONS',
            `On mission detail page for "${missionTitle}": ${missionPage.url()}`
        )

        // Dismiss any popups on mission page
        await this.bot.browser.utils.tryDismissAllMessages(missionPage)
        await this.bot.utils.wait(1000)

        // Scroll to load all content
        await missionPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await this.bot.utils.wait(1500)
        await missionPage.evaluate(() => window.scrollTo(0, 0))
        await this.bot.utils.wait(1000)

        const maxAttempts = 3
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const tasks = await this.findMissionSubTasks(missionPage)

            if (!tasks.length) {
                if (attempt === 0) {
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `All tasks already completed for "${missionTitle}"`
                    )
                }
                break
            }

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-MISSIONS',
                `Found ${tasks.length} incomplete task(s) for "${missionTitle}" (attempt ${attempt + 1})`
            )

            for (const task of tasks) {
                try {
                    await this.clickMissionSubTask(missionPage, task)
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Error on sub-task "${task.title}": ${errMsg(error)}`
                    )
                    await this.closeAllExtraTabs(missionPage)
                }
            }

            // Reload mission page to check progress
            await missionPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
            await this.bot.utils.wait(3000)
        }
    }

    private async findMissionSubTasks(page: Page): Promise<CardInfo[]> {
        return await page.evaluate(() => {
            const result: { index: number; title: string; points: string; completed: boolean }[] = []

            // Find all potential subtask links or buttons
            const allLinks = document.querySelectorAll('a[href], button, [role="link"], div[class*="cursor-pointer"]')
            const seen = new Set<string>()
            let logicalIndex = 0

            allLinks.forEach((link) => {
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

                result.push({
                    index: logicalIndex,
                    title,
                    points: '',
                    completed: false
                })
                logicalIndex++
            })

            return result
        })
    }

    private async clickMissionSubTask(page: Page, task: CardInfo): Promise<void> {
        await this.closeAllExtraTabs(page)

        await page.evaluate((taskIndex: number) => {
            const allLinks = document.querySelectorAll('a[href], button, [role="link"], div[class*="cursor-pointer"]')
            const seen = new Set<string>()
            let logicalIndex = 0

            for (const link of allLinks) {
                const el = link as HTMLElement
                const fullText = el.textContent?.trim() || ''

                if (el.getAttribute('aria-disabled') === 'true') continue
                if (el.getAttribute('data-disabled') === 'true') continue
                if (el.closest('[aria-disabled="true"], [data-disabled="true"]')) continue

                if (fullText.includes('Completed') || fullText.includes('Hoàn thành')) continue
                const parentRow = el.closest('div, li, article')
                if (parentRow?.querySelector('[class*="bg-statusSuccessRewardsBg"]')) continue

                if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) continue

                const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href : el.getAttribute('href') || ''
                if (href) {
                    try {
                        const path = new URL(href, window.location.origin).pathname
                        if (path === '/earn' || path === '/earn/' || path === '/dashboard' || path === '/dashboard/') continue
                    } catch {}
                }

                if (fullText.length < 2) continue

                const dedupeKey = href || fullText.substring(0, 40)
                if (seen.has(dedupeKey)) continue
                seen.add(dedupeKey)

                let taskContainer: Element | null = el.parentElement
                for (let depth = 0; depth < 6 && taskContainer; depth++) {
                    if (taskContainer.querySelector('h3, h4, p[class*="Body2Strong"]')) break
                    taskContainer = taskContainer.parentElement
                }



                if (logicalIndex === taskIndex) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    el.click()
                    return
                }
                logicalIndex++
            }
        }, task.index)

        this.bot.logger.info(
            this.bot.isMobile,
            'MODERN-MISSIONS',
            `✔ Clicked sub-task: "${task.title}" ${task.points ? `(${task.points})` : ''}`,
            'green'
        )

        await this.bot.utils.wait(3000)

        // Handle new tab that might have opened
        const newTab = await this.bot.browser.utils.getLatestTab(page)
        if (newTab !== page) {
            await newTab.waitForLoadState('domcontentloaded').catch(() => {})
            await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
        }

        await this.closeAllExtraTabs(page)
        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
    }

    private async verifyMissions(page: Page): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'Verifying mission completion...')

            await this.closeAllExtraTabs(page)
            await page.goto('https://rewards.bing.com/earn', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            })
            await this.bot.utils.wait(3000)

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            const remaining = await this.findMissionCards(page)

            if (remaining.length === 0) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'MODERN-MISSIONS',
                    '✔ Verification passed: All missions completed',
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'MODERN-MISSIONS',
                    `Verification: ${remaining.length} mission(s) still remaining: ${remaining.map(m => `${m.title}(${m.completedTasks}/${m.totalTasks})`).join(', ')}`
                )

                // One more attempt on remaining missions
                for (const mission of remaining) {
                    try {
                        await this.completeMission(page, mission)
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            'MODERN-MISSIONS',
                            `Retry error on "${mission.title}": ${errMsg(error)}`
                        )
                        await this.closeAllExtraTabs(page)
                    }
                }
            }
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-MISSIONS', `Verification error: ${errMsg(error)}`)
        }
    }

    /**
     * Auto claim pending points on /dashboard
     * Detects "Ready to claim" card, clicks it, and clicks "Claim points" button in flyout
     */
    async doClaimPoints(page: Page): Promise<{ claimed: boolean; points: number }> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-CLAIM', 'Starting auto claim points')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/dashboard')

            // Find "Ready to claim" card
            const claimCard = await this.findClaimCard(page)
            if (!claimCard) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-CLAIM', 'No points ready to claim')
                return { claimed: false, points: 0 }
            }

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-CLAIM',
                `Found ${claimCard.points} points ready to claim`,
                'green'
            )

            // Click the card to open flyout
            await this.clickClaimCard(page, claimCard)
            await this.bot.utils.wait(2000)

            // Wait for flyout and click "Claim points" button
            const claimButton = await page.$('button[data-rac]:has-text("Claim points")')
            if (claimButton) {
                await claimButton.click()
                this.bot.logger.info(
                    this.bot.isMobile,
                    'MODERN-CLAIM',
                    `✔ Claimed ${claimCard.points} points`,
                    'green'
                )

                await this.bot.utils.wait(3000)
                await this.closeAllExtraTabs(page)

                return { claimed: true, points: claimCard.points }
            } else {
                this.bot.logger.warn(this.bot.isMobile, 'MODERN-CLAIM', 'Claim button not found in flyout')
                await this.closeAllExtraTabs(page)
                return { claimed: false, points: 0 }
            }
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-CLAIM', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
            return { claimed: false, points: 0 }
        }
    }

    private async findClaimCard(page: Page): Promise<{ points: number } | null> {
        return await page.evaluate(() => {
            const cards = document.querySelectorAll('div[class*="bg-bgCardOnPrimaryDefaultRest"]')

            for (const card of cards) {
                const fullText = card.textContent?.trim() || ''

                // Look for "Ready to claim" text
                if (!fullText.includes('Ready to claim')) continue

                // Extract points number from the card
                // Pattern: <p class="text-pageHeader">124</p>
                const pointsEl = card.querySelector('p[class*="text-pageHeader"]')
                if (!pointsEl) continue

                const pointsText = pointsEl.textContent?.trim() || ''
                const points = parseInt(pointsText)

                if (!isNaN(points) && points > 0) {
                    return { points }
                }
            }

            return null
        })
    }

    private async clickClaimCard(page: Page, claimCard: { points: number }): Promise<void> {
        await page.evaluate((points: number) => {
            const cards = document.querySelectorAll('div[class*="bg-bgCardOnPrimaryDefaultRest"]')

            for (const card of cards) {
                const fullText = card.textContent?.trim() || ''

                if (!fullText.includes('Ready to claim')) continue

                const pointsEl = card.querySelector('p[class*="text-pageHeader"]')
                if (!pointsEl) continue

                const pointsText = pointsEl.textContent?.trim() || ''
                const cardPoints = parseInt(pointsText)

                if (cardPoints === points) {
                    ;(card as HTMLElement).click()
                    return
                }
            }
        }, claimCard.points)
    }
}

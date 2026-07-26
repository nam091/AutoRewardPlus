import type { Page } from 'patchright'
import type { MicrosoftRewardsBot } from '../index'
import { errMsg } from '../util/Utils'
import { uiDiagnostic } from '../util/ErrorDiagnostic'
import {
    buildEvaluateProfile,
    CLAIM_BUTTON_TEXTS,
    SECTIONS,
    type EvaluateProfile,
    type SectionProfile
} from './ModernUISelectors'

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
    private readonly selectors: EvaluateProfile = buildEvaluateProfile()

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    /**
     * Waits until a section has real content instead of placeholders.
     *
     * Sections render skeleton placeholders while loading. A fixed wait meant
     * the workers frequently read a section that was still a skeleton, found
     * zero cards, logged "no earnable cards" and skipped every task in it.
     */
    private async waitForSectionContent(page: Page, section: SectionProfile, timeoutMs = 25000): Promise<boolean> {
        const args = {
            ids: [...section.ids],
            headings: [...section.headings],
            cardSelectors: this.selectors.cardLinkSelectors,
            skeletonSelectors: this.selectors.skeletonSelectors
        }

        const deadline = Date.now() + timeoutMs
        let lastState = { found: false, cards: 0, skeletons: 0 }

        while (Date.now() < deadline) {
            lastState = await page.evaluate(({ ids, headings, cardSelectors, skeletonSelectors }: typeof args) => {
                const candidates: Element[] = []
                for (const id of ids) {
                    document.querySelectorAll(`section[id="${id}"]`).forEach(el => candidates.push(el))
                }
                Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                    const text = (h.textContent ?? '').trim().toLowerCase()
                    if (!headings.some(alias => text.startsWith(alias))) return
                    const container = h.closest('section') ?? h.parentElement?.parentElement
                    if (container && !candidates.includes(container)) candidates.push(container)
                })

                let cards = 0
                let skeletons = 0
                for (const container of candidates) {
                    for (const selector of cardSelectors) {
                        const count = container.querySelectorAll(selector).length
                        if (count) {
                            cards = Math.max(cards, count)
                            break
                        }
                    }
                    skeletons += skeletonSelectors.reduce(
                        (sum, selector) => sum + container.querySelectorAll(selector).length,
                        0
                    )
                }

                return { found: candidates.length > 0, cards, skeletons }
            }, args)

            if (lastState.cards > 0 && lastState.skeletons === 0) return true
            await this.bot.utils.wait(1000)
        }

        this.bot.logger.warn(
            this.bot.isMobile,
            'MODERN-UI',
            `Section "${section.label}" did not finish loading within ${Math.round(timeoutMs / 1000)}s | cards=${lastState.cards} | skeletons=${lastState.skeletons}`
        )
        return lastState.cards > 0
    }

    /**
     * Saves the page when a selector fails, so a markup change on Microsoft's
     * side leaves something to inspect instead of a single log line.
     */
    private async reportSelectorMiss(page: Page, label: string, details: string): Promise<void> {
        const dir = await uiDiagnostic(page, label, details)
        if (dir) {
            this.bot.logger.warn(this.bot.isMobile, 'MODERN-UI', `Saved selector diagnostics to: ${dir}`)
        }
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

    async expandDashboardSection(page: Page, section: SectionProfile): Promise<boolean> {
        try {
            const args = {
                ids: [...section.ids],
                headings: [...section.headings],
                triggerSelectors: this.selectors.expandTriggerSelectors,
                infoLabelPrefixes: this.selectors.infoButtonLabelPrefixes
            }

            const expanded = await page.evaluate(
                ({ ids, headings, triggerSelectors, infoLabelPrefixes }: typeof args) => {
                    const candidates: Element[] = []
                    for (const id of ids) {
                        document.querySelectorAll(`section[id="${id}"]`).forEach(el => candidates.push(el))
                    }
                    Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                        const text = (h.textContent ?? '').trim().toLowerCase()
                        if (!headings.some(alias => text.startsWith(alias))) return
                        const container = h.closest('section') ?? h.parentElement?.parentElement
                        if (container && !candidates.includes(container)) candidates.push(container)
                    })

                    if (!candidates.length) return 'not-found'

                    // A section also contains an "About <section>" info popover
                    // button carrying aria-expanded="false". Clicking it opens a
                    // tooltip and leaves the section untouched.
                    const isInfoButton = (btn: Element) => {
                        const label = (btn.getAttribute('aria-label') ?? '').trim().toLowerCase()
                        return infoLabelPrefixes.some(prefix => label.startsWith(prefix))
                    }

                    for (const container of candidates) {
                        for (const selector of triggerSelectors) {
                            const btn = Array.from(container.querySelectorAll(selector)).find(
                                candidate => !isInfoButton(candidate)
                            )
                            if (!btn) continue

                            if (btn.getAttribute('aria-expanded') === 'false') {
                                ;(btn as HTMLElement).click()
                                return 'expanded'
                            }
                            return 'already-expanded'
                        }
                    }

                    // Section exists but has no collapse control, so it is already visible.
                    return 'already-expanded'
                },
                args
            )

            if (expanded === 'expanded') {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-UI', `Expanded section: "${section.label}"`)
                await this.bot.utils.wait(1500)
                return true
            } else if (expanded === 'already-expanded') {
                this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Section already expanded: "${section.label}"`)
                return true
            }

            this.bot.logger.warn(
                this.bot.isMobile,
                'MODERN-UI',
                `Section not found: "${section.label}" (tried headings: ${section.headings.join(', ')})`
            )
            await this.reportSelectorMiss(
                page,
                `section-not-found-${section.key}`,
                `No h2/h3 heading started with any of: ${section.headings.join(' | ')}`
            )
            return false
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-UI',
                `Error expanding "${section.label}": ${errMsg(error)}`
            )
            return false
        }
    }

    /**
     * Scroll to and click a card inside a section, handle new tab, close extras.
     * Shared by doDailySet, doKeepEarning, and their verification retries.
     */
    private async clickCardInSection(page: Page, section: SectionProfile, card: CardInfo, tag: string): Promise<void> {
        await this.closeAllExtraTabs(page)

        // Resolving by href first means an extra promoted card appearing in the
        // section does not shift the click onto the wrong task; the recorded
        // index stays as a fallback for cards that expose no usable href.
        const args = {
            ids: [...section.ids],
            headings: [...section.headings],
            cardSelectors: this.selectors.cardLinkSelectors,
            cardIndex: card.index,
            cardHref: card.href ?? '',
            action: 'scroll' as 'scroll' | 'click'
        }

        // The resolver is duplicated inside the evaluate body on purpose:
        // `page.evaluate` serializes the callback, so it cannot close over
        // helpers defined here, and injecting one via eval() would be blocked
        // by the site's CSP.
        const runOnCard = (input: typeof args) =>
            page.evaluate(({ ids, headings, cardSelectors, cardIndex, cardHref, action }: typeof args) => {
                // Must match how the finders resolve the section: several
                // elements share the id and heading, and only one holds cards.
                const candidates: Element[] = []
                for (const id of ids) {
                    document.querySelectorAll(`section[id="${id}"]`).forEach(el => candidates.push(el))
                }
                Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                    const text = (h.textContent ?? '').trim().toLowerCase()
                    if (!headings.some(alias => text.startsWith(alias))) return
                    const container = h.closest('section') ?? h.parentElement?.parentElement
                    if (container && !candidates.includes(container)) candidates.push(container)
                })
                if (!candidates.length) return false

                let cards: HTMLElement[] = []
                for (const container of candidates) {
                    for (const selector of cardSelectors) {
                        const found = Array.from(container.querySelectorAll(selector)) as HTMLElement[]
                        if (found.length > cards.length) cards = found
                        if (found.length) break
                    }
                }
                if (!cards.length) return false

                let target: HTMLElement | null = null
                if (cardHref) {
                    target = cards.find(c => (c as HTMLAnchorElement).href === cardHref) ?? null
                }
                target ??= cards[cardIndex] ?? null
                if (!target) return false

                if (action === 'scroll') {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else {
                    target.click()
                }
                return true
            }, input)

        const located = await runOnCard({ ...args, action: 'scroll' })

        if (!located) {
            this.bot.logger.warn(
                this.bot.isMobile,
                tag,
                `Could not locate card "${card.title}" in section "${section.label}"`
            )
            await this.reportSelectorMiss(
                page,
                `card-not-found-${section.key}`,
                `Card "${card.title}" (index ${card.index}, href "${card.href ?? ''}") not resolvable`
            )
            return
        }

        await this.bot.utils.wait(1000)

        await runOnCard({ ...args, action: 'click' })

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
    private async processCards(page: Page, cards: CardInfo[], section: SectionProfile, tag: string): Promise<void> {
        for (const card of cards) {
            try {
                await this.clickCardInSection(page, section, card, tag)
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

            await this.expandDashboardSection(page, SECTIONS.yourProgress)

            const expanded = await this.expandDashboardSection(page, SECTIONS.dailySet)
            if (!expanded) {
                this.bot.logger.warn(this.bot.isMobile, 'MODERN-DAILY-SET', 'Could not expand Daily Set section')
                return
            }

            await this.bot.utils.wait(2000)

            await this.waitForSectionContent(page, SECTIONS.dailySet)

            const cards = await this.findDailySetCards(page)
            // Points are not required here. Every daily set card is earnable, and
            // requiring a parsed point value meant a card whose badge could not
            // be read was silently skipped instead of clicked.
            const uncompletedCards = cards.filter(c => !c.completed)

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-DAILY-SET',
                `Found ${cards.length} cards, ${uncompletedCards.length} uncompleted with points`
            )

            if (!uncompletedCards.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'All Daily Set items already completed')
                return
            }

            await this.processCards(page, uncompletedCards, SECTIONS.dailySet, 'MODERN-DAILY-SET')

            await this.verifyAndRetry(
                page,
                SECTIONS.dailySet,
                'MODERN-DAILY-SET',
                'https://rewards.bing.com/dashboard',
                () => this.findDailySetCards(page).then(c => c.filter(x => !x.completed))
            )

            this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Daily Set completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-DAILY-SET', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findDailySetCards(page: Page): Promise<CardInfo[]> {
        const args = {
            ids: [...SECTIONS.dailySet.ids],
            headings: [...SECTIONS.dailySet.headings],
            cardSelectors: this.selectors.cardLinkSelectors,
            titleSelectors: this.selectors.titleSelectors,
            pointsBadgeSelectors: this.selectors.pointsBadgeSelectors,
            completedBadgeSelectors: this.selectors.completedBadgeSelectors,
            completedTexts: this.selectors.completedTexts,
            maxCardPoints: this.selectors.maxCardPoints
        }

        return await page.evaluate((input: typeof args) => {
            const {
                ids,
                headings,
                cardSelectors,
                titleSelectors,
                pointsBadgeSelectors,
                completedBadgeSelectors,
                completedTexts,
                maxCardPoints
            } = input

            const result: { index: number; title: string; points: string; completed: boolean; href: string }[] = []

            // The page renders more than one element per section id (a visible
            // copy and a hidden one) and only one of them holds the cards, so
            // every candidate is considered and the richest one wins.
            const candidates: Element[] = []
            for (const id of ids) {
                document.querySelectorAll(`section[id="${id}"]`).forEach(el => candidates.push(el))
            }
            Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                const text = (h.textContent ?? '').trim().toLowerCase()
                if (!headings.some(alias => text.startsWith(alias))) return
                const container = h.closest('section') ?? h.parentElement?.parentElement
                if (container && !candidates.includes(container)) candidates.push(container)
            })

            let cardLinks: HTMLElement[] = []
            for (const container of candidates) {
                for (const selector of cardSelectors) {
                    const found = Array.from(container.querySelectorAll(selector)) as HTMLElement[]
                    if (found.length > cardLinks.length) cardLinks = found
                    if (found.length) break
                }
            }

            cardLinks.forEach((card, i) => {
                const anchor = card as HTMLAnchorElement
                const fullText = (anchor.textContent ?? '').trim()
                const lowerText = fullText.toLowerCase()

                let title = ''
                for (const selector of titleSelectors) {
                    const el = anchor.querySelector(selector)
                    if (el?.textContent?.trim()) {
                        title = el.textContent.trim()
                        break
                    }
                }
                if (!title) title = fullText.substring(0, 60)

                // Accept both "+10" and a bare "10": the daily set renders the
                // figure without a plus sign.
                let points = ''
                for (const selector of pointsBadgeSelectors) {
                    const el = Array.from(anchor.querySelectorAll(selector)).find(candidate => {
                        const text = (candidate.textContent ?? '').trim()
                        return /^\+?\d+$/.test(text)
                    })
                    if (el) {
                        const value = parseInt((el.textContent ?? '').replace('+', '').trim())
                        if (value > 0 && value <= maxCardPoints) {
                            points = `+${value}`
                            break
                        }
                    }
                }
                if (!points) {
                    anchor.querySelectorAll('span, div, p').forEach(el => {
                        if (el.children.length) return
                        const text = (el.textContent ?? '').trim()
                        if (!/^\+?\d+$/.test(text)) return
                        const value = parseInt(text.replace('+', ''))
                        if (value > 0 && value <= maxCardPoints) points = `+${value}`
                    })
                }

                const hasBadge = completedBadgeSelectors.some(selector => !!anchor.querySelector(selector))
                const isCompleted = hasBadge || completedTexts.some(marker => lowerText.includes(marker))

                result.push({ index: i, title, points, completed: isCompleted, href: anchor.href ?? '' })
            })

            return result
        }, args)
    }

    /**
     * Generic verify-and-retry: reload page, re-expand section, find remaining cards, retry.
     */
    private async verifyAndRetry(
        page: Page,
        section: SectionProfile,
        tag: string,
        url: string,
        findRemaining: () => Promise<CardInfo[]>
    ): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, tag, `Verifying ${section.label} completion...`)

            await this.closeAllExtraTabs(page)
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await this.bot.utils.wait(3000)

            if (section.key === SECTIONS.dailySet.key) {
                await this.expandDashboardSection(page, section)
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
                    `✔ Verification passed: All ${section.label} tasks completed`,
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
                        await this.clickCardInSection(page, section, card, tag)
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

            await this.waitForSectionContent(page, SECTIONS.keepEarning)

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

            await this.processCards(page, earnableCards, SECTIONS.keepEarning, 'MODERN-KEEP-EARNING')

            await this.verifyAndRetry(
                page,
                SECTIONS.keepEarning,
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
        const args = {
            ids: [...SECTIONS.keepEarning.ids],
            headings: [...SECTIONS.keepEarning.headings],
            cardSelectors: this.selectors.cardLinkSelectors,
            pointsBadgeSelectors: this.selectors.pointsBadgeSelectors,
            maxCardPoints: this.selectors.maxCardPoints,
            titleSelectors: this.selectors.titleSelectors,
            descriptionSelectors: this.selectors.descriptionSelectors,
            completedBadgeSelectors: this.selectors.completedBadgeSelectors,
            completedTexts: this.selectors.completedTexts,
            lockedTexts: this.selectors.lockedTexts,
            taskCountPattern: this.selectors.taskCountPattern,
            earnPointsPattern: this.selectors.earnPointsPattern,
            barePointsPattern: this.selectors.barePointsPattern
        }

        const outcome = await page.evaluate((input: typeof args) => {
            const {
                ids,
                headings,
                cardSelectors,
                pointsBadgeSelectors,
                maxCardPoints,
                titleSelectors,
                descriptionSelectors,
                completedBadgeSelectors,
                completedTexts,
                lockedTexts,
                taskCountPattern,
                earnPointsPattern,
                barePointsPattern
            } = input

            const cards: { index: number; title: string; points: string; href: string }[] = []

            // Several elements share this section's id and heading; only one of
            // them holds the cards, so all candidates are examined.
            const candidates: Element[] = []
            for (const id of ids) {
                document.querySelectorAll(`section[id="${id}"]`).forEach(el => candidates.push(el))
            }
            Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                const text = (h.textContent ?? '').trim().toLowerCase()
                if (!headings.some(alias => text.startsWith(alias))) return
                const container = h.closest('section') ?? h.parentElement?.parentElement
                if (container && !candidates.includes(container)) candidates.push(container)
            })

            if (!candidates.length) return { sectionFound: false, cards }

            const taskCountRegex = new RegExp(taskCountPattern, 'i')
            const earnPointsRegex = new RegExp(earnPointsPattern, 'i')
            const barePointsRegex = new RegExp(barePointsPattern, 'i')

            let allCards: HTMLElement[] = []
            for (const container of candidates) {
                for (const selector of cardSelectors) {
                    const found = Array.from(container.querySelectorAll(selector)) as HTMLElement[]
                    if (found.length > allCards.length) allCards = found
                    if (found.length) break
                }
            }

            allCards.forEach((card, i) => {
                const anchor = card as HTMLAnchorElement
                const fullText = (anchor.textContent ?? '').trim()
                const lowerText = fullText.toLowerCase()

                if (completedTexts.some(marker => lowerText.includes(marker))) return
                if (completedBadgeSelectors.some(selector => !!anchor.querySelector(selector))) return
                if (lockedTexts.some(marker => lowerText.includes(marker))) return

                // Mission cards carry sub-tasks and are handled by doMissions.
                if (taskCountRegex.test(fullText)) return

                // Method 1: badge points, with or without a leading "+"
                let pointsText = ''
                for (const selector of pointsBadgeSelectors) {
                    const el = Array.from(anchor.querySelectorAll(selector)).find(candidate =>
                        /^\+?\d+$/.test((candidate.textContent ?? '').trim())
                    )
                    if (el) {
                        const value = parseInt((el.textContent ?? '').replace('+', '').trim())
                        if (value > 0 && value <= maxCardPoints) {
                            pointsText = `+${value}`
                            break
                        }
                    }
                }
                if (!pointsText) {
                    anchor.querySelectorAll('span, div, p').forEach(el => {
                        if (el.children.length) return
                        const text = (el.textContent ?? '').trim()
                        if (!/^\+?\d+$/.test(text)) return
                        const value = parseInt(text.replace('+', ''))
                        if (value > 0 && value <= maxCardPoints) pointsText = `+${value}`
                    })
                }

                // Method 2: description-style ("earn 30 points" / "nhận 30 điểm")
                if (!pointsText) {
                    let descText = ''
                    for (const selector of descriptionSelectors) {
                        const el = anchor.querySelector(selector)
                        if (el?.textContent?.trim()) {
                            descText = el.textContent.trim()
                            break
                        }
                    }
                    const descMatch = (descText || fullText).match(earnPointsRegex)
                    if (descMatch) pointsText = `+${descMatch[1]}`
                }

                // Method 3: any bare "N points" figure within a plausible range
                if (!pointsText) {
                    const match = fullText.match(barePointsRegex)
                    const value = match?.[1] ? parseInt(match[1]) : 0
                    if (value > 0 && value <= maxCardPoints && !lowerText.includes('lifetime points')) {
                        pointsText = `+${value}`
                    }
                }

                if (!pointsText) return

                let title = ''
                for (const selector of titleSelectors) {
                    const el = anchor.querySelector(selector)
                    if (el?.textContent?.trim()) {
                        title = el.textContent.trim().substring(0, 60)
                        break
                    }
                }
                if (!title) title = fullText.replace(pointsText, '').trim().substring(0, 60)

                cards.push({ index: i, title, points: pointsText, href: anchor.href ?? '' })
            })

            return { sectionFound: true, cards }
        }, args)

        if (!outcome.sectionFound) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'MODERN-KEEP-EARNING',
                `Section not found (tried headings: ${SECTIONS.keepEarning.headings.join(', ')})`
            )
            await this.reportSelectorMiss(
                page,
                `section-not-found-${SECTIONS.keepEarning.key}`,
                `No h2/h3 heading started with any of: ${SECTIONS.keepEarning.headings.join(' | ')}`
            )
        }

        return outcome.cards
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

            // Missions live in the "Quests" section, which loads asynchronously
            // like the rest of /earn. Reading it too early reports no missions.
            await this.waitForSectionContent(page, SECTIONS.quests)

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
        const args = {
            taskCountPattern: this.selectors.taskCountPattern,
            barePointsPattern: this.selectors.barePointsPattern,
            titleSelectors: this.selectors.titleSelectors,
            completedBadgeSelectors: this.selectors.completedBadgeSelectors
        }

        return await page.evaluate(
            ({ taskCountPattern, barePointsPattern, titleSelectors, completedBadgeSelectors }: typeof args) => {
                const result: {
                    index: number
                    title: string
                    points: string
                    totalTasks: number
                    completedTasks: number
                    href: string
                }[] = []

                const taskCountRegex = new RegExp(taskCountPattern, 'i')
                const barePointsRegex = new RegExp(barePointsPattern, 'i')

                // Find all elements containing the task pattern (X/Y tasks/nhiệm vụ)
                const allElements = Array.from(document.querySelectorAll('*'))
                const taskElements = allElements.filter(el => {
                    const childNodes = Array.from(el.childNodes)
                    return childNodes.some(node => node.nodeType === 3 && taskCountRegex.test(node.textContent || ''))
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
                            completedBadgeSelectors.some(selector => !!temp!.querySelector(selector)) ||
                            temp.className.toLowerCase().includes('success')
                        ) {
                            isCompleted = true
                            break
                        }
                        temp = temp.parentElement
                    }
                    if (isCompleted) return

                    const taskMatch = fullText.match(taskCountRegex)
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
                        const match = (card.textContent || '').match(barePointsRegex)
                        if (match?.[1] && parseInt(match[1]) > 0) {
                            pointsText = `+${match[1]}`
                        }
                    }

                    let title = ''
                    for (const selector of titleSelectors) {
                        const titleEl = card.querySelector(selector)
                        if (titleEl?.textContent?.trim()) {
                            title = titleEl.textContent.trim().substring(0, 60)
                            break
                        }
                    }
                    if (!title) {
                        title =
                            (card.textContent ?? '')
                                .replace(taskCountRegex, '')
                                .replace(/\+\d+/, '')
                                .replace(/Expires in.*?$/i, '')
                                .trim()
                                .substring(0, 60) || `Quest_${i}`
                    }

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
            },
            args
        )
    }

    private async completeMission(page: Page, mission: MissionInfo): Promise<void> {
        await this.closeAllExtraTabs(page)

        const args = {
            mission,
            missionCardSelectors: this.selectors.missionCardSelectors,
            taskCountPattern: this.selectors.taskCountPattern
        }

        const clicked = await page.evaluate(({ mission: m, missionCardSelectors, taskCountPattern }: typeof args) => {
            const taskCountRegex = new RegExp(taskCountPattern, 'i')
            const elements = document.querySelectorAll(missionCardSelectors.join(', '))

            for (const el of elements) {
                const fullText = el.textContent?.trim() || ''
                if (!taskCountRegex.test(fullText)) continue

                const anchor = el.tagName === 'A' ? (el as HTMLAnchorElement) : el.querySelector('a[href]')
                const href = anchor ? (anchor as HTMLAnchorElement).href : el.getAttribute('href') || ''

                if ((m.href && href === m.href) || (m.title && fullText.includes(m.title))) {
                    const target = (anchor || el) as HTMLElement
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    target.click()
                    return true
                }
            }
            return false
        }, args)

        if (!clicked) {
            // Deliberately no positional fallback: the old code clicked
            // `cards[mission.index]` from a differently-filtered list, which
            // could open an unrelated card.
            this.bot.logger.warn(
                this.bot.isMobile,
                'MODERN-MISSIONS',
                `Could not locate mission card "${mission.title}" (href: ${mission.href || 'none'})`
            )
            await this.reportSelectorMiss(
                page,
                'mission-card-not-found',
                `Mission "${mission.title}" href="${mission.href}" not matched by any of: ${this.selectors.missionCardSelectors.join(' | ')}`
            )
            return
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
            const isQuestPage =
                currentUrl.includes('/quest') || currentUrl.includes('/mission') || currentUrl.includes('/challenge')

            if (hasNavigated || isQuestPage) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', `Navigated to quest detail: ${currentUrl}`)

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
        const args = {
            taskSelectors: this.selectors.missionTaskSelectors,
            titleSelectors: this.selectors.titleSelectors,
            completedTexts: this.selectors.completedTexts,
            completedBadgeSelectors: this.selectors.completedBadgeSelectors
        }

        return await page.evaluate(
            ({ taskSelectors, titleSelectors, completedTexts, completedBadgeSelectors }: typeof args) => {
                const result: { index: number; title: string; points: string; completed: boolean; href: string }[] = []

                const allLinks = document.querySelectorAll(taskSelectors.join(', '))
                const seen = new Set<string>()
                let logicalIndex = 0

                allLinks.forEach(link => {
                    const el = link as HTMLElement
                    const fullText = el.textContent?.trim() || ''
                    const lowerText = fullText.toLowerCase()

                    if (el.getAttribute('aria-disabled') === 'true') return
                    if (el.getAttribute('data-disabled') === 'true') return
                    if (el.closest('[aria-disabled="true"], [data-disabled="true"]')) return

                    if (completedTexts.some(marker => lowerText.includes(marker))) return
                    const parentRow = el.closest('div, li, article')
                    if (parentRow && completedBadgeSelectors.some(selector => !!parentRow.querySelector(selector))) {
                        return
                    }

                    if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) return

                    const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href : el.getAttribute('href') || ''
                    if (href) {
                        try {
                            const path = new URL(href, window.location.origin).pathname
                            if (
                                path === '/earn' ||
                                path === '/earn/' ||
                                path === '/dashboard' ||
                                path === '/dashboard/'
                            ) {
                                return
                            }
                        } catch {
                            /* a non-parsable href is still worth clicking */
                        }
                    }

                    if (fullText.length < 2) return

                    const dedupeKey = href || fullText.substring(0, 40)
                    if (seen.has(dedupeKey)) return
                    seen.add(dedupeKey)

                    let taskContainer: Element | null = el.parentElement
                    for (let depth = 0; depth < 6 && taskContainer; depth++) {
                        if (taskContainer.querySelector(titleSelectors.join(', '))) break
                        taskContainer = taskContainer.parentElement
                    }

                    let title = ''
                    if (taskContainer) {
                        const titleEl = taskContainer.querySelector(titleSelectors.join(', '))
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
                        completed: false,
                        // Identity used to re-find this row later; the index alone
                        // is not stable once earlier tasks complete.
                        href: href || fullText.substring(0, 40)
                    })
                    logicalIndex++
                })

                return result
            },
            args
        )
    }

    private async clickMissionSubTask(page: Page, task: CardInfo): Promise<boolean> {
        await this.closeAllExtraTabs(page)

        const args = {
            taskSelectors: this.selectors.missionTaskSelectors,
            completedTexts: this.selectors.completedTexts,
            completedBadgeSelectors: this.selectors.completedBadgeSelectors,
            taskKey: task.href ?? '',
            taskTitle: task.title
        }

        // Matched by identity rather than by position. Completing one sub-task
        // removes it from the incomplete list, which shifted every later index
        // and made the loop click the wrong row and skip the last one.
        const clicked = await page.evaluate(
            ({ taskSelectors, completedTexts, completedBadgeSelectors, taskKey, taskTitle }: typeof args) => {
                const allLinks = document.querySelectorAll(taskSelectors.join(', '))

                for (const link of allLinks) {
                    const el = link as HTMLElement
                    const fullText = el.textContent?.trim() || ''
                    const lowerText = fullText.toLowerCase()

                    if (el.getAttribute('aria-disabled') === 'true') continue
                    if (el.getAttribute('data-disabled') === 'true') continue
                    if (el.closest('[aria-disabled="true"], [data-disabled="true"]')) continue

                    if (completedTexts.some(marker => lowerText.includes(marker))) continue
                    const parentRow = el.closest('div, li, article')
                    if (parentRow && completedBadgeSelectors.some(selector => !!parentRow.querySelector(selector))) {
                        continue
                    }

                    if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) continue
                    if (fullText.length < 2) continue

                    const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href : el.getAttribute('href') || ''
                    const identity = href || fullText.substring(0, 40)

                    const matches = taskKey ? identity === taskKey : !!taskTitle && fullText.includes(taskTitle)

                    if (matches) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        el.click()
                        return true
                    }
                }
                return false
            },
            args
        )

        if (!clicked) {
            // Usually means the task completed as a side effect of an earlier
            // click, so this is expected rather than an error.
            this.bot.logger.debug(
                this.bot.isMobile,
                'MODERN-MISSIONS',
                `Sub-task no longer present (likely already completed): "${task.title}"`
            )
            return false
        }

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
        return true
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

            // Wait for the flyout and click its confirm button. The label is
            // localized, so each known variant is tried in turn.
            const clicked = await page.evaluate(
                (labels: string[]) => {
                    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[]

                    for (const label of labels) {
                        const match = buttons.find(btn => (btn.textContent ?? '').trim().toLowerCase().includes(label))
                        if (match) {
                            match.click()
                            return true
                        }
                    }
                    return false
                },
                [...CLAIM_BUTTON_TEXTS]
            )

            if (clicked) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-CLAIM', `✔ Claimed ${claimCard.points} points`, 'green')

                await this.bot.utils.wait(3000)
                await this.closeAllExtraTabs(page)

                return { claimed: true, points: claimCard.points }
            } else {
                this.bot.logger.warn(this.bot.isMobile, 'MODERN-CLAIM', 'Claim button not found in flyout')
                await this.reportSelectorMiss(
                    page,
                    'claim-button-not-found',
                    `No button matched any of: ${CLAIM_BUTTON_TEXTS.join(' | ')}`
                )
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
        const args = {
            cardSelectors: this.selectors.claimCardSelectors,
            pointsSelectors: this.selectors.claimPointsSelectors,
            readyTexts: this.selectors.claimReadyTexts
        }

        return await page.evaluate(({ cardSelectors, pointsSelectors, readyTexts }: typeof args) => {
            for (const cardSelector of cardSelectors) {
                const cards = Array.from(document.querySelectorAll(cardSelector))

                for (const card of cards) {
                    const lowerText = (card.textContent ?? '').trim().toLowerCase()
                    if (!readyTexts.some(marker => lowerText.includes(marker))) continue

                    for (const pointsSelector of pointsSelectors) {
                        const pointsEl = card.querySelector(pointsSelector)
                        const points = parseInt((pointsEl?.textContent ?? '').trim())
                        if (!isNaN(points) && points > 0) {
                            return { points }
                        }
                    }
                }
            }

            return null
        }, args)
    }

    private async clickClaimCard(page: Page, claimCard: { points: number }): Promise<void> {
        const args = {
            cardSelectors: this.selectors.claimCardSelectors,
            pointsSelectors: this.selectors.claimPointsSelectors,
            readyTexts: this.selectors.claimReadyTexts,
            points: claimCard.points
        }

        await page.evaluate(({ cardSelectors, pointsSelectors, readyTexts, points }: typeof args) => {
            for (const cardSelector of cardSelectors) {
                const cards = Array.from(document.querySelectorAll(cardSelector))

                for (const card of cards) {
                    const lowerText = (card.textContent ?? '').trim().toLowerCase()
                    if (!readyTexts.some(marker => lowerText.includes(marker))) continue

                    for (const pointsSelector of pointsSelectors) {
                        const pointsEl = card.querySelector(pointsSelector)
                        const cardPoints = parseInt((pointsEl?.textContent ?? '').trim())
                        if (cardPoints === points) {
                            ;(card as HTMLElement).click()
                            return
                        }
                    }
                }
            }
        }, args)
    }
}

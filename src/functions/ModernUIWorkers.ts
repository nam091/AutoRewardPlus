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
        const cardSelectors =
            section.key === SECTIONS.quests.key
                ? [...new Set([...this.selectors.cardLinkSelectors, ...this.selectors.missionCardSelectors])]
                : this.selectors.cardLinkSelectors

        const args = {
            ids: [...section.ids],
            headings: [...section.headings],
            cardSelectors,
            skeletonSelectors: this.selectors.skeletonSelectors,
            infoLabelPrefixes: this.selectors.infoButtonLabelPrefixes,
            isQuests: section.key === SECTIONS.quests.key
        }

        const deadline = Date.now() + timeoutMs
        let lastState = { found: false, cards: 0, skeletons: 0 }

        while (Date.now() < deadline) {
            lastState = await page.evaluate(({ ids, headings, cardSelectors, skeletonSelectors, infoLabelPrefixes, isQuests }: typeof args) => {
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
                        const matched = Array.from(container.querySelectorAll(selector)).filter(el => {
                            if (!isQuests) return true
                            if (el.getAttribute('slot') === 'trigger' || el.closest('[slot="trigger"]')) return false
                            const label = (el.getAttribute('aria-label') ?? '').trim().toLowerCase()
                            if (infoLabelPrefixes.some(prefix => label.startsWith(prefix))) return false
                            if (el.closest('header, nav')) return false
                            return true
                        })
                        if (matched.length) {
                            cards = Math.max(cards, matched.length)
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

        // Pulse cards ("Complete this puzzle", "Do you know the answer?") and
        // the desktop taskbar / Bing-app punchcards never expose an "N/M tasks"
        // counter — they carry their own reward language instead. Both were
        // therefore invisible to the counter scan, which is why Keep Earning
        // reported "Found 0 earnable card(s)" although three cards were on screen.
        const pulseHints = [
            'puzzle',
            'trivia',
            'do you know',
            'challenge yourself',
            'arrange the tiles',
            'reveal the image',
            'câu hỏi',
            'giải đố',
            'xếp hình',
            'ghép hình'
        ]

        allCards.forEach((card, i) => {
            const anchor = card as HTMLAnchorElement
            const fullText = (anchor.textContent ?? '').trim()
            const lowerText = fullText.toLowerCase()

            if (completedTexts.some(marker => lowerText.includes(marker))) return
            if (completedBadgeSelectors.some(selector => !!anchor.querySelector(selector))) return
            if (lockedTexts.some(marker => lowerText.includes(marker))) return

            // Mission cards carry sub-tasks and are handled by doMissions, but
            // only when they are short-window punchcards. Streak cards use a
            // different caption and must still be reportable.
            const isMissionCounter = taskCountRegex.test(fullText)
            const isPulseCard = pulseHints.some(hint => lowerText.includes(hint))
            if (isMissionCounter && !isPulseCard) return
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

            if (missions.length) {
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
            } else {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'No incomplete missions found')
            }

            // Safely check Streaks section ONLY for clickable outbound Activity anchors
            await this.doStreakActivities(page)

            this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'Missions completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-MISSIONS', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findMissionCards(page: Page): Promise<MissionInfo[]> {
        const args = {
            questIds: [...SECTIONS.quests.ids],
            questHeadings: [...SECTIONS.quests.headings],
            taskCountPattern: this.selectors.taskCountPattern,
            activityCountPattern: this.selectors.activityCountPattern,
            streakProgressPattern: this.selectors.streakProgressPattern,
            missionExpiryPattern: this.selectors.missionExpiryPattern,
            barePointsPattern: this.selectors.barePointsPattern,
            titleSelectors: this.selectors.titleSelectors,
            completedBadgeSelectors: this.selectors.completedBadgeSelectors,
            completedTexts: this.selectors.completedTexts,
            lockedTexts: this.selectors.lockedTexts,
            infoButtonLabelPrefixes: this.selectors.infoButtonLabelPrefixes,
            missionCardSelectors: this.selectors.missionCardSelectors
        }

        return await page.evaluate(
            ({
                questIds,
                questHeadings,
                taskCountPattern,
                activityCountPattern,
                streakProgressPattern,
                missionExpiryPattern,
                barePointsPattern,
                titleSelectors,
                completedBadgeSelectors,
                completedTexts,
                lockedTexts,
                infoButtonLabelPrefixes,
                missionCardSelectors
            }: typeof args) => {
                const result: {
                    index: number
                    title: string
                    points: string
                    totalTasks: number
                    completedTasks: number
                    href: string
                }[] = []

                const taskCountRegex = new RegExp(taskCountPattern, 'i')
                const activityCountRegex = new RegExp(activityCountPattern, 'i')
                const streakRegex = new RegExp(streakProgressPattern, 'i')
                const expiryRegex = new RegExp(missionExpiryPattern, 'i')
                const barePointsRegex = new RegExp(barePointsPattern, 'i')
                const bareRatioRegex = /\b(\d+)\s*\/\s*(\d+)\b/
                const dateLikeRegex = /\b\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}\b/
                const taskbarSkipRegex = /windows taskbar|thanh taskbar|search box on the windows/i

                // Unified section resolution via SECTIONS.quests.ids and localized h2/h3 headings.
                const questContainers: Element[] = []
                for (const id of questIds) {
                    document.querySelectorAll(`section[id="${id}"]`).forEach(el => {
                        if (!questContainers.includes(el)) questContainers.push(el)
                    })
                }
                Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                    const text = (h.textContent ?? '').trim().toLowerCase()
                    if (!questHeadings.some(alias => text.startsWith(alias))) return
                    const container = h.closest('section') ?? h.parentElement?.parentElement
                    if (container && !questContainers.includes(container)) questContainers.push(container)
                })

                const hasQuestsSection = questContainers.length > 0
                const scopes: ParentNode[] = hasQuestsSection ? questContainers : [document]

                const isTriggerOrInfoControl = (el: HTMLElement): boolean => {
                    if (el.closest('[hidden], [aria-hidden="true"], [inert], template')) return true
                    if (el.getAttribute('slot') === 'trigger' || el.closest('[slot="trigger"]')) return true
                    if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) return true
                    if (
                        el.hasAttribute('disabled') ||
                        el.getAttribute('aria-disabled') === 'true' ||
                        el.getAttribute('data-disabled') === 'true'
                    ) {
                        return true
                    }
                    const label = (el.getAttribute('aria-label') ?? '').trim().toLowerCase()
                    if (label && infoButtonLabelPrefixes.some(prefix => label.startsWith(prefix))) return true
                    if (label && questHeadings.some(h => label === h)) return true
                    return false
                }

                const isSearchStreakBanner = (text: string): boolean => {
                    const lower = text.toLowerCase()
                    if (/bing\s+search\s+streak/i.test(lower)) return true
                    if (
                        /(?:search|tìm\s*kiếm)\s*:\s*\d+\s*\/\s*\d+/i.test(lower) &&
                        !/(?:activity|hoạt\s*động|quest|nhiệm\s*vụ|task)/i.test(lower)
                    ) {
                        return true
                    }
                    return false
                }

                const parseTaskCounts = (
                    text: string,
                    allowDefaultInQuests: boolean
                ): { completedTasks: number; totalTasks: number } | null => {
                    const taskMatch = text.match(taskCountRegex)
                    if (taskMatch) {
                        return {
                            completedTasks: parseInt(taskMatch[1] ?? '0', 10),
                            totalTasks: parseInt(taskMatch[2] ?? '0', 10)
                        }
                    }

                    const actMatch = text.match(activityCountRegex)
                    if (actMatch) {
                        return {
                            completedTasks: parseInt(actMatch[1] ?? '0', 10),
                            totalTasks: parseInt(actMatch[2] ?? '0', 10)
                        }
                    }

                    const streakMatch = text.match(streakRegex)
                    if (streakMatch && !isSearchStreakBanner(text)) {
                        return {
                            completedTasks: parseInt(streakMatch[1] ?? '0', 10),
                            totalTasks: parseInt(streakMatch[2] ?? '0', 10)
                        }
                    }

                    const sanitized = text.replace(dateLikeRegex, ' ')
                    const bareMatch = sanitized.match(bareRatioRegex)
                    if (bareMatch) {
                        const completed = parseInt(bareMatch[1] ?? '0', 10)
                        const total = parseInt(bareMatch[2] ?? '0', 10)
                        if (total > 0 && total <= 50 && completed <= total) {
                            return { completedTasks: completed, totalTasks: total }
                        }
                    }

                    if (allowDefaultInQuests) {
                        return { completedTasks: 0, totalTasks: 1 }
                    }
                    return null
                }

                const extractPoints = (card: HTMLElement, fullText: string): string => {
                    let pointsText = ''
                    card.querySelectorAll('span, div, p').forEach(sub => {
                        const text = (sub.textContent ?? '').trim()
                        if (/^\+?\d{1,4}$/.test(text) && sub.children.length === 0) {
                            pointsText = `+${text.replace('+', '')}`
                        }
                    })
                    if (!pointsText) {
                        const bare = fullText.match(barePointsRegex)
                        if (bare?.[1] && parseInt(bare[1], 10) > 0) pointsText = `+${bare[1]}`
                    }
                    return pointsText || '+0'
                }

                const extractTitle = (card: HTMLElement, fullText: string, fallbackIndex: number): string => {
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
                            fullText
                                .replace(taskCountRegex, '')
                                .replace(activityCountRegex, '')
                                .replace(/\+\d+/, '')
                                .replace(/Expires in.*?$/i, '')
                                .trim()
                                .substring(0, 60) || `Quest_${fallbackIndex}`
                    }
                    return title
                }

                const isCardCompleted = (card: HTMLElement): boolean => {
                    const lowerText = (card.textContent ?? '').toLowerCase()
                    if (completedTexts.some(marker => lowerText.includes(marker))) return true
                    let isCompleted = false
                    let temp: HTMLElement | null = card
                    while (temp && temp.tagName !== 'BODY') {
                        if (
                            completedBadgeSelectors.some(selector => !!temp!.querySelector(selector)) ||
                            temp.className.toString().toLowerCase().includes('success')
                        ) {
                            isCompleted = true
                            break
                        }
                        if (temp.tagName === 'SECTION') break
                        temp = temp.parentElement
                    }
                    return isCompleted
                }

                const seenKeys = new Set<string>()
                const seenElements = new Set<Element>()
                const results: (typeof result)[number][] = []

                const addMission = (card: HTMLElement, href: string, counts: { completedTasks: number; totalTasks: number }) => {
                    if (counts.totalTasks <= 0 || counts.completedTasks >= counts.totalTasks) return
                    const fullText = (card.textContent ?? '').trim()
                    if (!fullText || fullText.length < 2) return
                    if (taskbarSkipRegex.test(fullText) || isSearchStreakBanner(fullText)) return
                    const lowerText = fullText.toLowerCase()
                    if (lockedTexts.some(marker => lowerText.includes(marker))) return

                    const title = extractTitle(card, fullText, results.length)
                    const dedupeKey = href || title.toLowerCase()
                    if (seenKeys.has(dedupeKey)) return
                    for (const prevEl of seenElements) {
                        if (prevEl === card || prevEl.contains(card) || card.contains(prevEl)) return
                    }

                    seenKeys.add(dedupeKey)
                    seenElements.add(card)

                    results.push({
                        index: results.length,
                        title,
                        points: extractPoints(card, fullText),
                        totalTasks: counts.totalTasks,
                        completedTasks: counts.completedTasks,
                        href
                    })
                }

                // 1. Path 1: Anchor cards (/earn/quest/... when unscoped, or any anchor inside questsSection).
                const anchorSelector = hasQuestsSection
                    ? 'a[href]'
                    : 'a[href*="/earn/quest/"], a[href*="/quest"]'
                for (const scope of scopes) {
                    Array.from(scope.querySelectorAll<HTMLAnchorElement>(anchorSelector)).forEach(anchor => {
                        if (isTriggerOrInfoControl(anchor)) return
                        const card = anchor.querySelector('div') ?? anchor
                        const fullText = (anchor.textContent ?? card.textContent ?? '').trim()
                        if (!fullText) return
                        if (taskbarSkipRegex.test(fullText) || isSearchStreakBanner(fullText)) return

                        // Only enforce expiryRegex when questsSection could not be scoped (avoid Streaks false positives).
                        if (!hasQuestsSection && !expiryRegex.test(fullText)) return

                        const counts = parseTaskCounts(fullText, hasQuestsSection)
                        if (!counts || counts.completedTasks >= counts.totalTasks || counts.totalTasks === 0) return

                        let isCompleted = completedTexts.some(marker => fullText.toLowerCase().includes(marker))
                        let temp: HTMLElement | null = card as HTMLElement
                        while (!isCompleted && temp && temp.tagName !== 'BODY') {
                            if (
                                completedBadgeSelectors.some(selector => !!temp!.querySelector(selector)) ||
                                temp.className.toString().toLowerCase().includes('success')
                            ) {
                                isCompleted = true
                                break
                            }
                            // Stop at the section boundary. Walking past it reached
                            // <main>, whose completed Daily Set cards carry success
                            // badges, so every punchcard looked already finished and
                            // was dropped before it could be clicked.
                            if (temp.tagName === 'SECTION') break
                            temp = temp.parentElement
                        }
                        if (isCompleted) return

                        const href = anchor.href || ''
                        addMission(anchor, href, counts)
                    })
                }

                // 2. Path 2: Run alongside Path 1 (for <button aria-expanded>, nested counter spans, etc.).
                //    Climb to the outer clickable card FIRST before checking expiry or card text.
                for (const scope of scopes) {
                    const allElements = Array.from(scope.querySelectorAll('*'))
                    const taskElements = allElements.filter(el => {
                        const childNodes = Array.from(el.childNodes)
                        return childNodes.some(node => {
                            if (node.nodeType !== 3) return false
                            const txt = node.textContent || ''
                            return (
                                taskCountRegex.test(txt) ||
                                activityCountRegex.test(txt) ||
                                streakRegex.test(txt) ||
                                (hasQuestsSection && bareRatioRegex.test(txt.replace(dateLikeRegex, ' ')))
                            )
                        })
                    })

                    taskElements.forEach(taskEl => {
                        const el = taskEl as HTMLElement
                        let card: HTMLElement | null = el
                        while (card && card.tagName !== 'BODY' && card.tagName !== 'SECTION') {
                            const cls = card.className.toString().toLowerCase()
                            const role = card.getAttribute('role')
                            if (
                                card.tagName === 'A' ||
                                card.tagName === 'BUTTON' ||
                                role === 'link' ||
                                role === 'button' ||
                                card.tagName === 'LI' ||
                                cls.includes('card') ||
                                cls.includes('cursor-pointer') ||
                                cls.includes('item')
                            ) {
                                break
                            }
                            card = card.parentElement
                        }
                        if (!card || card.tagName === 'BODY' || card.tagName === 'SECTION') {
                            card = el.parentElement || el
                        }

                        if (isTriggerOrInfoControl(card)) return
                        const cardText = (card.textContent ?? '').trim()
                        if (!cardText) return
                        if (!hasQuestsSection && !expiryRegex.test(cardText)) return
                        if (isCardCompleted(card)) return

                        const counts = parseTaskCounts(cardText, false)
                        if (!counts || counts.completedTasks >= counts.totalTasks || counts.totalTasks === 0) return

                        const anchor =
                            card.tagName === 'A'
                                ? (card as HTMLAnchorElement)
                                : card.querySelector('a[href*="/quest"], a[href]')
                        const rawHref = anchor
                            ? (anchor as HTMLAnchorElement).href
                            : card.getAttribute('href') || ''
                        const href = rawHref.startsWith('http')
                            ? rawHref
                            : rawHref
                              ? `${window.location.origin}${rawHref}`
                              : ''

                        addMission(card, href, counts)
                    })
                }

                // 3. Path 3: When questsSection is explicitly resolved, trust any remaining incomplete
                //    interactive card directly inside questsSection even without N/M or expiry text.
                if (hasQuestsSection) {
                    const cardSelectorChain = missionCardSelectors.join(', ')
                    for (const container of questContainers) {
                        Array.from(container.querySelectorAll<HTMLElement>(cardSelectorChain)).forEach(rawCard => {
                            if (isTriggerOrInfoControl(rawCard)) return
                            if (rawCard.closest('h2, h3')) return

                            // Prefer the actual clickable <a> or <button> inside a wrapper <div>/<li> if present
                            const innerClickable =
                                rawCard.tagName === 'A' ||
                                rawCard.tagName === 'BUTTON' ||
                                rawCard.getAttribute('role') === 'button' ||
                                rawCard.getAttribute('role') === 'link'
                                    ? rawCard
                                    : (rawCard.querySelector<HTMLElement>(
                                          'a[href], button:not([slot="trigger"]), [role="button"], [role="link"]'
                                      ) ?? rawCard)

                            if (isTriggerOrInfoControl(innerClickable)) return
                            if (isCardCompleted(innerClickable)) return

                            const cardText = (innerClickable.textContent ?? '').trim()
                            if (!cardText || cardText.length < 2) return
                            if (taskbarSkipRegex.test(cardText) || isSearchStreakBanner(cardText)) return

                            const counts = parseTaskCounts(cardText, true)
                            if (!counts || counts.completedTasks >= counts.totalTasks || counts.totalTasks === 0) return

                            const anchor =
                                innerClickable.tagName === 'A'
                                    ? (innerClickable as HTMLAnchorElement)
                                    : innerClickable.querySelector('a[href]')
                            const rawHref = anchor
                                ? (anchor as HTMLAnchorElement).href
                                : innerClickable.getAttribute('href') || ''
                            const href = rawHref.startsWith('http')
                                ? rawHref
                                : rawHref
                                  ? `${window.location.origin}${rawHref}`
                                  : ''

                            // Require either a navigable href, a button/role=button, or a title/points cue
                            const isInteractiveTag =
                                Boolean(href) ||
                                innerClickable.tagName === 'BUTTON' ||
                                innerClickable.getAttribute('role') === 'button' ||
                                innerClickable.getAttribute('role') === 'link' ||
                                innerClickable.className.toString().toLowerCase().includes('cursor-pointer')
                            if (!isInteractiveTag) return

                            addMission(innerClickable, href, counts)
                        })
                    }
                }

                results.forEach((r, i) => {
                    result.push({ ...r, index: i })
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
            questIds: [...SECTIONS.quests.ids],
            questHeadings: [...SECTIONS.quests.headings],
            missionCardSelectors: this.selectors.missionCardSelectors,
            infoButtonLabelPrefixes: this.selectors.infoButtonLabelPrefixes,
            completedTexts: this.selectors.completedTexts,
            lockedTexts: this.selectors.lockedTexts
        }

        const locateResult = await page.evaluate(
            ({
                mission: m,
                questIds,
                questHeadings,
                missionCardSelectors,
                infoButtonLabelPrefixes,
                completedTexts,
                lockedTexts
            }: typeof args) => {
                // Clear previous target marker
                document.querySelectorAll('[data-arp-mission-target]').forEach(el => {
                    el.removeAttribute('data-arp-mission-target')
                })

                const normalize = (val: string) => val.replace(/\s+/g, ' ').trim().toLowerCase()
                const targetTitleNorm = normalize(m.title)

                const questContainers: Element[] = []
                for (const id of questIds) {
                    document.querySelectorAll(`section[id="${id}"]`).forEach(el => {
                        if (!questContainers.includes(el)) questContainers.push(el)
                    })
                }
                Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                    const text = (h.textContent ?? '').trim().toLowerCase()
                    if (!questHeadings.some(alias => text.startsWith(alias))) return
                    const container = h.closest('section') ?? h.parentElement?.parentElement
                    if (container && !questContainers.includes(container)) questContainers.push(container)
                })

                const scopes: ParentNode[] = questContainers.length > 0 ? questContainers : [document]

                const isExcluded = (el: HTMLElement): boolean => {
                    if (el.getAttribute('slot') === 'trigger' || el.closest('[slot="trigger"]')) return true
                    if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) return true
                    const label = normalize(el.getAttribute('aria-label') ?? '')
                    if (label && infoButtonLabelPrefixes.some(p => label.startsWith(p))) return true
                    const lower = normalize(el.textContent ?? '')
                    if (completedTexts.some(t => lower.includes(t))) return true
                    if (lockedTexts.some(t => lower.includes(t))) return true
                    return false
                }

                const stampTarget = (target: HTMLElement) => {
                    target.setAttribute('data-arp-mission-target', '1')
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    const tag = target.tagName
                    const role = target.getAttribute('role')
                    return {
                        found: true,
                        isButtonControl: tag === 'BUTTON' || role === 'button' || target.hasAttribute('aria-expanded'),
                        isAnchor: tag === 'A'
                    }
                }

                // 1. Exact href / pathname match across scopes
                if (m.href) {
                    let targetPathname = ''
                    try {
                        targetPathname = new URL(m.href, window.location.origin).pathname
                    } catch {}

                    for (const scope of scopes) {
                        const anchors = Array.from(scope.querySelectorAll<HTMLElement>('a[href], [href]'))
                        for (const el of anchors) {
                            if (isExcluded(el)) continue
                            const rawHref = el.tagName === 'A' ? (el as HTMLAnchorElement).href : el.getAttribute('href') || ''
                            if (!rawHref) continue
                            let elPathname = ''
                            try {
                                elPathname = new URL(rawHref, window.location.origin).pathname
                            } catch {}
                            if (rawHref === m.href || (targetPathname && elPathname === targetPathname)) {
                                return stampTarget(el)
                            }
                        }
                    }
                }

                // 2. Normalized title / text match inside quest scopes
                const selectorChain = [...new Set([...missionCardSelectors, 'button', '[role="button"]'])].join(', ')
                for (const scope of scopes) {
                    const elements = Array.from(scope.querySelectorAll<HTMLElement>(selectorChain))
                    for (const el of elements) {
                        if (isExcluded(el)) continue
                        const fullTextNorm = normalize(el.textContent ?? '')
                        if (!fullTextNorm) continue

                        const anchor = el.tagName === 'A' ? (el as HTMLAnchorElement) : el.querySelector('a[href]')
                        const href = anchor ? (anchor as HTMLAnchorElement).href : el.getAttribute('href') || ''

                        const matchesHref = Boolean(m.href && href && href === m.href)
                        const matchesTitle = Boolean(targetTitleNorm && fullTextNorm.includes(targetTitleNorm))

                        if (matchesHref || matchesTitle) {
                            const target =
                                el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'
                                    ? el
                                    : ((anchor as HTMLElement | null) || el)
                            return stampTarget(target)
                        }
                    }
                }

                return { found: false, isButtonControl: false, isAnchor: false }
            },
            args
        )

        if (!locateResult.found) {
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

        const beforeClickUrl = page.url()
        const targetLocator = page.locator('[data-arp-mission-target="1"]').first()

        const clickedViaLocator = await targetLocator
            .click({ timeout: 5000 })
            .then(() => true)
            .catch(() => false)
        if (!clickedViaLocator) {
            await page.evaluate(() => {
                const el = document.querySelector<HTMLElement>('[data-arp-mission-target="1"]')
                el?.click()
            })
        }
        if (!locateResult.isButtonControl) {
            await this.bot.utils.wait(600)
            // Fallback to DOM click if Playwright Locator click did not trigger navigation or tab or expansion
            const currentTabs = page.context().pages().length
            const sameUrl = this.normalizeUrlWithoutHash(page.url()) === this.normalizeUrlWithoutHash(beforeClickUrl)
            const expandedNow = await page
                .evaluate(() => {
                    const el = document.querySelector('[data-arp-mission-target="1"]')
                    const hasDialog = Boolean(document.querySelector('[role="dialog"], dialog, [aria-modal="true"]'))
                    return el?.getAttribute('aria-expanded') === 'true' || hasDialog
                })
                .catch(() => false)
            if (currentTabs <= 1 && sameUrl && !expandedNow && !clickedViaLocator) {
                await targetLocator.click({ timeout: 5000 }).catch(() => {})
            }
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
            const hasNavigated =
                this.normalizeUrlWithoutHash(currentUrl) !== this.normalizeUrlWithoutHash(beforeClickUrl)
            const isQuestPage =
                currentUrl.includes('/quest') ||
                currentUrl.includes('/mission') ||
                currentUrl.includes('/challenge') ||
                currentUrl.includes('/activity')

            if (hasNavigated || isQuestPage) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', `Navigated to quest detail: ${currentUrl}`)

                await this.completeMissionTasks(page, mission.title)

                const returnEarnUrl = beforeClickUrl.startsWith('http')
                    ? beforeClickUrl
                    : 'https://rewards.bing.com/earn'
                await page.goto(returnEarnUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                })
                await this.bot.utils.wait(2000)
            } else {
                // Check for inline expansion (aria-expanded="true") or modal dialog right on /earn
                const inlineScope = await page.evaluate(() => {
                    const dialog = document.querySelector('[role="dialog"], dialog, [aria-modal="true"]')
                    if (dialog) {
                        dialog.setAttribute('data-arp-inline-quest', '1')
                        return '[data-arp-inline-quest="1"]'
                    }

                    const target = document.querySelector('[data-arp-mission-target="1"]')
                    if (target && target.getAttribute('aria-expanded') === 'true') {
                        const controlsId = target.getAttribute('aria-controls')
                        if (controlsId) {
                            const controlled = document.getElementById(controlsId)
                            if (controlled) {
                                controlled.setAttribute('data-arp-inline-quest', '1')
                                return '[data-arp-inline-quest="1"]'
                            }
                        }
                        const wrapper = target.closest('[class*="Card"], li, div') ?? target.parentElement
                        if (wrapper) {
                            wrapper.setAttribute('data-arp-inline-quest', '1')
                            return '[data-arp-inline-quest="1"]'
                        }
                    }
                    return null
                })

                if (inlineScope) {
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Inline quest panel/dialog opened for "${mission.title}"`
                    )
                    await this.completeMissionTasks(page, mission.title, inlineScope)
                    await page
                        .evaluate(() => {
                            document
                                .querySelectorAll('[data-arp-inline-quest]')
                                .forEach(el => el.removeAttribute('data-arp-inline-quest'))
                        })
                        .catch(() => {})
                } else {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Quest "${mission.title}" did not navigate to detail page (URL: ${currentUrl})`
                    )
                }
            }
        }

        await page
            .evaluate(() => {
                document
                    .querySelectorAll('[data-arp-mission-target]')
                    .forEach(el => el.removeAttribute('data-arp-mission-target'))
            })
            .catch(() => {})

        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
    }

    private normalizeUrlWithoutHash(rawUrl: string): string {
        try {
            const parsed = new URL(rawUrl)
            parsed.hash = ''
            return parsed.toString()
        } catch {
            return rawUrl.split('#')[0] ?? rawUrl
        }
    }

    private async completeMissionTasks(
        missionPage: Page,
        missionTitle: string,
        scopeSelector?: string
    ): Promise<void> {
        const missionUrl = missionPage.url()
        this.bot.logger.info(
            this.bot.isMobile,
            'MODERN-MISSIONS',
            `On mission detail page for "${missionTitle}": ${missionUrl}`
        )

        // Dismiss any popups on mission page
        await this.bot.browser.utils.tryDismissAllMessages(missionPage)
        await this.bot.utils.wait(1000)

        if (!scopeSelector) {
            // Scroll to load all content
            await missionPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(1500)
            await missionPage.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)
        }

        const maxAttempts = 3
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const { tasks, unreachableCount } = await this.findMissionSubTasksDetailed(missionPage, scopeSelector)

            if (!tasks.length) {
                if (attempt === 0) {
                    if (unreachableCount > 0 || (!scopeSelector && (await this.isUnreachableMission(missionPage)))) {
                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'MODERN-MISSIONS',
                            `Skipping "${missionTitle}": all sub-tasks require a desktop taskbar or mobile app action that this browser cannot perform`
                        )
                    } else {
                        this.bot.logger.info(
                            this.bot.isMobile,
                            'MODERN-MISSIONS',
                            `All tasks already completed for "${missionTitle}"`
                        )
                    }
                }
                break
            }

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-MISSIONS',
                `Found ${tasks.length} incomplete task(s) for "${missionTitle}" (attempt ${attempt + 1}${unreachableCount > 0 ? `, skipped ${unreachableCount} unreachable` : ''})`
            )

            for (const task of tasks) {
                try {
                    await this.clickMissionSubTask(missionPage, task, missionUrl)
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Error on sub-task "${task.title}": ${errMsg(error)}`
                    )
                    await this.closeAllExtraTabs(missionPage)
                }
            }

            if (scopeSelector) {
                if (this.normalizeUrlWithoutHash(missionPage.url()) !== this.normalizeUrlWithoutHash(missionUrl)) {
                    await missionPage.goto(missionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
                }
                await this.bot.utils.wait(1500)
            } else {
                // Ensure we are back on missionUrl before reloading to check progress
                if (this.normalizeUrlWithoutHash(missionPage.url()) !== this.normalizeUrlWithoutHash(missionUrl)) {
                    if (/^https?:/i.test(missionUrl)) {
                        await missionPage.goto(missionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
                    }
                } else if (/^https?:/i.test(missionUrl)) {
                    await missionPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
                }
                await this.bot.utils.wait(3000)
            }
        }
    }

    /**
     * Matches missions whose completion requires an OS/app-level action.
     * Kept as fallback signal when zero actionable web sub-tasks are present.
     */
    private async isUnreachableMission(page: Page): Promise<boolean> {
        const markers = this.selectors.unreachableSubTaskMarkers
        return await page.evaluate((markerList: string[]) => {
            const text = (document.body.textContent ?? '').toLowerCase()
            return markerList.some(marker => text.includes(marker))
        }, markers)
    }

    public async findMissionSubTasks(page: Page, scopeSelector?: string): Promise<CardInfo[]> {
        const { tasks } = await this.findMissionSubTasksDetailed(page, scopeSelector)
        return tasks
    }

    private async findMissionSubTasksDetailed(
        page: Page,
        scopeSelector?: string
    ): Promise<{ tasks: CardInfo[]; unreachableCount: number }> {
        const args = {
            taskSelectors: this.selectors.missionTaskSelectors,
            titleSelectors: this.selectors.titleSelectors,
            completedTexts: this.selectors.completedTexts,
            completedBadgeSelectors: this.selectors.completedBadgeSelectors,
            unreachableMarkers: this.selectors.unreachableSubTaskMarkers,
            readMoreTexts: this.selectors.readMoreTexts,
            infoLabelPrefixes: this.selectors.infoButtonLabelPrefixes,
            scopeSelector: scopeSelector ?? ''
        }

        return await page.evaluate(
            ({
                taskSelectors,
                titleSelectors,
                completedTexts,
                completedBadgeSelectors,
                unreachableMarkers,
                readMoreTexts,
                infoLabelPrefixes,
                scopeSelector
            }: typeof args) => {
                const tasks: { index: number; title: string; points: string; completed: boolean; href: string }[] = []
                let unreachableCount = 0

                const roots: ParentNode[] = scopeSelector
                    ? Array.from(document.querySelectorAll(scopeSelector))
                    : [document]
                if (!roots.length) return { tasks, unreachableCount }

                const selectorChain = taskSelectors.join(', ')
                const seen = new Set<string>()
                let logicalIndex = 0

                for (const root of roots) {
                    const allLinks = root.querySelectorAll(selectorChain)
                    allLinks.forEach(link => {
                        const el = link as HTMLElement
                        const fullText = el.textContent?.trim() || ''
                        const lowerText = fullText.toLowerCase()
                        const normalizedLabel = lowerText.replace(/[.…]+$/g, '').trim()

                        if (el.hasAttribute('disabled')) return
                        if (el.getAttribute('aria-disabled') === 'true') return
                        if (el.getAttribute('data-disabled') === 'true') return
                        if (el.closest('[disabled], [aria-disabled="true"], [data-disabled="true"]')) return

                        if (el.getAttribute('slot') === 'trigger' || el.closest('[slot="trigger"]')) return
                        if (el.getAttribute('data-arp-mission-target') === '1') return
                        const ariaLabel = (el.getAttribute('aria-label') ?? '').trim().toLowerCase()
                        if (ariaLabel && infoLabelPrefixes.some(p => ariaLabel.startsWith(p))) return

                        if (completedTexts.some(marker => lowerText.includes(marker))) return
                        const parentRow = el.closest('div, li, article')
                        if (
                            parentRow &&
                            completedBadgeSelectors.some(selector => !!parentRow.querySelector(selector))
                        ) {
                            return
                        }

                        if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) return

                        const hrefAttr = el.getAttribute('href') || ''
                        const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href : hrefAttr
                        const isRealLink = Boolean(
                            href && href !== '#' && !href.startsWith('javascript:')
                        )

                        // Exclude pure "Read more" / "Tìm hiểu thêm" non-navigating toggles
                        if (!isRealLink && readMoreTexts.includes(normalizedLabel)) {
                            return
                        }
                        if (el.tagName === 'SPAN' && el.hasAttribute('href') && !hrefAttr.trim()) {
                            return
                        }

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

                        // Per-sub-task unreachable check: check href scheme and tight row text
                        if (/^(?:bing:|ms-windows-store:)/i.test(href)) {
                            unreachableCount++
                            return
                        }

                        let rowContainer: Element | null = el.closest(
                            'li, article, tr, [class*="row" i], [class*="task" i], div'
                        )
                        if (rowContainer) {
                            const controlsInRow = Array.from(rowContainer.querySelectorAll(selectorChain)).filter(c => {
                                const cHref =
                                    c.tagName === 'A'
                                        ? (c as HTMLAnchorElement).href
                                        : (c.getAttribute('href') || '')
                                const cNorm = (c.textContent ?? '').trim().toLowerCase().replace(/[.…]+$/g, '')
                                return Boolean(cHref && cHref !== '#') || !readMoreTexts.includes(cNorm)
                            })
                            if (controlsInRow.length > 1) {
                                rowContainer = el
                            }
                        }
                        const rowText = (rowContainer?.textContent ?? fullText).toLowerCase()
                        if (unreachableMarkers.some(marker => rowText.includes(marker))) {
                            unreachableCount++
                            return
                        }

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

                        tasks.push({
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
                }

                return { tasks, unreachableCount }
            },
            args
        )
    }

    private async clickMissionSubTask(page: Page, task: CardInfo, missionUrl?: string): Promise<boolean> {
        await this.closeAllExtraTabs(page)
        const returnUrl = missionUrl || page.url()

        const args = {
            taskSelectors: this.selectors.missionTaskSelectors,
            completedTexts: this.selectors.completedTexts,
            completedBadgeSelectors: this.selectors.completedBadgeSelectors,
            unreachableMarkers: this.selectors.unreachableSubTaskMarkers,
            readMoreTexts: this.selectors.readMoreTexts,
            taskKey: task.href ?? '',
            taskTitle: task.title
        }

        // Matched by identity rather than by position. Completing one sub-task
        // removes it from the incomplete list, which shifted every later index
        // and made the loop click the wrong row and skip the last one.
        const clickMeta = await page.evaluate(
            ({
                taskSelectors,
                completedTexts,
                completedBadgeSelectors,
                unreachableMarkers,
                readMoreTexts,
                taskKey,
                taskTitle
            }: typeof args) => {
                document.querySelectorAll('[data-arp-subtask-target]').forEach(el => {
                    el.removeAttribute('data-arp-subtask-target')
                })

                const allLinks = document.querySelectorAll(taskSelectors.join(', '))

                for (const link of allLinks) {
                    const el = link as HTMLElement
                    const fullText = el.textContent?.trim() || ''
                    const lowerText = fullText.toLowerCase()
                    const normalizedLabel = lowerText.replace(/[.…]+$/g, '').trim()

                    if (el.hasAttribute('disabled')) continue
                    if (el.getAttribute('aria-disabled') === 'true') continue
                    if (el.getAttribute('data-disabled') === 'true') continue
                    if (el.closest('[disabled], [aria-disabled="true"], [data-disabled="true"]')) continue
                    if (el.getAttribute('slot') === 'trigger' || el.closest('[slot="trigger"]')) continue
                    if (el.getAttribute('data-arp-mission-target') === '1') continue

                    if (completedTexts.some(marker => lowerText.includes(marker))) continue
                    const parentRow = el.closest('div, li, article')
                    if (parentRow && completedBadgeSelectors.some(selector => !!parentRow.querySelector(selector))) {
                        continue
                    }

                    if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) continue
                    if (fullText.length < 2) continue

                    const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href : el.getAttribute('href') || ''
                    const isRealLink = Boolean(href && href !== '#' && !href.startsWith('javascript:'))
                    if (!isRealLink && readMoreTexts.includes(normalizedLabel)) continue
                    if (/^(?:bing:|ms-windows-store:)/i.test(href)) continue
                    if (unreachableMarkers.some(marker => lowerText.includes(marker))) continue

                    const identity = href || fullText.substring(0, 40)
                    const matches = taskKey ? identity === taskKey : !!taskTitle && fullText.includes(taskTitle)

                    if (matches) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        el.setAttribute('data-arp-subtask-target', '1')
                        return { matched: true }
                    }
                }
                return { matched: false }
            },
            args
        )

        if (!clickMeta.matched) {
            // Usually means the task completed as a side effect of an earlier
            // click, so this is expected rather than an error.
            this.bot.logger.debug(
                this.bot.isMobile,
                'MODERN-MISSIONS',
                `Sub-task no longer present (likely already completed): "${task.title}"`
            )
            return false
        }

        const clickedViaLocator = await page
            .locator('[data-arp-subtask-target="1"]')
            .first()
            .click({ timeout: 5000 })
            .then(() => true)
            .catch(() => false)
        if (!clickedViaLocator) {
            await page
                .evaluate(() => {
                    const el = document.querySelector<HTMLElement>('[data-arp-subtask-target="1"]')
                    el?.click()
                })
                .catch(() => {})
            await page.waitForLoadState('domcontentloaded').catch(() => {})
        }
        await page
            .evaluate(() => {
                document
                    .querySelectorAll('[data-arp-subtask-target]')
                    .forEach(el => el.removeAttribute('data-arp-subtask-target'))
            })
            .catch(() => {})

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
        } else {
            // If sub-task navigated same-tab away from missionUrl, dwell and navigate back
            await page.waitForLoadState('domcontentloaded').catch(() => {})
            const currentUrl = page.url()
            if (this.normalizeUrlWithoutHash(currentUrl) !== this.normalizeUrlWithoutHash(returnUrl)) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'MODERN-MISSIONS',
                    `Same-tab sub-task navigation detected (${currentUrl}); returning to ${returnUrl}`
                )
                await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
                await page.goto(returnUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
                await this.bot.utils.wait(1500)
            }
        }

        await this.closeAllExtraTabs(page)
        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
        return true
    }

    /**
     * Safely checks SECTIONS.streaks on /earn ONLY for clickable outbound Activity anchors/CTAs.
     * Never clicks non-navigable Bing Search Streak banner buttons.
     */
    public async doStreakActivities(page: Page): Promise<void> {
        try {
            if (!page.url().includes('rewards.bing.com/earn')) {
                await this.navigateAndPrepare(page, 'https://rewards.bing.com/earn')
            }

            const args = {
                streakIds: [...SECTIONS.streaks.ids],
                streakHeadings: [...SECTIONS.streaks.headings],
                completedTexts: this.selectors.completedTexts,
                completedBadgeSelectors: this.selectors.completedBadgeSelectors,
                lockedTexts: this.selectors.lockedTexts
            }

            const activities = await page.evaluate(
                ({ streakIds, streakHeadings, completedTexts, completedBadgeSelectors, lockedTexts }: typeof args) => {
                    const containers: Element[] = []
                    for (const id of streakIds) {
                        document.querySelectorAll(`section[id="${id}"]`).forEach(el => {
                            if (!containers.includes(el)) containers.push(el)
                        })
                    }
                    Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                        const text = (h.textContent ?? '').trim().toLowerCase()
                        if (!streakHeadings.some(alias => text.startsWith(alias))) return
                        const container = h.closest('section') ?? h.parentElement?.parentElement
                        if (container && !containers.includes(container)) containers.push(container)
                    })

                    const items: { href: string; title: string }[] = []
                    const seen = new Set<string>()

                    for (const container of containers) {
                        Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]')).forEach(anchor => {
                            if (anchor.closest('header, nav, [slot="trigger"]')) return
                            const rawHref = anchor.getAttribute('href') || ''
                            const fullHref = anchor.href || ''
                            if (!rawHref || rawHref === '#' || rawHref.startsWith('javascript:')) return
                            try {
                                const pathname = new URL(fullHref, window.location.origin).pathname
                                if (pathname === '/earn' || pathname === '/earn/' || pathname === '/dashboard') return
                            } catch {
                                return
                            }

                            const text = (anchor.textContent ?? '').trim()
                            const lower = text.toLowerCase()
                            if (!text) return
                            // Never click Bing Search Streak banners or completed/locked items
                            if (/bing\s+search\s+streak/i.test(lower)) return
                            if (
                                /(?:search|tìm\s*kiếm)\s*:\s*\d+\s*\/\s*\d+/i.test(lower) &&
                                !/(?:activity|hoạt\s*động|check[\s-]?in|điểm\s*danh)/i.test(lower)
                            ) {
                                return
                            }
                            if (completedTexts.some(m => lower.includes(m))) return
                            if (lockedTexts.some(m => lower.includes(m))) return
                            if (completedBadgeSelectors.some(sel => !!anchor.querySelector(sel))) return
                            if (!/(?:activity|hoạt\s*động|check[\s-]?in|điểm\s*danh)/i.test(lower)) return

                            if (seen.has(fullHref)) return
                            seen.add(fullHref)
                            items.push({ href: fullHref, title: text.substring(0, 60) })
                        })
                    }

                    return items
                },
                args
            )

            if (!activities.length) return

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-STREAK-ACTIVITY',
                `Found ${activities.length} clickable streak activity anchor(s)`
            )

            for (const act of activities) {
                try {
                    const beforeUrl = page.url()
                    const clicked = await page.evaluate((targetHref: string) => {
                        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
                        const match = anchors.find(a => a.href === targetHref)
                        if (!match) return false
                        match.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        match.click()
                        return true
                    }, act.href)
                    if (!clicked) continue

                    await this.bot.utils.wait(3000)
                    const newTab = await this.bot.browser.utils.getLatestTab(page)
                    if (newTab !== page) {
                        await newTab.waitForLoadState('domcontentloaded').catch(() => {})
                        await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
                        await this.closeAllExtraTabs(page)
                    } else if (this.normalizeUrlWithoutHash(page.url()) !== this.normalizeUrlWithoutHash(beforeUrl)) {
                        await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
                        await page.goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
                        await this.bot.utils.wait(1500)
                    }
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-STREAK-ACTIVITY',
                        `✔ Clicked streak activity: "${act.title}"`,
                        'green'
                    )
                } catch (err) {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'MODERN-STREAK-ACTIVITY',
                        `Error on streak activity "${act.title}": ${errMsg(err)}`
                    )
                    await this.closeAllExtraTabs(page)
                }
            }
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'MODERN-STREAK-ACTIVITY',
                `Streak activity check failed: ${errMsg(error)}`
            )
        }
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

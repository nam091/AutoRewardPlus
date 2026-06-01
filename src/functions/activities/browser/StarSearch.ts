import type { Page } from 'patchright'
import { randomBytes } from 'crypto'

import type { MicrosoftRewardsBot } from '../../../index'
import { errMsg } from '../../../util/Utils'

/**
 * STAR Search — Supplementary Topic-Aware Random Search
 *
 * Runs AFTER point-earning searches are complete.
 * Generates N completely different topics, then expands each topic
 * into additional related searches for a more natural browsing pattern.
 */
export class StarSearch {
    private bot: MicrosoftRewardsBot
    private bingHome = 'https://bing.com'
    private searchCount = 0

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async doStarSearch(page: Page, isMobile: boolean): Promise<void> {
        const starCount = this.bot.config.workers.starSearchCount ?? 5

        this.bot.logger.info(isMobile, 'STAR-SEARCH', `Starting STAR Search | topics=${starCount}`)

        try {
            // Generate completely unique, meaningful queries that Bing cannot predict
            // No external sources — pure algorithmic generation
            const uniqueQueries = this.generateUniqueQueries(starCount)

            if (uniqueQueries.length === 0) {
                this.bot.logger.warn(isMobile, 'STAR-SEARCH', 'No queries generated, skipping')
                return
            }

            this.bot.logger.info(
                isMobile,
                'STAR-SEARCH',
                `Generated ${uniqueQueries.length} unique queries: ${uniqueQueries.slice(0, 3).map(t => `"${t}"`).join(', ')}${uniqueQueries.length > 3 ? '...' : ''}`
            )

            // Each query stands alone — no expansion, no clustering
            const expandedSearches: { topic: string; queries: string[] }[] = uniqueQueries.map(q => ({
                topic: q,
                queries: []
            }))

            const totalSearches = uniqueQueries.length
            this.bot.logger.info(isMobile, 'STAR-SEARCH', `Total STAR searches: ${totalSearches}`)

            // Navigate to Bing
            await page.goto(this.bingHome)
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(page)

            // Step 3: Execute searches topic by topic
            let completedSearches = 0

            for (const { topic, queries } of expandedSearches) {
                this.bot.logger.info(isMobile, 'STAR-SEARCH', `Topic: "${topic}" | sub-queries=${queries.length}`)

                // Search the base topic first
                await this.executeSearch(page, topic, isMobile)
                completedSearches++

                // Then search expanded sub-queries
                for (const query of queries) {
                    await this.executeSearch(page, query, isMobile)
                    completedSearches++
                }

                this.bot.logger.info(
                    isMobile,
                    'STAR-SEARCH',
                    `Topic "${topic}" done | progress=${completedSearches}/${totalSearches}`
                )

                // Random pause between topics
                const topicPause = this.bot.utils.randomDelay(2000, 5000)
                await this.bot.utils.wait(topicPause)
            }

            this.bot.logger.info(
                isMobile,
                'STAR-SEARCH',
                `STAR Search completed | topics=${totalSearches} | totalSearches=${completedSearches}`,
                'green'
            )
        } catch (error) {
            this.bot.logger.error(isMobile, 'STAR-SEARCH', `Error: ${errMsg(error)}`)
        }
    }

    /**
     * Generate completely unique, meaningful search queries algorithmically.
     * No external sources — Bing cannot predict these because they combine
     * unrelated concepts in meaningful ways.
     *
     * Strategy: Combine domain + temporal + specificity + question pattern
     * Example: "how quantum entanglement affected 1847 gold rush communication methods"
     */
    private generateUniqueQueries(count: number): string[] {
        const queries: string[] = []
        const seen = new Set<string>()

        // Domain pools — mix unrelated fields
        const domains = [
            'quantum physics', 'medieval architecture', 'deep sea biology', 'ancient astronomy',
            'cryptography', 'botanical genetics', 'meteorology', 'linguistics', 'metallurgy',
            'oceanography', 'paleontology', 'neuroscience', 'thermodynamics', 'cartography',
            'music theory', 'vaccine development', 'satellite engineering', 'archaeology'
        ]

        // Temporal markers — specific eras or future dates
        const temporalMarkers = [
            'during the 1847 gold rush', 'in 2087', 'before the industrial revolution',
            'after the next solar eclipse', 'during the Tang dynasty', 'in the 22nd century',
            'following the 1906 San Francisco earthquake', 'during the Viking age',
            'after the invention of the printing press', 'in the year 2150',
            'during the Renaissance period', 'before World War I', 'in the 1920s jazz age'
        ]

        // Specificity modifiers — add precision
        const specificity = [
            'in coastal regions', 'among nomadic tribes', 'using primitive tools',
            'with limited resources', 'under extreme conditions', 'in isolated communities',
            'through unconventional methods', 'via forgotten techniques', 'using lost knowledge',
            'in high-altitude environments', 'across trade routes', 'within secret societies'
        ]

        // Question patterns — meaningful inquiry structures
        const patterns = [
            'how', 'why', 'what made', 'what caused', 'how did',
            'what would happen if', 'how could', 'why would', 'what led to'
        ]

        // Action/concept verbs
        const actions = [
            'affected', 'influenced', 'transformed', 'enabled', 'prevented',
            'accelerated', 'complicated', 'simplified', 'revolutionized', 'challenged'
        ]

        // Objects/concepts
        const concepts = [
            'communication methods', 'survival strategies', 'resource management',
            'navigation techniques', 'knowledge preservation', 'social structures',
            'energy systems', 'food production', 'defense mechanisms', 'trade networks',
            'artistic expression', 'mathematical understanding', 'medical practices'
        ]

        let attempts = 0
        const maxAttempts = count * 10

        while (queries.length < count && attempts < maxAttempts) {
            attempts++

            // Randomly combine elements into a meaningful query
            const pattern = patterns[Math.floor(Math.random() * patterns.length)]
            const domain1 = domains[Math.floor(Math.random() * domains.length)]
            const domain2 = domains[Math.floor(Math.random() * domains.length)]
            const temporal = temporalMarkers[Math.floor(Math.random() * temporalMarkers.length)]
            const specific = specificity[Math.floor(Math.random() * specificity.length)]
            const action = actions[Math.floor(Math.random() * actions.length)]
            const concept = concepts[Math.floor(Math.random() * concepts.length)]

            // Skip if same domain twice
            if (domain1 === domain2) continue

            // Build query with different structures
            const structure = Math.floor(Math.random() * 4)
            let query = ''

            switch (structure) {
                case 0:
                    // "how [domain1] affected [concept] [temporal] [specific]"
                    query = `${pattern} ${domain1} ${action} ${concept} ${temporal} ${specific}`
                    break
                case 1:
                    // "why [domain1] and [domain2] combined [temporal]"
                    query = `${pattern} ${domain1} and ${domain2} ${action} ${concept} ${temporal}`
                    break
                case 2:
                    // "what made [domain1] possible [specific] [temporal]"
                    query = `${pattern} ${domain1} possible ${specific} ${temporal}`
                    break
                case 3:
                    // "how did [domain1] influence [domain2] [temporal]"
                    query = `how did ${domain1} influence ${domain2} ${temporal} ${specific}`
                    break
            }

            const normalized = query.toLowerCase().trim()
            if (!seen.has(normalized)) {
                seen.add(normalized)
                queries.push(query)
            }
        }

        return queries
    }

    /**
     * Execute a single Bing search with human-like behavior.
     * Includes random scrolling, clicking, text selection, and fake interactions.
     */
    private async executeSearch(page: Page, query: string, isMobile: boolean): Promise<void> {
        const refreshThreshold = 10
        this.searchCount++

        try {
            // Refresh page periodically to avoid sluggishness
            if (this.searchCount % refreshThreshold === 0) {
                const cvid = randomBytes(16).toString('hex')
                const url = `${this.bingHome}/search?q=${encodeURIComponent(query)}&PC=U531&FORM=ANNTA1&cvid=${cvid}`
                await page.goto(url)
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
                await this.bot.browser.utils.tryDismissAllMessages(page)
            }

            const searchBar = '#sb_form_q'
            const searchBox = page.locator(searchBar)

            await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'auto' }))
            await page.keyboard.press('Home')
            await searchBox.waitFor({ state: 'visible', timeout: 15000 })

            await this.bot.utils.wait(1000)
            await this.bot.browser.utils.ghostClick(page, searchBar, { clickCount: 3 })
            await searchBox.fill('')

            // Type query with human-like variable delay (not perfectly uniform)
            await this.typeLikeHuman(page, query)
            await page.keyboard.press('Enter')

            this.bot.logger.info(isMobile, 'STAR-SEARCH', `Searched: "${query}"`)

            await this.bot.utils.wait(3000)

            // Perform fake actions on search results page (70% chance)
            if (Math.random() < 0.7) {
                await this.performFakeActions(page, isMobile)
            }

            // Visit a random result page (60% chance) with fake actions inside
            if (this.bot.config.searchSettings.clickRandomResults || Math.random() < 0.6) {
                await this.visitRandomResult(page, isMobile)
            }

            // Random delay between searches
            await this.bot.utils.wait(
                this.bot.utils.randomDelay(
                    this.bot.config.searchSettings.searchDelay.min,
                    this.bot.config.searchSettings.searchDelay.max
                )
            )
        } catch (error) {
            this.bot.logger.warn(isMobile, 'STAR-SEARCH', `Search failed for "${query}": ${errMsg(error)}`)
        }
    }

    /**
     * Type text with variable delay like a real human (not uniform 50ms).
     * Occasional micro-pauses simulate thinking.
     */
    private async typeLikeHuman(page: Page, text: string): Promise<void> {
        for (const char of text) {
            // 5% chance of a longer pause (thinking), 20% short pause, rest normal
            const rand = Math.random()
            let delay: number
            if (rand < 0.05) {
                delay = this.bot.utils.randomNumber(180, 350)
            } else if (rand < 0.25) {
                delay = this.bot.utils.randomNumber(90, 150)
            } else {
                delay = this.bot.utils.randomNumber(30, 80)
            }
            await page.keyboard.type(char, { delay: 0 })
            await this.bot.utils.wait(delay)
        }
    }

    /**
     * Perform a random sequence of fake actions on the current page.
     * Randomly picks 3-6 actions from: scroll, select text, click element, mouse move, read pause.
     */
    private async performFakeActions(page: Page, isMobile: boolean): Promise<void> {
        const actionCount = this.bot.utils.randomNumber(3, 6)
        const actions = ['scroll', 'scroll', 'selectText', 'clickElement', 'mouseMove', 'readPause']

        for (let i = 0; i < actionCount; i++) {
            const action = actions[Math.floor(Math.random() * actions.length)] ?? 'scroll'
            try {
                switch (action) {
                    case 'scroll':
                        await this.naturalScroll(page, isMobile)
                        break
                    case 'selectText':
                        await this.selectRandomText(page, isMobile)
                        break
                    case 'clickElement':
                        await this.clickRandomElement(page, isMobile)
                        break
                    case 'mouseMove':
                        if (!isMobile) await this.moveMouseRandomly(page)
                        else await this.naturalScroll(page, isMobile)
                        break
                    case 'readPause':
                        await this.simulateReading(page, isMobile)
                        break
                }
            } catch (error) {
                this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Fake action "${action}" error: ${errMsg(error)}`)
            }

            // Random pause between actions (300-1500ms)
            await this.bot.utils.wait(this.bot.utils.randomDelay(300, 1500))
        }
    }

    /**
     * Natural scrolling: multiple small scrolls with pauses, up and down.
     * Simulates reading through content.
     */
    private async naturalScroll(page: Page, isMobile: boolean): Promise<void> {
        try {
            const scrollSteps = this.bot.utils.randomNumber(2, 5)
            const scrollDirection = Math.random() < 0.7 ? 1 : -1 // 70% down, 30% up

            for (let i = 0; i < scrollSteps; i++) {
                const scrollAmount = Math.floor(Math.random() * 400 + 100) * scrollDirection
                await page.evaluate(
                    (amount: number) => window.scrollBy({ left: 0, top: amount, behavior: 'smooth' }),
                    scrollAmount
                )
                // Small pause between scrolls (like reading)
                await this.bot.utils.wait(this.bot.utils.randomDelay(200, 600))
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Natural scroll error: ${errMsg(error)}`)
        }
    }

    /**
     * Select random text on the page (highlight like reading).
     * Uses Range API to select a random text node.
     */
    private async selectRandomText(page: Page, isMobile: boolean): Promise<void> {
        try {
            const selected = await page.evaluate(() => {
                // Find all text-containing elements (paragraphs, headings, spans)
                const candidates = document.querySelectorAll('p, h1, h2, h3, h4, li, span, .b_algo .b_caption')
                const textElements = Array.from(candidates).filter(el => {
                    const text = el.textContent?.trim() ?? ''
                    return text.length > 20 && text.length < 500
                })

                if (textElements.length === 0) return false

                const target = textElements[Math.floor(Math.random() * textElements.length)]
                if (!target) return false

                try {
                    const selection = window.getSelection()
                    if (!selection) return false

                    // Create a range and select a portion of the text
                    const range = document.createRange()
                    const text = target.textContent ?? ''
                    const start = Math.floor(Math.random() * Math.max(1, text.length / 2))
                    const end = Math.min(text.length, start + Math.floor(Math.random() * 60 + 20))

                    const textNode = target.firstChild
                    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                        range.setStart(textNode, Math.min(start, textNode.textContent?.length ?? 0))
                        range.setEnd(textNode, Math.min(end, textNode.textContent?.length ?? 0))
                        selection.removeAllRanges()
                        selection.addRange(range)
                        return true
                    }
                } catch {
                    return false
                }
                return false
            })

            if (selected) {
                // Hold selection for a moment (like reading)
                await this.bot.utils.wait(this.bot.utils.randomDelay(800, 2000))

                // Deselect by clicking elsewhere
                await page.mouse.click(10, 10)
                await this.bot.utils.wait(300)
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Select text error: ${errMsg(error)}`)
        }
    }

    /**
     * Click a random non-link element on the page (headings, images, paragraphs).
     * Avoids navigation - just clicks in place.
     */
    private async clickRandomElement(page: Page, isMobile: boolean): Promise<void> {
        try {
            const clicked = await page.evaluate(() => {
                // Clickable non-navigation elements
                const selectors = [
                    'h1',
                    'h2',
                    'h3',
                    'h4',
                    'p',
                    'img',
                    'li',
                    '.b_algo h2',
                    '.b_algo .b_caption',
                    'span.b_snippetBig',
                    '.b_top',
                    '.b_ans'
                ]

                const elements: Element[] = []
                for (const sel of selectors) {
                    elements.push(...Array.from(document.querySelectorAll(sel)))
                }

                // Filter visible, non-empty elements
                const visible = elements.filter(el => {
                    const rect = el.getBoundingClientRect()
                    return (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        rect.top > 0 &&
                        rect.top < window.innerHeight * 3 &&
                        (el.textContent?.trim().length ?? 0) > 0
                    )
                })

                if (visible.length === 0) return null

                const target = visible[Math.floor(Math.random() * visible.length)]
                if (!target) return null

                const rect = target.getBoundingClientRect()
                return {
                    x: rect.left + rect.width / 2 + window.scrollX,
                    y: rect.top + rect.height / 2 + window.scrollY,
                    tag: target.tagName
                }
            })

            if (clicked && clicked.x > 0 && clicked.y > 0) {
                // Move mouse to element, then click
                await page.mouse.move(clicked.x, clicked.y, { steps: this.bot.utils.randomNumber(5, 15) })
                await this.bot.utils.wait(this.bot.utils.randomDelay(100, 300))
                await page.mouse.click(clicked.x, clicked.y)
                await this.bot.utils.wait(this.bot.utils.randomDelay(300, 800))
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Click element error: ${errMsg(error)}`)
        }
    }

    /**
     * Move mouse to random positions on the page (desktop only).
     * Simulates natural mouse wandering.
     */
    private async moveMouseRandomly(page: Page): Promise<void> {
        try {
            const viewport = page.viewportSize()
            if (!viewport) return

            const moves = this.bot.utils.randomNumber(2, 5)
            for (let i = 0; i < moves; i++) {
                const x = Math.floor(Math.random() * viewport.width)
                const y = Math.floor(Math.random() * viewport.height)
                await page.mouse.move(x, y, { steps: this.bot.utils.randomNumber(8, 20) })
                await this.bot.utils.wait(this.bot.utils.randomDelay(100, 400))
            }
        } catch (error) {
            this.bot.logger.debug(false, 'STAR-SEARCH', `Mouse move error: ${errMsg(error)}`)
        }
    }

    /**
     * Simulate reading: scroll to a position, pause for a while, maybe scroll a bit more.
     */
    private async simulateReading(page: Page, isMobile: boolean): Promise<void> {
        try {
            // Scroll to a random position
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const scrollPos = Math.floor(Math.random() * (totalHeight - viewportHeight) * 0.8)
            await page.evaluate((pos: number) => window.scrollTo({ left: 0, top: pos, behavior: 'smooth' }), scrollPos)

            // "Read" for 2-6 seconds
            await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 6000))

            // Small scroll adjustment (like adjusting reading position)
            const adjustScroll = Math.floor(Math.random() * 150 - 75)
            await page.evaluate(
                (amount: number) => window.scrollBy({ left: 0, top: amount, behavior: 'smooth' }),
                adjustScroll
            )
            await this.bot.utils.wait(this.bot.utils.randomDelay(500, 1500))
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Reading sim error: ${errMsg(error)}`)
        }
    }

    /**
     * Visit a random search result and perform fake actions inside.
     * Replaces the old clickRandomLink - more comprehensive.
     */
    private async visitRandomResult(page: Page, isMobile: boolean): Promise<void> {
        try {
            const searchPageUrl = page.url()

            // Collect all result links
            const links = await page.evaluate(() => {
                const resultLinks = document.querySelectorAll('#b_results .b_algo h2 a')
                return Array.from(resultLinks)
                    .filter(a => {
                        const href = (a as HTMLAnchorElement).href
                        return (
                            href &&
                            !href.includes('bing.com') &&
                            !href.includes('microsoft.com') &&
                            !href.includes('wikipedia.org/wiki/Main')
                        )
                    })
                    .map((a, idx) => ({
                        href: (a as HTMLAnchorElement).href,
                        text: a.textContent?.trim().substring(0, 80) ?? '',
                        index: idx
                    }))
            })

            if (links.length === 0) return

            // Pick a random result (not always the first one)
            const chosen = links[Math.floor(Math.random() * Math.min(links.length, 8))]
            if (!chosen) return

            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Visiting: "${chosen.text}"`)

            // Scroll to the link first (natural behavior)
            await page.evaluate((idx: number) => {
                const els = document.querySelectorAll('#b_results .b_algo h2 a')
                const el = els[idx] as HTMLElement | undefined
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, chosen.index)
            await this.bot.utils.wait(this.bot.utils.randomDelay(500, 1200))

            // Click the link
            await page.evaluate((href: string) => {
                const link = document.querySelector(`a[href="${CSS.escape(href)}"]`) as HTMLElement | null
                if (link) link.click()
            }, chosen.href)

            await this.bot.utils.wait(3000)

            // Get the page we landed on
            let visitPage: Page = page
            if (!isMobile) {
                visitPage = await this.bot.browser.utils.getLatestTab(page)
            }

            if (visitPage !== page || isMobile) {
                await visitPage.waitForLoadState('domcontentloaded').catch(() => {})
                await this.bot.utils.wait(this.bot.utils.randomDelay(1500, 3000))

                // Perform 2-4 fake actions inside the visited page
                const visitActions = this.bot.utils.randomNumber(2, 4)
                for (let i = 0; i < visitActions; i++) {
                    await this.performFakeActions(visitPage, isMobile)
                    await this.bot.utils.wait(this.bot.utils.randomDelay(800, 2000))
                }

                // Stay on the page for a bit (like reading)
                await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
            }

            // Return to search results
            if (isMobile) {
                await page.goto(searchPageUrl)
            } else {
                const currentTab = await this.bot.browser.utils.getLatestTab(page)
                if (currentTab !== page) {
                    await currentTab.close().catch(() => {})
                }
            }

            await this.bot.utils.wait(this.bot.utils.randomDelay(1000, 2500))
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Visit result error: ${errMsg(error)}`)
            // Ensure we're back on search page
            if (!isMobile) {
                const tab = await this.bot.browser.utils.getLatestTab(page).catch(() => page)
                if (tab !== page) await tab.close().catch(() => {})
            }
        }
    }
}

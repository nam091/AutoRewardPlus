import { randomBytes } from 'crypto'

import type { BrowserContext, Page } from 'patchright'

import type { Account } from '../../../interface/Account'
import type { ConfigStarSearchSettings } from '../../../interface/Config'
import { HumanizeEngine } from '../../../browser/humanize/HumanizeEngine'
import { QueryCore } from '../../QueryEngine'
import { Workers } from '../../Workers'
import { errMsg } from '../../../util/Utils'

export class StarSearch extends Workers {
    private readonly bingHome = 'https://bing.com'
    private searchCount = 0

    private getSettings(): ConfigStarSearchSettings {
        return {
            searchCount: 25,
            keywordPoolSize: 700,
            minWordCount: 5,
            maxWordCount: 15,
            useInPrivate: true,
            popupClicksPerSearch: { min: 1, max: 3 },
            searchDelay: { min: '30sec', max: '1min' },
            ...this.bot.config.starSearchSettings
        }
    }

    public async doStarSearch(page: Page, isMobile: boolean, account: Account): Promise<void> {
        const settings = this.getSettings()
        const langCode = (account.langCode ?? this.bot.userData.langCode ?? 'vi').toLowerCase()

        this.bot.logger.info(
            isMobile,
            'STAR-SEARCH',
            `⭐ Starting Star Search | searches=${settings.searchCount} | pool=${settings.keywordPoolSize} | inPrivate=${settings.useInPrivate}`,
            'magenta'
        )

        const queryCore = new QueryCore(this.bot)
        const keywordPool = await queryCore.generateStarSearchKeywords(
            settings.keywordPoolSize,
            langCode,
            settings.minWordCount,
            settings.maxWordCount
        )

        if (keywordPool.length === 0) {
            this.bot.logger.warn(isMobile, 'STAR-SEARCH', 'No keywords available, skipping Star Search')
            return
        }

        const queries = this.bot.utils.shuffleArray([...keywordPool]).slice(0, settings.searchCount)

        this.bot.logger.info(
            isMobile,
            'STAR-SEARCH',
            `📊 Selected ${queries.length} queries from pool of ${keywordPool.length}`,
            'magenta'
        )

        let isolatedContext: BrowserContext | null = null
        let searchPage = page

        try {
            if (settings.useInPrivate && !isMobile) {
                isolatedContext = await this.createInPrivateContext(page, account)
                if (isolatedContext) {
                    searchPage = await isolatedContext.newPage()
                    await searchPage.goto(this.bingHome, { waitUntil: 'domcontentloaded' }).catch(() => {})
                    await this.bot.utils.wait(1500)
                    await this.bot.browser.utils.tryDismissAllMessages(searchPage)
                    this.bot.logger.info(isMobile, 'STAR-SEARCH', 'Using isolated InPrivate-style context', 'magenta')
                }
            }

            let completed = 0
            for (const query of queries) {
                try {
                    await this.executeSearch(searchPage, query, isMobile, settings)
                    completed++
                    this.bot.logger.debug(
                        isMobile,
                        'STAR-SEARCH',
                        `Progress ${completed}/${queries.length} | query="${query}"`
                    )
                } catch (error) {
                    this.bot.logger.warn(
                        isMobile,
                        'STAR-SEARCH',
                        `Search failed | query="${query}" | ${errMsg(error)}`
                    )
                }
            }

            this.bot.logger.info(
                isMobile,
                'STAR-SEARCH',
                `🎉 Star Search completed | searches=${completed}/${queries.length}`,
                'magenta'
            )
        } finally {
            if (isolatedContext) {
                await isolatedContext.close().catch(() => {})
            }
        }
    }

    private async createInPrivateContext(page: Page, account: Account): Promise<BrowserContext | null> {
        try {
            const fingerprint = this.bot.desktopFingerprint ?? this.bot.fingerprint
            if (!fingerprint) {
                this.bot.logger.warn(false, 'STAR-SEARCH', 'No desktop fingerprint available for InPrivate context')
                return null
            }

            const browserFactory = this.bot['browserFactory'] as {
                createInPrivateContext: (
                    parentPage: Page,
                    acc: Account,
                    fp: typeof fingerprint
                ) => Promise<BrowserContext>
            }

            return await browserFactory.createInPrivateContext(page, account, fingerprint)
        } catch (error) {
            this.bot.logger.warn(false, 'STAR-SEARCH', `InPrivate context failed: ${errMsg(error)}`)
            return null
        }
    }

    private async executeSearch(
        page: Page,
        query: string,
        isMobile: boolean,
        settings: ConfigStarSearchSettings
    ): Promise<void> {
        const refreshThreshold = 10
        this.searchCount++

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

        await this.bot.utils.wait(this.bot.utils.exponentialDelay(400, 1800))
        await HumanizeEngine.humanClick(page, searchBar)
        await searchBox.fill('')
        await HumanizeEngine.typeHumanlike(page, searchBar, query)
        await this.bot.utils.wait(this.bot.utils.exponentialDelay(200, 800))
        await page.keyboard.press('Enter')

        this.bot.logger.info(isMobile, 'STAR-SEARCH', `🔍 Searched: "${query}"`, 'cyan')

        await this.bot.utils.wait(this.bot.utils.exponentialDelay(2000, 5000))

        if (Math.random() < 0.7) {
            await this.performFakeActions(page, isMobile)
        }

        const popupMin = this.bot.utils.stringToNumber(settings.popupClicksPerSearch.min)
        const popupMax = this.bot.utils.stringToNumber(settings.popupClicksPerSearch.max)
        const popupClicks = this.bot.utils.randomNumber(popupMin, popupMax)

        for (let i = 0; i < popupClicks; i++) {
            if (this.bot.config.searchSettings.clickRandomResults || Math.random() < 0.65) {
                await this.visitRandomResult(page, isMobile)
            }
            if (i < popupClicks - 1) {
                await this.bot.utils.wait(this.bot.utils.randomDelay(1500, 4000))
            }
        }

        await this.bot.utils.wait(
            this.bot.utils.randomDelay(settings.searchDelay.min, settings.searchDelay.max)
        )
    }

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

            await this.bot.utils.wait(this.bot.utils.randomDelay(300, 1500))
        }
    }

    private async naturalScroll(page: Page, isMobile: boolean): Promise<void> {
        try {
            const scrollSteps = this.bot.utils.randomNumber(2, 5)
            const scrollDirection = Math.random() < 0.7 ? 1 : -1

            for (let i = 0; i < scrollSteps; i++) {
                const scrollAmount = Math.floor(Math.random() * 400 + 100) * scrollDirection
                await page.evaluate(
                    (amount: number) => window.scrollBy({ left: 0, top: amount, behavior: 'smooth' }),
                    scrollAmount
                )
                await this.bot.utils.wait(this.bot.utils.randomDelay(200, 600))
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Natural scroll error: ${errMsg(error)}`)
        }
    }

    private async selectRandomText(page: Page, isMobile: boolean): Promise<void> {
        try {
            const selected = await page.evaluate(() => {
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
                await this.bot.utils.wait(this.bot.utils.randomDelay(800, 2000))
                await page.mouse.click(10, 10)
                await this.bot.utils.wait(300)
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Select text error: ${errMsg(error)}`)
        }
    }

    private async clickRandomElement(page: Page, isMobile: boolean): Promise<void> {
        try {
            const clicked = await page.evaluate(() => {
                const selectors = ['h1', 'h2', 'h3', 'h4', 'p', 'img', 'li', '.b_algo h2', '.b_algo .b_caption', 'span.b_snippetBig']
                const elements: Element[] = []
                for (const sel of selectors) {
                    elements.push(...Array.from(document.querySelectorAll(sel)))
                }

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
                    y: rect.top + rect.height / 2 + window.scrollY
                }
            })

            if (clicked && clicked.x > 0 && clicked.y > 0) {
                await page.mouse.move(clicked.x, clicked.y, { steps: this.bot.utils.randomNumber(5, 15) })
                await this.bot.utils.wait(this.bot.utils.randomDelay(100, 300))
                await page.mouse.click(clicked.x, clicked.y)
                await this.bot.utils.wait(this.bot.utils.randomDelay(300, 800))
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Click element error: ${errMsg(error)}`)
        }
    }

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

    private async simulateReading(page: Page, isMobile: boolean): Promise<void> {
        try {
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const scrollPos = Math.floor(Math.random() * (totalHeight - viewportHeight) * 0.8)
            await page.evaluate((pos: number) => window.scrollTo({ left: 0, top: pos, behavior: 'smooth' }), scrollPos)
            await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 6000))

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

    private async visitRandomResult(page: Page, isMobile: boolean): Promise<void> {
        try {
            const searchPageUrl = page.url()

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

            const chosen = links[Math.floor(Math.random() * Math.min(links.length, 8))]
            if (!chosen) return

            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Visiting popup: "${chosen.text}"`)

            await page.evaluate((idx: number) => {
                const els = document.querySelectorAll('#b_results .b_algo h2 a')
                const el = els[idx] as HTMLElement | undefined
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, chosen.index)
            await this.bot.utils.wait(this.bot.utils.randomDelay(500, 1200))

            if (isMobile) {
                await HumanizeEngine.humanClick(page, `#b_results .b_algo h2 a >> nth=${chosen.index}`)
            } else {
                const [popup] = await Promise.all([
                    page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
                    page.evaluate((href: string) => {
                        const link = document.querySelector(`a[href="${CSS.escape(href)}"]`) as HTMLElement | null
                        if (link) link.click()
                    }, chosen.href)
                ])

                const visitPage = popup ?? page
                await visitPage.waitForLoadState('domcontentloaded').catch(() => {})
                await this.bot.utils.wait(this.bot.utils.randomDelay(1500, 3000))

                const visitActions = this.bot.utils.randomNumber(2, 4)
                for (let i = 0; i < visitActions; i++) {
                    await this.performFakeActions(visitPage, isMobile)
                }

                if (popup) {
                    await popup.close().catch(() => {})
                } else {
                    await page.goto(searchPageUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
                }
                return
            }

            await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
            const visitActions = this.bot.utils.randomNumber(2, 3)
            for (let i = 0; i < visitActions; i++) {
                await this.performFakeActions(page, isMobile)
            }
            await page.goto(searchPageUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Visit result error: ${errMsg(error)}`)
        }
    }
}
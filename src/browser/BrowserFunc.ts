import type { BrowserContext, Cookie, Page } from 'patchright'
import type { AxiosRequestConfig } from 'axios'

import type { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'
import { errMsg } from '../util/Utils'

import type { Counters, DashboardData } from './../interface/DashboardData'
import type { AppUserData } from '../interface/AppUserData'
import type { XboxDashboardData } from '../interface/XboxDashboardData'
import type { AppEarnablePoints, BrowserEarnablePoints, MissingSearchPoints } from '../interface/Points'
import type { AppDashboardData } from '../interface/AppDashBoardData'

const DASHBOARD_CACHE_TTL_MS = 15_000

export default class BrowserFunc {
    private bot: MicrosoftRewardsBot
    private dashboardCache: { data: DashboardData; ts: number } | null = null

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    invalidateDashboardCache(): void {
        this.dashboardCache = null
    }

    /**
     * Detect if the account is using the modern card-based UI
     * Checks for collapsible section buttons (react-aria Disclosure triggers)
     * and the "Earn" tab in the navigation, which only exist on modern UI.
     * @param page {Page} Playwright page object
     */
    async isModernUI(page: Page): Promise<boolean> {
        try {
            // Navigate to dashboard to check
            const url = page.url()
            if (!url.includes('rewards.bing.com')) {
                await page.goto('https://rewards.bing.com/dashboard', {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                })
                await this.bot.utils.wait(2000)
            }

            // Modern UI detection: check for collapsible sections with slot="trigger"
            // or sections with aria-expanded buttons, or "Earn" nav link
            const isModern = await page.evaluate(() => {
                // Check 1: Buttons with slot="trigger" (react-aria Disclosure)
                const triggerBtns = document.querySelectorAll('button[slot="trigger"]')
                if (triggerBtns.length > 0) return true

                // Check 2: Buttons with aria-expanded in section context
                const sections = document.querySelectorAll('section')
                for (const s of sections) {
                    const h = s.querySelector('h2, h3')
                    const btn = s.querySelector('button[aria-expanded]')
                    if (h && btn && h.textContent?.trim()?.startsWith('Daily set')) return true
                }

                // Check 3: "Earn" link in nav (legacy uses "Earn more")
                const navLinks = document.querySelectorAll('nav a, header a')
                for (const link of navLinks) {
                    if (link.textContent?.trim() === 'Earn') return true
                }

                return false
            })

            return isModern
        } catch (error) {
            return false
        }
    }

    /**
     * Fetch user desktop dashboard data
     * @returns {DashboardData} Object of user bing rewards dashboard data
     */
    async getDashboardData(skipCache = false, pageOverride?: Page): Promise<DashboardData> {
        if (!skipCache && this.dashboardCache && Date.now() - this.dashboardCache.ts < DASHBOARD_CACHE_TTL_MS) {
            return this.dashboardCache.data
        }

        // Try getting dashboard directly from active page window.dashboard first (avoids HTTP 431)
        const activePage = pageOverride || this.bot.mainMobilePage || this.bot.mainDesktopPage
        if (activePage && !activePage.isClosed()) {
            try {
                const isSuspended = await activePage.evaluate(() => {
                    const text = document.body ? document.body.innerText : ''
                    return text.includes('Your Microsoft Rewards account has been suspended') || text.includes('account has been suspended')
                })
                if (isSuspended) {
                    throw new Error('Tài khoản đã bị Microsoft Rewards đình chỉ (Account Suspended)')
                }
            } catch (err: any) {
                if (err.message?.includes('Account Suspended')) throw err
            }

            try {
                const pageData = await activePage.evaluate(() => {
                    const win = window as any
                    if (win.dashboard && typeof win.dashboard === 'object' && win.dashboard.userStatus) {
                        return win.dashboard
                    }
                    return null
                })
                if (pageData) {
                    this.dashboardCache = { data: pageData, ts: Date.now() }
                    return pageData
                }
            } catch {}
        }

        try {
            const request: AxiosRequestConfig = {
                url: 'https://rewards.bing.com/api/getuserinfo?type=1',
                method: 'GET',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.buildCookieHeader(this.bot.cookies.mobile, ['bing.com']),
                    Referer: 'https://rewards.bing.com/',
                    Origin: 'https://rewards.bing.com'
                }
            }

            const response = await this.bot.axios.request(request)

            if (response.data?.dashboard) {
                const data = response.data.dashboard as DashboardData
                this.dashboardCache = { data, ts: Date.now() }
                return data
            }
            throw new Error('Dashboard data missing from API response')
        } catch (error) {
            this.bot.logger.warn(this.bot.isMobile, 'GET-DASHBOARD-DATA', `API failed: ${errMsg(error)}, trying fallback`)

            // 1. Try reading directly from active browser page via fetch() in page context
            if (activePage && !activePage.isClosed()) {
                try {
                    const inPageData = await activePage.evaluate(async () => {
                        try {
                            const res = await fetch('https://rewards.bing.com/api/getuserinfo?type=1')
                            if (res.ok) {
                                const json = await res.json()
                                if (json?.dashboard) return json.dashboard
                            }
                        } catch {}
                        return null
                    })
                    if (inPageData) {
                        this.dashboardCache = { data: inPageData as DashboardData, ts: Date.now() }
                        return inPageData as DashboardData
                    }
                } catch {}

                // Try reading window.dashboard or legacy var dashboard
                try {
                    const content = await activePage.content()
                    const match = content.match(/var\s+dashboard\s*=\s*({.*?});/s)
                    if (match?.[1]) {
                        const data = JSON.parse(match[1]) as DashboardData
                        this.dashboardCache = { data, ts: Date.now() }
                        return data
                    }
                } catch {}
            }

            // 2. Fallback to App API if mobile accessToken is available
            if (this.bot.accessToken) {
                try {
                    this.bot.logger.info(this.bot.isMobile, 'GET-DASHBOARD-DATA', 'Attempting fallback via mobile App API')
                    const appData = await this.getAppDashboardData()
                    if (appData?.response) {
                        const balance = appData.response.balance ?? 0
                        const country = appData.response.profile?.attributes?.country?.toLowerCase() || 'vn'
                        const level = appData.response.profile?.attributes?.level || 'Level 1'
                        const goalName = appData.response.goal_item?.name || 'None'
                        const goalPrice = appData.response.goal_item?.price || 0
                        const syntheticData: any = {
                            userStatus: {
                                availablePoints: balance,
                                lifetimePoints: balance,
                                levelInfo: { activeLevelName: level, activeLevel: level },
                                redeemGoal: { title: goalName, price: goalPrice },
                                counters: {
                                    pcSearch: [
                                        { pointProgress: 0, pointProgressMax: 90 },
                                        { pointProgress: 0, pointProgressMax: 12 }
                                    ],
                                    mobileSearch: [
                                        { pointProgress: 0, pointProgressMax: 60 }
                                    ],
                                    activityAndQuiz: [],
                                    dailyPoint: []
                                }
                            },
                            userProfile: {
                                attributes: { country }
                            },
                            promotionalItems: [],
                            dailySetPromotions: {},
                            morePromotions: []
                        }
                        this.dashboardCache = { data: syntheticData as DashboardData, ts: Date.now() }
                        return syntheticData as DashboardData
                    }
                } catch (appErr) {
                    this.bot.logger.warn(this.bot.isMobile, 'GET-DASHBOARD-DATA', `App API fallback failed: ${errMsg(appErr)}`)
                }
            }

            // 3. Fallback to HTTP request with strictly filtered cookies
            try {
                const request: AxiosRequestConfig = {
                    url: this.bot.config.baseURL,
                    method: 'GET',
                    headers: {
                        ...(this.bot.fingerprint?.headers ?? {}),
                        Cookie: this.buildCookieHeader(this.bot.cookies.mobile, ['bing.com']),
                        Referer: 'https://rewards.bing.com/',
                        Origin: 'https://rewards.bing.com'
                    }
                }

                const response = await this.bot.axios.request(request)
                const match = response.data.match(/var\s+dashboard\s*=\s*({.*?});/s)

                if (match?.[1]) {
                    const data = JSON.parse(match[1]) as DashboardData
                    this.dashboardCache = { data, ts: Date.now() }
                    return data
                }
            } catch {}

            throw new Error(`Failed to load dashboard data: ${errMsg(error)}`)
        }
    }

    /**
     * Fetch user app dashboard data
     * @returns {AppDashboardData} Object of user bing rewards dashboard data
     */
    async getAppDashboardData(): Promise<AppDashboardData> {
        try {
            const request: AxiosRequestConfig = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=613',
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent':
                        'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
                },
                validateStatus: status => (status >= 200 && status < 300) || status === 403
            }

            const response = await this.bot.axios.request(request)

            if (response.status === 403) {
                if (response.data?.code === 9) {
                    const msg = 'Tài khoản đã bị Microsoft Rewards đình chỉ (Account Suspended - Code 9)'
                    this.bot.logger.error(this.bot.isMobile, 'GET-APP-DASHBOARD-DATA', msg)
                    throw new Error(msg)
                }
                throw new Error(`App API access forbidden (HTTP 403): ${JSON.stringify(response.data)}`)
            }

            return response.data as AppDashboardData
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-APP-DASHBOARD-DATA',
                `Error fetching dashboard data: ${errMsg(error)}`
            )
            throw error
        }
    }

    /**
     * Fetch user xbox dashboard data
     * @returns {XboxDashboardData} Object of user bing rewards dashboard data
     */
    async getXBoxDashboardData(): Promise<XboxDashboardData> {
        try {
            const request: AxiosRequestConfig = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=xboxapp&options=6',
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One X) AppleWebKit/537.36 (KHTML, like Gecko) Edge/18.19041'
                }
            }

            const response = await this.bot.axios.request(request)
            return response.data as XboxDashboardData
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-XBOX-DASHBOARD-DATA',
                `Error fetching dashboard data: ${errMsg(error)}`
            )
            throw error
        }
    }

    /**
     * Get search point counters
     */
    async getSearchPoints(): Promise<Counters> {
        const dashboardData = await this.getDashboardData(true)

        return dashboardData.userStatus.counters
    }

    missingSearchPoints(counters: Counters, isMobile: boolean): MissingSearchPoints {
        const mobileData = counters.mobileSearch?.[0]
        const desktopData = counters.pcSearch?.[0]
        const edgeData = counters.pcSearch?.[1]

        const mobilePoints = mobileData ? Math.max(0, mobileData.pointProgressMax - mobileData.pointProgress) : 0
        const desktopPoints = desktopData ? Math.max(0, desktopData.pointProgressMax - desktopData.pointProgress) : 0
        const edgePoints = edgeData ? Math.max(0, edgeData.pointProgressMax - edgeData.pointProgress) : 0

        const totalPoints = isMobile ? mobilePoints : desktopPoints + edgePoints

        return { mobilePoints, desktopPoints, edgePoints, totalPoints }
    }

    /**
     * Renders real search progress as "earned/max" for the dashboard and sheet.
     * `pcSearch` holds both the desktop and Edge-bonus counters, so they are summed.
     */
    formatSearchProgress(counters: Counters): { pcProgress: string; mobileProgress: string } {
        const sum = (entries: Counters['pcSearch'] | undefined) =>
            (entries ?? []).reduce(
                (acc, x) => ({
                    progress: acc.progress + (x.pointProgress ?? 0),
                    max: acc.max + (x.pointProgressMax ?? 0)
                }),
                { progress: 0, max: 0 }
            )

        const pc = sum(counters.pcSearch)
        const mobile = sum(counters.mobileSearch)

        return {
            pcProgress: `${pc.progress}/${pc.max}`,
            mobileProgress: `${mobile.progress}/${mobile.max}`
        }
    }

    /**
     * Get total earnable points with web browser
     */
    async getBrowserEarnablePoints(): Promise<BrowserEarnablePoints> {
        try {
            const data = await this.getDashboardData()

            const desktopSearchPoints =
                data.userStatus.counters.pcSearch?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0

            const mobileSearchPoints =
                data.userStatus.counters.mobileSearch?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0

            const todayDate = this.bot.utils.getFormattedDate()
            const dailySetPoints =
                data.dailySetPromotions[todayDate]?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0

            const morePromotionsPoints =
                data.morePromotions?.reduce((sum, x) => {
                    if (
                        ['quiz', 'urlreward'].includes(x.promotionType) &&
                        x.exclusiveLockedFeatureStatus !== 'locked'
                    ) {
                        return sum + (x.pointProgressMax - x.pointProgress)
                    }
                    return sum
                }, 0) ?? 0

            const totalEarnablePoints = desktopSearchPoints + mobileSearchPoints + dailySetPoints + morePromotionsPoints

            return {
                dailySetPoints,
                morePromotionsPoints,
                desktopSearchPoints,
                mobileSearchPoints,
                totalEarnablePoints
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-BROWSER-EARNABLE-POINTS',
                `An error occurred: ${errMsg(error)}`
            )
            throw error
        }
    }

    /**
     * Get total earnable points with mobile app
     */
    async getAppEarnablePoints(): Promise<AppEarnablePoints> {
        try {
            const eligibleOffers = ['ENUS_readarticle3_30points', 'Gamification_Sapphire_DailyCheckIn']

            const request: AxiosRequestConfig = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'X-Rewards-Country': this.bot.userData.geoLocale,
                    'X-Rewards-Language': 'en',
                    'X-Rewards-ismobile': 'true'
                },
                validateStatus: status => (status >= 200 && status < 300) || status === 403
            }

            const response = await this.bot.axios.request(request)
            if (response.status === 403 || response.data?.code === 9) {
                return { readToEarn: 0, checkIn: 0, totalEarnablePoints: 0 }
            }
            const userData: AppUserData = response.data
            const eligibleActivities = userData.response.promotions.filter(x =>
                eligibleOffers.includes(x.attributes.offerid ?? '')
            )

            let readToEarn = 0
            let checkIn = 0

            for (const item of eligibleActivities) {
                const attrs = item.attributes

                if (attrs.type === 'msnreadearn') {
                    const pointMax = parseInt(attrs.pointmax ?? '0')
                    const pointProgress = parseInt(attrs.pointprogress ?? '0')
                    readToEarn = Math.max(0, pointMax - pointProgress)
                } else if (attrs.type === 'checkin') {
                    const progress = parseInt(attrs.progress ?? '0')
                    const checkInDay = progress % 7
                    const lastUpdated = new Date(attrs.last_updated ?? '')
                    const today = new Date()

                    if (checkInDay < 6 && today.getDate() !== lastUpdated.getDate()) {
                        checkIn = parseInt(attrs[`day_${checkInDay + 1}_points`] ?? '0')
                    }
                }
            }

            const totalEarnablePoints = readToEarn + checkIn

            return {
                readToEarn,
                checkIn,
                totalEarnablePoints
            }
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'GET-APP-EARNABLE-POINTS', `An error occurred: ${errMsg(error)}`)
            throw error
        }
    }
    /**
     * Get current point amount
     * @returns {number} Current total point amount
     */
    async getCurrentPoints(): Promise<number> {
        try {
            const data = await this.getDashboardData()

            return data.userStatus.availablePoints
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'GET-CURRENT-POINTS', `An error occurred: ${errMsg(error)}`)
            throw error
        }
    }

    async closeBrowser(browser: BrowserContext, email: string) {
        const rootBrowser = (browser as any).browser?.() || null

        try {
            // Try to save cookies
            const cookies = await browser.cookies()
            this.bot.logger.debug(this.bot.isMobile, 'CLOSE-BROWSER', `Saving ${cookies.length} cookies.`)
            await saveSessionData(this.bot.config.sessionPath, cookies, email, this.bot.isMobile)

            await this.bot.utils.wait(2000)
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'CLOSE-BROWSER', `Failed to save session: ${error}`)
        } finally {
            try {
                await browser.close()

                if (rootBrowser) {
                    await rootBrowser.close().catch(() => {})
                }

                this.bot.logger.info(this.bot.isMobile, 'CLOSE-BROWSER', 'All browser resources closed.')
            } catch (closeError) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'CLOSE-BROWSER',
                    'Shutdown encountered an error, but process exiting.'
                )
            }
        }
    }

    buildCookieHeader(cookies: Cookie[], allowedDomains?: string[]): string {
        const domains = allowedDomains && allowedDomains.length > 0 ? allowedDomains : ['bing.com']
        const cookieList = [
            ...new Map(
                cookies
                    .filter(c => {
                        return (
                            typeof c.domain === 'string' &&
                            domains.some(d => c.domain.toLowerCase().endsWith(d.toLowerCase()))
                        )
                    })
                    .map(c => [c.name, c])
            ).values()
        ]

        let result = cookieList.map(c => `${c.name}=${c.value}`).join('; ')

        // Protect against HTTP 431 (Request Header Fields Too Large)
        if (result.length > 4096) {
            const priorityNames = new Set([
                'KievRPSSecAuth',
                'NAP',
                'ANON',
                'MUID',
                'MUIDB',
                '_EDGE_S',
                '_EDGE_V',
                'SRCHUSR',
                'SRCHD',
                'SRCHUID',
                'WLS'
            ])
            const priorityCookies = cookieList.filter(c => priorityNames.has(c.name))
            const otherCookies = cookieList.filter(c => !priorityNames.has(c.name))
            const combined = [...priorityCookies, ...otherCookies]
            const parts: string[] = []
            let currentLen = 0

            for (const c of combined) {
                const part = `${c.name}=${c.value}`
                if (currentLen + part.length + 2 > 4096) break
                parts.push(part)
                currentLen += part.length + 2
            }
            result = parts.join('; ')
        }

        return result
    }
}

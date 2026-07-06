import type { BrowserContext } from 'patchright'

import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'

import { MicrosoftRewardsBot, executionContext } from '../index'

import type { DashboardData } from '../interface/DashboardData'

import type { Account } from '../interface/Account'
import { needsDesktopSession, needsModernTasks } from './desktopSessionPolicy'
import { ModernUIWorkers } from './ModernUIWorkers'
import { errMsg } from '../util/Utils'

interface BrowserSession {
    context: BrowserContext
    fingerprint: BrowserFingerprintWithHeaders
}

interface MissingSearchPoints {
    mobilePoints: number
    desktopPoints: number
}

interface SearchResults {
    mobilePoints: number
    desktopPoints: number
}

interface DesktopPhaseOptions {
    data: DashboardData
    missingSearchPoints: MissingSearchPoints
    desktopSearch: boolean
    modern?: boolean
    star?: boolean
    refreshDashboardForModern?: boolean
    logTag?: string
}

interface ExecuteDesktopWorkOptions extends DesktopPhaseOptions {
    session?: BrowserSession | null
    createSession?: boolean
    closeSession?: boolean
    executionContext?: typeof executionContext
}

export class SearchManager {
    constructor(private bot: MicrosoftRewardsBot) {}

    private policyModernTasks(): boolean {
        return needsModernTasks(this.bot.config.workers, this.bot.rewardsVersion)
    }

    private policyDesktopSession(shouldDoDesktop: boolean): boolean {
        return needsDesktopSession(this.bot.config.workers, this.bot.rewardsVersion, shouldDoDesktop)
    }

    private async runWithDesktopFingerprint<T>(session: BrowserSession, fn: () => Promise<T>): Promise<T> {
        const savedFingerprint = this.bot.fingerprint
        this.bot.desktopFingerprint = session.fingerprint
        this.bot.fingerprint = session.fingerprint
        try {
            return await fn()
        } finally {
            this.bot.fingerprint = this.bot.mobileFingerprint ?? savedFingerprint
        }
    }

    /**
     * Single desktop executor: modern tasks -> desktop search -> star search.
     * Always runs inside runWithDesktopFingerprint.
     */
    private async runDesktopPhase(
        session: BrowserSession,
        account: Account,
        accountEmail: string,
        opts: DesktopPhaseOptions
    ): Promise<number> {
        const {
            data,
            missingSearchPoints,
            desktopSearch,
            modern = this.policyModernTasks(),
            star = this.bot.config.workers.doStarSearch,
            refreshDashboardForModern = false,
            logTag = 'DESKTOP-PHASE'
        } = opts

        return await this.runWithDesktopFingerprint(session, async () => {
            let taskData = data
            if (modern) {
                if (refreshDashboardForModern) {
                    taskData = await this.bot.browser.func.getDashboardData()
                }
                await this.runModernUITasks(taskData)
            }

            let pointsEarned = 0
            if (desktopSearch) {
                this.bot.logger.info(
                    'main',
                    logTag,
                    `Search start | target=${missingSearchPoints.desktopPoints}`
                )
                pointsEarned = await this.bot.activities.doSearch(taskData, this.bot.mainDesktopPage, false)
                this.bot.logger.info(
                    'main',
                    logTag,
                    `Search done | earned=${pointsEarned}/${missingSearchPoints.desktopPoints}`
                )
                this.bot.logger.debug('main', logTag, `Result | account=${accountEmail} | earned=${pointsEarned}`)
            }

            if (star) {
                await this.runStarSearchIfEnabled(account, accountEmail)
            }

            return pointsEarned
        })
    }

    /**
     * Create session (optional), run desktop phase, close session (optional).
     */
    private async executeDesktopWork(
        account: Account,
        accountEmail: string,
        opts: ExecuteDesktopWorkOptions
    ): Promise<number> {
        const execCtx = opts.executionContext ?? executionContext
        const logTag = opts.logTag ?? 'DESKTOP-PHASE'
        const closeSession = opts.closeSession !== false
        let session = opts.session ?? null

        return await execCtx.run({ isMobile: false, account }, async () => {
            try {
                if (opts.createSession || !session) {
                    session = await this.createDesktopSession(account, accountEmail)
                }

                return await this.runDesktopPhase(session!, account, accountEmail, {
                    data: opts.data,
                    missingSearchPoints: opts.missingSearchPoints,
                    desktopSearch: opts.desktopSearch,
                    modern: opts.modern,
                    star: opts.star,
                    refreshDashboardForModern: opts.refreshDashboardForModern,
                    logTag
                })
            } catch (error) {
                this.bot.logger.error('main', logTag, `Failed: ${errMsg(error)}`)
                if (error instanceof Error && error.stack) {
                    this.bot.logger.debug('main', logTag, `Stack: ${error.stack}`)
                }
                return 0
            } finally {
                if (closeSession && session) {
                    this.bot.logger.info('main', logTag, 'Closing desktop session')
                    try {
                        await this.bot.browser.func.closeBrowser(session.context, accountEmail)
                        this.bot.logger.info('main', logTag, 'Desktop browser closed')
                    } catch (error) {
                        this.bot.logger.warn('main', logTag, `Close failed: ${errMsg(error)}`)
                    }
                }
            }
        })
    }

    async doSearches(
        data: DashboardData,
        missingSearchPoints: MissingSearchPoints,
        mobileSession: BrowserSession,
        account: Account,
        accountEmail: string
    ): Promise<SearchResults> {
        this.bot.logger.debug(
            'main',
            'SEARCH-MANAGER',
            `Start | account=${accountEmail} | mobileMissing=${missingSearchPoints.mobilePoints} | desktopMissing=${missingSearchPoints.desktopPoints}`
        )

        const doMobile = this.bot.config.workers.doMobileSearch && missingSearchPoints.mobilePoints > 0
        const doDesktop = this.bot.config.workers.doDesktopSearch && missingSearchPoints.desktopPoints > 0

        const mobileStatus = this.bot.config.workers.doMobileSearch
            ? missingSearchPoints.mobilePoints > 0
                ? 'run'
                : 'skip-no-points'
            : 'skip-disabled'
        const desktopStatus = this.bot.config.workers.doDesktopSearch
            ? missingSearchPoints.desktopPoints > 0
                ? 'run'
                : 'skip-no-points'
            : 'skip-disabled'

        this.bot.logger.info(
            'main',
            'SEARCH-MANAGER',
            `Mobile: ${mobileStatus} (enabled=${this.bot.config.workers.doMobileSearch}, missing=${missingSearchPoints.mobilePoints})`
        )
        this.bot.logger.info(
            'main',
            'SEARCH-MANAGER',
            `Desktop: ${desktopStatus} (enabled=${this.bot.config.workers.doDesktopSearch}, missing=${missingSearchPoints.desktopPoints})`
        )

        if (!doMobile && !doDesktop) {
            const bothWorkersEnabled = this.bot.config.workers.doMobileSearch && this.bot.config.workers.doDesktopSearch
            const bothNoPoints = missingSearchPoints.mobilePoints <= 0 && missingSearchPoints.desktopPoints <= 0

            if (bothWorkersEnabled && bothNoPoints) {
                this.bot.logger.info(
                    'main',
                    'SEARCH-MANAGER',
                    'All searches skipped: no mobile or desktop points left.'
                )
            } else {
                this.bot.logger.info('main', 'SEARCH-MANAGER', 'No searches scheduled (disabled or no points).')
            }

            this.bot.logger.info('main', 'SEARCH-MANAGER', 'Closing mobile session')
            try {
                await executionContext.run({ isMobile: true, account }, async () => {
                    await this.bot.browser.func.closeBrowser(mobileSession.context, accountEmail)
                })
                this.bot.logger.info('main', 'SEARCH-MANAGER', 'Mobile session closed')
            } catch (error) {
                this.bot.logger.warn('main', 'SEARCH-MANAGER', `Failed to close mobile session: ${errMsg(error)}`)
                if (error instanceof Error && error.stack) {
                    this.bot.logger.debug('main', 'SEARCH-MANAGER', `Mobile close stack: ${error.stack}`)
                }
            }

            const needModernTasks = this.policyModernTasks()
            if (this.policyDesktopSession(false)) {
                this.bot.logger.info(
                    'main',
                    'SEARCH-MANAGER',
                    `Creating desktop session | star=${this.bot.config.workers.doStarSearch} | modern=${needModernTasks}`
                )
                try {
                    await this.executeDesktopWork(account, accountEmail, {
                        data,
                        missingSearchPoints,
                        desktopSearch: false,
                        modern: needModernTasks,
                        star: this.bot.config.workers.doStarSearch,
                        refreshDashboardForModern: true,
                        createSession: true,
                        closeSession: true,
                        executionContext,
                        logTag: 'SEARCH-EARLY-DESKTOP'
                    })
                } catch (error) {
                    this.bot.logger.error('main', 'SEARCH-MANAGER', `Desktop tasks failed: ${errMsg(error)}`)
                }
            }

            return { mobilePoints: 0, desktopPoints: 0 }
        }

        const useParallel = this.bot.config.searchSettings.parallelSearching
        this.bot.logger.info('main', 'SEARCH-MANAGER', `Mode: ${useParallel ? 'parallel' : 'sequential'}`)
        this.bot.logger.debug('main', 'SEARCH-MANAGER', `parallelSearching=${useParallel} | account=${accountEmail}`)

        if (useParallel) {
            return await this.doParallelSearches(
                data,
                missingSearchPoints,
                mobileSession,
                account,
                accountEmail,
                executionContext
            )
        } else {
            return await this.doSequentialSearches(
                data,
                missingSearchPoints,
                mobileSession,
                account,
                accountEmail,
                executionContext
            )
        }
    }

    private async doParallelSearches(
        data: DashboardData,
        missingSearchPoints: MissingSearchPoints,
        mobileSession: BrowserSession,
        account: Account,
        accountEmail: string,
        executionContext: any
    ): Promise<SearchResults> {
        this.bot.logger.info('main', 'SEARCH-MANAGER', 'Parallel start')
        this.bot.logger.debug(
            'main',
            'SEARCH-MANAGER',
            `Parallel config | account=${accountEmail} | mobileMissing=${missingSearchPoints.mobilePoints} | desktopMissing=${missingSearchPoints.desktopPoints}`
        )

        const shouldDoMobile = this.bot.config.workers.doMobileSearch && missingSearchPoints.mobilePoints > 0
        const shouldDoDesktop = this.bot.config.workers.doDesktopSearch && missingSearchPoints.desktopPoints > 0
        const needModernTasks = this.policyModernTasks()

        this.bot.logger.debug(
            'main',
            'SEARCH-MANAGER',
            `Parallel flags | mobile=${shouldDoMobile} | desktop=${shouldDoDesktop} | star=${this.bot.config.workers.doStarSearch} | modern=${needModernTasks}`
        )

        let desktopSession: BrowserSession | null = null
        let mobileContextClosed = false

        try {
            const promises: Promise<number>[] = []
            const searchTypes: string[] = []

            if (shouldDoMobile) {
                this.bot.logger.debug(
                    'main',
                    'SEARCH-MANAGER',
                    `Schedule mobile | target=${missingSearchPoints.mobilePoints}`
                )
                searchTypes.push('Mobile')
                promises.push(
                    this.doMobileSearch(data, missingSearchPoints, mobileSession, account, accountEmail, executionContext).then(
                        points => {
                            mobileContextClosed = true
                            this.bot.logger.info('main', 'SEARCH-MANAGER', `Mobile done | earned=${points}`)
                            return points
                        }
                    )
                )
            } else {
                const reason = !this.bot.config.workers.doMobileSearch ? 'disabled' : 'no-points'
                this.bot.logger.info('main', 'SEARCH-MANAGER', `Skip mobile (${reason}); closing mobile session`)
                await this.bot.browser.func.closeBrowser(mobileSession.context, accountEmail)
                mobileContextClosed = true
                this.bot.logger.info('main', 'SEARCH-MANAGER', 'Mobile session closed (no mobile search)')
            }

            const runDesktop = this.policyDesktopSession(shouldDoDesktop)

            if (runDesktop) {
                this.bot.logger.info('main', 'SEARCH-MANAGER', 'Desktop login start')
                desktopSession = await executionContext.run({ isMobile: false, account }, async () =>
                    this.createDesktopSession(account, accountEmail)
                )
                this.bot.logger.info('main', 'SEARCH-MANAGER', 'Desktop login done')
            } else {
                this.bot.logger.info(
                    'main',
                    'SEARCH-MANAGER',
                    `Skip desktop login (search=${shouldDoDesktop}, star=${this.bot.config.workers.doStarSearch}, modern=${needModernTasks})`
                )
            }

            if (runDesktop && desktopSession) {
                if (shouldDoDesktop) {
                    this.bot.logger.debug(
                        'main',
                        'SEARCH-MANAGER',
                        `Schedule desktop | target=${missingSearchPoints.desktopPoints}`
                    )
                    searchTypes.push('Desktop')
                    promises.push(
                        this.executeDesktopWork(account, accountEmail, {
                            data,
                            missingSearchPoints,
                            desktopSearch: true,
                            modern: needModernTasks,
                            star: this.bot.config.workers.doStarSearch,
                            session: desktopSession,
                            closeSession: true,
                            executionContext,
                            logTag: 'SEARCH-DESKTOP-PARALLEL'
                        }).then(points => {
                            this.bot.logger.info('main', 'SEARCH-MANAGER', `Desktop done | earned=${points}`)
                            return points
                        })
                    )
                } else {
                    promises.push(
                        this.executeDesktopWork(account, accountEmail, {
                            data,
                            missingSearchPoints,
                            desktopSearch: false,
                            modern: needModernTasks,
                            star: this.bot.config.workers.doStarSearch,
                            session: desktopSession,
                            closeSession: true,
                            executionContext,
                            logTag: 'SEARCH-DESKTOP-PARALLEL'
                        })
                    )
                }
            }

            this.bot.logger.info('main', 'SEARCH-MANAGER', `Running parallel: ${searchTypes.join(' + ') || 'none'}`)

            const results = await Promise.all(promises)

            const mobilePoints = shouldDoMobile ? (results[0] ?? 0) : 0
            const desktopPoints = shouldDoDesktop ? (results[shouldDoMobile ? 1 : 0] ?? 0) : 0

            this.bot.logger.info(
                'main',
                'SEARCH-MANAGER',
                `Parallel summary | mobile=${mobilePoints} | desktop=${desktopPoints} | total=${
                    mobilePoints + desktopPoints
                }`
            )

            return { mobilePoints, desktopPoints }
        } catch (error) {
            this.bot.logger.error('main', 'SEARCH-MANAGER', `Parallel failed: ${errMsg(error)}`)
            if (error instanceof Error && error.stack) {
                this.bot.logger.debug('main', 'SEARCH-MANAGER', `Parallel stack: ${error.stack}`)
            }
            throw error
        } finally {
            if (!mobileContextClosed && mobileSession) {
                this.bot.logger.info('main', 'SEARCH-MANAGER', 'Cleanup: closing mobile session')
                try {
                    await executionContext.run({ isMobile: true, account }, async () => {
                        await this.bot.browser.func.closeBrowser(mobileSession.context, accountEmail)
                    })
                    this.bot.logger.info('main', 'SEARCH-MANAGER', 'Cleanup: mobile session closed')
                } catch (error) {
                    this.bot.logger.warn('main', 'SEARCH-MANAGER', `Cleanup: mobile close failed: ${errMsg(error)}`)
                }
            }
        }
    }

    private async doSequentialSearches(
        data: DashboardData,
        missingSearchPoints: MissingSearchPoints,
        mobileSession: BrowserSession,
        account: Account,
        accountEmail: string,
        executionContext: any
    ): Promise<SearchResults> {
        this.bot.logger.info('main', 'SEARCH-MANAGER', 'Sequential start')

        const shouldDoMobile = this.bot.config.workers.doMobileSearch && missingSearchPoints.mobilePoints > 0
        const shouldDoDesktop = this.bot.config.workers.doDesktopSearch && missingSearchPoints.desktopPoints > 0
        const needModernTasks = this.policyModernTasks()
        const needDesktopSession = this.policyDesktopSession(shouldDoDesktop)

        let mobilePoints = 0
        let desktopPoints = 0

        if (shouldDoMobile) {
            this.bot.logger.info('main', 'SEARCH-MANAGER', 'Step 1: mobile')
            mobilePoints = await this.doMobileSearch(
                data,
                missingSearchPoints,
                mobileSession,
                account,
                accountEmail,
                executionContext
            )
            this.bot.logger.info('main', 'SEARCH-MANAGER', `Step 1: mobile done | earned=${mobilePoints}`)
        } else {
            const reason = !this.bot.config.workers.doMobileSearch ? 'disabled' : 'no-points'
            this.bot.logger.info('main', 'SEARCH-MANAGER', `Step 1: skip mobile (${reason}); closing mobile session`)
            try {
                await executionContext.run({ isMobile: true, account }, async () => {
                    await this.bot.browser.func.closeBrowser(mobileSession.context, accountEmail)
                })
                this.bot.logger.info('main', 'SEARCH-MANAGER', 'Unused mobile session closed')
            } catch (error) {
                this.bot.logger.warn('main', 'SEARCH-MANAGER', `Unused mobile close failed: ${errMsg(error)}`)
            }
        }

        if (needDesktopSession) {
            this.bot.logger.info('main', 'SEARCH-MANAGER', 'Step 2: desktop')
            desktopPoints = await this.executeDesktopWork(account, accountEmail, {
                data,
                missingSearchPoints,
                desktopSearch: shouldDoDesktop,
                modern: needModernTasks,
                star: this.bot.config.workers.doStarSearch,
                createSession: true,
                closeSession: true,
                executionContext,
                logTag: 'SEARCH-DESKTOP-SEQUENTIAL'
            })
            this.bot.logger.info('main', 'SEARCH-MANAGER', `Step 2: desktop done | earned=${desktopPoints}`)
        } else {
            this.bot.logger.info('main', 'SEARCH-MANAGER', 'Step 2: skip desktop (no search, star, or modern tasks)')
        }

        this.bot.logger.info(
            'main',
            'SEARCH-MANAGER',
            `Sequential summary | mobile=${mobilePoints} | desktop=${desktopPoints} | total=${
                mobilePoints + desktopPoints
            }`
        )

        return { mobilePoints, desktopPoints }
    }

    private async createDesktopSession(account: Account, accountEmail: string): Promise<BrowserSession> {
        this.bot.logger.info('main', 'SEARCH-DESKTOP-LOGIN', 'Init desktop session')

        const session = await this.bot['browserFactory'].createBrowser(account)
        this.bot.desktopFingerprint = session.fingerprint

        return await this.runWithDesktopFingerprint(session, async () => {
            this.bot.mainDesktopPage = await session.context.newPage()

            this.bot.logger.info('main', 'SEARCH-DESKTOP-LOGIN', `Browser ready | account=${accountEmail}`)

            await this.bot.mainDesktopPage.goto('https://www.bing.com', { waitUntil: 'domcontentloaded' }).catch(() => {})
            await this.bot.utils.wait(2000)

            const profileVisible = await this.bot.mainDesktopPage
                .locator('#id_n')
                .isVisible()
                .catch(() => false)

            if (profileVisible) {
                this.bot.logger.info(
                    'main',
                    'SEARCH-DESKTOP-LOGIN',
                    'Desktop session reused from saved cookies, skipping login'
                )
            } else {
                this.bot.logger.info('main', 'SEARCH-DESKTOP-LOGIN', 'Login start')
                await this.bot['login'].login(this.bot.mainDesktopPage, account)
            }

            await this.bot['login'].verifyBingSession(this.bot.mainDesktopPage)
            this.bot.cookies.desktop = await session.context.cookies()
            this.bot.logger.info('main', 'SEARCH-DESKTOP-LOGIN', 'Desktop session ready')

            return session
        })
    }

    private async runStarSearchIfEnabled(account: Account, accountEmail: string): Promise<void> {
        if (!this.bot.config.workers.doStarSearch) {
            return
        }

        try {
            this.bot.logger.info('main', 'STAR-SEARCH', `Starting Star Search | account=${accountEmail}`, 'magenta')
            await this.bot.activities.doStarSearch(this.bot.mainDesktopPage, false, account)
        } catch (error) {
            this.bot.logger.warn('main', 'STAR-SEARCH', `Star Search failed: ${errMsg(error)}`)
        }
    }

    private async runModernUITasks(data: DashboardData): Promise<void> {
        try {
            this.bot.logger.info('main', 'MODERN-UI-DESKTOP', 'Running Modern UI tasks on desktop browser')

            const modernWorkers = new ModernUIWorkers(this.bot)

            if (this.bot.config.workers.doDailySet) {
                await modernWorkers.doDailySet(this.bot.mainDesktopPage)
            }

            if (this.bot.config.workers.doMorePromotions) {
                await modernWorkers.doKeepEarning(this.bot.mainDesktopPage)
            }

            if (this.bot.config.workers.doMissions) {
                await modernWorkers.doMissions(this.bot.mainDesktopPage)
            }

            if (this.bot.config.workers.doClaimPoints) {
                const claimResult = await modernWorkers.doClaimPoints(this.bot.mainDesktopPage)
                if (claimResult.claimed) {
                    this.bot.logger.info(
                        'main',
                        'MODERN-CLAIM',
                        `✔ Claimed ${claimResult.points} points`,
                        'green'
                    )
                    this.bot.userData.claimedPoints = (this.bot.userData.claimedPoints || 0) + claimResult.points
                }
            }

            this.bot.logger.info('main', 'MODERN-UI-DESKTOP', 'Modern UI tasks completed')
        } catch (error) {
            this.bot.logger.error('main', 'MODERN-UI-DESKTOP', `Error: ${errMsg(error)}`)
        }
    }

    private async doMobileSearch(
        data: DashboardData,
        missingSearchPoints: MissingSearchPoints,
        mobileSession: BrowserSession,
        account: Account,
        accountEmail: string,
        executionContext: any
    ): Promise<number> {
        return await executionContext.run({ isMobile: true, account }, async () => {
            try {
                if (!this.bot.config.workers.doMobileSearch || missingSearchPoints.mobilePoints === 0) {
                    return 0
                }

                this.bot.logger.info(
                    'main',
                    'SEARCH-MOBILE-SEARCH',
                    `Search start | target=${missingSearchPoints.mobilePoints}`
                )

                const pointsEarned = await this.bot.activities.doSearch(data, this.bot.mainMobilePage, true)

                this.bot.logger.info(
                    'main',
                    'SEARCH-MOBILE-SEARCH',
                    `Search done | earned=${pointsEarned}/${missingSearchPoints.mobilePoints}`
                )

                return pointsEarned
            } catch (error) {
                this.bot.logger.error('main', 'SEARCH-MOBILE-SEARCH', `Failed: ${errMsg(error)}`)
                return 0
            } finally {
                try {
                    await this.bot.browser.func.closeBrowser(mobileSession.context, accountEmail)
                    this.bot.logger.info('main', 'SEARCH-MOBILE-SEARCH', 'Mobile browser closed')
                } catch (error) {
                    this.bot.logger.warn('main', 'SEARCH-MOBILE-SEARCH', `Close failed: ${errMsg(error)}`)
                }
            }
        })
    }
}
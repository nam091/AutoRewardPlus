import type { AxiosRequestConfig } from 'axios'

import type { BasePromotion } from '../../../interface/DashboardData'

import { Workers } from '../../Workers'
import { errMsg } from '../../../util/Utils'

export class UrlReward extends Workers {
    private cookieHeader: string = ''

    private fingerprintHeader: { [x: string]: string } = {}

    private gainedPoints: number = 0

    private oldBalance: number = this.bot.userData.currentPoints

    /**
     * Fetch a fresh __RequestVerificationToken from the desktop dashboard.
     * Desktop cookies are required because the token must match the session.
     */
    private async fetchDesktopRequestToken(): Promise<string> {
        try {
            const request: AxiosRequestConfig = {
                url: 'https://rewards.bing.com/',
                method: 'GET',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.cookieHeader,
                    Referer: 'https://rewards.bing.com/'
                }
            }

            const response = await this.bot.axios.request(request)
            const html: string = response.data ?? ''

            // Try input[name="__RequestVerificationToken"] first
            const inputMatch = html.match(/<input[^>]*name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i)
            if (inputMatch?.[1]) {
                this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', 'Extracted request token from desktop dashboard (input)')
                return inputMatch[1]
            }

            // Fallback: meta[name="__RequestVerificationToken"]
            const metaMatch = html.match(/<meta[^>]*name=["']__RequestVerificationToken["'][^>]*content=["']([^"']+)["']/i)
            if (metaMatch?.[1]) {
                this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', 'Extracted request token from desktop dashboard (meta)')
                return metaMatch[1]
            }

            this.bot.logger.warn(this.bot.isMobile, 'URL-REWARD', 'Could not extract request token from desktop dashboard')
            return ''
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'URL-REWARD', `Failed to fetch desktop request token: ${errMsg(error)}`)
            return ''
        }
    }

    public async doUrlReward(promotion: BasePromotion) {
        const offerId = promotion.offerId

        this.bot.logger.info(
            this.bot.isMobile,
            'URL-REWARD',
            `Starting UrlReward | offerId=${offerId} | geo=${this.bot.userData.geoLocale} | oldBalance=${this.oldBalance}`
        )

        try {
            // Always use desktop cookies for UrlReward API — mobile cookies cause HTTP 400
            this.cookieHeader = this.bot.browser.func.buildCookieHeader(
                this.bot.cookies.desktop,
                ['bing.com', 'live.com', 'microsoftonline.com']
            )

            if (!this.cookieHeader) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'URL-REWARD',
                    'Skipping: No desktop cookies available'
                )
                return
            }

            // Fetch a fresh request token that matches the desktop session
            // The current this.bot.requestToken may be from mobile context → causes 401
            const requestToken = await this.fetchDesktopRequestToken()

            if (!requestToken && this.bot.rewardsVersion === 'legacy') {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'URL-REWARD',
                    'Skipping: Could not obtain desktop request token'
                )
                return
            }

            const fingerprintHeaders = { ...this.bot.fingerprint.headers }
            delete fingerprintHeaders['Cookie']
            delete fingerprintHeaders['cookie']
            this.fingerprintHeader = fingerprintHeaders

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Prepared UrlReward headers | offerId=${offerId} | cookieLength=${this.cookieHeader.length} | hasToken=${!!requestToken}`
            )

            const formData = new URLSearchParams({
                id: offerId,
                hash: promotion.hash,
                timeZone: '60',
                activityAmount: '1',
                dbs: '0',
                form: '',
                type: '',
                __RequestVerificationToken: requestToken || this.bot.requestToken
            })

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Prepared UrlReward form data | offerId=${offerId} | hash=${promotion.hash} | timeZone=60 | activityAmount=1`
            )

            const request: AxiosRequestConfig = {
                url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
                method: 'POST',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.cookieHeader,
                    Referer: 'https://rewards.bing.com/',
                    Origin: 'https://rewards.bing.com'
                },
                data: formData
            }

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Sending UrlReward request | offerId=${offerId} | url=${request.url}`
            )

            const response = await this.bot.axios.request(request)

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Received UrlReward response | offerId=${offerId} | status=${response.status}`
            )

            const newBalance = await this.bot.browser.func.getCurrentPoints()
            this.gainedPoints = newBalance - this.oldBalance

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Balance delta after UrlReward | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance} | gainedPoints=${this.gainedPoints}`
            )

            if (this.gainedPoints > 0) {
                this.bot.userData.currentPoints = newBalance
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + this.gainedPoints

                this.bot.logger.info(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `Completed UrlReward | offerId=${offerId} | status=${response.status} | gainedPoints=${this.gainedPoints} | newBalance=${newBalance}`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `Failed UrlReward with no points | offerId=${offerId} | status=${response.status} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`
                )
            }

            this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Waiting after UrlReward | offerId=${offerId}`)

            await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'URL-REWARD',
                `Error in doUrlReward | offerId=${promotion.offerId} | message=${errMsg(error)}`
            )
        }
    }
}

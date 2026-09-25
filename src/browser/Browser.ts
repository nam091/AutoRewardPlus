import net from 'net'
import { chromium as patchrightChromium, type BrowserContext } from 'patchright'
import { chromium, type Browser as PlaywrightBrowser } from 'playwright-core'

import { FingerprintInjector } from 'fingerprint-injector'

import { BrowserFingerprintWithHeaders, FingerprintGenerator } from 'fingerprint-generator'

import type { MicrosoftRewardsBot } from '../index'

import { loadSessionData, saveFingerprintData } from '../util/Load'

import { UserAgentManager } from './UserAgent'
import { AntiDetectionEngine } from './humanize/AntiDetectionEngine'
import { HumanizeEngine } from './humanize/HumanizeEngine'
import { stableSeed } from './humanize/SeededRandom'

import type { Account, AccountProxy } from '../interface/Account'
import { errMsg } from '../util/Utils'

/* Test Stuff
https://abrahamjuliot.github.io/creepjs/
https://botcheck.luminati.io/
https://fv.pro/
https://pixelscan.net/
https://www.browserscan.net/
*/

interface BrowserCreationResult {
    context: BrowserContext
    fingerprint: BrowserFingerprintWithHeaders
}

class Browser {
    private readonly bot: MicrosoftRewardsBot
    private static readonly BROWSER_ARGS = [
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-web-authentication-ui',
        '--disable-external-intent-requests',
        '--disable-blink-features=Attestation',
        '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys,WebAuthenticationProxy,U2F',
        '--disable-save-password-bubble'
    ] as const

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async createBrowser(account: Account): Promise<BrowserCreationResult> {
        let browser: PlaywrightBrowser
        const hasProxy = Boolean(account.proxy.url)
        const ignoreCertificateErrors = hasProxy && Boolean(this.bot.config.proxy.ignoreCertificateErrors)
        const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0
        const sandboxArgs = runningAsRoot ? ['--no-sandbox', '--disable-setuid-sandbox'] : []
        const certArgs = ignoreCertificateErrors
            ? ['--ignore-certificate-errors', '--ignore-certificate-errors-spki-list', '--ignore-ssl-errors']
            : []

        if (hasProxy) {
            const isReachable = await this.checkProxyReachable(account.proxy)
            if (!isReachable) {
                const proxyStr = `${account.proxy.url}:${account.proxy.port}`
                this.bot.logger.error(
                    this.bot.isMobile,
                    'BROWSER-PROXY',
                    `[PROXY-OFFLINE] Máy chủ proxy ${proxyStr} không phản hồi! Tạm dừng phiên chạy để bảo vệ tài khoản.`
                )
                throw new Error(`[PROXY-OFFLINE] Proxy ${proxyStr} is unreachable`)
            }
        }
        try {
            const proxyConfig = account.proxy.url
                ? {
                      server: this.formatProxyServer(account.proxy),
                      ...(account.proxy.username &&
                          account.proxy.password && {
                              username: account.proxy.username,
                              password: account.proxy.password
                          })
                  }
                : undefined

            browser = await chromium.launch({
                executablePath: patchrightChromium.executablePath(),
                headless: this.bot.config.headless,
                ...(proxyConfig && { proxy: proxyConfig }),
                args: [...Browser.BROWSER_ARGS, ...sandboxArgs, ...certArgs]
            })
        } catch (error) {
            const errorMessage = errMsg(error)
            this.bot.logger.error(this.bot.isMobile, 'BROWSER', `Launch failed: ${errorMessage}`)
            throw error
        }

        try {
            const sessionData = await loadSessionData(
                this.bot.config.sessionPath,
                account.email,
                account.saveFingerprint,
                this.bot.isMobile
            )

            const fingerprint = sessionData.fingerprint ?? (await this.generateFingerprint(this.bot.isMobile))

            const injector = new FingerprintInjector()
            const injectableHeaders = { ...fingerprint.headers }
            for (const header of [
                'accept-encoding',
                'accept',
                'cache-control',
                'pragma',
                'sec-fetch-dest',
                'sec-fetch-mode',
                'sec-fetch-site',
                'sec-fetch-user',
                'upgrade-insecure-requests',
                'te'
            ]) {
                delete injectableHeaders[header]
            }
            const geo = (account.geoLocale || 'vn').toLowerCase()
            const timezoneMap: Record<string, string> = {
                vn: 'Asia/Ho_Chi_Minh',
                us: 'America/New_York',
                jp: 'Asia/Tokyo',
                de: 'Europe/Berlin',
                gb: 'Europe/London'
            }
            const timezoneId = timezoneMap[geo] || 'Asia/Ho_Chi_Minh'
            const locale = geo === 'vn' ? 'vi-VN' : 'en-US'

            injectableHeaders['accept-language'] =
                geo === 'vn'
                    ? 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
                    : 'en-US,en;q=0.9'

            const context = await browser.newContext({
                userAgent: fingerprint.fingerprint.navigator.userAgent,
                colorScheme: 'dark',
                timezoneId,
                locale,
                viewport: {
                    width: fingerprint.fingerprint.screen.width,
                    height: fingerprint.fingerprint.screen.height
                },
                deviceScaleFactor: fingerprint.fingerprint.screen.devicePixelRatio,
                isMobile: this.bot.isMobile,
                hasTouch: this.bot.isMobile,
                permissions: [],
                ignoreHTTPSErrors: ignoreCertificateErrors,
                extraHTTPHeaders: injectableHeaders
            })

            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                })
            })

            // Apply anti-detection patches
            const antiDetectionProfile = {
                seed: stableSeed(
                    account.email.toLowerCase(),
                    this.bot.isMobile,
                    fingerprint.fingerprint.navigator.userAgent
                ),
                isMobile: this.bot.isMobile
            }
            const fingerprintScript = injector.getInjectableScript(fingerprint)
            await AntiDetectionEngine.applyAll(context, antiDetectionProfile, fingerprintScript)

            // Bind mouse paths, typing rhythm and dwell times to the same
            // account/device/day seed the fingerprint uses, so behavior stays
            // internally consistent across a run rather than freshly random.
            HumanizeEngine.configureSeed(
                account.email.toLowerCase(),
                this.bot.isMobile,
                new Date().toISOString().slice(0, 10)
            )
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER', 'Anti-detection patches applied')

            context.setDefaultTimeout(this.bot.utils.stringToNumber(this.bot.config?.globalTimeout ?? 30000))

            await context.addCookies(sessionData.cookies)

            if (
                (account.saveFingerprint.mobile && this.bot.isMobile) ||
                (account.saveFingerprint.desktop && !this.bot.isMobile)
            ) {
                await saveFingerprintData(this.bot.config.sessionPath, account.email, this.bot.isMobile, fingerprint)
            }

            this.bot.logger.info(
                this.bot.isMobile,
                'BROWSER',
                `Created browser with User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`
            )
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FINGERPRINT', JSON.stringify(fingerprint))
            this.bot.logger.info(
                this.bot.isMobile,
                'BROWSER',
                'Enhanced anti-detection active (canvas, WebGL, audio noise)'
            )

            return { context: context as unknown as BrowserContext, fingerprint }
        } catch (error) {
            await browser.close().catch(() => {})
            throw error
        }
    }

    private async checkProxyReachable(proxy: AccountProxy, timeoutMs = 3500): Promise<boolean> {
        return new Promise(resolve => {
            try {
                let host = proxy.url
                let port = proxy.port
                if (proxy.url.includes('://')) {
                    const u = new URL(proxy.url)
                    host = u.hostname
                    port = parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10) || proxy.port
                }
                const socket = net.createConnection({ host, port: proxy.port || port, timeout: timeoutMs }, () => {
                    socket.destroy()
                    resolve(true)
                })
                socket.on('timeout', () => {
                    socket.destroy()
                    resolve(false)
                })
                socket.on('error', () => {
                    socket.destroy()
                    resolve(false)
                })
            } catch {
                resolve(false)
            }
        })
    }

    private formatProxyServer(proxy: AccountProxy): string {
        try {
            const urlObj = new URL(proxy.url)
            const protocol = urlObj.protocol.replace(':', '')
            return `${protocol}://${urlObj.hostname}:${proxy.port}`
        } catch {
            return `${proxy.url}:${proxy.port}`
        }
    }

    async generateFingerprint(isMobile: boolean) {
        const fingerPrintData = new FingerprintGenerator().getFingerprint({
            devices: isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'linux'],
            browsers: [{ name: 'edge' }]
        })

        const userAgentManager = new UserAgentManager(this.bot)
        const updatedFingerPrintData = await userAgentManager.updateFingerprintUserAgent(fingerPrintData, isMobile)

        return updatedFingerPrintData
    }
}

export default Browser

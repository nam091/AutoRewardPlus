import type { Cookie } from 'patchright'
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'
import fs from 'fs'
import path from 'path'

import type { Account, ConfigSaveFingerprint } from '../interface/Account'
import type { Config } from '../interface/Config'
import { validateAccounts, validateConfig } from './Validator'

let configCache: Config

export function loadAccounts(): Account[] {
    try {
        let file = 'accounts.json'

        if (process.argv.includes('-dev')) {
            file = 'accounts.dev.json'
        }

        const accountDir = path.join(__dirname, '../', file)
        const accounts = fs.readFileSync(accountDir, 'utf-8')
        const accountsData = JSON.parse(accounts)

        const validated = validateAccounts(accountsData)
        const defaultProxyUrl = process.env.DEFAULT_PROXY_URL?.trim()
        const defaultProxyPort = process.env.DEFAULT_PROXY_PORT ? parseInt(process.env.DEFAULT_PROXY_PORT, 10) : 0
        if (defaultProxyUrl) {
            for (const acc of validated) {
                if (!acc.proxy?.url) {
                    acc.proxy = {
                        url: defaultProxyUrl,
                        port: defaultProxyPort,
                        username: process.env.DEFAULT_PROXY_USERNAME || '',
                        password: process.env.DEFAULT_PROXY_PASSWORD || '',
                        proxyAxios: true
                    }
                }
            }
        }
        return validated
    } catch (error) {
        throw new Error(error as string)
    }
}

export function loadConfig(): Config {
    try {
        if (configCache) {
            return configCache
        }

        const configDir = path.join(__dirname, '../', 'config.json')
        const config = fs.readFileSync(configDir, 'utf-8')

        const configData = JSON.parse(config)
        configCache = validateConfig(configData)

        return configCache
    } catch (error) {
        throw new Error(error as string)
    }
}

function resolveSessionFile(sessionPath: string, email: string, fileName: string): string {
    const candidates = [
        path.join(__dirname, '../browser/', sessionPath, email, fileName),
        path.resolve('dist/browser', sessionPath, email, fileName),
        path.resolve('src/browser', sessionPath, email, fileName),
        path.resolve(sessionPath, email, fileName)
    ]
    for (const cand of candidates) {
        if (fs.existsSync(cand)) return cand
    }
    return candidates[0]!
}

export async function loadSessionData(
    sessionPath: string,
    email: string,
    saveFingerprint: ConfigSaveFingerprint,
    isMobile: boolean
) {
    try {
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json'
        const cookieFile = resolveSessionFile(sessionPath, email, cookiesFileName)

        let cookies: Cookie[] = []
        if (fs.existsSync(cookieFile)) {
            const cookiesData = await fs.promises.readFile(cookieFile, 'utf-8')
            cookies = JSON.parse(cookiesData)
        }

        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json'
        const fingerprintFile = resolveSessionFile(sessionPath, email, fingerprintFileName)

        let fingerprint!: BrowserFingerprintWithHeaders
        const shouldLoadFingerprint = isMobile ? saveFingerprint.mobile : saveFingerprint.desktop
        if (shouldLoadFingerprint && fs.existsSync(fingerprintFile)) {
            const fingerprintData = await fs.promises.readFile(fingerprintFile, 'utf-8')
            fingerprint = JSON.parse(fingerprintData)
        }

        return {
            cookies: cookies,
            fingerprint: fingerprint
        }
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function saveSessionData(
    sessionPath: string,
    cookies: Cookie[],
    email: string,
    isMobile: boolean
): Promise<string> {
    try {
        const sessionDirs = [
            path.resolve(sessionPath, email),
            path.resolve('src/browser', sessionPath, email),
            path.join(__dirname, '../browser/', sessionPath, email),
            path.resolve('dist/browser', sessionPath, email)
        ]
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json'

        for (const dir of sessionDirs) {
            try {
                if (!fs.existsSync(dir)) {
                    await fs.promises.mkdir(dir, { recursive: true })
                }
                await fs.promises.writeFile(path.join(dir, cookiesFileName), JSON.stringify(cookies, null, 2))
            } catch {
                // Ignore failure for individual directory path
            }
        }

        return sessionDirs[0]!
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function saveFingerprintData(
    sessionPath: string,
    email: string,
    isMobile: boolean,
    fingerpint: BrowserFingerprintWithHeaders
): Promise<string> {
    try {
        const sessionDirs = [
            path.resolve(sessionPath, email),
            path.resolve('src/browser', sessionPath, email),
            path.join(__dirname, '../browser/', sessionPath, email),
            path.resolve('dist/browser', sessionPath, email)
        ]
        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json'

        for (const dir of sessionDirs) {
            try {
                if (!fs.existsSync(dir)) {
                    await fs.promises.mkdir(dir, { recursive: true })
                }
                await fs.promises.writeFile(path.join(dir, fingerprintFileName), JSON.stringify(fingerpint, null, 2))
            } catch {
                // Ignore failure for individual directory path
            }
        }

        return sessionDirs[0]!
    } catch (error) {
        throw new Error(error as string)
    }
}


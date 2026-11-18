import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface DashboardSettings {
    defaultProxyUrl: string
    defaultProxyPort: number
    defaultProxyUsername: string
    defaultProxyPassword: string
    maxConcurrentSingleRuns: number
    autoRefreshSec: number
    proxyHealthTimeoutMs: number
    updatedAt: string | null
}

export interface RedactedDashboardSettings extends DashboardSettings {
    hasDefaultProxyPassword: boolean
}

const DEFAULT_SETTINGS_FILE = path.resolve('src/dashboard/settings.json')

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function normalizeProxyUrl(raw: unknown): string {
    if (typeof raw !== 'string') return ''
    const trimmed = raw.trim()
    if (!trimmed) return ''
    const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`
    const parsed = new URL(candidate)
    if (!['http:', 'https:', 'socks5:', 'socks4:', 'socks:'].includes(parsed.protocol)) {
        throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`)
    }
    return `${parsed.protocol}//${parsed.hostname}${parsed.port && !trimmed.includes('://') ? '' : parsed.port ? `:${parsed.port}` : ''}`
}

export class SettingsService {
    private readonly filePath: string

    constructor(filePath = process.env.DASHBOARD_SETTINGS_PATH?.trim() || DEFAULT_SETTINGS_FILE) {
        this.filePath = path.resolve(filePath)
    }

    getRaw(): DashboardSettings {
        const envUrl = process.env.DEFAULT_PROXY_URL?.trim() || ''
        const envPort = clampInt(process.env.DEFAULT_PROXY_PORT, envUrl ? 10808 : 0, 0, 65535)
        const envUser = process.env.DEFAULT_PROXY_USERNAME?.trim() || ''
        const envPass = process.env.DEFAULT_PROXY_PASSWORD || ''

        const defaults: DashboardSettings = {
            defaultProxyUrl: envUrl,
            defaultProxyPort: envPort,
            defaultProxyUsername: envUser,
            defaultProxyPassword: envPass,
            maxConcurrentSingleRuns: 2,
            autoRefreshSec: 8,
            proxyHealthTimeoutMs: 4000,
            updatedAt: null
        }

        if (!existsSync(this.filePath)) {
            return defaults
        }

        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<DashboardSettings>
            return {
                defaultProxyUrl:
                    typeof parsed.defaultProxyUrl === 'string' ? parsed.defaultProxyUrl : defaults.defaultProxyUrl,
                defaultProxyPort: clampInt(parsed.defaultProxyPort, defaults.defaultProxyPort, 0, 65535),
                defaultProxyUsername:
                    typeof parsed.defaultProxyUsername === 'string'
                        ? parsed.defaultProxyUsername
                        : defaults.defaultProxyUsername,
                defaultProxyPassword:
                    typeof parsed.defaultProxyPassword === 'string'
                        ? parsed.defaultProxyPassword
                        : defaults.defaultProxyPassword,
                maxConcurrentSingleRuns: clampInt(parsed.maxConcurrentSingleRuns, 2, 1, 2),
                autoRefreshSec: clampInt(parsed.autoRefreshSec, 8, 3, 120),
                proxyHealthTimeoutMs: clampInt(parsed.proxyHealthTimeoutMs, 4000, 1000, 15000),
                updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
            }
        } catch {
            return defaults
        }
    }

    get(): RedactedDashboardSettings {
        const raw = this.getRaw()
        return {
            ...raw,
            defaultProxyPassword: raw.defaultProxyPassword ? '[REDACTED]' : '',
            hasDefaultProxyPassword: Boolean(raw.defaultProxyPassword)
        }
    }

    async write(input: Partial<DashboardSettings> & { clearProxyPassword?: boolean }): Promise<RedactedDashboardSettings> {
        const current = this.getRaw()

        let nextProxyUrl = current.defaultProxyUrl
        if (input.defaultProxyUrl !== undefined) {
            nextProxyUrl = normalizeProxyUrl(input.defaultProxyUrl)
        }

        let nextPort =
            input.defaultProxyPort !== undefined
                ? clampInt(input.defaultProxyPort, current.defaultProxyPort, 0, 65535)
                : current.defaultProxyPort

        if (nextProxyUrl) {
            try {
                const parsed = new URL(nextProxyUrl)
                if (parsed.port && !input.defaultProxyPort) {
                    nextPort = clampInt(parsed.port, nextPort || 10808, 1, 65535)
                }
                nextProxyUrl = `${parsed.protocol}//${parsed.hostname}`
            } catch {
                // Keep validated URL
            }
            if (nextPort <= 0) {
                throw new Error('Proxy port must be between 1 and 65535 when Proxy URL is set.')
            }
        } else if (input.defaultProxyUrl !== undefined) {
            nextPort = 0
        }

        let nextPassword = current.defaultProxyPassword
        if (input.clearProxyPassword) {
            nextPassword = ''
        } else if (
            typeof input.defaultProxyPassword === 'string' &&
            input.defaultProxyPassword !== '[REDACTED]' &&
            input.defaultProxyPassword !== ''
        ) {
            nextPassword = input.defaultProxyPassword
        }

        const next: DashboardSettings = {
            defaultProxyUrl: nextProxyUrl,
            defaultProxyPort: nextPort,
            defaultProxyUsername:
                typeof input.defaultProxyUsername === 'string'
                    ? input.defaultProxyUsername.trim()
                    : current.defaultProxyUsername,
            defaultProxyPassword: nextPassword,
            maxConcurrentSingleRuns: clampInt(
                input.maxConcurrentSingleRuns,
                current.maxConcurrentSingleRuns,
                1,
                2
            ),
            autoRefreshSec: clampInt(input.autoRefreshSec, current.autoRefreshSec, 3, 120),
            proxyHealthTimeoutMs: clampInt(input.proxyHealthTimeoutMs, current.proxyHealthTimeoutMs, 1000, 15000),
            updatedAt: new Date().toISOString()
        }

        await fs.mkdir(path.dirname(this.filePath), { recursive: true })
        const tempPath = `${this.filePath}.${process.pid}.tmp`
        await fs.writeFile(tempPath, `${JSON.stringify(next, null, 4)}\n`, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(tempPath, this.filePath)

        return this.get()
    }

    buildChildEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
        const raw = this.getRaw()
        return {
            ...baseEnv,
            DEFAULT_PROXY_URL: raw.defaultProxyUrl,
            DEFAULT_PROXY_PORT: String(raw.defaultProxyPort || 0),
            DEFAULT_PROXY_USERNAME: raw.defaultProxyUsername,
            DEFAULT_PROXY_PASSWORD: raw.defaultProxyPassword
        }
    }
}

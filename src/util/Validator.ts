import { z } from 'zod'
import semver from 'semver'
import ms, { StringValue } from 'ms'
import pkg from '../../package.json'

import { Config } from '../interface/Config'
import { Account } from '../interface/Account'

const Duration = z.union([
    z.number().finite().nonnegative(),
    z.string().refine(value => ms(value as StringValue) !== undefined, 'Invalid duration')
])

const LogFilterSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(['whitelist', 'blacklist']),
    levels: z.array(z.enum(['debug', 'info', 'warn', 'error'])).optional(),
    keywords: z.array(z.string()).optional(),
    regexPatterns: z.array(z.string()).optional()
})

const DelaySchema = z
    .object({
        min: Duration,
        max: Duration
    })
    .refine(
        ({ min, max }) => {
            const toMs = (value: number | string) => (typeof value === 'number' ? value : ms(value as StringValue)!)
            return toMs(min) <= toMs(max)
        },
        { message: 'Minimum delay must not exceed maximum delay' }
    )

const QueryEngineSchema = z.enum(['google', 'wikipedia', 'reddit', 'local'])

// Webhook
const WebhookSchema = z.object({
    discord: z
        .object({
            enabled: z.boolean(),
            url: z.string()
        })
        .optional(),
    ntfy: z
        .object({
            enabled: z.boolean().optional(),
            url: z.string(),
            topic: z.string().optional(),
            token: z.string().optional(),
            title: z.string().optional(),
            tags: z.array(z.string()).optional(),
            priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional()
        })
        .optional(),
    webhookLogFilter: LogFilterSchema
})

// AI Config
const AIProviderSchema = z.object({
    name: z.string().min(1),
    baseUrl: z.url(),
    model: z.string().min(1),
    apiKey: z.string().default(''),
    priority: z.number().int().positive(),
    enabled: z.boolean()
})

const AISchema = z.object({
    baseUrl: z.url(),
    model: z.string(),
    apiKey: z.string().default(''),
    fallbackProviders: z.array(AIProviderSchema).optional(),
    maxRetries: z.number().int().min(1).max(10).optional(),
    retryDelayMs: z.number().int().nonnegative().optional(),
    cacheTtlMs: z.number().int().nonnegative().optional()
})

const GoogleSheetsSchema = z.object({
    enabled: z.boolean(),
    spreadsheetId: z.string(),
    sheetName: z.string().min(1),
    accountsSheetName: z.string().min(1).optional(),
    keyFilePath: z.string().min(1)
})

const ProfileSettingsSchema = z
    .object({
        searchDelay: DelaySchema.optional(),
        readDelay: DelaySchema.optional(),
        searchTargetRatioMin: z.number().gt(0.1).max(1.0).optional(),
        searchTargetRatioMax: z.number().gt(0.1).max(1.0).optional(),
        readArticlesMin: z.number().int().min(1).max(20).optional(),
        readArticlesMax: z.number().int().min(1).max(20).optional(),
        readFractionMin: z.number().min(0.1).max(2.0).optional(),
        readFractionMax: z.number().min(0.1).max(2.0).optional(),
        typingMultiplier: z.number().min(0.2).max(5.0).optional(),
        waitMultiplier: z.number().min(0.2).max(5.0).optional(),
        resultVisitMultiplier: z.number().min(0.2).max(5.0).optional(),
        extraSearchVerifyRounds: z.number().int().min(0).max(5).optional(),
        thoroughTasks: z.boolean().optional()
    })
    .refine(
        val =>
            val.searchTargetRatioMin === undefined ||
            val.searchTargetRatioMax === undefined ||
            val.searchTargetRatioMin <= val.searchTargetRatioMax,
        { message: 'searchTargetRatioMin must not exceed searchTargetRatioMax' }
    )
    .refine(
        val =>
            val.readArticlesMin === undefined ||
            val.readArticlesMax === undefined ||
            val.readArticlesMin <= val.readArticlesMax,
        { message: 'readArticlesMin must not exceed readArticlesMax' }
    )
    .refine(
        val =>
            val.readFractionMin === undefined ||
            val.readFractionMax === undefined ||
            val.readFractionMin <= val.readFractionMax,
        { message: 'readFractionMin must not exceed readFractionMax' }
    )

const BehaviorSchema = z.object({
    accountStartDelay: DelaySchema.default({ min: '2sec', max: '10sec' }),
    enableSessionBreaks: z.boolean().default(true),
    telemetry: z.boolean().default(true)
})

// Config
export const ConfigSchema = z.object({
    baseURL: z.url(),
    sessionPath: z.string().min(1),
    headless: z.boolean(),
    clusters: z.number().int().positive(),
    maxAccountRetries: z.number().int().min(1).max(10).optional(),
    errorDiagnostics: z.boolean(),
    workers: z.object({
        doDailySet: z.boolean(),
        doSpecialPromotions: z.boolean(),
        doMorePromotions: z.boolean(),
        doPunchCards: z.boolean(),
        doAppPromotions: z.boolean(),
        doDesktopSearch: z.boolean(),
        doMobileSearch: z.boolean(),
        doDailyCheckIn: z.boolean(),
        doReadToEarn: z.boolean(),
        doMissions: z.boolean().default(true),
        doClaimPoints: z.boolean().default(true)
    }),
    searchOnBingLocalQueries: z.boolean(),
    globalTimeout: Duration,
    searchSettings: z.object({
        scrollRandomResults: z.boolean(),
        clickRandomResults: z.boolean(),
        parallelSearching: z.boolean(),
        queryEngines: z.array(QueryEngineSchema),
        searchResultVisitTime: Duration,
        searchDelay: DelaySchema,
        readDelay: DelaySchema
    }),
    debugLogs: z.boolean(),
    proxy: z.object({
        queryEngine: z.boolean(),
        ignoreCertificateErrors: z.boolean().default(false)
    }),
    consoleLogFilter: LogFilterSchema,
    webhook: WebhookSchema,
    ai: AISchema.optional(),
    googleSheets: GoogleSheetsSchema.optional(),
    behavior: BehaviorSchema.default({
        accountStartDelay: { min: '2sec', max: '10sec' },
        enableSessionBreaks: true,
        telemetry: true
    }),
    profiles: z
        .object({
            safe: ProfileSettingsSchema.optional(),
            fast: ProfileSettingsSchema.optional()
        })
        .optional()
})

// Account
export const AccountSchema = z.object({
    email: z.string().min(1),
    password: z.string(),
    totpSecret: z.string().optional(),
    totp: z.string().optional(),
    recoveryEmail: z.string(),
    geoLocale: z.string(),
    langCode: z.string(),
    tag: z.string().optional(),
    enabled: z.boolean().optional(),
    proxy: z
        .object({
            proxyAxios: z.boolean(),
            url: z.string(),
            port: z.number().int().min(0).max(65535),
            password: z.string(),
            username: z.string()
        })
        .refine(proxy => !proxy.proxyAxios || proxy.url.length === 0 || proxy.port > 0, {
            message: 'Axios proxy with a URL requires a port between 1 and 65535'
        }),
    saveFingerprint: z.object({
        mobile: z.boolean(),
        desktop: z.boolean()
    })
})

export function validateConfig(data: unknown): Config {
    return ConfigSchema.parse(data) as Config
}

export function validateAccounts(data: unknown): Account[] {
    return z.array(AccountSchema).parse(data)
}

export function checkNodeVersion(): void {
    try {
        const requiredVersion = pkg.engines?.node

        if (!requiredVersion) {
            console.warn('No Node.js version requirement found in package.json "engines" field.')
            return
        }

        if (!semver.satisfies(process.version, requiredVersion)) {
            console.error(`Current Node.js version ${process.version} does not satisfy requirement: ${requiredVersion}`)
            process.exit(1)
        }
    } catch (error) {
        console.error('Failed to validate Node.js version:', error)
        process.exit(1)
    }
}

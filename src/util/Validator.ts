import { z } from 'zod'
import semver from 'semver'
import pkg from '../../package.json'

import { Config } from '../interface/Config'
import { Account } from '../interface/Account'

const NumberOrString = z.union([z.number(), z.string()])

const LogFilterSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(['whitelist', 'blacklist']),
    levels: z.array(z.enum(['debug', 'info', 'warn', 'error'])).optional(),
    keywords: z.array(z.string()).optional(),
    regexPatterns: z.array(z.string()).optional()
})

const DelaySchema = z.object({
    min: NumberOrString,
    max: NumberOrString
})

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
    name: z.string(),
    baseUrl: z.string(),
    model: z.string(),
    apiKey: z.string(),
    priority: z.number().int(),
    enabled: z.boolean()
})

const AISchema = z.object({
    baseUrl: z.string(),
    model: z.string(),
    apiKey: z.string(),
    fallbackProviders: z.array(AIProviderSchema).optional(),
    maxRetries: z.number().int().positive().optional(),
    retryDelayMs: z.number().int().nonnegative().optional(),
    cacheTtlMs: z.number().int().nonnegative().optional()
})

const StarSearchSettingsSchema = z.object({
    searchCount: z.number().int().min(1).max(100).default(25),
    keywordPoolSize: z.number().int().min(50).max(2000).default(700),
    minWordCount: z.number().int().min(3).max(20).default(5),
    maxWordCount: z.number().int().min(5).max(30).default(15),
    useInPrivate: z.boolean().default(true),
    popupClicksPerSearch: DelaySchema.default({ min: 1, max: 3 }),
    searchDelay: DelaySchema.default({ min: '30sec', max: '1min' })
})

// Config
export const ConfigSchema = z.object({
    baseURL: z.string(),
    sessionPath: z.string(),
    headless: z.boolean(),
    clusters: z.number().int().nonnegative(),
    maxAccountRetries: z.number().int().nonnegative().default(2),
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
        doClaimPoints: z.boolean().default(true),
        doStarSearch: z.boolean().default(true)
    }),
    searchOnBingLocalQueries: z.boolean(),
    globalTimeout: NumberOrString,
    searchSettings: z.object({
        scrollRandomResults: z.boolean(),
        clickRandomResults: z.boolean(),
        parallelSearching: z.boolean(),
        queryEngines: z.array(QueryEngineSchema),
        searchResultVisitTime: NumberOrString,
        searchDelay: DelaySchema,
        readDelay: DelaySchema
    }),
    debugLogs: z.boolean(),
    proxy: z.object({
        queryEngine: z.boolean()
    }),
    consoleLogFilter: LogFilterSchema,
    webhook: WebhookSchema,
    ai: AISchema.optional(),
    googleSheets: z
        .object({
            enabled: z.boolean(),
            spreadsheetId: z.string(),
            sheetName: z.string(),
            keyFilePath: z.string()
        })
        .optional(),
    starSearchSettings: StarSearchSettingsSchema.optional()
})

// Account
export const AccountSchema = z.object({
    email: z.string(),
    password: z.string(),
    totpSecret: z.string().optional(),
    recoveryEmail: z.string(),
    geoLocale: z.string(),
    langCode: z.string(),
    proxy: z.object({
        proxyAxios: z.boolean(),
        url: z.string(),
        port: z.number(),
        password: z.string(),
        username: z.string()
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

export interface Config {
    baseURL: string
    sessionPath: string
    headless: boolean
    clusters: number
    maxAccountRetries?: number
    errorDiagnostics: boolean
    workers: ConfigWorkers
    searchOnBingLocalQueries: boolean
    globalTimeout: number | string
    searchSettings: ConfigSearchSettings
    debugLogs: boolean
    proxy: ConfigProxy
    consoleLogFilter: LogFilter
    webhook: ConfigWebhook
    ai?: ConfigAI
    googleSheets?: ConfigGoogleSheets
    starSearchSettings?: ConfigStarSearchSettings
}

export interface ConfigStarSearchSettings {
    searchCount: number
    keywordPoolSize: number
    minWordCount: number
    maxWordCount: number
    useInPrivate: boolean
    popupClicksPerSearch: ConfigDelay
    searchDelay: ConfigDelay
}

export interface ConfigAI {
    baseUrl: string
    model: string
    apiKey: string
    fallbackProviders?: ConfigAIProvider[]
    maxRetries?: number
    retryDelayMs?: number
    cacheTtlMs?: number
}

export interface ConfigAIProvider {
    name: string
    baseUrl: string
    model: string
    apiKey: string
    priority: number
    enabled: boolean
}

export interface ConfigGoogleSheets {
    enabled: boolean
    spreadsheetId: string
    sheetName: string
    keyFilePath: string
}

export type QueryEngine = 'google' | 'wikipedia' | 'reddit' | 'local'

export interface ConfigSearchSettings {
    scrollRandomResults: boolean
    clickRandomResults: boolean
    parallelSearching: boolean
    queryEngines: QueryEngine[]
    searchResultVisitTime: number | string
    searchDelay: ConfigDelay
    readDelay: ConfigDelay
}

export interface ConfigDelay {
    min: number | string
    max: number | string
}

export interface ConfigProxy {
    queryEngine: boolean
}

export interface ConfigWorkers {
    doDailySet: boolean
    doSpecialPromotions: boolean
    doMorePromotions: boolean
    doPunchCards: boolean
    doAppPromotions: boolean
    doDesktopSearch: boolean
    doMobileSearch: boolean
    doDailyCheckIn: boolean
    doReadToEarn: boolean
    doMissions: boolean
    doClaimPoints: boolean
    doStarSearch: boolean
}

// Webhooks
export interface ConfigWebhook {
    discord?: WebhookDiscordConfig
    ntfy?: WebhookNtfyConfig
    webhookLogFilter: LogFilter
}

export interface LogFilter {
    enabled: boolean
    mode: 'whitelist' | 'blacklist'
    levels?: Array<'debug' | 'info' | 'warn' | 'error'>
    keywords?: string[]
    regexPatterns?: string[]
}

export interface WebhookDiscordConfig {
    enabled: boolean
    url: string
}

export interface WebhookNtfyConfig {
    enabled?: boolean
    url: string
    topic?: string
    token?: string
    title?: string
    tags?: string[]
    priority?: 1 | 2 | 3 | 4 | 5 // 5 highest (important)
}

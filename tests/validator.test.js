const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { validateAccounts, validateConfig } = require('../dist/util/Validator')

function validConfig() {
    return {
        baseURL: 'https://rewards.bing.com',
        sessionPath: 'sessions',
        headless: true,
        clusters: 1,
        errorDiagnostics: false,
        workers: {
            doDailySet: true,
            doSpecialPromotions: true,
            doMorePromotions: true,
            doPunchCards: true,
            doAppPromotions: true,
            doDesktopSearch: true,
            doMobileSearch: true,
            doDailyCheckIn: true,
            doReadToEarn: true
        },
        searchOnBingLocalQueries: false,
        globalTimeout: '30sec',
        searchSettings: {
            scrollRandomResults: false,
            clickRandomResults: false,
            parallelSearching: true,
            queryEngines: ['local'],
            searchResultVisitTime: '10sec',
            searchDelay: { min: '10sec', max: '30sec' },
            readDelay: { min: 100, max: 200 }
        },
        debugLogs: false,
        proxy: { queryEngine: false },
        consoleLogFilter: { enabled: false, mode: 'whitelist' },
        webhook: {
            webhookLogFilter: { enabled: false, mode: 'whitelist' }
        }
    }
}

test('config validation applies worker defaults and preserves integrations', () => {
    const input = validConfig()
    input.googleSheets = {
        enabled: true,
        spreadsheetId: 'sheet-id',
        sheetName: 'Rewards',
        keyFilePath: 'service-account.json'
    }
    input.ai = {
        baseUrl: 'https://api.example.com/v1',
        model: 'model',
        apiKey: '',
        maxRetries: 4,
        retryDelayMs: 0,
        cacheTtlMs: 0,
        fallbackProviders: []
    }

    const parsed = validateConfig(input)
    assert.equal(parsed.workers.doMissions, true)
    assert.equal(parsed.workers.doClaimPoints, true)
    assert.equal(parsed.ai.maxRetries, 4)
    assert.equal(parsed.googleSheets.sheetName, 'Rewards')
})

test('config validation rejects invalid concurrency and delay ranges', () => {
    const invalidClusters = validConfig()
    invalidClusters.clusters = 0
    assert.throws(() => validateConfig(invalidClusters))

    const invalidDelay = validConfig()
    invalidDelay.searchSettings.searchDelay = { min: '2min', max: '1min' }
    assert.throws(() => validateConfig(invalidDelay))
})

test('account validation rejects incomplete enabled proxy settings', () => {
    const account = {
        email: 'account@example.com',
        password: 'secret',
        recoveryEmail: 'recovery@example.com',
        geoLocale: 'US',
        langCode: 'en',
        proxy: { proxyAxios: true, url: '', port: 0, password: '', username: '' },
        saveFingerprint: { mobile: true, desktop: true }
    }
    assert.throws(() => validateAccounts([account]))
})

test('example config is valid and contains no embedded API secret', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../src/config.example.json'), 'utf8')
    assert.doesNotMatch(raw, /sk-[a-zA-Z0-9_-]{12,}/)
    assert.doesNotThrow(() => validateConfig(JSON.parse(raw)))
})

test('example accounts remain valid when proxy is disabled with port zero', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../src/accounts.example.json'), 'utf8')
    assert.doesNotThrow(() => validateAccounts(JSON.parse(raw)))
})

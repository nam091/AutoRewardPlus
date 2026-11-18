const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
    addTag,
    calculateAccountAgeDays,
    hasTag,
    hasZeroRedemptionEvidence,
    isNewAccountAge,
    parseAccountAgeDays,
    parseOrderHistoryText,
    parseTags,
    removeTag,
    syncNewTagByAge
} = require('../dist/util/RewardUtils')
const { resolveExecutionProfile, toMs } = require('../dist/browser/humanize/ExecutionProfile')
const { SeededRandom } = require('../dist/browser/humanize/SeededRandom')
const { validateConfig } = require('../dist/util/Validator')
const {
    atomicWriteFileAsync,
    atomicWriteFileSync,
    withFileLockAsync,
    withFileLockSync
} = require('../dist/util/FileLock')
const { AccountService } = require('../dist/dashboard/accountService')
const { isAccountTagSyncMessage } = require('../dist/services/stateService')

function buildBaseConfig() {
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
            searchDelay: { min: '30sec', max: '1min' },
            readDelay: { min: '25sec', max: '50sec' }
        },
        debugLogs: false,
        proxy: { queryEngine: false },
        consoleLogFilter: { enabled: false, mode: 'whitelist' },
        webhook: {
            webhookLogFilter: { enabled: false, mode: 'whitelist' }
        }
    }
}

function makeAccount(email, extra = {}) {
    return {
        email,
        password: 'secret-password',
        recoveryEmail: 'recovery@example.com',
        geoLocale: 'vn',
        langCode: 'vi',
        proxy: { proxyAxios: true, url: '', port: 0, username: '', password: '' },
        saveFingerprint: { mobile: true, desktop: true },
        ...extra
    }
}

test('RewardUtils age parsing and new-account threshold (< 90 days)', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400 * 1000)
    const hundredDaysAgo = new Date(Date.now() - 100 * 86400 * 1000)
    const futureDate = new Date(Date.now() + 5 * 86400 * 1000)

    assert.equal(calculateAccountAgeDays(tenDaysAgo), 10)
    assert.equal(calculateAccountAgeDays(hundredDaysAgo.toISOString()), 100)
    assert.equal(calculateAccountAgeDays(futureDate), null)
    assert.equal(calculateAccountAgeDays('not-a-date'), null)
    assert.equal(calculateAccountAgeDays(undefined), null)

    assert.equal(parseAccountAgeDays('0d'), 0)
    assert.equal(parseAccountAgeDays('22d'), 22)
    assert.equal(parseAccountAgeDays('2m (65d)'), 65)
    assert.equal(parseAccountAgeDays('2.0y (731d)'), 731)
    assert.equal(parseAccountAgeDays('6m'), 180)
    assert.equal(parseAccountAgeDays('N/A'), null)
    assert.equal(parseAccountAgeDays(''), null)

    assert.equal(isNewAccountAge('22d'), true)
    assert.equal(isNewAccountAge('2m (65d)'), true)
    assert.equal(isNewAccountAge('2m (89d)'), true)
    assert.equal(isNewAccountAge('6m (205d)'), false)
    assert.equal(isNewAccountAge('2.0y (731d)'), false)
    assert.equal(isNewAccountAge('N/A'), null)
    assert.equal(isNewAccountAge(tenDaysAgo), true)
    assert.equal(isNewAccountAge(hundredDaysAgo.toISOString()), false)
})

test('RewardUtils tag manipulation and syncNewTagByAge', () => {
    assert.deepEqual(parseTags(' main , clone, MAIN , new '), ['main', 'clone', 'new'])
    assert.equal(hasTag('main, Clone', 'clone'), true)
    assert.equal(hasTag('main, clone', 'new'), false)
    assert.equal(addTag('main, clone', 'new'), 'main, clone, new')
    assert.equal(addTag('main, NEW, clone', 'new'), 'main, NEW, clone')
    assert.equal(removeTag('main, NEW, clone', 'new'), 'main, clone')

    assert.deepEqual(syncNewTagByAge('main, clone', true), { tag: 'main, clone, new', changed: true })
    assert.deepEqual(syncNewTagByAge('main, new, clone', true), { tag: 'main, new, clone', changed: false })
    assert.deepEqual(syncNewTagByAge('main, NEW, clone', false), { tag: 'main, clone', changed: true })
    assert.deepEqual(syncNewTagByAge('new', false), { tag: '', changed: true })
    assert.deepEqual(syncNewTagByAge('main, clone', null), { tag: 'main, clone', changed: false })
})

test('RewardUtils order history parsing and zero redemption evidence', () => {
    assert.equal(parseOrderHistoryText('Your orders\n19 results\nOrder no. 123'), 19)
    assert.equal(parseOrderHistoryText('Đơn hàng của bạn: 19 kết quả'), 19)
    assert.equal(parseOrderHistoryText('19 kết quả'), 19)
    assert.equal(parseOrderHistoryText('Showing 1 - 10 of 1,250'), 1250)
    assert.equal(parseOrderHistoryText('Hiển thị 1–10 của 25'), 25)
    assert.equal(parseOrderHistoryText("You haven't placed any orders yet."), 0)
    assert.equal(parseOrderHistoryText('No orders found'), 0)
    assert.equal(parseOrderHistoryText('Bạn chưa có đơn hàng nào'), 0)
    assert.equal(parseOrderHistoryText('Order no. 1111-aaaa ... Order no. 2222-bbbb'), 2)
    assert.equal(parseOrderHistoryText('Sign in to your Microsoft account'), null)
    assert.equal(parseOrderHistoryText('random unrecognized payload 404'), null)

    assert.equal(hasZeroRedemptionEvidence({ lifetimePointsRedeemed: 0, lastOrder: null }), true)
    assert.equal(hasZeroRedemptionEvidence({ lifetimePointsRedeemed: 0 }), true)
    assert.equal(hasZeroRedemptionEvidence({ lifetimePointsRedeemed: 0, lastOrder: { id: 'o1' } }), false)
    assert.equal(hasZeroRedemptionEvidence({ lifetimePointsRedeemed: 6500, lastOrder: null }), false)
    assert.equal(hasZeroRedemptionEvidence({ lastOrder: null }), false)
    assert.equal(hasZeroRedemptionEvidence(null), false)
})

test('ExecutionProfile resolves safe (with precedence), standard, fast, and Validator overrides', () => {
    const rawCfg = buildBaseConfig()
    rawCfg.googleSheets = {
        enabled: true,
        spreadsheetId: 'sheet-id',
        sheetName: 'Sheet1',
        accountsSheetName: 'Accounts',
        keyFilePath: 'service-account.json'
    }
    rawCfg.profiles = {
        safe: {
            searchDelay: { min: '25sec', max: '50sec' },
            readDelay: { min: '21sec', max: '41sec' },
            searchTargetRatioMin: 0.72,
            searchTargetRatioMax: 0.84,
            readArticlesMin: 7,
            readArticlesMax: 9,
            typingMultiplier: 1.3
        },
        fast: {
            searchDelay: { min: '5sec', max: '10sec' },
            readDelay: { min: '4sec', max: '8sec' },
            extraSearchVerifyRounds: 3,
            thoroughTasks: true
        }
    }

    const cfg = validateConfig(rawCfg)
    assert.equal(cfg.googleSheets.accountsSheetName, 'Accounts')
    assert.equal(toMs('25sec', 1000), 25000)
    assert.equal(toMs('bad', 1234), 1234)

    // Safe takes precedence over high redemptionCount
    const seededSafe = resolveExecutionProfile({
        tag: 'main, NEW',
        redemptionCount: 10,
        config: cfg,
        random: new SeededRandom('safe-seed-1')
    })
    assert.equal(seededSafe.mode, 'safe')
    assert.equal(seededSafe.isNewTag, true)
    assert.deepEqual(seededSafe.searchDelay, { minMs: 25000, maxMs: 50000 })
    assert.deepEqual(seededSafe.readDelay, { minMs: 21000, maxMs: 41000 })
    assert.ok(seededSafe.searchTargetRatio >= 0.72 && seededSafe.searchTargetRatio <= 0.84)
    assert.ok(seededSafe.readArticlesTarget >= 7 && seededSafe.readArticlesTarget <= 9)
    assert.equal(seededSafe.typingMultiplier, 1.3)
    assert.equal(seededSafe.waitMultiplier, 1.25)
    assert.equal(seededSafe.resultVisitMultiplier, 1.35)
    assert.equal(seededSafe.extraSearchVerifyRounds, 0)
    assert.equal(seededSafe.thoroughTasks, false)
    assert.deepEqual(seededSafe.interactionWeights, { read: 4, scroll: 4, click: 3 })

    // Default safe range checks without config overrides
    const defaultSafe = resolveExecutionProfile({
        tag: 'new',
        redemptionCount: 10,
        random: new SeededRandom('safe-seed-2')
    })
    assert.ok(defaultSafe.searchTargetRatio >= 0.7 && defaultSafe.searchTargetRatio <= 0.85)
    assert.ok(defaultSafe.readArticlesTarget >= 7 && defaultSafe.readArticlesTarget <= 10)

    // Fast mode when no 'new' tag and redemptionCount >= 6
    const fast = resolveExecutionProfile({
        tag: 'main',
        redemptionCount: 6,
        config: cfg
    })
    assert.equal(fast.mode, 'fast')
    assert.equal(fast.isNewTag, false)
    assert.deepEqual(fast.searchDelay, { minMs: 5000, maxMs: 10000 })
    assert.deepEqual(fast.readDelay, { minMs: 4000, maxMs: 8000 })
    assert.equal(fast.searchTargetRatio, 1.0)
    assert.equal(fast.readArticlesTarget, 10)
    assert.equal(fast.typingMultiplier, 0.6)
    assert.equal(fast.waitMultiplier, 0.6)
    assert.equal(fast.resultVisitMultiplier, 0.65)
    assert.equal(fast.extraSearchVerifyRounds, 3)
    assert.equal(fast.thoroughTasks, true)
    assert.deepEqual(fast.interactionWeights, { read: 6, scroll: 2, click: 2 })

    // Standard mode when no 'new' tag and redemptionCount < 6
    const standard = resolveExecutionProfile({
        tag: 'clone',
        redemptionCount: 5,
        config: cfg
    })
    assert.equal(standard.mode, 'standard')
    assert.deepEqual(standard.searchDelay, { minMs: 30000, maxMs: 60000 })
    assert.deepEqual(standard.readDelay, { minMs: 25000, maxMs: 50000 })
    assert.equal(standard.searchTargetRatio, 1.0)
    assert.equal(standard.readArticlesTarget, 10)
    assert.equal(standard.typingMultiplier, 1.0)
    assert.equal(standard.extraSearchVerifyRounds, 0)
    assert.equal(standard.thoroughTasks, false)

    // Invalid profile ranges rejected by Validator
    const badRatio = buildBaseConfig()
    badRatio.profiles = { safe: { searchTargetRatioMin: 0.9, searchTargetRatioMax: 0.7 } }
    assert.throws(() => validateConfig(badRatio))

    const lowRatio = buildBaseConfig()
    lowRatio.profiles = { safe: { searchTargetRatioMin: 0.1 } }
    assert.throws(() => validateConfig(lowRatio))

    const badArticles = buildBaseConfig()
    badArticles.profiles = { safe: { readArticlesMin: 12, readArticlesMax: 8 } }
    assert.throws(() => validateConfig(badArticles))
})

test('FileLock serializes concurrent writes, recovers stale locks, and writes atomically', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-filelock-'))
    const counterFile = path.join(tmpDir, 'nested', 'counter.txt')

    try {
        atomicWriteFileSync(counterFile, '0')
        assert.equal(fs.readFileSync(counterFile, 'utf8'), '0')

        await Promise.all(
            Array.from({ length: 12 }, () =>
                withFileLockAsync(counterFile, async () => {
                    const current = Number.parseInt(fs.readFileSync(counterFile, 'utf8'), 10)
                    await new Promise(resolve => setTimeout(resolve, 10))
                    await atomicWriteFileAsync(counterFile, String(current + 1))
                })
            )
        )
        assert.equal(fs.readFileSync(counterFile, 'utf8'), '12')
        assert.equal(fs.existsSync(`${counterFile}.lock`), false)

        // Stale lock recovery
        const lockPath = `${counterFile}.lock`
        fs.writeFileSync(lockPath, '999999\n0')
        const staleTime = new Date(Date.now() - 20000)
        fs.utimesSync(lockPath, staleTime, staleTime)

        const syncVal = withFileLockSync(
            counterFile,
            () => {
                const next = Number.parseInt(fs.readFileSync(counterFile, 'utf8'), 10) + 1
                atomicWriteFileSync(counterFile, String(next))
                return next
            },
            { staleMs: 1000, timeoutMs: 1000 }
        )
        assert.equal(syncVal, 13)
        assert.equal(fs.existsSync(lockPath), false)
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('AccountService syncNewTagByEmail, syncNewTagByEmailSync, reconcileNewTagsFromStates, and concurrency', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-acc-sync-'))
    const accountsPath = path.join(tmpDir, 'accounts.json')
    fs.writeFileSync(
        accountsPath,
        JSON.stringify(
            [
                makeAccount('young@example.com', { tag: 'main, clone' }),
                makeAccount('mature@example.com', { tag: 'main, new, clone' }),
                makeAccount('onlynew@example.com', { tag: 'new' }),
                makeAccount('unknown@example.com', { tag: 'vip' })
            ],
            null,
            4
        )
    )

    process.env.ACCOUNTS_PATH = accountsPath
    const svc = new AccountService()
    try {
        // Unknown age makes no change
        assert.deepEqual(await svc.syncNewTagByEmail('unknown@example.com', null), { tag: 'vip', changed: false })
        assert.equal(await svc.syncNewTagByEmail('missing@example.com', true), null)

        // Add 'new' while preserving 'main, clone'
        assert.deepEqual(await svc.syncNewTagByEmail('YOUNG@example.com', true), {
            tag: 'main, clone, new',
            changed: true
        })
        assert.equal(svc.getRawAccount('young@example.com').tag, 'main, clone, new')

        // Sync removal while preserving 'main, clone'
        assert.deepEqual(svc.syncNewTagByEmailSync('mature@example.com', false), {
            tag: 'main, clone',
            changed: true
        })
        assert.equal(svc.getRawAccount('mature@example.com').tag, 'main, clone')

        // Removing sole 'new' deletes tag cleanly and stays schema-valid
        assert.deepEqual(await svc.syncNewTagByEmail('onlynew@example.com', false), { tag: '', changed: true })
        assert.equal(svc.getRawAccount('onlynew@example.com').tag, undefined)

        // Reconcile from states updates only known <3m or >=3m entries
        const changed = await svc.reconcileNewTagsFromStates([
            { email: 'young@example.com', accountAge: '6m (205d)' },
            { email: 'onlynew@example.com', accountAge: '22d' },
            { email: 'unknown@example.com', accountAge: 'N/A' }
        ])
        assert.equal(changed, 2)
        assert.equal(svc.getRawAccount('young@example.com').tag, 'main, clone')
        assert.equal(svc.getRawAccount('onlynew@example.com').tag, 'new')
        assert.equal(svc.getRawAccount('unknown@example.com').tag, 'vip')

        // Concurrent mutations under FileLock lose zero writes
        await Promise.all([
            svc.create(makeAccount('c1@example.com')),
            svc.create(makeAccount('c2@example.com')),
            svc.syncNewTagByEmail('unknown@example.com', true),
            svc.toggleEnabled('mature@example.com', false)
        ])
        assert.equal(svc.list().length, 6)
        assert.equal(svc.getRawAccount('unknown@example.com').tag, 'vip, new')
        assert.equal(svc.getRawAccount('mature@example.com').enabled, false)
        assert.equal(fs.existsSync(`${accountsPath}.lock`), false)

        // IPC contract type guard check
        assert.equal(isAccountTagSyncMessage({ __accountAgeSync: { email: 'a@b.com', isNew: true } }), true)
        assert.equal(isAccountTagSyncMessage({ __stateUpdate: {} }), false)
        assert.equal(isAccountTagSyncMessage(null), false)
    } finally {
        delete process.env.ACCOUNTS_PATH
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

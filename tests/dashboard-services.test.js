const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('ConfigService preserves [REDACTED] secrets when writing updated config', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-cfg-'))
    const cfgPath = path.join(tmpDir, 'config.json')
    const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'config.example.json'), 'utf8'))
    sample.ai.apiKey = 'sk-real-secret-value-12345'
    sample.webhook.discord.url = 'https://discord.com/api/webhooks/123/real-token'
    fs.writeFileSync(cfgPath, JSON.stringify(sample, null, 2))

    process.env.CONFIG_PATH = cfgPath
    const { ConfigService } = require('../dist/dashboard/configService')
    try {
        const svc = new ConfigService()
        const snap = await svc.snapshot()
        assert.equal(snap.data.ai.apiKey, '[REDACTED]')

        // Modify non-secret field while sending [REDACTED] back
        snap.data.clusters = 4
        await svc.write(snap.data)

        const rawAfter = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
        assert.equal(rawAfter.clusters, 4)
        assert.equal(rawAfter.ai.apiKey, 'sk-real-secret-value-12345')
        assert.equal(rawAfter.webhook.discord.url, 'https://discord.com/api/webhooks/123/real-token')
    } finally {
        delete process.env.CONFIG_PATH
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('SettingsService and AccountService handle CRUD, secret preservation, and validation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-acc-'))
    const settingsPath = path.join(tmpDir, 'settings.json')
    const accountsPath = path.join(tmpDir, 'accounts.json')
    fs.writeFileSync(accountsPath, '[]')

    process.env.DASHBOARD_SETTINGS_PATH = settingsPath
    process.env.ACCOUNTS_PATH = accountsPath
    const { SettingsService } = require('../dist/dashboard/settingsService')
    const { AccountService } = require('../dist/dashboard/accountService')
    try {
        const settingsSvc = new SettingsService()
        await settingsSvc.write({
            defaultProxyUrl: 'http://100.74.159.41',
            defaultProxyPort: 10808,
            defaultProxyUsername: 'user1',
            defaultProxyPassword: 'secret-proxy-password',
            maxConcurrentSingleRuns: 2
        })
        const redacted = settingsSvc.get()
        assert.equal(redacted.defaultProxyPassword, '[REDACTED]')
        assert.equal(redacted.hasDefaultProxyPassword, true)

        // Updating port without password must preserve password
        await settingsSvc.write({ defaultProxyPort: 10809 })
        assert.equal(settingsSvc.getRaw().defaultProxyPassword, 'secret-proxy-password')
        assert.equal(settingsSvc.getRaw().defaultProxyPort, 10809)

        const accSvc = new AccountService()
        await accSvc.create({
            email: 'tester@example.com',
            password: 'acc-password',
            totpSecret: 'JBSWY3DPEHPK3PXP',
            geoLocale: 'vn',
            langCode: 'vi'
        })
        const listed = accSvc.list()
        assert.equal(listed.length, 1)
        assert.equal(listed[0].hasPassword, true)
        assert.equal(listed[0].hasTotp, true)
        assert.equal(listed[0].password, '')

        // Toggle disabled & update geo while keeping secrets
        await accSvc.toggleEnabled('tester@example.com', false)
        await accSvc.update('tester@example.com', { geoLocale: 'us', tag: 'vip' })
        const raw = accSvc.getRawAccount('tester@example.com')
        assert.equal(raw.enabled, false)
        assert.equal(raw.geoLocale, 'us')
        assert.equal(raw.tag, 'vip')
        assert.equal(raw.password, 'acc-password')
        assert.equal(raw.totpSecret, 'JBSWY3DPEHPK3PXP')

        assert.equal(await accSvc.remove('tester@example.com'), true)
        assert.equal(accSvc.list().length, 0)

        const imp = await accSvc.bulkImport(
            'u1@example.com|pass1|JBSWY3DPEHPK3PXP|rec1@example.com\nu2@example.com|pass2\nbadline\nu1@example.com|dup',
            { geoLocale: 'us', langCode: 'en', tag: 'batch1' }
        )
        assert.equal(imp.added, 2)
        assert.equal(imp.skipped, 1)
        assert.equal(imp.errors.length, 1)
        assert.equal(accSvc.list().length, 2)
        assert.equal(accSvc.getRawAccount('u1@example.com').tag, 'batch1')
    } finally {
        delete process.env.DASHBOARD_SETTINGS_PATH
        delete process.env.ACCOUNTS_PATH
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('SessionService unifies and deletes across sessions, src/browser/sessions, and dist/browser/sessions', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-sess-'))
    const origCwd = process.cwd()
    process.chdir(tmpDir)
    try {
        fs.mkdirSync(path.join(tmpDir, 'sessions', 'a@b.com'), { recursive: true })
        fs.mkdirSync(path.join(tmpDir, 'src', 'browser', 'sessions', 'a@b.com'), { recursive: true })
        fs.mkdirSync(path.join(tmpDir, 'dist', 'browser', 'sessions', 'a@b.com'), { recursive: true })
        fs.writeFileSync(path.join(tmpDir, 'sessions', 'a@b.com', 'session_desktop.json'), '[]')
        fs.writeFileSync(path.join(tmpDir, 'src', 'browser', 'sessions', 'a@b.com', 'session_mobile.json'), '[]')
        fs.writeFileSync(path.join(tmpDir, 'dist', 'browser', 'sessions', 'a@b.com', 'session_desktop.json'), '[]')

        const { SessionService } = require(path.join(origCwd, 'dist', 'dashboard', 'sessionService'))
        const svc = new SessionService('sessions')
        const list = await svc.list()
        assert.equal(list.length, 1)
        assert.equal(list[0].hasDesktop, true)
        assert.equal(list[0].hasMobile, true)

        assert.equal(await svc.remove('a@b.com'), true)
        assert.equal(fs.existsSync(path.join(tmpDir, 'sessions', 'a@b.com')), false)
        assert.equal(fs.existsSync(path.join(tmpDir, 'src', 'browser', 'sessions', 'a@b.com')), false)
        assert.equal(fs.existsSync(path.join(tmpDir, 'dist', 'browser', 'sessions', 'a@b.com')), false)
    } finally {
        process.chdir(origCwd)
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('StateService applyAccountState writes safely with file locking and leaves no stale lock', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-lock-'))
    const origCwd = process.cwd()
    process.chdir(tmpDir)
    try {
        fs.mkdirSync(path.join(tmpDir, 'src', 'dashboard'), { recursive: true })
        fs.writeFileSync(path.join(tmpDir, 'src', 'accounts.json'), JSON.stringify([
            {
                email: 'a@example.com',
                password: 'p',
                recoveryEmail: '',
                geoLocale: 'vn',
                langCode: 'vi',
                proxy: { proxyAxios: true, url: '', port: 0, username: '', password: '' },
                saveFingerprint: { mobile: true, desktop: true }
            },
            {
                email: 'b@example.com',
                password: 'p',
                recoveryEmail: '',
                geoLocale: 'vn',
                langCode: 'vi',
                proxy: { proxyAxios: true, url: '', port: 0, username: '', password: '' },
                saveFingerprint: { mobile: true, desktop: true }
            }
        ]))

        const { StateService } = require(path.join(origCwd, 'dist', 'services', 'stateService'))
        const svc = new StateService()
        svc.applyAccountState('a@example.com', { status: 'OK', totalPoints: 1234 })
        svc.applyAccountState('b@example.com', { status: 'ERROR', lastError: 'boom' })

        const states = svc.getStates()
        assert.equal(states.find(s => s.email === 'a@example.com').totalPoints, 1234)
        assert.equal(states.find(s => s.email === 'b@example.com').lastError, 'boom')
        assert.equal(fs.existsSync(path.join(tmpDir, 'src', 'dashboard', 'db.json.lock')), false)
    } finally {
        process.chdir(origCwd)
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

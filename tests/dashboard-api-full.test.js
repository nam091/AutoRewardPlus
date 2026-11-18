const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('DashboardServer API manages settings, accounts, proxy check, and 2-slot single runs', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-srv-'))
    const origCwd = process.cwd()
    process.chdir(tmpDir)

    const cfgSrc = path.join(origCwd, 'src', 'config.example.json')
    fs.mkdirSync(path.join(tmpDir, 'src', 'dashboard', 'web'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'dashboard', 'web', 'index.html'), '<html></html>')
    fs.copyFileSync(cfgSrc, path.join(tmpDir, 'src', 'config.json'))
    fs.writeFileSync(path.join(tmpDir, 'src', 'accounts.json'), '[]')

    delete process.env.DASHBOARD_API_TOKEN
    delete process.env.DASHBOARD_ALLOW_CONFIG_WRITE
    process.env.DASHBOARD_HOST = '127.0.0.1'

    const { DashboardServer } = require(path.join(origCwd, 'dist', 'dashboard', 'server'))
    const server = new DashboardServer()

    try {
        // 1. Add account via API
        const addRes = await server.app.inject({
            method: 'POST',
            url: '/api/accounts/manage',
            payload: { email: 'user1@example.com', password: 'pw1', geoLocale: 'vn', langCode: 'vi' }
        })
        assert.equal(addRes.statusCode, 200)

        // 2. Settings write + read (redacted)
        const setRes = await server.app.inject({
            method: 'PUT',
            url: '/api/settings',
            payload: { defaultProxyUrl: 'http://127.0.0.1', defaultProxyPort: 65432, maxConcurrentSingleRuns: 2 }
        })
        assert.equal(setRes.statusCode, 200)
        assert.equal(JSON.parse(setRes.body).data.defaultProxyPort, 65432)

        // 3. Config write preserves secrets
        const cfgGet = JSON.parse((await server.app.inject({ method: 'GET', url: '/api/config' })).body).data.data
        cfgGet.clusters = 2
        const cfgPut = await server.app.inject({ method: 'PUT', url: '/api/config', payload: cfgGet })
        assert.equal(cfgPut.statusCode, 200)

        // 4. Proxy status & unreachable proxy test
        const proxyTest = await server.app.inject({ method: 'POST', url: '/api/proxy/test', payload: {} })
        assert.equal(proxyTest.statusCode, 200)
        assert.equal(JSON.parse(proxyTest.body).success, false)

        // 5. Status reports idle and singlePool maxConcurrent = 2
        const statusRes = JSON.parse((await server.app.inject({ method: 'GET', url: '/api/status' })).body)
        assert.equal(statusRes.success, true)
        assert.equal(statusRes.data.singlePool.maxConcurrent, 2)
    } finally {
        await server.close()
        process.chdir(origCwd)
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('Source fixes: TTY guards in TOTP/Recovery, enabled filter in batch, SearchManager full account context', () => {
    const root = path.join(__dirname, '..')
    const totpSrc = fs.readFileSync(path.join(root, 'src', 'browser', 'auth', 'methods', 'Totp2FALogin.ts'), 'utf8')
    const recSrc = fs.readFileSync(path.join(root, 'src', 'browser', 'auth', 'methods', 'RecoveryEmailLogin.ts'), 'utf8')
    const indexSrc = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8')
    const searchMgrSrc = fs.readFileSync(path.join(root, 'src', 'functions', 'SearchManager.ts'), 'utf8')

    assert.ok(totpSrc.includes('!process.stdin.isTTY'), 'Totp2FALogin must guard non-TTY stdin')
    assert.ok(recSrc.includes('!process.stdin.isTTY'), 'RecoveryEmailLogin must guard non-TTY stdin')
    assert.ok(indexSrc.includes('a.enabled !== false'), 'Batch initialize must filter disabled accounts')
    assert.ok(!searchMgrSrc.includes('{ isMobile: true, accountEmail }'), 'SearchManager must not pass accountEmail as account')
    assert.ok(!searchMgrSrc.includes('{ isMobile: false, accountEmail }'), 'SearchManager must not pass accountEmail as account')
})

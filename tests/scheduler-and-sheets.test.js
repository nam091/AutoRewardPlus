const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '..')
const { SchedulerService, getClockSnapshot } = require(path.join(ROOT, 'dist', 'dashboard', 'schedulerService'))

test('SchedulerService dual-day rollover waits until both VPS and Local enter a new day', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-sch-dual-'))
    const statePath = path.join(tmpDir, 'scheduler-state.json')
    fs.writeFileSync(
        statePath,
        JSON.stringify({
            config: {
                enabled: true,
                vpsTimezone: 'America/Los_Angeles',
                localTimezone: 'Asia/Ho_Chi_Minh',
                minLocalHour: 7,
                maxLocalHour: 21,
                minJitterMinutes: 15,
                maxJitterMinutes: 180,
                requireProxy: true
            },
            lastRunVpsDate: '2026-11-17',
            lastRunLocalDate: '2026-11-17'
        })
    )

    try {
        const scheduler = new SchedulerService({
            statePath,
            randomInt: () => 45,
            checkProxy: async () => ({ ok: true })
        })

        // 2026-11-18 07:30 +07 (VN) = 2026-11-17 16:30 PST (LA) -> VPS still on 2026-11-17
        const beforeVpsMidnight = new Date('2026-11-18T00:30:00.000Z')
        const st1 = await scheduler.evaluate(beforeVpsMidnight)
        assert.equal(st1.localDate, '2026-11-18')
        assert.equal(st1.vpsDate, '2026-11-17')
        assert.equal(st1.conditions.localNewDay, true)
        assert.equal(st1.conditions.vpsNewDay, false)
        assert.equal(st1.phase, 'WAITING_NEW_DAY')
        assert.equal(st1.plannedTargetAt, null)

        // 2026-11-18 15:05 +07 (VN) = 2026-11-18 00:05 PST (LA) -> BOTH rolled to 2026-11-18
        const afterVpsMidnight = new Date('2026-11-18T08:05:00.000Z')
        const st2 = await scheduler.evaluate(afterVpsMidnight)
        assert.equal(st2.localDate, '2026-11-18')
        assert.equal(st2.vpsDate, '2026-11-18')
        assert.equal(st2.conditions.localNewDay, true)
        assert.equal(st2.conditions.vpsNewDay, true)
        assert.equal(st2.conditions.localHourOk, true)
        assert.equal(st2.phase, 'COUNTDOWN')
        assert.equal(st2.plannedJitterMinutes, 45)
        assert.equal(st2.plannedTargetAt, new Date(afterVpsMidnight.getTime() + 45 * 60_000).toISOString())
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('SchedulerService waits for minLocalHour and plans randomized slot at 07:00 +07 when VPS UTC matches day', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-sch-hour-'))
    const statePath = path.join(tmpDir, 'scheduler-state.json')
    fs.writeFileSync(
        statePath,
        JSON.stringify({
            config: {
                enabled: true,
                vpsTimezone: 'UTC',
                localTimezone: 'Asia/Ho_Chi_Minh',
                minLocalHour: 7,
                maxLocalHour: 21,
                minJitterMinutes: 15,
                maxJitterMinutes: 180,
                requireProxy: true
            },
            lastRunVpsDate: '2026-11-17',
            lastRunLocalDate: '2026-11-17'
        })
    )

    try {
        const scheduler = new SchedulerService({
            statePath,
            randomInt: (min, max) => {
                assert.equal(min, 15)
                assert.equal(max, 180)
                return 60
            },
            checkProxy: async () => ({ ok: true })
        })

        // 2026-11-18 06:30 +07 = 2026-11-17 23:30 UTC -> UTC still on 2026-11-17
        const stPreUtc = await scheduler.evaluate(new Date('2026-11-17T23:30:00.000Z'))
        assert.equal(stPreUtc.phase, 'WAITING_NEW_DAY')

        // When VPS is ahead (e.g. Asia/Tokyo) and local is < 07:00 +07, waits on WAITING_LOCAL_HOUR
        const tokyoScheduler = new SchedulerService({
            statePath: path.join(tmpDir, 'tokyo-state.json'),
            randomInt: () => 60
        })
        await tokyoScheduler.updateConfig(
            { enabled: true, vpsTimezone: 'Asia/Tokyo', localTimezone: 'Asia/Ho_Chi_Minh' },
            new Date('2026-11-17T22:30:00.000Z') // 05:30 +07, 07:30 +09
        )
        const stWaitHour = tokyoScheduler.getStatus(new Date('2026-11-17T22:30:00.000Z'))
        assert.equal(stWaitHour.phase, 'WAITING_LOCAL_HOUR')
        assert.equal(stWaitHour.plannedTargetAt, null)

        // At 07:00 +07 = 00:00 UTC -> BOTH are 2026-11-18 and localHour >= 7 -> plans +60m COUNTDOWN
        const sevenAmVn = new Date('2026-11-18T00:00:00.000Z')
        const stReady = await scheduler.evaluate(sevenAmVn)
        assert.equal(stReady.localDate, '2026-11-18')
        assert.equal(stReady.vpsDate, '2026-11-18')
        assert.equal(stReady.phase, 'COUNTDOWN')
        assert.equal(stReady.countdownSec, 60 * 60)
        assert.equal(stReady.plannedTargetAt, '2026-11-18T01:00:00.000Z')
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('SchedulerService gates on proxy at target time, launches batch once, and avoids duplicate same-day runs', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-sch-proxy-'))
    const statePath = path.join(tmpDir, 'scheduler-state.json')
    let proxyOk = false
    let proxyChecks = 0
    let batchStarts = 0
    let botBusy = false

    try {
        const scheduler = new SchedulerService({
            statePath,
            randomInt: () => 20,
            isBotBusy: () => botBusy,
            checkProxy: async () => {
                proxyChecks++
                return proxyOk ? { ok: true } : { ok: false, reason: 'Windows proxy offline' }
            },
            startBatch: async () => {
                batchStarts++
                botBusy = true
            }
        })

        const t0 = new Date('2026-11-18T01:00:00.000Z') // 08:00 +07
        await scheduler.updateConfig(
            {
                enabled: true,
                vpsTimezone: 'UTC',
                localTimezone: 'Asia/Ho_Chi_Minh',
                requireProxy: true
            },
            t0
        )

        const targetTime = new Date(t0.getTime() + 20 * 60_000)

        // At target time while proxy offline -> WAITING_PROXY, no launch
        const stOffline = await scheduler.evaluate(targetTime)
        assert.equal(stOffline.phase, 'WAITING_PROXY')
        assert.equal(stOffline.lastError, 'Windows proxy offline')
        assert.equal(batchStarts, 0)
        const checksAfterFail = proxyChecks

        // 30s later -> throttled inside 60s window
        proxyOk = true
        const stThrottled = await scheduler.evaluate(new Date(targetTime.getTime() + 30_000))
        assert.equal(stThrottled.phase, 'WAITING_PROXY')
        assert.equal(proxyChecks, checksAfterFail)
        assert.equal(batchStarts, 0)

        // 65s later -> re-checks proxy, sees ok=true, launches batch once
        const stLaunched = await scheduler.evaluate(new Date(targetTime.getTime() + 65_000))
        assert.equal(proxyChecks, checksAfterFail + 1)
        assert.equal(batchStarts, 1)
        assert.equal(stLaunched.phase, 'RUNNING')
        assert.equal(stLaunched.lastRunLocalDate, '2026-11-18')
        assert.equal(stLaunched.lastRunVpsDate, '2026-11-18')

        // Batch finishes -> DONE_TODAY and subsequent evaluations same day never re-launch
        botBusy = false
        scheduler.notifyBatchFinished()
        const stDone = await scheduler.evaluate(new Date(targetTime.getTime() + 2 * 3600_000))
        assert.equal(stDone.phase, 'DONE_TODAY')
        assert.equal(batchStarts, 1)
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('SchedulerService reroll() picks a fresh target time and persists across reload', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-sch-reroll-'))
    const statePath = path.join(tmpDir, 'scheduler-state.json')
    const rolls = [25, 110]

    try {
        const scheduler = new SchedulerService({
            statePath,
            randomInt: () => rolls.shift() ?? 90,
            checkProxy: async () => ({ ok: true })
        })

        const now = new Date('2026-11-18T01:00:00.000Z')
        const st1 = await scheduler.updateConfig(
            { enabled: true, vpsTimezone: 'UTC', localTimezone: 'Asia/Ho_Chi_Minh' },
            now
        )
        assert.equal(st1.plannedJitterMinutes, 25)

        const st2 = await scheduler.reroll(now)
        assert.equal(st2.plannedJitterMinutes, 110)
        assert.equal(st2.plannedTargetAt, new Date(now.getTime() + 110 * 60_000).toISOString())

        const reloaded = new SchedulerService({ statePath })
        const stReload = reloaded.getStatus(now)
        assert.equal(stReload.plannedJitterMinutes, 110)
        assert.equal(stReload.plannedTargetAt, st2.plannedTargetAt)
        assert.equal(getClockSnapshot('Invalid/Zone', now).timeZone, 'UTC')
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

test('SheetService 2-tab sync + missing Accounts_Info creation + trailing clear + DashboardServer scheduler API', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-v8-b3-'))
    const origCwd = process.cwd()
    process.chdir(tmpDir)

    delete process.env.DASHBOARD_API_TOKEN
    delete process.env.DASHBOARD_ALLOW_CONFIG_WRITE
    process.env.DASHBOARD_HOST = '127.0.0.1'

    try {
        fs.mkdirSync(path.join(tmpDir, 'src', 'dashboard', 'web'), { recursive: true })
        fs.writeFileSync(path.join(tmpDir, 'src', 'dashboard', 'web', 'index.html'), '<html></html>')
        fs.mkdirSync(path.join(tmpDir, 'sessions', 'acc1@example.com'), { recursive: true })
        fs.writeFileSync(path.join(tmpDir, 'sessions', 'acc1@example.com', 'session_desktop.json'), '[]')
        fs.writeFileSync(path.join(tmpDir, 'sessions', 'acc1@example.com', 'session_mobile.json'), '[]')

        const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'config.example.json'), 'utf8'))
        cfg.googleSheets = {
            enabled: true,
            spreadsheetId: 'mock-spreadsheet-123',
            sheetName: 'Sheet1',
            accountsSheetName: 'Accounts_Info',
            keyFilePath: 'service-account.json'
        }
        fs.writeFileSync(path.join(tmpDir, 'src', 'config.json'), JSON.stringify(cfg, null, 2))

        fs.writeFileSync(
            path.join(tmpDir, 'src', 'accounts.json'),
            JSON.stringify(
                [
                    {
                        email: 'acc1@example.com',
                        password: '=pw1',
                        totpSecret: 'TOTP1',
                        recoveryEmail: 'rec1@example.com',
                        geoLocale: 'vn',
                        langCode: 'vi',
                        tag: 'new',
                        enabled: true,
                        proxy: { proxyAxios: true, url: 'http://100.1.1.1', port: 10808, username: 'u1', password: 'p1' },
                        saveFingerprint: { mobile: true, desktop: true }
                    },
                    {
                        email: 'acc2@example.com',
                        password: 'pw2',
                        recoveryEmail: '',
                        geoLocale: 'us',
                        langCode: 'en',
                        tag: 'main',
                        enabled: false,
                        proxy: { proxyAxios: true, url: '', port: 0, username: '', password: '' },
                        saveFingerprint: { mobile: true, desktop: true }
                    }
                ],
                null,
                2
            )
        )

        fs.writeFileSync(
            path.join(tmpDir, 'src', 'dashboard', 'db.json'),
            JSON.stringify(
                [
                    {
                        email: 'acc1@example.com',
                        totalPoints: 1200,
                        dailyPoints: 90,
                        pcProgress: '30/90',
                        mobileProgress: '20/60',
                        status: 'OK',
                        accountAge: '15d',
                        streak: '3',
                        updatedAt: '10:00:00 18/11/2026',
                        level: 'Level 2',
                        lifetimePoints: 2500,
                        redemptionCount: 0,
                        lifetimePointsRedeemed: 0,
                        redeemGoalTitle: 'Grab'
                    },
                    {
                        email: 'acc2@example.com',
                        totalPoints: 8900,
                        dailyPoints: 150,
                        pcProgress: '90/90',
                        mobileProgress: '60/60',
                        status: 'OK',
                        accountAge: '1.5y (548d)',
                        streak: '45',
                        updatedAt: '10:05:00 18/11/2026',
                        level: 'Level 2',
                        lifetimePoints: 65000,
                        redemptionCount: 8,
                        lifetimePointsRedeemed: 52000,
                        lastOrderTitle: 'Shopee 100k',
                        lastOrderDate: '2026-10-01T00:00:00Z',
                        redeemGoalTitle: 'Shopee'
                    }
                ],
                null,
                2
            )
        )

        const { SheetService } = require(path.join(ROOT, 'dist', 'services', 'sheetService'))
        const sheetsSvc = new SheetService()

        // Missing service-account.json -> returns false with clear lastError
        const missingRes = await sheetsSvc.syncAllFromDisk()
        assert.equal(missingRes, false)
        assert.ok(sheetsSvc.lastError && sheetsSvc.lastError.includes('service-account.json'))

        // Mock Google Sheets API client (missing Accounts_Info tab initially)
        const existingTabs = ['Sheet1']
        const batchUpdates = []
        const updates = []
        const clears = []

        const mockClient = {
            spreadsheets: {
                get: async () => ({
                    data: { sheets: existingTabs.map(title => ({ properties: { title } })) }
                }),
                batchUpdate: async params => {
                    batchUpdates.push(params)
                    const added = params.requestBody.requests[0]?.addSheet?.properties?.title
                    if (added) existingTabs.push(added)
                    return { data: {} }
                },
                values: {
                    update: async params => {
                        updates.push(params)
                        return { data: {} }
                    },
                    clear: async params => {
                        clears.push(params)
                        return { data: {} }
                    }
                }
            }
        }

        const synced = await sheetsSvc.syncAllFromDisk({
            client: mockClient,
            onlineEmails: new Set(['acc1@example.com'])
        })
        assert.equal(synced, true)
        assert.equal(sheetsSvc.lastError, null)

        // ensureSheetTab added Accounts_Info via batchUpdate
        assert.equal(batchUpdates.length, 1)
        assert.equal(batchUpdates[0].requestBody.requests[0].addSheet.properties.title, 'Accounts_Info')

        // Both tabs updated + trailing rows cleared
        assert.equal(updates.length, 2)
        assert.equal(updates[0].range, 'Sheet1!A1:S3')
        assert.equal(updates[0].requestBody.values[0].length, 19)
        assert.equal(updates[0].requestBody.values[0][1], 'Tag')
        assert.equal(updates[0].requestBody.values[0][3], 'Quà đã đổi')
        assert.equal(updates[0].requestBody.values[0][4], 'Chế độ')
        assert.equal(updates[0].requestBody.values[1][0], 'acc1@example.com')
        assert.equal(updates[0].requestBody.values[1][1], 'new')
        assert.equal(updates[0].requestBody.values[1][3], '0')
        assert.equal(updates[0].requestBody.values[1][4], 'safe')
        assert.equal(updates[0].requestBody.values[1][16], 'ONLINE')
        assert.equal(updates[0].requestBody.values[2][4], 'fast')

        assert.equal(updates[1].range, 'Accounts_Info!A1:W3')
        assert.equal(updates[1].valueInputOption, 'RAW')
        assert.equal(updates[1].requestBody.values[0].length, 23)
        assert.equal(updates[1].requestBody.values[1][1], '=pw1')
        assert.equal(updates[1].requestBody.values[1][2], 'TOTP1')
        assert.equal(updates[1].requestBody.values[1][3], 'rec1@example.com')
        assert.equal(updates[1].requestBody.values[1][8], 'http://100.1.1.1')
        assert.equal(updates[1].requestBody.values[1][19], 'D+M')
        assert.equal(updates[1].requestBody.values[2][5], 'FALSE')
        assert.equal(updates[1].requestBody.values[2][19], 'None')

        assert.deepEqual(
            clears.map(c => c.range),
            ['Sheet1!A4:Z1000', 'Accounts_Info!A4:Z1000']
        )

        // Ensure syncAccountsToSheet delegates cleanly to syncAllFromDisk with statsOverride
        const prevUpdateCount = updates.length
        const delegated = await sheetsSvc.syncAccountsToSheet([
            {
                email: 'acc1@example.com',
                totalPoints: 1350,
                dailyPoints: 240,
                pcProgress: '90/90',
                mobileProgress: '60/60',
                status: 'OK',
                accountAge: '15d',
                updatedAt: '11:00:00 18/11/2026',
                streak: '4',
                onlineStatus: 'OFFLINE'
            }
        ])
        assert.equal(delegated, false) // no client injected on default singleton/instance without keyFile

        // Also test SettingsService lazy relative path across process.chdir
        const { SettingsService } = require(path.join(ROOT, 'dist', 'dashboard', 'settingsService'))
        const lazySettings = new SettingsService()
        await lazySettings.write({ defaultProxyPort: 10810, defaultProxyUrl: 'http://127.0.0.1' })
        assert.equal(fs.existsSync(path.join(tmpDir, 'src', 'dashboard', 'settings.json')), true)
        assert.equal(lazySettings.getRaw().defaultProxyPort, 10810)

        // DashboardServer API integration
        const { DashboardServer } = require(path.join(ROOT, 'dist', 'dashboard', 'server'))
        const server = new DashboardServer()

        try {
            // /api/scheduler initial disabled state
            const getSch = JSON.parse((await server.app.inject({ method: 'GET', url: '/api/scheduler' })).body)
            assert.equal(getSch.success, true)
            assert.equal(getSch.data.phase, 'DISABLED')
            assert.equal(getSch.data.config.enabled, false)

            // Write-guard check
            process.env.DASHBOARD_ALLOW_CONFIG_WRITE = '0'
            const blockedPut = await server.app.inject({
                method: 'PUT',
                url: '/api/scheduler',
                payload: { enabled: true }
            })
            assert.equal(blockedPut.statusCode, 403)
            delete process.env.DASHBOARD_ALLOW_CONFIG_WRITE

            // Enable scheduler over 0..24 window so test is time-of-day independent
            const putSch = await server.app.inject({
                method: 'PUT',
                url: '/api/scheduler',
                payload: {
                    enabled: true,
                    minLocalHour: 0,
                    maxLocalHour: 24,
                    minJitterMinutes: 15,
                    maxJitterMinutes: 60,
                    requireProxy: false
                }
            })
            assert.equal(putSch.statusCode, 200)
            const putBody = JSON.parse(putSch.body)
            assert.equal(putBody.success, true)
            assert.equal(putBody.data.phase, 'COUNTDOWN')
            assert.ok(putBody.data.plannedTargetAt)

            // Heartbeat endpoint updates localTimezone + proxyOk
            const hbRes = await server.app.inject({
                method: 'POST',
                url: '/api/scheduler/heartbeat',
                payload: { localTimezone: 'Asia/Ho_Chi_Minh', proxyOk: true }
            })
            assert.equal(hbRes.statusCode, 200)
            const hbBody = JSON.parse(hbRes.body)
            assert.equal(hbBody.success, true)
            assert.equal(hbBody.data.conditions.proxyOk, true)

            // Reroll endpoint
            const rerollRes = await server.app.inject({
                method: 'POST',
                url: '/api/scheduler/reroll',
                payload: {}
            })
            assert.equal(rerollRes.statusCode, 200)
            assert.equal(JSON.parse(rerollRes.body).success, true)

            // /api/accounts exposes meta.scheduler + executionMode + redemptionCount
            const accRes = JSON.parse((await server.app.inject({ method: 'GET', url: '/api/accounts' })).body)
            assert.equal(accRes.success, true)
            assert.equal(accRes.meta.scheduler.config.enabled, true)
            const acc1 = accRes.data.find(a => a.email === 'acc1@example.com')
            const acc2 = accRes.data.find(a => a.email === 'acc2@example.com')
            assert.equal(acc1.executionMode, 'safe')
            assert.equal(acc1.redemptionCount, 0)
            assert.equal(acc2.executionMode, 'fast')
            assert.equal(acc2.redemptionCount, 8)
            assert.equal(acc2.lastOrderTitle, 'Shopee 100k')

            // /api/status exposes data.scheduler
            const statusRes = JSON.parse((await server.app.inject({ method: 'GET', url: '/api/status' })).body)
            assert.equal(statusRes.success, true)
            assert.equal(statusRes.data.scheduler.config.enabled, true)

            // /api/sync-sheets returns explicit failure (400) when service-account.json is absent
            const syncRes = await server.app.inject({ method: 'POST', url: '/api/sync-sheets' })
            assert.equal(syncRes.statusCode, 400)
            const syncJson = JSON.parse(syncRes.body)
            assert.equal(syncJson.success, false)
            assert.ok(syncJson.message.includes('service-account.json'))
            assert.equal(updates.length, prevUpdateCount)

            // start(0) & close() lifecycle starts and stops scheduler cleanly
            await server.start(0)
        } finally {
            await server.close()
        }

        // Auth check on /api/scheduler when DASHBOARD_API_TOKEN is set
        process.env.DASHBOARD_API_TOKEN = 'secret-scheduler-token'
        const authedServer = new DashboardServer()
        try {
            const unauth = await authedServer.app.inject({ method: 'GET', url: '/api/scheduler' })
            assert.equal(unauth.statusCode, 401)
            const authOk = await authedServer.app.inject({
                method: 'GET',
                url: '/api/scheduler',
                headers: { authorization: 'Bearer secret-scheduler-token' }
            })
            assert.equal(authOk.statusCode, 200)
        } finally {
            delete process.env.DASHBOARD_API_TOKEN
            await authedServer.close()
        }
    } finally {
        process.chdir(origCwd)
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
})

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const BrowserFunc = require('../dist/browser/BrowserFunc').default
const { loadSessionData } = require('../dist/util/Load')

test('missingSearchPoints uses real counters when available', () => {
    const mockBot = {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        isMobile: false,
        userData: { currentPoints: 100 },
        utils: { wait: () => Promise.resolve() }
    }
    const browserFunc = new BrowserFunc(mockBot)

    const counters = {
        pcSearch: [
            { pointProgress: 30, pointProgressMax: 90 },
            { pointProgress: 0, pointProgressMax: 12 }
        ],
        mobileSearch: [{ pointProgress: 20, pointProgressMax: 60 }],
        activityAndQuiz: [],
        dailyPoint: []
    }

    const missingDesktop = browserFunc.missingSearchPoints(counters, false)
    assert.equal(missingDesktop.desktopPoints, 60)
    assert.equal(missingDesktop.edgePoints, 12)
    assert.equal(missingDesktop.totalPoints, 72)

    const missingMobile = browserFunc.missingSearchPoints(counters, true)
    assert.equal(missingMobile.mobilePoints, 40)
    assert.equal(missingMobile.totalPoints, 40)

    const progress = browserFunc.formatSearchProgress(counters)
    assert.equal(progress.pcProgress, '30/102')
    assert.equal(progress.mobileProgress, '20/60')
})

test('missingSearchPoints and formatSearchProgress leverage modern breakdown cache when counters are empty', () => {
    const mockBot = {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        isMobile: false,
        userData: { currentPoints: 100 },
        utils: { wait: () => Promise.resolve() }
    }
    const browserFunc = new BrowserFunc(mockBot)

    browserFunc.setSearchBreakdown({
        desktop: { earned: 45, max: 90 },
        mobile: { earned: 25, max: 60 }
    })

    const emptyCounters = {
        pcSearch: [],
        mobileSearch: [],
        activityAndQuiz: [],
        dailyPoint: []
    }

    const missingDesktop = browserFunc.missingSearchPoints(emptyCounters, false)
    assert.equal(missingDesktop.desktopPoints, 45)
    assert.equal(missingDesktop.edgePoints, 0)
    assert.equal(missingDesktop.totalPoints, 45)

    const missingMobile = browserFunc.missingSearchPoints(emptyCounters, true)
    assert.equal(missingMobile.mobilePoints, 35)
    assert.equal(missingMobile.totalPoints, 35)

    const progress = browserFunc.formatSearchProgress(emptyCounters)
    assert.equal(progress.pcProgress, '45/90')
    assert.equal(progress.mobileProgress, '25/60')
})

test('updateModernSearchBreakdownProgress updates modern breakdown progress correctly and caps at max', () => {
    const mockBot = {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        isMobile: false,
        userData: { currentPoints: 100 },
        utils: { wait: () => Promise.resolve() }
    }
    const browserFunc = new BrowserFunc(mockBot)

    browserFunc.setSearchBreakdown({
        desktop: { earned: 42, max: 90 },
        mobile: { earned: 0, max: 60 }
    })

    // Simulate search completion: gained 60 mobile points, 48 desktop points
    browserFunc.updateModernSearchBreakdownProgress(60, 48)

    const breakdown = browserFunc.getSearchBreakdown()
    assert.equal(breakdown.desktop.earned, 90)
    assert.equal(breakdown.mobile.earned, 60)

    const emptyCounters = {
        pcSearch: [],
        mobileSearch: [],
        activityAndQuiz: [],
        dailyPoint: []
    }
    const progress = browserFunc.formatSearchProgress(emptyCounters)
    assert.equal(progress.pcProgress, '90/90')
    assert.equal(progress.mobileProgress, '60/60')

    // Ensure capping: adding extra points does not exceed max
    browserFunc.updateModernSearchBreakdownProgress(10, 10)
    assert.equal(breakdown.desktop.earned, 90)
    assert.equal(breakdown.mobile.earned, 60)
})

test('loadSessionData falls back to alternate device cookies when current file is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reward-session-test-'))
    const email = 'test_fallback@example.com'
    const accountDir = path.join(tmpDir, email)
    fs.mkdirSync(accountDir, { recursive: true })

    const sampleCookies = [
        { name: 'MUID', value: '12345', domain: '.bing.com', path: '/' }
    ]
    // Write mobile cookies only
    fs.writeFileSync(path.join(accountDir, 'session_mobile.json'), JSON.stringify(sampleCookies, null, 2))

    // Attempt to load desktop session (isMobile = false)
    const result = await loadSessionData(tmpDir, email, { desktop: false, mobile: false }, false)

    // Should successfully retrieve cookies from session_mobile.json fallback
    assert.ok(result.cookies && result.cookies.length > 0)
    assert.equal(result.cookies[0].value, '12345')

    // And should have automatically persisted a copy to session_desktop.json
    const desktopFile = path.join(accountDir, 'session_desktop.json')
    assert.ok(fs.existsSync(desktopFile), 'session_desktop.json should have been created as a saved fallback copy')
    const savedDesktop = JSON.parse(fs.readFileSync(desktopFile, 'utf-8'))
    assert.equal(savedDesktop[0].value, '12345')

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true })
})

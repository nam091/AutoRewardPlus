const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { chromium: patchrightChromium } = require('patchright')
const { chromium } = require('playwright-core')
const { FingerprintGenerator } = require('fingerprint-generator')
const { FingerprintInjector } = require('fingerprint-injector')

const { AntiDetectionEngine } = require('../dist/browser/humanize/AntiDetectionEngine')

test('anti-detection profile is stable inside a browser context and resources close', async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<canvas id="sample" width="8" height="8"></canvas>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.notEqual(typeof address, 'string')

    const browser = await chromium.launch({ headless: true, executablePath: patchrightChromium.executablePath() })
    try {
        const fingerprint = new FingerprintGenerator().getFingerprint({
            devices: ['mobile'],
            operatingSystems: ['android'],
            browsers: [{ name: 'chrome' }]
        })
        fingerprint.fingerprint.navigator.hardwareConcurrency = 7
        const context = await browser.newContext({
            userAgent: fingerprint.fingerprint.navigator.userAgent,
            viewport: {
                width: fingerprint.fingerprint.screen.width,
                height: fingerprint.fingerprint.screen.height
            },
            isMobile: true,
            hasTouch: true
        })
        const fingerprintScript = new FingerprintInjector().getInjectableScript(fingerprint)
        await AntiDetectionEngine.applyAll(context, { seed: 123456, isMobile: true }, fingerprintScript)
        const page = await context.newPage()
        await page.goto(`http://127.0.0.1:${address.port}`)

        const snapshot = await page.evaluate(() => {
            const canvas = document.getElementById('sample')
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = '#336699'
            ctx.fillRect(0, 0, 8, 8)
            const read = () => Array.from(ctx.getImageData(0, 0, 8, 8).data).join(',')
            return {
                first: read(),
                second: read(),
                webdriver: navigator.webdriver,
                platform: navigator.platform,
                hardwareConcurrency: navigator.hardwareConcurrency,
                touchPoints: navigator.maxTouchPoints,
                profile: window.__arpProfile
            }
        })

        assert.equal(snapshot.first, snapshot.second)
        assert.equal(snapshot.webdriver, false)
        assert.equal(snapshot.platform, fingerprint.fingerprint.navigator.platform)
        assert.equal(snapshot.hardwareConcurrency, 7)
        assert.equal(snapshot.touchPoints, fingerprint.fingerprint.navigator.maxTouchPoints)
        assert.deepEqual(snapshot.profile, { seed: 123456, device: 'mobile' })

        await context.close()
        assert.equal(browser.contexts().length, 0)
    } finally {
        await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
})

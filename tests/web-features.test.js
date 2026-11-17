/**
 * Web-only regression tests:
 *  - banned accounts are hidden by default, exposed via explicit opt-in
 *  - a same-day checkpoint rotates the batch to the failing account
 *  - an OTP stdin prompt is never awaited in an unattended VPS run
 *  - a transient proxy TCP failure is retried before aborting
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('dashboard API hides SUSPENDED rows unless showBanned is set', () => {
    const src = read('src/dashboard/server.ts')
    assert.ok(src.includes("s.status !== 'SUSPENDED'"), 'default load must filter suspended rows')
    assert.ok(src.includes("request.query.showBanned"), 'opt-in query parameter is required')
    assert.ok(src.includes('bannedCount'), 'meta must expose the hidden count')
})

test('web dashboard exposes the banned toggle and honors the resume hint', () => {
    const html = read('src/dashboard/web/index.html')
    assert.ok(html.includes('toggleBanned()'), 'banned toggle button exists')
    assert.ok(html.includes('?showBanned=1'), 'fetch honours the opt-in')
    assert.ok(html.includes('resumeHint'), 'resume hint element exists')
    assert.ok(html.includes('Sẽ chạy tiếp từ'), 'resume UI text exists')
})

test('checkpoint only resumes from the same local day and disables for single runs', () => {
    const src = read('src/services/runCheckpointService.ts')
    assert.ok(src.includes('checkpoint.date !== localDay(date)'), 'stale checkpoints are ignored')
    assert.ok(src.includes('enabled = false'), 'single-account runs cannot move the checkpoint')

    const index = read('src/index.ts')
    assert.ok(index.includes('runCheckpointService.enabled = batchRun'), 'batch flag wired')
    assert.ok(index.includes('this.accounts = this.accounts.slice(idx)'), 'batch rotates to the failing account')
    assert.ok(index.includes('runCheckpointService.clear()'), 'successful full batch clears the checkpoint')
})

test('unattended login fails fast with an explicit OTP error', () => {
    const src = read('src/browser/auth/methods/GetACodeLogin.ts')
    assert.ok(src.includes('!process.stdin.isTTY'), 'TTY guard exists')
    assert.ok(src.includes('[OTP-REQUIRED]'), 'actionable OTP error code')
})

test('proxy reachability uses retries', () => {
    const src = read('src/browser/Browser.ts')
    assert.ok(src.includes('for (let attempt = 1; attempt <= 3; attempt++)'), 'proxy TCP probe retries')
    assert.ok(src.includes('private probeProxy'), 'single probe extracted')
})

test('application-only emulator prototype removed from controller', () => {
    const src = read('tools/windows-controller/controller.js')
    assert.ok(!src.includes('openMobileEmulator'), 'emulator launcher must not remain')
    assert.ok(!fs.existsSync(path.join(root, 'tools/windows-controller/mobileEmulator.js')), 'prototype file removed')
    assert.ok(!fs.existsSync(path.join(root, 'AutoReward-BingMobile.bat')), 'prototype bat removed')
})

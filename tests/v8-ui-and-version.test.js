const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function extractInlineScripts(html) {
    return [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
}

test('version is bumped to 8.0.0 across package metadata and unified UI, and scheduler state is gitignored', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    assert.equal(pkg.version, '8.0.0');
    assert.equal(lock.version, '8.0.0');
    assert.equal(lock.packages[''].version, '8.0.0');

    const gitignore = read('.gitignore');
    assert.ok(gitignore.includes('src/dashboard/scheduler-state.json'));
    assert.ok(gitignore.includes('scheduler-state.json'));

    const webHtml = read('src/dashboard/web/index.html');
    assert.ok(webHtml.includes('v8.0.0'));
    assert.ok(webHtml.includes('Unified Control'));
    assert.ok(!webHtml.includes('v7.2.2'));
});

test('src/dashboard/web/index.html inline scripts compile cleanly and preserve v8 & legacy hooks', () => {
    const html = read('src/dashboard/web/index.html');
    const scripts = extractInlineScripts(html);
    assert.ok(scripts.length >= 2, 'expected Tailwind config and main inline script');
    scripts.forEach((code, idx) => {
        assert.doesNotThrow(() => new vm.Script(code, { filename: `web/index.html#${idx}` }));
    });

    // Preserved web-features hooks
    for (const token of ['toggleBanned()', '?showBanned=1', 'resumeHint', 'Sẽ chạy tiếp từ']) {
        assert.ok(html.includes(token), `missing preserved hook: ${token}`);
    }

    // Sidebar collapse, redemption/mode, scheduler, and config fields
    const requiredTokens = [
        'leftSidebar',
        'btnToggleSidebar',
        'compactHeaderNav',
        'toggleSidebar',
        'arp_sidebar_hidden',
        'resolveClientMode',
        'renderModeBadge',
        'Quà &amp;',
        'redemptionDesc',
        'NEW_SAFE',
        'FAST_6PLUS',
        'colspan="11"',
        'schedulerHeaderBadge',
        '/api/scheduler',
        '/api/scheduler/reroll',
        '/api/scheduler/run-now',
        'schEnabled',
        'schLocalTz',
        'schVpsTz',
        'schMinHour',
        'schMaxHour',
        'schMinJitter',
        'schMaxJitter',
        'schRequireProxy',
        'cfgAccountsSheetName',
        'cfgSafeSearchMin',
        'cfgSafeSearchMax',
        'cfgSafeReadMin',
        'cfgSafeReadMax',
        'cfgSafeRatioMin',
        'cfgSafeRatioMax',
        'cfgFastSearchMin',
        'cfgFastSearchMax',
        'cfgFastReadMin',
        'cfgFastReadMax',
        'cfgFastExtraRounds'
    ];
    for (const token of requiredTokens) {
        assert.ok(html.includes(token), `missing v8 web UI token: ${token}`);
    }
});

test('local Windows web server is removed and launcher points Windows & Linux to unified web (:3030)', () => {
    assert.equal(
        fs.existsSync(path.join(root, 'tools/windows-controller/server.js')),
        false,
        'duplicate local web UI tools/windows-controller/server.js must be removed'
    );

    const bat = read('AutoReward-WebControl.bat');
    assert.ok(bat.includes('proxyServer.js'), 'launcher must still start local Windows Proxy (:10808)');
    assert.ok(!bat.includes('127.0.0.1:4000'), 'launcher must not open deprecated local web :4000');
    assert.ok(!bat.includes('windows-controller\\server.js'), 'launcher must not start local web server.js');
    assert.ok(bat.includes('100.126.196.30:3030'), 'launcher must open unified web (:3030)');

    const controllerSrc = read('tools/windows-controller/controller.js');
    assert.ok(controllerSrc.includes('/home/ubuntu/AutoRewardPlus-v7.2.1/'), 'VPS directory path must remain unchanged');
});

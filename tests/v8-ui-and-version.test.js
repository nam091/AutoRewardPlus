const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function extractInlineScripts(html) {
    return [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
}

test('version is bumped to 8.0.0 across package metadata and UIs, and scheduler state is gitignored', () => {
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
    assert.ok(!webHtml.includes('v7.2.2'));

    const { HTML_CONTENT } = require(path.join(root, 'tools/windows-controller/server.js'));
    assert.ok(HTML_CONTENT.includes('v8.0.0'));
    assert.ok(!HTML_CONTENT.includes('v7.2.2'));
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

test('tools/windows-controller/server.js HTML_CONTENT scripts compile cleanly and contain v8 features', () => {
    const { HTML_CONTENT } = require(path.join(root, 'tools/windows-controller/server.js'));
    const scripts = extractInlineScripts(HTML_CONTENT);
    assert.ok(scripts.length >= 2, 'expected Tailwind config and main inline script');
    scripts.forEach((code, idx) => {
        assert.doesNotThrow(() => new vm.Script(code, { filename: `windows-controller/server.js#${idx}` }));
    });

    const requiredTokens = [
        'Quà / Mode',
        'colspan="7"',
        'VPS Smart Auto-Scheduler (:3030)',
        'Khi VPS Auto-Scheduler BẬT, không cần đặt Task Scheduler Windows trùng giờ',
        'toggleVpsScheduler',
        'rerollVpsScheduler',
        'resolveClientMode',
        'renderModeBadge',
        'kpiGiftsFast'
    ];
    for (const token of requiredTokens) {
        assert.ok(HTML_CONTENT.includes(token), `missing Windows Center token: ${token}`);
    }

    // Exercise resolveClientMode & escAttrJs directly from rendered script
    const mainScript = scripts[scripts.length - 1];
    const sandbox = {
        document: {
            getElementById: () => ({
                textContent: '',
                innerHTML: '',
                value: '',
                checked: false,
                className: '',
                classList: { add() {}, remove() {}, toggle() {} }
            }),
            querySelectorAll: () => []
        },
        fetch: async () => ({ json: async () => ({}) }),
        setInterval: () => 0,
        setTimeout: () => 0,
        window: { open() {} },
        Intl
    };
    vm.createContext(sandbox);
    vm.runInContext(mainScript, sandbox);

    assert.equal(sandbox.resolveClientMode({ tag: 'new', redemptionCount: 10 }), 'safe');
    assert.equal(sandbox.resolveClientMode({ tag: 'main', redemptionCount: 6 }), 'fast');
    assert.equal(sandbox.resolveClientMode({ tag: 'main', redemptionCount: 2 }), 'standard');
    assert.equal(sandbox.resolveClientMode({ executionMode: 'fast', tag: 'new', redemptionCount: 0 }), 'fast');
    assert.equal(sandbox.escAttrJs("o'reilly@example.com"), 'o\\x27reilly@example.com');
});

test('WindowsController preserves VPS path and exposes scheduler proxy methods + HTTP routes', async () => {
    const controllerSrc = read('tools/windows-controller/controller.js');
    assert.ok(controllerSrc.includes('/home/ubuntu/AutoRewardPlus-v7.2.1/'), 'VPS directory path must remain unchanged');

    const WindowsController = require(path.join(root, 'tools/windows-controller/controller.js'));
    assert.equal(typeof WindowsController.getVPSScheduler, 'function');
    assert.equal(typeof WindowsController.updateVPSScheduler, 'function');
    assert.equal(typeof WindowsController.rerollVPSScheduler, 'function');

    const { server } = require(path.join(root, 'tools/windows-controller/server.js'));

    // Stub WindowsController methods for isolated HTTP route verification
    const origGetSch = WindowsController.getVPSScheduler;
    const origUpdSch = WindowsController.updateVPSScheduler;
    const origRerollSch = WindowsController.rerollVPSScheduler;
    const origTs = WindowsController.getTailscaleStatus;
    const origProxy = WindowsController.ensureProxyRunning;
    const origAutostart = WindowsController.getAutostartStatus;
    const origVpsStatus = WindowsController.getVPSStatus;
    const origVpsAcc = WindowsController.getVPSAccounts;

    WindowsController.getVPSScheduler = async () => ({ success: true, data: { phase: 'COUNTDOWN', enabled: true } });
    WindowsController.updateVPSScheduler = async body => ({ success: true, data: { phase: 'DISABLED', ...body } });
    WindowsController.rerollVPSScheduler = async () => ({ success: true, data: { phase: 'COUNTDOWN', rerolled: true } });
    WindowsController.getTailscaleStatus = () => ({ active: true, ip: '100.64.0.1' });
    WindowsController.ensureProxyRunning = async () => ({ running: true, port: 10808, stats: null });
    WindowsController.getAutostartStatus = () => ({ enabled: false });
    WindowsController.getVPSStatus = async () => ({ success: true, data: { state: 'IDLE' } });
    WindowsController.getVPSAccounts = async () => ({ success: true, data: [], meta: {} });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
        const reqJson = (p, method = 'GET', body = null) =>
            new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json' } }, res => {
                    let raw = '';
                    res.on('data', c => { raw += c; });
                    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
                });
                req.on('error', reject);
                if (body) req.write(JSON.stringify(body));
                req.end();
            });

        const getRes = await reqJson('/api/scheduler');
        assert.equal(getRes.status, 200);
        assert.equal(getRes.body.data.phase, 'COUNTDOWN');

        const putRes = await reqJson('/api/scheduler', 'PUT', { enabled: false });
        assert.equal(putRes.status, 200);
        assert.equal(putRes.body.data.enabled, false);

        const rerollRes = await reqJson('/api/scheduler/reroll', 'POST', {});
        assert.equal(rerollRes.status, 200);
        assert.equal(rerollRes.body.data.rerolled, true);

        const localStatus = await reqJson('/api/local-status');
        assert.equal(localStatus.status, 200);
        assert.equal(localStatus.body.scheduler.data.phase, 'COUNTDOWN');
    } finally {
        WindowsController.getVPSScheduler = origGetSch;
        WindowsController.updateVPSScheduler = origUpdSch;
        WindowsController.rerollVPSScheduler = origRerollSch;
        WindowsController.getTailscaleStatus = origTs;
        WindowsController.ensureProxyRunning = origProxy;
        WindowsController.getAutostartStatus = origAutostart;
        WindowsController.getVPSStatus = origVpsStatus;
        WindowsController.getVPSAccounts = origVpsAcc;
        await new Promise(resolve => server.close(resolve));
    }
});

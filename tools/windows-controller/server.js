const http = require('http');
const url = require('url');
const WindowsController = require('./controller');

const PORT = 4000;

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoRewardPlus - Windows Control Center</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0b0f19; font-family: system-ui, -apple-system, sans-serif; }
    </style>
</head>
<body class="text-slate-100 min-h-screen p-5 antialiased">
    <div class="max-w-4xl mx-auto space-y-6">
        <!-- Header -->
        <header class="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-xl flex justify-between items-center">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-500 flex items-center justify-center font-bold text-white text-lg shadow-lg shadow-cyan-500/20">
                    🎮
                </div>
                <div>
                    <h1 class="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Windows Remote Control Center</h1>
                    <p class="text-xs text-slate-400">Manage AutoRewardPlus on VPS via Tailscale Residential Tunnel</p>
                </div>
            </div>
            <button onclick="refreshData()" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg transition border border-slate-700 flex items-center gap-1.5">
                🔄 Refresh
            </button>
        </header>

        <!-- Status Cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                <div class="text-xs text-slate-400">Tailscale Windows</div>
                <div id="tsStatus" class="text-base font-bold text-slate-200 mt-1 flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-slate-500"></span> Checking...
                </div>
                <div id="tsIp" class="text-[11px] text-slate-500 mt-0.5">—</div>
            </div>
            <div class="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                <div class="text-xs text-slate-400">Residential Proxy (Port 10808)</div>
                <div id="proxyStatus" class="text-base font-bold text-slate-200 mt-1 flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-slate-500"></span> Checking...
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">Residential IP: Routing ready</div>
            </div>
            <div class="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                <div class="text-xs text-slate-400">VPS Engine Status</div>
                <div id="vpsStatus" class="text-base font-bold text-slate-200 mt-1 flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-slate-500"></span> Checking...
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">100.126.196.30:3030</div>
            </div>
        </div>

        <!-- 1-Click Remote Actions -->
        <div class="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-4">
            <div class="flex justify-between items-center">
                <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">1-Click Control Panel</h2>
                <button onclick="testTailscale()" class="px-3 py-1.5 bg-blue-950/60 hover:bg-blue-900 text-cyan-300 border border-cyan-800/50 rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-md">
                    <span>🔍</span>
                    <span>Test Tailscale Connection</span>
                </button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button onclick="triggerAction('start')" class="p-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition shadow-lg shadow-emerald-950 flex flex-col items-center justify-center gap-1.5">
                    <span class="text-lg">🚀</span>
                    <span>Run All on VPS</span>
                </button>
                <button onclick="triggerAction('stop')" class="p-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl transition shadow-lg shadow-rose-950 flex flex-col items-center justify-center gap-1.5">
                    <span class="text-lg">🛑</span>
                    <span>Stop VPS Bot</span>
                </button>
                <button onclick="openVpsDashboard()" class="p-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition shadow-lg shadow-indigo-950 flex flex-col items-center justify-center gap-1.5">
                    <span class="text-lg">📊</span>
                    <span>Open VPS Dashboard</span>
                </button>
                <button onclick="triggerAction('sync')" class="p-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-xl transition shadow-lg shadow-amber-950 flex flex-col items-center justify-center gap-1.5">
                    <span class="text-lg">🔄</span>
                    <span>Sync to VPS</span>
                </button>
            </div>
        </div>

        <!-- Auto Scheduler Section -->
        <div class="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
            <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Daily Task Scheduler (Windows)</h2>
            <p class="text-xs text-slate-400">Automatically verifies Tailscale, launches proxy, and runs VPS bot daily.</p>
            <div class="flex items-center gap-3">
                <input id="scheduleTime" type="time" value="07:30" class="bg-slate-950 border border-slate-700 px-3 py-1.5 rounded-lg text-xs text-white">
                <button onclick="saveSchedule()" class="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold rounded-lg transition shadow-md">
                    ⏰ Save Daily Schedule
                </button>
            </div>
        </div>

        <!-- Accounts Quick View -->
        <div class="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-3">
            <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">VPS Accounts & Regions</h2>
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="text-slate-500 font-semibold border-b border-slate-800 pb-2">
                        <tr>
                            <th class="pb-2">Account</th>
                            <th class="pb-2">Region</th>
                            <th class="pb-2">Points</th>
                            <th class="pb-2">Streak</th>
                            <th class="pb-2">Age</th>
                            <th class="pb-2 text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody id="accountsBody" class="divide-y divide-slate-800/50 font-mono text-slate-300">
                        <tr><td colspan="6" class="py-4 text-center text-slate-500">Loading accounts from VPS...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Toast -->
    <div id="toast" class="fixed bottom-5 right-5 bg-slate-900 border border-cyan-500 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 transform translate-y-20 opacity-0 transition duration-300 z-50 pointer-events-none">
        <span id="toastIcon">ℹ️</span>
        <span id="toastMsg">Notification</span>
    </div>

    <script>
        function showToast(msg, icon = 'ℹ️') {
            const toast = document.getElementById('toast');
            document.getElementById('toastIcon').textContent = icon;
            document.getElementById('toastMsg').textContent = msg;
            toast.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3500);
        }

        async function refreshData() {
            try {
                const res = await fetch('/api/local-status');
                const data = await res.json();

                // Tailscale
                const tsEl = document.getElementById('tsStatus');
                if (data.tailscale.active) {
                    tsEl.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> CONNECTED';
                    tsEl.className = 'text-base font-bold text-emerald-400 mt-1 flex items-center gap-2';
                    document.getElementById('tsIp').textContent = 'IP: ' + data.tailscale.ip;
                } else {
                    tsEl.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> DISCONNECTED';
                    tsEl.className = 'text-base font-bold text-rose-400 mt-1 flex items-center gap-2';
                    document.getElementById('tsIp').textContent = data.tailscale.error;
                }

                // Proxy
                const proxyEl = document.getElementById('proxyStatus');
                if (data.proxy.running) {
                    proxyEl.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> ACTIVE';
                    proxyEl.className = 'text-base font-bold text-emerald-400 mt-1 flex items-center gap-2';
                } else {
                    proxyEl.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> STOPPED';
                    proxyEl.className = 'text-base font-bold text-rose-400 mt-1 flex items-center gap-2';
                }

                // VPS Status
                const vpsEl = document.getElementById('vpsStatus');
                if (data.vps.success && data.vps.data) {
                    const st = data.vps.data.state;
                    const color = st === 'RUNNING' ? 'text-emerald-400' : 'text-cyan-400';
                    vpsEl.innerHTML = \`<span class="w-2.5 h-2.5 rounded-full bg-cyan-400"></span> \${st}\`;
                    vpsEl.className = \`text-base font-bold \${color} mt-1 flex items-center gap-2\`;
                } else {
                    vpsEl.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> NO CONNECTION';
                    vpsEl.className = 'text-base font-bold text-amber-400 mt-1 flex items-center gap-2';
                }

                // Accounts
                if (data.accounts.success && data.accounts.data) {
                    const tbody = document.getElementById('accountsBody');
                    tbody.innerHTML = '';
                    data.accounts.data.forEach(acc => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = \`
                            <td class="py-2.5">\${acc.email}</td>
                            <td class="py-2.5"><span class="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 text-[10px] uppercase font-bold tracking-wider">\${acc.geoLocale || 'vn'}</span></td>
                            <td class="py-2.5 text-amber-400 font-bold">\${Number(acc.totalPoints || 0).toLocaleString()}</td>
                            <td class="py-2.5 text-orange-400">🔥 \${acc.streak || 0}</td>
                            <td class="py-2.5 text-slate-400">\${acc.accountAge || 'N/A'}</td>
                            <td class="py-2.5 text-center">
                                <button onclick="runAccount('\${acc.email}')" class="px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 rounded border border-cyan-500/30 text-[11px] transition">
                                    ⚡ Run
                                </button>
                            </td>
                        \`;
                        tbody.appendChild(tr);
                    });
                }
            } catch (err) {
                showToast('Update error: ' + err.message, '⚠️');
            }
        }

        async function triggerAction(action) {
            try {
                showToast('Sending command ' + action + '...', '⏳');
                const res = await fetch('/api/action/' + action, { method: 'POST' });
                const json = await res.json();
                showToast(json.message || JSON.stringify(json), json.success ? '🚀' : '⚠️');
                refreshData();
            } catch (e) {
                showToast('Error: ' + e.message, '⚠️');
            }
        }

        async function runAccount(email) {
            try {
                showToast('Starting ' + email + '...', '⚡');
                const res = await fetch('/api/action/run-account?email=' + encodeURIComponent(email), { method: 'POST' });
                const json = await res.json();
                showToast(json.message || JSON.stringify(json), json.success ? '🚀' : '⚠️');
                refreshData();
            } catch (e) {
                showToast('Error: ' + e.message, '⚠️');
            }
        }

        async function saveSchedule() {
            const time = document.getElementById('scheduleTime').value;
            try {
                const res = await fetch('/api/action/schedule?time=' + encodeURIComponent(time), { method: 'POST' });
                const json = await res.json();
                showToast(json.message, '⏰');
            } catch (e) {
                showToast('Error: ' + e.message, '⚠️');
            }
        }

        async function testTailscale() {
            try {
                showToast('Testing Tailscale -> VPS connection...', '⏳');
                const res = await fetch('/api/action/test-tailscale', { method: 'POST' });
                const json = await res.json();
                showToast(json.message, json.success ? '✅' : '⚠️');
                refreshData();
            } catch (e) {
                showToast('Connection test error: ' + e.message, '⚠️');
            }
        }

        function openVpsDashboard() {
            window.open('http://100.126.196.30:3030', '_blank');
        }

        refreshData();
        setInterval(refreshData, 10000);
    </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HTML_CONTENT);
    }

    if (parsed.pathname === '/api/local-status') {
        const tailscale = WindowsController.getTailscaleStatus();
        let proxy = { running: false, port: 10808 };
        let vps = { success: false, data: null };
        let accounts = { success: false, data: [] };

        if (tailscale.active) {
            proxy = await WindowsController.ensureProxyRunning();
            try {
                vps = await WindowsController.getVPSStatus();
                accounts = await WindowsController.getVPSAccounts();
            } catch (err) {
                vps = { success: false, message: err.message };
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ tailscale, proxy, vps, accounts }));
    }

    if (parsed.pathname.startsWith('/api/action/')) {
        const action = parsed.pathname.replace('/api/action/', '');
        try {
            let result;
            if (action === 'start') {
                result = await WindowsController.startBot();
            } else if (action === 'stop') {
                result = await WindowsController.stopBot();
            } else if (action === 'sync') {
                result = WindowsController.syncToVPS();
            } else if (action === 'test-tailscale') {
                result = await WindowsController.testTailscaleConnection();
            } else if (action === 'run-account') {
                const email = parsed.query.email;
                result = await WindowsController.runSingleAccount(email);
            } else if (action === 'schedule') {
                const time = parsed.query.time || '07:30';
                result = WindowsController.scheduleDailyTask(time);
            } else {
                throw new Error('Unknown action: ' + action);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, ...result }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: error.message }));
        }
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Windows Control Center] Running at http://127.0.0.1:${PORT}`);
});

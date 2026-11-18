const http = require('http');
const url = require('url');
const WindowsController = require('./controller');

const PORT = parseInt(process.env.WINDOWS_CONTROL_PORT || '4000', 10);

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoRewardPlus - Windows Control & Proxy Center</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['Inter', 'system-ui', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    }
                }
            }
        }
    </script>
    <style>
        body {
            background-color: #070b12;
            background-image:
                radial-gradient(at 0% 0%, rgba(6, 182, 212, 0.08) 0px, transparent 50%),
                radial-gradient(at 100% 0%, rgba(139, 92, 246, 0.08) 0px, transparent 50%),
                radial-gradient(at 50% 100%, rgba(16, 185, 129, 0.05) 0px, transparent 50%);
            background-attachment: fixed;
            font-family: 'Inter', system-ui, sans-serif;
        }
        .glass-card {
            background: rgba(15, 23, 42, 0.72);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.6); }
        ::-webkit-scrollbar-thumb { background: rgba(51, 65, 85, 0.8); border-radius: 9999px; }
    </style>
</head>
<body class="text-slate-100 min-h-screen p-4 md:p-6 antialiased selection:bg-cyan-500 selection:text-white">
    <div class="max-w-7xl mx-auto space-y-5">

        <!-- Header Bar -->
        <header class="glass-card p-4 md:p-5 rounded-2xl shadow-2xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div class="flex items-center gap-3.5">
                <div class="relative w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center font-extrabold text-white text-xl shadow-lg shadow-cyan-500/25 border border-white/20">
                    ⚡
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h1 class="text-lg md:text-xl font-bold bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-300 bg-clip-text text-transparent">AutoRewardPlus Control Center</h1>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">Proxy + VPS</span>
                    </div>
                    <p class="text-xs text-slate-400">Windows Residential Tunnel (:10808) &bull; Oracle Cloud VPS Controller (:3030)</p>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <div id="tsBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-slate-500 animate-pulse"></span>
                    <span class="font-medium">Tailscale: Checking...</span>
                </div>
                <div id="proxyBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-slate-500"></span>
                    <span class="font-medium">Proxy: Checking...</span>
                </div>
                <div id="vpsBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-slate-500"></span>
                    <span class="font-medium">VPS: Connecting...</span>
                </div>
                <button onclick="refreshData()" class="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-medium rounded-xl transition flex items-center gap-1.5">
                    <span id="refreshIcon">🔄</span>
                    <span>Làm mới</span>
                </button>
            </div>
        </header>

        <!-- Active Single-Run Pool Bar -->
        <div id="singlePoolBar" class="hidden glass-card p-3.5 rounded-2xl border border-cyan-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div class="flex flex-wrap items-center gap-2" id="singlePoolItems"></div>
            <button onclick="triggerAction('stop')" class="px-3 py-1 bg-rose-600/80 hover:bg-rose-500 text-white rounded-lg font-semibold">Dừng tất cả acc đơn</button>
        </div>

        <!-- KPI Metrics Ribbon -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div class="glass-card p-4 rounded-2xl">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Tổng điểm tích lũy</div>
                <div id="kpiTotalPoints" class="text-2xl md:text-3xl font-extrabold text-cyan-300 mt-1 font-mono">--</div>
                <div class="text-[11px] text-slate-500 mt-0.5">Toàn bộ tài khoản</div>
            </div>
            <div class="glass-card p-4 rounded-2xl">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Điểm kiếm hôm nay</div>
                <div id="kpiTodayValue" class="text-2xl md:text-3xl font-extrabold text-emerald-400 mt-1 font-mono">--</div>
                <div class="text-[11px] text-slate-500 mt-0.5">Tổng thu hoạch trong ngày</div>
            </div>
            <div class="glass-card p-4 rounded-2xl">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Acc OK / Chạy</div>
                <div id="kpiActiveAccounts" class="text-2xl md:text-3xl font-extrabold text-sky-400 mt-1 font-mono">-- / --</div>
                <div class="text-[11px] text-slate-500 mt-0.5">Slot đơn: <span id="kpiSingleSlots">0/2</span></div>
            </div>
            <div class="glass-card p-4 rounded-2xl">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Lỗi / Đình chỉ</div>
                <div id="kpiErrorSuspended" class="text-2xl md:text-3xl font-extrabold text-amber-400 mt-1 font-mono">-- / --</div>
                <div class="text-[11px] text-slate-500 mt-0.5">Lỗi cần xử lý / Đã ban</div>
            </div>
        </div>

        <!-- Proxy Tool Telemetry & Diagnostics -->
        <div class="glass-card p-5 rounded-2xl shadow-xl space-y-4">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <div>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                        <span>🛡️</span> Tool Residential Proxy (:10808) &bull; Telemetry & Kiểm tra Tunnel
                    </h2>
                    <p id="proxyMetaText" class="text-xs text-slate-400 mt-0.5 font-mono">Đang đọc thống kê proxy...</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button onclick="proxyAction('test-local-proxy')" class="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold transition">🔍 Test Tunnel Local</button>
                    <button onclick="proxyAction('test-vps-proxy')" class="px-3 py-1.5 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-semibold transition">🌐 Test VPS → Proxy</button>
                    <button onclick="proxyAction('sync-proxy-ip')" class="px-3 py-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold transition">📡 Đồng bộ IP lên VPS</button>
                    <button onclick="proxyAction('restart-proxy')" class="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-semibold transition">🔄 Restart Proxy</button>
                </div>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs font-mono">
                <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5"><div class="text-[10px] text-slate-500">TUNNELS ĐANG MỞ</div><div id="pxActive" class="text-sm font-bold text-cyan-300 mt-0.5">0</div></div>
                <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5"><div class="text-[10px] text-slate-500">TỔNG TUNNELS</div><div id="pxTotal" class="text-sm font-bold text-slate-200 mt-0.5">0</div></div>
                <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5"><div class="text-[10px] text-slate-500">DỮ LIỆU GỬI</div><div id="pxBytesIn" class="text-sm font-bold text-slate-200 mt-0.5">0 KB</div></div>
                <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5"><div class="text-[10px] text-slate-500">DỮ LIỆU NHẬN</div><div id="pxBytesOut" class="text-sm font-bold text-emerald-300 mt-0.5">0 KB</div></div>
                <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5"><div class="text-[10px] text-slate-500">LỖI / CHẶN IP</div><div id="pxErrors" class="text-sm font-bold text-amber-300 mt-0.5">0 / 0</div></div>
                <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5"><div class="text-[10px] text-slate-500">UPTIME</div><div id="pxUptime" class="text-sm font-bold text-slate-200 mt-0.5">0s</div></div>
            </div>
        </div>

        <!-- 1-Click Action Hub -->
        <div class="glass-card p-5 rounded-2xl shadow-xl space-y-4">
            <div class="flex justify-between items-center">
                <div>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                        <span>🎮</span> Trung tâm Điều khiển VPS (1-Click)
                    </h2>
                    <p class="text-xs text-slate-400 mt-0.5">Điều phối trực tiếp tới VPS Oracle qua Tailscale</p>
                </div>
                <button onclick="testTailscale()" class="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-medium transition">
                    ⚡ Test Ping Tailscale
                </button>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                <button onclick="triggerAction('start')" class="p-3.5 bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white rounded-xl transition flex flex-col items-center justify-center gap-1.5 border border-emerald-400/20">
                    <span class="text-xl">🚀</span>
                    <div class="text-xs font-bold">Chạy Tất Cả</div>
                    <div class="text-[10px] text-emerald-200">Batch Mode</div>
                </button>
                <button onclick="triggerAction('run-unfinished')" class="p-3.5 bg-gradient-to-br from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 text-white rounded-xl transition flex flex-col items-center justify-center gap-1.5 border border-cyan-400/20">
                    <span class="text-xl">⚡</span>
                    <div class="text-xs font-bold">Chạy Acc Lỗi/Chờ</div>
                    <div class="text-[10px] text-cyan-100">Queue 2 Acc/Lượt</div>
                </button>
                <button onclick="triggerAction('stop')" class="p-3.5 bg-gradient-to-br from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white rounded-xl transition flex flex-col items-center justify-center gap-1.5 border border-rose-400/20">
                    <span class="text-xl">🛑</span>
                    <div class="text-xs font-bold">Dừng Bot</div>
                    <div class="text-[10px] text-rose-200">Stop Batch &amp; Queue</div>
                </button>
                <button onclick="openVpsDashboard()" class="p-3.5 bg-gradient-to-br from-indigo-600 to-violet-700 hover:from-indigo-500 hover:to-violet-600 text-white rounded-xl transition flex flex-col items-center justify-center gap-1.5 border border-indigo-400/20">
                    <span class="text-xl">📊</span>
                    <div class="text-xs font-bold">Mở Web Dashboard</div>
                    <div class="text-[10px] text-indigo-200">Settings &amp; Full UI :3030</div>
                </button>
                <button onclick="triggerAction('sync')" class="p-3.5 bg-gradient-to-br from-amber-600 to-orange-700 hover:from-amber-500 hover:to-orange-600 text-white rounded-xl transition flex flex-col items-center justify-center gap-1.5 border border-amber-400/20 col-span-2 md:col-span-1">
                    <span class="text-xl">🔄</span>
                    <div class="text-xs font-bold">Đồng bộ Session</div>
                    <div class="text-[10px] text-amber-200">Sync to VPS</div>
                </button>
            </div>
        </div>

        <!-- Automation & Startup Settings -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="glass-card p-5 rounded-2xl shadow-xl flex flex-col justify-between space-y-4">
                <div>
                    <div class="flex items-center justify-between">
                        <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-400">💻 Khởi động cùng Windows</h2>
                        <span id="autostartStatusBadge" class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">Đang kiểm tra...</span>
                    </div>
                    <p class="text-xs text-slate-400 mt-1">Tự động khởi động Web Control Center (:4000) và Residential Proxy (:10808) khi bật máy.</p>
                </div>
                <div class="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <div class="text-xs text-slate-300">AutoReward-WebControl.bat --silent</div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input id="toggleAutostart" type="checkbox" onchange="toggleAutostart(this.checked)" class="sr-only peer">
                        <div class="w-11 h-6 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                    </label>
                </div>
            </div>

            <div class="glass-card p-5 rounded-2xl shadow-xl flex flex-col justify-between space-y-4">
                <div>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-400">⏰ Lịch Chạy Hàng Ngày (Windows Task)</h2>
                    <p class="text-xs text-slate-400 mt-1">Kích hoạt tự động chạy dàn tài khoản trên VPS theo khung giờ định sẵn.</p>
                </div>
                <div class="flex items-center gap-3 pt-2 border-t border-slate-800/80">
                    <input id="scheduleTime" type="time" value="07:30" class="bg-slate-900 border border-slate-700/80 px-3 py-2 rounded-xl text-xs text-cyan-300 font-mono">
                    <button onclick="saveSchedule()" class="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-bold rounded-xl transition">💾 Lưu Lịch Hàng Ngày</button>
                </div>
            </div>
        </div>

        <!-- Accounts Table -->
        <div class="glass-card rounded-2xl overflow-hidden shadow-2xl p-5 space-y-4">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-400">👥 Danh sách Tài khoản (Chạy đơn tối đa 2 acc + Hàng đợi tự động)</h2>
                    <p class="text-xs text-slate-400 mt-0.5">Bấm ⚡ để chạy đơn ngay (nếu đã đủ 2/2 slot sẽ tự xếp hàng đợi)</p>
                </div>
                <input id="accountFilter" type="text" onkeyup="filterAccountsTable()" placeholder="Lọc email / trạng thái..." class="w-full sm:w-64 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl text-xs text-slate-200 placeholder-slate-500">
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="text-slate-400 font-semibold border-b border-slate-800 text-[11px] uppercase tracking-wider">
                        <tr>
                            <th class="pb-3 px-2">Tài khoản</th>
                            <th class="pb-3 px-2">Hôm nay</th>
                            <th class="pb-3 px-2">PC</th>
                            <th class="pb-3 px-2">Mobile</th>
                            <th class="pb-3 px-2">Chuỗi</th>
                            <th class="pb-3 px-2">Trạng thái</th>
                            <th class="pb-3 px-2 text-center">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody id="accountsBody" class="divide-y divide-slate-800/40 font-mono text-slate-300">
                        <tr><td colspan="7" class="py-6 text-center text-slate-500">Đang tải dữ liệu từ VPS...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Live Logs -->
        <div class="glass-card rounded-2xl overflow-hidden shadow-2xl p-5 space-y-3">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-slate-300">Live Engine Logs (VPS)</h2>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="fetchLogs()" class="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700">Làm mới</button>
                    <button onclick="clearTerminal()" class="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg border border-slate-700">Xoá</button>
                </div>
            </div>
            <div id="terminal" class="bg-black/80 border border-slate-800/90 rounded-xl p-3.5 font-mono text-[11px] leading-relaxed text-slate-300 h-52 overflow-y-auto space-y-1">
                <div class="text-slate-500">[System] Đang lắng nghe nhật ký hoạt động từ VPS...</div>
            </div>
        </div>
    </div>

    <!-- Toast -->
    <div id="toast" class="fixed bottom-5 right-5 glass-card border border-cyan-500/50 text-white px-4 py-3 rounded-2xl shadow-2xl text-xs flex items-center gap-3 transform translate-y-24 opacity-0 transition duration-300 z-50 pointer-events-none">
        <span id="toastIcon" class="text-base">ℹ️</span>
        <div>
            <div id="toastTitle" class="font-bold text-cyan-300 text-[11px] uppercase tracking-wider">Thông báo</div>
            <div id="toastMsg" class="text-slate-200 mt-0.5">Nội dung</div>
        </div>
    </div>

    <script>
        let rawAccounts = [];
        let singlePool = { maxConcurrent: 2, activeCount: 0, queuedCount: 0, active: [], queue: [] };

        function fmtBytes(bytes) {
            const n = Number(bytes || 0);
            if (n < 1024) return n + ' B';
            if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
            return (n / 1048576).toFixed(2) + ' MB';
        }

        function showToast(msg, icon = 'ℹ️', title = 'Thông báo') {
            const toast = document.getElementById('toast');
            document.getElementById('toastIcon').textContent = icon;
            document.getElementById('toastTitle').textContent = title;
            document.getElementById('toastMsg').textContent = msg;
            toast.classList.remove('translate-y-24', 'opacity-0');
            setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 4500);
        }

        async function refreshData() {
            const refreshIcon = document.getElementById('refreshIcon');
            refreshIcon.classList.add('animate-spin');
            try {
                const res = await fetch('/api/local-status');
                const data = await res.json();

                const tsBadge = document.getElementById('tsBadge');
                if (data.tailscale && data.tailscale.active) {
                    tsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-medium font-mono">Tailscale: ' + (data.tailscale.ip || 'OK') + '</span>';
                    tsBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs';
                } else {
                    tsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span><span class="text-rose-400 font-medium">Tailscale: Disconnected</span>';
                    tsBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs';
                }

                const proxyBadge = document.getElementById('proxyBadge');
                const pStats = data.proxy?.stats;
                if (data.proxy && data.proxy.running) {
                    proxyBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-medium">Proxy :' + data.proxy.port + (pStats ? ' (' + pStats.activeTunnels + ' tunnels)' : '') + '</span>';
                    proxyBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs';
                } else {
                    proxyBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400"></span><span class="text-amber-300 font-medium">Proxy: Offline</span>';
                    proxyBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs';
                }

                if (pStats) {
                    document.getElementById('pxActive').textContent = pStats.activeTunnels ?? 0;
                    document.getElementById('pxTotal').textContent = pStats.totalTunnels ?? 0;
                    document.getElementById('pxBytesIn').textContent = fmtBytes(pStats.bytesIn);
                    document.getElementById('pxBytesOut').textContent = fmtBytes(pStats.bytesOut);
                    document.getElementById('pxErrors').textContent = (pStats.totalErrors ?? 0) + ' / ' + (pStats.blockedRequests ?? 0);
                    document.getElementById('pxUptime').textContent = (pStats.uptimeSec ?? 0) + 's';
                    document.getElementById('proxyMetaText').textContent = 'PID: ' + pStats.pid + ' | Allowlist: ' + pStats.allowlist + ' | Auth: ' + (pStats.authEnabled ? 'ON' : 'OFF');
                }

                const vpsBadge = document.getElementById('vpsBadge');
                if (data.vps && data.vps.success) {
                    const vpsData = data.vps.data || {};
                    singlePool = vpsData.singlePool || singlePool;
                    const modeText = vpsData.mode === 'single' ? 'SINGLE ' + singlePool.activeCount + '/' + singlePool.maxConcurrent : (vpsData.state || 'IDLE');
                    vpsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-medium">VPS: ' + modeText + '</span>';
                    vpsBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs';
                } else {
                    vpsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span><span class="text-rose-400 font-medium">VPS: Offline</span>';
                    vpsBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs';
                }

                renderSinglePoolBar();

                if (data.autostart) {
                    const toggle = document.getElementById('toggleAutostart');
                    const badge = document.getElementById('autostartStatusBadge');
                    toggle.checked = Boolean(data.autostart.enabled);
                    badge.textContent = data.autostart.enabled ? 'ĐÃ BẬT' : 'ĐÃ TẮT';
                }

                if (data.accounts && data.accounts.data) {
                    rawAccounts = data.accounts.data;
                    const meta = data.accounts.meta || {};
                    if (meta.singlePool) singlePool = meta.singlePool;
                    renderSinglePoolBar();
                    filterAccountsTable();
                    updateKPIs(rawAccounts, meta);
                }
            } catch (err) {
                showToast('Lỗi tải dữ liệu: ' + err.message, '⚠️', 'Lỗi');
            } finally {
                setTimeout(() => refreshIcon.classList.remove('animate-spin'), 400);
            }
        }

        function renderSinglePoolBar() {
            const bar = document.getElementById('singlePoolBar');
            const items = document.getElementById('singlePoolItems');
            const active = singlePool.active || [];
            const queue = singlePool.queue || [];
            document.getElementById('kpiSingleSlots').textContent = active.length + '/' + (singlePool.maxConcurrent || 2);

            if (active.length === 0 && queue.length === 0) {
                bar.classList.add('hidden');
                return;
            }
            bar.classList.remove('hidden');
            const parts = [];
            parts.push('<span class="font-bold text-cyan-300">Chạy đơn (' + active.length + '/' + (singlePool.maxConcurrent || 2) + '):</span>');
            for (const r of active) {
                parts.push('<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-200 font-mono">▶ ' + r.email + ' (' + r.uptimeSec + 's) <button onclick="stopSingleAccount(\'' + r.email + '\')" class="text-rose-400 hover:text-rose-300 font-bold">✕</button></span>');
            }
            for (let i = 0; i < queue.length; i++) {
                const q = queue[i];
                parts.push('<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-200 font-mono">⏳ #' + (i + 1) + ' ' + q.email + ' <button onclick="stopSingleAccount(\'' + q.email + '\')" class="text-rose-400 hover:text-rose-300 font-bold">✕</button></span>');
            }
            items.innerHTML = parts.join('');
        }

        function updateKPIs(accounts, meta) {
            let total = 0, today = 0, ok = 0, err = 0;
            for (const acc of accounts) {
                total += (acc.totalPoints || 0);
                today += (acc.dailyPoints || 0);
                if (acc.status === 'OK' || acc.status === 'RUNNING') ok++;
                if (acc.status === 'ERROR') err++;
            }
            document.getElementById('kpiTotalPoints').textContent = total.toLocaleString('vi-VN');
            document.getElementById('kpiTodayValue').textContent = '+' + today.toLocaleString('vi-VN') + ' pts';
            document.getElementById('kpiActiveAccounts').textContent = ok + ' / ' + accounts.length;
            document.getElementById('kpiErrorSuspended').textContent = err + ' / ' + Number(meta?.bannedCount || 0);
        }

        function renderAccountsTable(accounts) {
            const tbody = document.getElementById('accountsBody');
            if (!accounts || accounts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500">Không có tài khoản nào.</td></tr>';
                return;
            }
            tbody.innerHTML = accounts.map(acc => {
                const statusClass = acc.status === 'OK' ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40' :
                    acc.status === 'RUNNING' ? 'bg-cyan-950/60 text-cyan-300 border-cyan-500/40 animate-pulse' :
                    acc.status === 'ERROR' ? 'bg-rose-950/60 text-rose-300 border-rose-500/40' :
                    'bg-slate-800 text-slate-300 border-slate-700';

                let actionHtml = '';
                if (acc.singleRunning) {
                    actionHtml = \`<button onclick="stopSingleAccount('\${acc.email}')" class="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 rounded-lg text-[10px] font-semibold border border-rose-500/40">■ Dừng</button>\`;
                } else if (acc.queued) {
                    actionHtml = \`<button onclick="stopSingleAccount('\${acc.email}')" class="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/35 text-amber-300 rounded-lg text-[10px] font-semibold border border-amber-500/40">✕ Huỷ (#\${acc.queuePosition})</button>\`;
                } else {
                    actionHtml = \`<button onclick="runSingleAccount('\${acc.email}')" class="px-2.5 py-1 bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 rounded-lg text-[10px] font-semibold border border-cyan-500/30">⚡ Chạy đơn</button>\`;
                }

                return \`
                    <tr class="hover:bg-slate-800/30 transition">
                        <td class="py-2.5 px-2">
                            <div class="font-medium text-slate-200">\${acc.email}</div>
                            <div class="text-[10px] text-slate-500">\${acc.level || 'Level 1'} &bull; \${acc.enabled === false ? 'DISABLED' : (acc.geoLocale || 'vn').toUpperCase()}</div>
                        </td>
                        <td class="py-2.5 px-2"><span class="font-bold text-emerald-400">+\${acc.dailyPoints || 0}</span> <span class="text-[10px] text-slate-500">(\${(acc.totalPoints || 0).toLocaleString('vi-VN')})</span></td>
                        <td class="py-2.5 px-2 text-sky-300 font-semibold">\${acc.pcProgress || '0/90'}</td>
                        <td class="py-2.5 px-2 text-indigo-300 font-semibold">\${acc.mobileProgress || '0/60'}</td>
                        <td class="py-2.5 px-2 text-amber-400 font-bold">\${acc.streak ? acc.streak + 'd 🔥' : '0d'}</td>
                        <td class="py-2.5 px-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold border \${statusClass}">\${acc.status}</span></td>
                        <td class="py-2.5 px-2 text-center">\${actionHtml}</td>
                    </tr>
                \`;
            }).join('');
        }

        function filterAccountsTable() {
            const query = (document.getElementById('accountFilter').value || '').toLowerCase().trim();
            const filtered = !query ? rawAccounts : rawAccounts.filter(a =>
                (a.email || '').toLowerCase().includes(query) ||
                (a.status || '').toLowerCase().includes(query)
            );
            renderAccountsTable(filtered);
        }

        async function triggerAction(action) {
            showToast('Đang thực hiện ' + action + '...', '⏳');
            try {
                const res = await fetch('/api/action/' + action);
                const data = await res.json();
                showToast(data.message || 'Hoàn tất!', data.success ? '✅' : '❌');
                setTimeout(refreshData, 1000);
            } catch (err) {
                showToast(err.message, '❌');
            }
        }

        async function proxyAction(action) {
            showToast('Đang kiểm tra proxy...', '⏳');
            try {
                const res = await fetch('/api/action/' + action);
                const data = await res.json();
                const msg = data.data?.message || data.message || 'Xong';
                showToast(msg, data.success ? '✅' : '⚠️', 'Proxy Diagnostics');
                setTimeout(refreshData, 800);
            } catch (err) {
                showToast(err.message, '❌');
            }
        }

        async function runSingleAccount(email) {
            try {
                const res = await fetch('/api/action/run-account?email=' + encodeURIComponent(email));
                const data = await res.json();
                showToast(data.message || ('Đã kích hoạt ' + email), data.success ? '🚀' : '⚠️');
                setTimeout(refreshData, 800);
            } catch (err) {
                showToast(err.message, '❌');
            }
        }

        async function stopSingleAccount(email) {
            try {
                const res = await fetch('/api/action/stop-account?email=' + encodeURIComponent(email));
                const data = await res.json();
                showToast(data.message || ('Đã dừng ' + email), data.success ? '🛑' : '⚠️');
                setTimeout(refreshData, 800);
            } catch (err) {
                showToast(err.message, '❌');
            }
        }

        async function toggleAutostart(enabled) {
            const res = await fetch('/api/action/autostart?enabled=' + enabled);
            const data = await res.json();
            showToast(data.message, data.success ? '✨' : '❌');
            refreshData();
        }

        async function testTailscale() {
            const res = await fetch('/api/action/test-tailscale');
            const data = await res.json();
            showToast(data.message, data.success ? '⚡' : '⚠️');
        }

        async function saveSchedule() {
            const time = document.getElementById('scheduleTime').value;
            const res = await fetch('/api/action/schedule?time=' + encodeURIComponent(time));
            const data = await res.json();
            showToast(data.message, data.success ? '⏰' : '❌');
        }

        function openVpsDashboard() {
            window.open('http://100.126.196.30:3030', '_blank');
        }

        async function fetchLogs() {
            try {
                const res = await fetch('/api/action/logs');
                const data = await res.json();
                if (data.success && data.data) {
                    const term = document.getElementById('terminal');
                    term.innerHTML = data.data.slice(-60).map(entry => {
                        const cls = entry.level === 'error' ? 'text-rose-400' : entry.level === 'warn' ? 'text-amber-400' : 'text-slate-300';
                        return \`<div class="\${cls}">[\${(entry.timestamp || '').slice(11, 19)}] \${entry.message}</div>\`;
                    }).join('');
                    term.scrollTop = term.scrollHeight;
                }
            } catch {}
        }

        function clearTerminal() {
            document.getElementById('terminal').innerHTML = '<div class="text-slate-500">[System] Đã xoá log màn hình.</div>';
        }

        refreshData();
        fetchLogs();
        setInterval(refreshData, 10000);
        setInterval(fetchLogs, 5000);
    </script>
</body>
</html>`;

// Background watchdog: keeps local residential proxy healthy whenever Tailscale is up
setInterval(async () => {
    try {
        const ts = WindowsController.getTailscaleStatus();
        if (ts.active) {
            await WindowsController.ensureProxyRunning();
        }
    } catch {}
}, 30000).unref();

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HTML_CONTENT);
    }

    if (parsed.pathname === '/api/local-status') {
        const tailscale = WindowsController.getTailscaleStatus();
        let proxy = { running: false, port: 10808, stats: null };
        let vps = { success: false, data: null };
        let accounts = { success: false, data: [], meta: {} };
        const autostart = WindowsController.getAutostartStatus();

        proxy = await WindowsController.ensureProxyRunning();
        if (tailscale.active) {
            try {
                [vps, accounts] = await Promise.all([
                    WindowsController.getVPSStatus(),
                    WindowsController.getVPSAccounts()
                ]);
            } catch (err) {
                vps = { success: false, message: err.message };
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ tailscale, proxy, vps, accounts, autostart }));
    }

    if (parsed.pathname.startsWith('/api/action/')) {
        const action = parsed.pathname.replace('/api/action/', '');
        try {
            let result;
            if (action === 'start') {
                result = await WindowsController.startBot();
            } else if (action === 'stop') {
                result = await WindowsController.stopBot();
            } else if (action === 'run-unfinished') {
                result = await WindowsController.runUnfinishedAccounts();
            } else if (action === 'sync') {
                result = WindowsController.syncToVPS();
            } else if (action === 'test-tailscale') {
                result = await WindowsController.testTailscaleConnection();
            } else if (action === 'test-local-proxy') {
                result = await WindowsController.testLocalProxyOutbound();
            } else if (action === 'test-vps-proxy') {
                result = await WindowsController.testVpsProxy();
            } else if (action === 'restart-proxy') {
                result = await WindowsController.restartProxy();
            } else if (action === 'sync-proxy-ip') {
                result = await WindowsController.syncProxyIpToVps();
            } else if (action === 'run-account') {
                result = await WindowsController.runSingleAccount(parsed.query.email);
            } else if (action === 'stop-account') {
                result = await WindowsController.stopSingleAccount(parsed.query.email);
            } else if (action === 'schedule') {
                result = WindowsController.scheduleDailyTask(parsed.query.time || '07:30');
            } else if (action === 'autostart') {
                result = WindowsController.setAutostart(parsed.query.enabled === 'true' || parsed.query.enabled === '1');
            } else if (action === 'logs') {
                result = await WindowsController.getVPSLogs();
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

const http = require('http');
const url = require('url');
const WindowsController = require('./controller');

const PORT = 4000;

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoRewardPlus - Windows Control Center</title>
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
                    },
                    colors: {
                        obsidian: '#070b12',
                        cardDark: 'rgba(15, 23, 42, 0.75)',
                        borderDark: 'rgba(255, 255, 255, 0.08)',
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
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .glass-card-hover {
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .glass-card-hover:hover {
            border-color: rgba(6, 182, 212, 0.35);
            box-shadow: 0 10px 30px -10px rgba(6, 182, 212, 0.15);
            transform: translateY(-2px);
        }
        /* Custom scrollbar */
        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        ::-webkit-scrollbar-track {
            background: rgba(15, 23, 42, 0.6);
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(51, 65, 85, 0.8);
            border-radius: 9999px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(100, 116, 139, 1);
        }
        @keyframes pulse-slow {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        .animate-pulse-slow {
            animation: pulse-slow 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
    </style>
</head>
<body class="text-slate-100 min-h-screen p-4 md:p-6 antialiased selection:bg-cyan-500 selection:text-white">
    <div class="max-w-6xl mx-auto space-y-6">

        <!-- Header Bar -->
        <header class="glass-card p-4 md:p-5 rounded-2xl shadow-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div class="flex items-center gap-3.5">
                <div class="relative w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center font-extrabold text-white text-xl shadow-lg shadow-cyan-500/25 border border-white/20">
                    ⚡
                    <span class="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-[#070b12] rounded-full animate-ping"></span>
                    <span class="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-[#070b12] rounded-full"></span>
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h1 class="text-lg md:text-xl font-bold bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-300 bg-clip-text text-transparent">AutoRewardPlus</h1>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">v7.2.2 Enterprise</span>
                    </div>
                    <p class="text-xs text-slate-400">Windows Residential Tunnel &bull; Oracle Cloud VPS Controller</p>
                </div>
            </div>

            <!-- Health Status Badges -->
            <div class="flex flex-wrap items-center gap-2">
                <div id="tsBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-slate-500 animate-pulse"></span>
                    <span class="font-medium">Tailscale: Checking...</span>
                </div>
                <div id="proxyBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span class="font-medium">Proxy: :10808</span>
                </div>
                <div id="vpsBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-slate-500"></span>
                    <span class="font-medium">VPS: Connecting...</span>
                </div>
                <button onclick="refreshData()" title="Làm mới trạng thái" class="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 active:scale-95 text-cyan-300 border border-cyan-500/30 text-xs font-medium rounded-xl transition flex items-center gap-1.5">
                    <span id="refreshIcon">🔄</span>
                    <span>Làm mới</span>
                </button>
            </div>
        </header>

        <!-- KPI Metrics Ribbon -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div class="glass-card glass-card-hover p-4 rounded-2xl relative overflow-hidden">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Tổng điểm tích lũy</div>
                <div id="kpiTotalPoints" class="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 mt-1 font-mono">
                    --
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">Dàn tài khoản Microsoft Rewards</div>
                <div class="absolute top-3 right-3 text-2xl opacity-20">🏆</div>
            </div>

            <div class="glass-card glass-card-hover p-4 rounded-2xl relative overflow-hidden">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Điểm kiếm hôm nay</div>
                <div id="kpiTodayPoints" class="text-2xl md:text-3xl font-extrabold text-emerald-400 mt-1 font-mono flex items-baseline gap-1">
                    <span id="kpiTodayValue">--</span>
                    <span class="text-xs font-normal text-emerald-500/80">pts</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">Tính theo balance live 24h</div>
                <div class="absolute top-3 right-3 text-2xl opacity-20">⚡</div>
            </div>

            <div class="glass-card glass-card-hover p-4 rounded-2xl relative overflow-hidden">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Tài khoản Hoạt động</div>
                <div id="kpiActiveAccounts" class="text-2xl md:text-3xl font-extrabold text-sky-400 mt-1 font-mono">
                    -- / --
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">Đã vượt qua kiểm tra an toàn</div>
                <div class="absolute top-3 right-3 text-2xl opacity-20">🟢</div>
            </div>

            <div class="glass-card glass-card-hover p-4 rounded-2xl relative overflow-hidden">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Tài khoản Đình chỉ</div>
                <div id="kpiSuspendedAccounts" class="text-2xl md:text-3xl font-extrabold text-purple-400 mt-1 font-mono">
                    --
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">Đã cách ly, không tốn tài nguyên</div>
                <div class="absolute top-3 right-3 text-2xl opacity-20">🛡️</div>
            </div>
        </div>

        <!-- 1-Click Action Hub -->
        <div class="glass-card p-5 rounded-2xl shadow-xl space-y-4">
            <div class="flex justify-between items-center">
                <div>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                        <span>🎮</span> Trung tâm Điều khiển 1-Click
                    </h2>
                    <p class="text-xs text-slate-400 mt-0.5">Thao tác trực tiếp tới hệ thống trên VPS Oracle qua luồng bảo mật</p>
                </div>
                <button onclick="testTailscale()" class="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-sm active:scale-95">
                    <span>⚡</span>
                    <span>Test Ping Tailscale</span>
                </button>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button onclick="triggerAction('start')" class="group p-4 bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 active:scale-[0.98] text-white rounded-xl transition shadow-lg shadow-emerald-950/50 flex flex-col items-center justify-center gap-2 border border-emerald-400/20">
                    <span class="text-2xl group-hover:scale-110 transition-transform">🚀</span>
                    <div class="text-center">
                        <div class="text-xs font-bold">Chạy 3 Cụm Song Song</div>
                        <div class="text-[10px] text-emerald-200">Run All Accounts</div>
                    </div>
                </button>

                <button onclick="triggerAction('stop')" class="group p-4 bg-gradient-to-br from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 active:scale-[0.98] text-white rounded-xl transition shadow-lg shadow-rose-950/50 flex flex-col items-center justify-center gap-2 border border-rose-400/20">
                    <span class="text-2xl group-hover:scale-110 transition-transform">🛑</span>
                    <div class="text-center">
                        <div class="text-xs font-bold">Dừng Bot Khẩn Cấp</div>
                        <div class="text-[10px] text-rose-200">Stop VPS Engine</div>
                    </div>
                </button>

                <button onclick="openVpsDashboard()" class="group p-4 bg-gradient-to-br from-indigo-600 to-violet-700 hover:from-indigo-500 hover:to-violet-600 active:scale-[0.98] text-white rounded-xl transition shadow-lg shadow-indigo-950/50 flex flex-col items-center justify-center gap-2 border border-indigo-400/20">
                    <span class="text-2xl group-hover:scale-110 transition-transform">📊</span>
                    <div class="text-center">
                        <div class="text-xs font-bold">Mở Web Dashboard</div>
                        <div class="text-[10px] text-indigo-200">Port :3030 Live</div>
                    </div>
                </button>

                <button onclick="triggerAction('sync')" class="group p-4 bg-gradient-to-br from-amber-600 to-orange-700 hover:from-amber-500 hover:to-orange-600 active:scale-[0.98] text-white rounded-xl transition shadow-lg shadow-amber-950/50 flex flex-col items-center justify-center gap-2 border border-amber-400/20">
                    <span class="text-2xl group-hover:scale-110 transition-transform">🔄</span>
                    <div class="text-center">
                        <div class="text-xs font-bold">Đồng bộ Session</div>
                        <div class="text-[10px] text-amber-200">Sync to VPS</div>
                    </div>
                </button>
            </div>
        </div>

        <!-- Automation & Startup Settings (Two-Column Layout) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

            <!-- Windows Startup Auto-Boot Card -->
            <div class="glass-card p-5 rounded-2xl shadow-xl flex flex-col justify-between space-y-4">
                <div>
                    <div class="flex items-center justify-between">
                        <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                            <span>💻</span> Khởi động cùng Windows
                        </h2>
                        <span id="autostartStatusBadge" class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                            Đang kiểm tra...
                        </span>
                    </div>
                    <p class="text-xs text-slate-400 mt-1">
                        Tự động khởi động ngầm trong khay hệ thống (System Tray) khi bật máy, duy trì Residential Proxy :10808 cho VPS hoạt động 24/7 mà không làm phiền màn hình.
                    </p>
                </div>

                <div class="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <div class="text-xs text-slate-300">
                        <div class="font-medium">Chế độ chạy ngầm System Tray</div>
                        <div class="text-[11px] text-slate-500">AutoRewardPlus.exe --silent</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input id="toggleAutostart" type="checkbox" onchange="toggleAutostart(this.checked)" class="sr-only peer">
                        <div class="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                    </label>
                </div>
            </div>

            <!-- Human-Cadence Smart Scheduler Card -->
            <div class="glass-card p-5 rounded-2xl shadow-xl flex flex-col justify-between space-y-4">
                <div>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                        <span>⏰</span> Lịch Chạy Hàng Ngày (Smart Jitter)
                    </h2>
                    <p class="text-xs text-slate-400 mt-1">
                        Cơ chế chống phát hiện: Tự động thêm độ trễ ngẫu nhiên 15-60 phút xung quanh mốc giờ hẹn để mô phỏng hành vi người dùng thật.
                    </p>
                </div>

                <div class="flex items-center gap-3 pt-2 border-t border-slate-800/80">
                    <input id="scheduleTime" type="time" value="07:30" class="bg-slate-900 border border-slate-700/80 px-3 py-2 rounded-xl text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500">
                    <button onclick="saveSchedule()" class="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-bold rounded-xl transition shadow-md shadow-cyan-950 flex items-center justify-center gap-1.5 active:scale-95">
                        <span>💾</span>
                        <span>Lưu Lịch Chạy Hàng Ngày</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Accounts Table -->
        <div class="glass-card rounded-2xl overflow-hidden shadow-2xl p-5 space-y-4">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                        <span>👥</span> Danh sách Tài khoản & Tiến độ Live
                    </h2>
                    <p class="text-xs text-slate-400 mt-0.5">Tiến độ cày điểm PC Search (90 đ), Mobile Search (60 đ) và trạng thái tài khoản</p>
                </div>
                <div class="flex items-center gap-2 w-full sm:w-auto">
                    <input id="accountFilter" type="text" onkeyup="filterAccountsTable()" placeholder="Lọc theo email / trạng thái..." class="w-full sm:w-64 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500">
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="text-slate-400 font-semibold border-b border-slate-800 text-[11px] uppercase tracking-wider">
                        <tr>
                            <th class="pb-3 px-2">Tài khoản</th>
                            <th class="pb-3 px-2">Hôm nay</th>
                            <th class="pb-3 px-2">PC Search (90đ)</th>
                            <th class="pb-3 px-2">Mobile (60đ)</th>
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

        <!-- Live Terminal / Logs Panel -->
        <div class="glass-card rounded-2xl overflow-hidden shadow-2xl p-5 space-y-3">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-slate-300">Live Engine Logs (VPS)</h2>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="fetchLogs()" class="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition border border-slate-700">
                        Làm mới Logs
                    </button>
                    <button onclick="clearTerminal()" class="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg transition border border-slate-700">
                        Xóa màn hình
                    </button>
                </div>
            </div>
            <div id="terminal" class="bg-black/80 border border-slate-800/90 rounded-xl p-3.5 font-mono text-[11px] leading-relaxed text-slate-300 h-48 overflow-y-auto space-y-1">
                <div class="text-slate-500">[System] Đang lắng nghe nhật ký hoạt động từ VPS...</div>
            </div>
        </div>

    </div>

    <!-- Toast Notification -->
    <div id="toast" class="fixed bottom-5 right-5 glass-card border border-cyan-500/50 text-white px-4 py-3 rounded-2xl shadow-2xl text-xs flex items-center gap-3 transform translate-y-24 opacity-0 transition duration-300 z-50 pointer-events-none">
        <span id="toastIcon" class="text-base">ℹ️</span>
        <div>
            <div id="toastTitle" class="font-bold text-cyan-300 text-[11px] uppercase tracking-wider">Thông báo</div>
            <div id="toastMsg" class="text-slate-200 mt-0.5">Nội dung</div>
        </div>
    </div>

    <script>
        let rawAccounts = [];

        function showToast(msg, icon = 'ℹ️', title = 'Thông báo') {
            const toast = document.getElementById('toast');
            document.getElementById('toastIcon').textContent = icon;
            document.getElementById('toastTitle').textContent = title;
            document.getElementById('toastMsg').textContent = msg;
            toast.classList.remove('translate-y-24', 'opacity-0');
            setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 4000);
        }

        async function refreshData() {
            const refreshIcon = document.getElementById('refreshIcon');
            refreshIcon.classList.add('animate-spin');

            try {
                const res = await fetch('/api/local-status');
                const data = await res.json();

                // 1. Tailscale Badge
                const tsBadge = document.getElementById('tsBadge');
                if (data.tailscale && data.tailscale.active) {
                    tsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-medium font-mono">Tailscale: ' + (data.tailscale.ip || 'OK') + '</span>';
                    tsBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs';
                } else {
                    tsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span><span class="text-rose-400 font-medium">Tailscale: Disconnected</span>';
                    tsBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs';
                }

                // 2. Proxy Badge
                const proxyBadge = document.getElementById('proxyBadge');
                if (data.proxy && data.proxy.running) {
                    proxyBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-medium">Proxy: :10808 Ready</span>';
                    proxyBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs';
                } else {
                    proxyBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400"></span><span class="text-amber-300 font-medium">Proxy: Offline</span>';
                    proxyBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs';
                }

                // 3. VPS Badge
                const vpsBadge = document.getElementById('vpsBadge');
                if (data.vps && data.vps.success) {
                    const state = data.vps.data?.state || 'Running';
                    vpsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-medium">VPS Engine: ' + state + '</span>';
                    vpsBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs';
                } else {
                    vpsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span><span class="text-rose-400 font-medium">VPS: Không phản hồi</span>';
                    vpsBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs';
                }

                // 4. Autostart Status
                if (data.autostart) {
                    const toggle = document.getElementById('toggleAutostart');
                    const badge = document.getElementById('autostartStatusBadge');
                    toggle.checked = Boolean(data.autostart.enabled);
                    if (data.autostart.enabled) {
                        badge.textContent = 'ĐÃ BẬT';
                        badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40';
                    } else {
                        badge.textContent = 'ĐÃ TẮT';
                        badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700';
                    }
                }

                // 5. Render Accounts & KPIs
                if (data.accounts && data.accounts.data) {
                    rawAccounts = data.accounts.data;
                    renderAccountsTable(rawAccounts);
                    updateKPIs(rawAccounts);
                }

            } catch (err) {
                showToast('Lỗi khi tải dữ liệu: ' + err.message, '⚠️', 'Lỗi Kết Nối');
            } finally {
                setTimeout(() => refreshIcon.classList.remove('animate-spin'), 600);
            }
        }

        function updateKPIs(accounts) {
            let total = 0;
            let today = 0;
            let active = 0;
            let suspended = 0;

            for (const acc of accounts) {
                total += (acc.totalPoints || 0);
                today += (acc.dailyPoints || 0);
                if (acc.status === 'SUSPENDED') {
                    suspended++;
                } else {
                    active++;
                }
            }

            document.getElementById('kpiTotalPoints').textContent = total.toLocaleString('vi-VN');
            document.getElementById('kpiTodayValue').textContent = '+' + today.toLocaleString('vi-VN');
            document.getElementById('kpiActiveAccounts').textContent = active + ' / ' + accounts.length;
            document.getElementById('kpiSuspendedAccounts').textContent = suspended;
        }

        function renderAccountsTable(accounts) {
            const tbody = document.getElementById('accountsBody');
            if (!accounts || accounts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500">Không có tài khoản nào.</td></tr>';
                return;
            }

            tbody.innerHTML = accounts.map(acc => {
                const isSuspended = acc.status === 'SUSPENDED';
                const isOk = acc.status === 'OK';
                const isRunning = acc.status === 'RUNNING';

                let statusBadge = '';
                if (isSuspended) {
                    statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-950/60 text-purple-300 border border-purple-500/40">SUSPENDED</span>';
                } else if (isOk) {
                    statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/40">OK</span>';
                } else if (isRunning) {
                    statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/40 animate-pulse">RUNNING</span>';
                } else {
                    statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/60 text-rose-300 border border-rose-500/40">' + (acc.status || 'ERROR') + '</span>';
                }

                const pcText = acc.pcProgress || '0/90';
                const mobText = acc.mobileProgress || '0/60';

                return \`
                    <tr class="hover:bg-slate-800/30 transition">
                        <td class="py-2.5 px-2">
                            <div class="font-medium text-slate-200">\${acc.email}</div>
                            <div class="text-[10px] text-slate-500">\${acc.level || 'Silver'} &bull; \${acc.accountAge || ''}</div>
                        </td>
                        <td class="py-2.5 px-2">
                            <span class="font-bold text-emerald-400">+\${acc.dailyPoints || 0}</span>
                            <div class="text-[10px] text-slate-500">Tổng: \${(acc.totalPoints || 0).toLocaleString('vi-VN')}</div>
                        </td>
                        <td class="py-2.5 px-2">
                            <span class="text-sky-300 font-semibold">\${pcText}</span>
                        </td>
                        <td class="py-2.5 px-2">
                            <span class="text-indigo-300 font-semibold">\${mobText}</span>
                        </td>
                        <td class="py-2.5 px-2">
                            <span class="text-amber-400 font-bold">\${acc.streak ? acc.streak + 'd 🔥' : '0d'}</span>
                        </td>
                        <td class="py-2.5 px-2">
                            \${statusBadge}
                        </td>
                        <td class="py-2.5 px-2 text-center">
                            \${isSuspended ? 
                                '<span class="text-[10px] text-slate-600">Đã cách ly</span>' :
                                \`<button onclick="runSingleAccount('\${acc.email}')" class="px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/25 active:scale-95 text-cyan-300 rounded-lg text-[10px] font-medium border border-cyan-500/30 transition">
                                    Chạy nick này
                                </button>\`
                            }
                        </td>
                    </tr>
                \`;
            }).join('');
        }

        function filterAccountsTable() {
            const query = (document.getElementById('accountFilter').value || '').toLowerCase().trim();
            if (!query) {
                renderAccountsTable(rawAccounts);
                return;
            }
            const filtered = rawAccounts.filter(a => 
                (a.email || '').toLowerCase().includes(query) || 
                (a.status || '').toLowerCase().includes(query) ||
                (a.level || '').toLowerCase().includes(query)
            );
            renderAccountsTable(filtered);
        }

        async function triggerAction(action) {
            showToast('Đang thực hiện lệnh ' + action.toUpperCase() + '...', '⏳', 'Đang xử lý');
            try {
                const res = await fetch('/api/action/' + action);
                const data = await res.json();
                if (data.success) {
                    showToast(data.message || 'Thực hiện lệnh thành công!', '✅', 'Thành Công');
                    setTimeout(refreshData, 1500);
                } else {
                    showToast(data.message || 'Lỗi khi thực hiện lệnh', '❌', 'Thất Bại');
                }
            } catch (err) {
                showToast(err.message, '❌', 'Lỗi Ngoại Lệ');
            }
        }

        async function runSingleAccount(email) {
            showToast('Đang kích hoạt tài khoản ' + email + ' trên VPS...', '⏳', 'Kích hoạt');
            try {
                const res = await fetch('/api/action/run-account?email=' + encodeURIComponent(email));
                const data = await res.json();
                if (data.success) {
                    showToast('Đã bắt đầu chạy ' + email + '!', '🚀', 'Thành Công');
                    setTimeout(refreshData, 1500);
                } else {
                    showToast(data.message, '❌', 'Lỗi');
                }
            } catch (err) {
                showToast(err.message, '❌', 'Lỗi');
            }
        }

        async function toggleAutostart(enabled) {
            showToast(enabled ? 'Đang bật khởi động cùng Windows...' : 'Đang tắt khởi động cùng Windows...', '⏳');
            try {
                const res = await fetch('/api/action/autostart?enabled=' + enabled);
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, '✨', 'Khởi Động Windows');
                    refreshData();
                } else {
                    showToast(data.message, '❌', 'Lỗi Cài Đặt');
                }
            } catch (err) {
                showToast(err.message, '❌', 'Lỗi');
            }
        }

        async function testTailscale() {
            showToast('Đang kiểm tra ping tới VPS qua Tailscale...', '🔍', 'Ping Test');
            try {
                const res = await fetch('/api/action/test-tailscale');
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, '⚡', 'Tailscale OK');
                } else {
                    showToast(data.message, '⚠️', 'Tailscale Lỗi');
                }
            } catch (err) {
                showToast(err.message, '❌', 'Lỗi');
            }
        }

        async function saveSchedule() {
            const time = document.getElementById('scheduleTime').value;
            showToast('Đang lưu lịch chạy: ' + time + '...', '⏳');
            try {
                const res = await fetch('/api/action/schedule?time=' + encodeURIComponent(time));
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, '⏰', 'Lên Lịch Thành Công');
                } else {
                    showToast(data.message, '❌', 'Lỗi');
                }
            } catch (err) {
                showToast(err.message, '❌', 'Lỗi');
            }
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
                    term.innerHTML = data.data.slice(-50).map(entry => {
                        const levelColor = entry.level === 'error' ? 'text-rose-400' :
                                          entry.level === 'warn' ? 'text-amber-400' : 'text-slate-300';
                        return \`<div class="\${levelColor}">[\${(entry.timestamp || '').slice(11, 19)}] \${entry.message}</div>\`;
                    }).join('');
                    term.scrollTop = term.scrollHeight;
                }
            } catch {}
        }

        function clearTerminal() {
            document.getElementById('terminal').innerHTML = '<div class="text-slate-500">[System] Đã xóa nhật ký.</div>';
        }

        // Auto refresh
        refreshData();
        setInterval(refreshData, 12000);
        setInterval(fetchLogs, 5000);
    </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);

    // Serve UI
    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HTML_CONTENT);
    }

    // Status API
    if (parsed.pathname === '/api/local-status') {
        const tailscale = WindowsController.getTailscaleStatus();
        let proxy = { running: false, port: 10808 };
        let vps = { success: false, data: null };
        let accounts = { success: false, data: [] };
        const autostart = WindowsController.getAutostartStatus();

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
        return res.end(JSON.stringify({ tailscale, proxy, vps, accounts, autostart }));
    }

    // Action API
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
            } else if (action === 'autostart') {
                const enabled = parsed.query.enabled === 'true' || parsed.query.enabled === '1';
                result = WindowsController.setAutostart(enabled);
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

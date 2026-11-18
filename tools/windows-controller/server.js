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
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
                        mono: ['"JetBrains Mono"', 'monospace']
                    }
                }
            }
        }
    </script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
        body {
            background-color: #070a10;
            background-image:
                radial-gradient(ellipse 80% 50% at 15% -10%, rgba(16, 185, 129, 0.08), transparent),
                radial-gradient(ellipse 60% 40% at 90% 0%, rgba(6, 182, 212, 0.06), transparent);
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .tabular-nums { font-variant-numeric: tabular-nums; }
        .panel {
            background: rgba(13, 19, 32, 0.88);
            border: 1px solid rgba(255, 255, 255, 0.07);
            box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.03) inset, 0 12px 32px -16px rgba(0, 0, 0, 0.7);
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #090d16; }
        ::-webkit-scrollbar-thumb { background: #263248; border-radius: 999px; }
    </style>
</head>
<body class="text-slate-100 min-h-[100dvh] p-4 sm:p-6 antialiased selection:bg-emerald-500/30">
    <div class="max-w-[1540px] mx-auto space-y-5">

        <!-- Top App Bar -->
        <header class="panel rounded-2xl p-4 sm:px-5 sm:py-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div class="flex items-center gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center font-extrabold text-slate-950 text-base shadow-lg shadow-emerald-500/20">
                    R+
                </div>
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <h1 class="text-base sm:text-lg font-bold tracking-tight text-white">AutoRewardPlus Windows Center</h1>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] text-slate-300 border border-white/10">v8.0.0</span>
                    </div>
                    <p class="text-xs text-slate-400 mt-0.5">Windows Residential Proxy (:10808) &bull; Oracle Cloud VPS (:3030)</p>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <div id="tsBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#070a10] border border-white/10 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-slate-500 animate-pulse"></span>
                    <span>Tailscale: Checking...</span>
                </div>
                <div id="proxyBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#070a10] border border-white/10 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-slate-500"></span>
                    <span>Proxy: Checking...</span>
                </div>
                <div id="vpsBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#070a10] border border-white/10 text-xs text-slate-300">
                    <span class="w-2 h-2 rounded-full bg-slate-500"></span>
                    <span>VPS: Connecting...</span>
                </div>
                <button onclick="openVpsDashboard()" class="px-3.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 border border-white/10 text-xs font-semibold rounded-xl transition">
                    Mở Dashboard VPS (:3030)
                </button>
                <button onclick="refreshData()" class="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-semibold rounded-xl transition flex items-center gap-1.5">
                    <span id="refreshIcon">↻</span>
                    <span>Làm mới</span>
                </button>
            </div>
        </header>

        <!-- Active Single Pool Bar -->
        <div id="singlePoolBar" class="hidden panel rounded-2xl p-3.5 border-emerald-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div id="singlePoolItems" class="flex flex-wrap items-center gap-2"></div>
            <button onclick="triggerAction('stop')" class="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded-xl font-semibold">Dừng tất cả</button>
        </div>

        <!-- 12-Col Bento Layout -->
        <div class="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">

            <!-- Left Control & Telemetry Column -->
            <div class="xl:col-span-4 space-y-5">
                <!-- 1-Click Controls -->
                <div class="panel rounded-2xl p-5 space-y-3.5">
                    <div class="flex items-center justify-between">
                        <h2 class="text-xs font-bold uppercase tracking-wider text-slate-300">Điều khiển nhanh VPS</h2>
                        <button onclick="testTailscale()" class="text-[11px] px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-cyan-300 border border-white/10 transition">Ping Tailscale</button>
                    </div>
                    <div class="grid grid-cols-2 gap-2.5">
                        <button onclick="triggerAction('start')" class="p-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition font-bold text-xs text-left space-y-0.5 shadow-lg shadow-emerald-500/15">
                            <div>▶ Chạy Tất Cả</div>
                            <div class="text-[10px] font-medium text-emerald-950/80">Batch toàn dàn</div>
                        </button>
                        <button onclick="triggerAction('run-unfinished')" class="p-3 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-emerald-300 rounded-xl transition font-semibold text-xs text-left space-y-0.5">
                            <div>⚡ Chạy Lỗi/Chờ</div>
                            <div class="text-[10px] text-slate-400">Queue 2 acc/lượt</div>
                        </button>
                        <button onclick="triggerAction('stop')" class="p-3 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 rounded-xl transition font-semibold text-xs text-left space-y-0.5">
                            <div>■ Dừng Bot</div>
                            <div class="text-[10px] text-rose-300/70">Dừng batch &amp; queue</div>
                        </button>
                        <button onclick="triggerAction('sync')" class="p-3 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-slate-200 rounded-xl transition font-semibold text-xs text-left space-y-0.5">
                            <div>↻ Đồng bộ Session</div>
                            <div class="text-[10px] text-slate-400">Copy Windows → VPS</div>
                        </button>
                    </div>
                </div>

                <!-- Proxy Tool Telemetry -->
                <div class="panel rounded-2xl p-5 space-y-3.5">
                    <div>
                        <h2 class="text-xs font-bold uppercase tracking-wider text-emerald-400">Tool Proxy (:10808)</h2>
                        <p id="proxyMetaText" class="text-[11px] text-slate-400 mt-0.5 font-mono">Đang đọc thống kê proxy...</p>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-xs font-mono">
                        <div class="bg-[#070a10] border border-white/[0.06] rounded-xl p-2.5"><div class="text-[10px] text-slate-500">ACTIVE</div><div id="pxActive" class="text-sm font-bold text-emerald-300 mt-0.5 tabular-nums">0</div></div>
                        <div class="bg-[#070a10] border border-white/[0.06] rounded-xl p-2.5"><div class="text-[10px] text-slate-500">TUNNELS</div><div id="pxTotal" class="text-sm font-bold text-slate-200 mt-0.5 tabular-nums">0</div></div>
                        <div class="bg-[#070a10] border border-white/[0.06] rounded-xl p-2.5"><div class="text-[10px] text-slate-500">UPTIME</div><div id="pxUptime" class="text-sm font-bold text-slate-200 mt-0.5 tabular-nums">0s</div></div>
                        <div class="bg-[#070a10] border border-white/[0.06] rounded-xl p-2.5"><div class="text-[10px] text-slate-500">GỬI</div><div id="pxBytesIn" class="text-xs font-bold text-slate-200 mt-0.5 tabular-nums">0 KB</div></div>
                        <div class="bg-[#070a10] border border-white/[0.06] rounded-xl p-2.5"><div class="text-[10px] text-slate-500">NHẬN</div><div id="pxBytesOut" class="text-xs font-bold text-emerald-300 mt-0.5 tabular-nums">0 KB</div></div>
                        <div class="bg-[#070a10] border border-white/[0.06] rounded-xl p-2.5"><div class="text-[10px] text-slate-500">LỖI/CHẶN</div><div id="pxErrors" class="text-xs font-bold text-amber-300 mt-0.5 tabular-nums">0/0</div></div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <button onclick="proxyAction('test-local-proxy')" class="px-3 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-emerald-300 rounded-xl font-semibold transition">Test Local</button>
                        <button onclick="proxyAction('test-vps-proxy')" class="px-3 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-cyan-300 rounded-xl font-semibold transition">Test VPS → Proxy</button>
                        <button onclick="proxyAction('sync-proxy-ip')" class="px-3 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 rounded-xl font-semibold transition">Đồng bộ IP VPS</button>
                        <button onclick="proxyAction('restart-proxy')" class="px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded-xl font-semibold transition">Restart Proxy</button>
                    </div>
                </div>

                <!-- VPS Smart Auto-Scheduler (:3030) -->
                <div class="panel rounded-2xl p-5 space-y-3">
                    <div class="flex items-center justify-between gap-2">
                        <h2 class="text-xs font-bold uppercase tracking-wider text-cyan-300">VPS Smart Auto-Scheduler (:3030)</h2>
                        <span id="winSchPhaseBadge" class="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-white/[0.06] text-slate-300 border border-white/10">CHECKING</span>
                    </div>
                    <div class="bg-[#070a10] border border-white/[0.06] rounded-xl p-2.5 space-y-1 text-[11px] font-mono">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-slate-400 font-sans">Next Run:</span>
                            <span id="winSchCountdown" class="text-emerald-300 font-bold">--</span>
                        </div>
                        <div id="winSchTimes" class="text-[10px] text-slate-400 truncate">VPS/Local: --</div>
                    </div>
                    <div class="flex flex-wrap gap-1.5 text-[10px]">
                        <span id="winSchCondDay" class="px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-400 border border-white/10">Ngày mới</span>
                        <span id="winSchCondHour" class="px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-400 border border-white/10">Giờ Local OK</span>
                        <span id="winSchCondProxy" class="px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-400 border border-white/10">Proxy OK</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <button id="winSchToggleBtn" onclick="toggleVpsScheduler()" class="px-3 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-xl font-semibold transition">Bật/Tắt</button>
                        <button onclick="rerollVpsScheduler()" class="px-3 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-cyan-300 rounded-xl font-semibold transition">🎲 Đổi giờ</button>
                    </div>
                    <p class="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-2.5 py-2">Khi VPS Auto-Scheduler BẬT, không cần đặt Task Scheduler Windows trùng giờ</p>
                </div>

                <!-- Windows Automation -->
                <div class="panel rounded-2xl p-5 space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <h2 class="text-xs font-bold uppercase tracking-wider text-slate-300">Khởi động cùng Windows</h2>
                            <p class="text-[11px] text-slate-500 mt-0.5">Tự chạy Proxy :10808 &amp; Center :4000</p>
                        </div>
                        <div class="flex items-center gap-2.5">
                            <span id="autostartStatusBadge" class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/[0.06] text-slate-400">...</span>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input id="toggleAutostart" type="checkbox" onchange="toggleAutostart(this.checked)" class="sr-only peer">
                                <div class="w-10 h-5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                        </div>
                    </div>

                    <div class="pt-3 border-t border-white/[0.06] space-y-2.5">
                        <div class="text-xs font-semibold text-slate-300">Lịch chạy hàng ngày (Task Scheduler)</div>
                        <div class="flex items-center gap-2">
                            <input id="scheduleTime" type="time" value="07:30" class="bg-[#070a10] border border-white/10 px-3 py-1.5 rounded-xl text-xs text-emerald-300 font-mono">
                            <button onclick="saveSchedule()" class="flex-1 px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs font-semibold rounded-xl transition">Lưu Lịch</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Accounts & Logs Column -->
            <div class="xl:col-span-8 space-y-5">
                <!-- 5 KPI Cards -->
                <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                    <div class="panel rounded-2xl p-4">
                        <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tổng điểm</div>
                        <div id="kpiTotalPoints" class="text-2xl font-bold text-cyan-300 mt-1 font-mono tabular-nums">--</div>
                        <div class="text-[11px] text-slate-500">Toàn bộ tài khoản</div>
                    </div>
                    <div class="panel rounded-2xl p-4">
                        <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Hôm nay</div>
                        <div id="kpiTodayValue" class="text-2xl font-bold text-emerald-400 mt-1 font-mono tabular-nums">--</div>
                        <div class="text-[11px] text-slate-500">Thu hoạch 24h</div>
                    </div>
                    <div class="panel rounded-2xl p-4">
                        <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">OK / Tổng</div>
                        <div id="kpiActiveAccounts" class="text-2xl font-bold text-white mt-1 font-mono tabular-nums">-- / --</div>
                        <div class="text-[11px] text-slate-500">Slot đơn: <span id="kpiSingleSlots" class="text-emerald-300">0/2</span></div>
                    </div>
                    <div class="panel rounded-2xl p-4">
                        <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Lỗi / Đình chỉ</div>
                        <div id="kpiErrorSuspended" class="text-2xl font-bold text-amber-300 mt-1 font-mono tabular-nums">-- / --</div>
                        <div class="text-[11px] text-slate-500">Cần xử lý / Ban</div>
                    </div>
                    <div class="panel rounded-2xl p-4 col-span-2 sm:col-span-1">
                        <div class="text-[11px] font-semibold uppercase tracking-wider text-violet-400">Quà / Fast 6+</div>
                        <div id="kpiGiftsFast" class="text-2xl font-bold text-violet-300 mt-1 font-mono tabular-nums">--</div>
                        <div id="kpiModeHint" class="text-[11px] text-slate-500">Fast 6+: 0 &bull; Safe: 0</div>
                    </div>
                </div>

                <!-- Accounts Table -->
                <div class="panel rounded-2xl overflow-hidden">
                    <div class="p-4 border-b border-white/[0.06] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                            <h2 class="text-xs font-bold uppercase tracking-wider text-white">Danh sách Tài khoản &amp; Tiến độ</h2>
                            <p class="text-[11px] text-slate-400 mt-0.5">Chạy đơn tối đa 2 acc song song, dư sẽ tự xếp hàng đợi</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                            <input id="accountFilter" type="text" onkeyup="filterAccountsTable()" placeholder="Lọc email / trạng thái..." class="flex-1 sm:w-52 bg-[#070a10] border border-white/10 px-3 py-1.5 rounded-xl text-xs text-slate-200 placeholder-slate-500">
                            <button onclick="openAccountModal()" class="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition shrink-0">+ Thêm Tài Khoản</button>
                        </div>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs whitespace-nowrap">
                            <thead class="bg-[#090e19] text-slate-400 font-semibold border-b border-white/[0.06] text-[10px] uppercase tracking-wider">
                                <tr>
                                    <th class="py-3 px-3.5">Tài khoản</th>
                                    <th class="py-3 px-2.5 text-right">Điểm</th>
                                    <th class="py-3 px-3">PC / Mobile</th>
                                    <th class="py-3 px-2.5 text-center">Chuỗi</th>
                                    <th class="py-3 px-2.5 text-center">Quà / Mode</th>
                                    <th class="py-3 px-2.5 text-center">Trạng thái</th>
                                    <th class="py-3 px-3.5 text-center">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody id="accountsBody" class="divide-y divide-white/[0.04] font-mono text-slate-300">
                                <tr><td colspan="7" class="py-8 text-center text-slate-500 font-sans">Đang tải dữ liệu từ VPS...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Live Logs -->
                <div class="panel rounded-2xl overflow-hidden">
                    <div class="px-4 py-2.5 border-b border-white/[0.06] flex justify-between items-center bg-[#0a0f1a]">
                        <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span class="text-xs font-bold text-slate-200">Live Engine Logs (VPS)</span>
                        </div>
                        <div class="flex items-center gap-2 text-[11px]">
                            <button onclick="fetchLogs()" class="px-2.5 py-1 bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 rounded-lg border border-white/10">Làm mới</button>
                            <button onclick="clearTerminal()" class="px-2.5 py-1 bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 rounded-lg border border-white/10">Xoá</button>
                        </div>
                    </div>
                    <div id="terminal" class="bg-[#06090f] p-3.5 font-mono text-[11px] leading-relaxed text-slate-300 h-44 overflow-y-auto space-y-1">
                        <div class="text-slate-500">[System] Đang lắng nghe nhật ký hoạt động từ VPS...</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Account Add/Edit/Import Modal -->
    <div id="accountModal" class="hidden fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="panel bg-[#0e1525] border-white/15 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <div class="flex items-center gap-3">
                    <h3 id="accModalTitle" class="text-sm font-bold text-white">Thêm tài khoản</h3>
                    <div id="accModalTabs" class="flex gap-1 text-xs bg-[#070a10] p-1 rounded-xl border border-white/[0.06]">
                        <button onclick="switchModalTab('single')" id="accTabSingle" class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-semibold">1 Tài khoản</button>
                        <button onclick="switchModalTab('bulk')" id="accTabBulk" class="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white font-semibold">Import hàng loạt</button>
                    </div>
                </div>
                <button onclick="closeAccountModal()" class="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            <div id="accSingleForm" class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div class="sm:col-span-2">
                    <label class="block text-slate-400 mb-1">Email *</label>
                    <input id="accEmail" type="email" class="w-full bg-[#070a10] border border-white/10 rounded-xl px-3 py-2 font-mono">
                </div>
                <div>
                    <label class="block text-slate-400 mb-1">Mật khẩu <span id="accPassHint" class="text-slate-500">*</span></label>
                    <input id="accPassword" type="password" class="w-full bg-[#070a10] border border-white/10 rounded-xl px-3 py-2 font-mono">
                </div>
                <div>
                    <label class="block text-slate-400 mb-1">TOTP Secret (2FA)</label>
                    <input id="accTotp" type="text" placeholder="Base32 (tuỳ chọn)" class="w-full bg-[#070a10] border border-white/10 rounded-xl px-3 py-2 font-mono">
                </div>
                <div>
                    <label class="block text-slate-400 mb-1">Recovery Email</label>
                    <input id="accRecovery" type="text" class="w-full bg-[#070a10] border border-white/10 rounded-xl px-3 py-2 font-mono">
                </div>
                <div>
                    <label class="block text-slate-400 mb-1">Tag / Nhóm</label>
                    <input id="accTag" type="text" placeholder="vd: main, clone" class="w-full bg-[#070a10] border border-white/10 rounded-xl px-3 py-2 font-mono">
                </div>
                <div>
                    <label class="block text-slate-400 mb-1">Geo Locale</label>
                    <input id="accGeo" type="text" value="vn" class="w-full bg-[#070a10] border border-white/10 rounded-xl px-3 py-2 font-mono">
                </div>
                <div>
                    <label class="block text-slate-400 mb-1">Language Code</label>
                    <input id="accLang" type="text" value="vi" class="w-full bg-[#070a10] border border-white/10 rounded-xl px-3 py-2 font-mono">
                </div>
                <div class="sm:col-span-2 grid grid-cols-3 gap-2 pt-1 border-t border-white/[0.06]">
                    <input id="accProxyUrl" type="text" placeholder="Proxy riêng (trống = mặc định)" class="col-span-2 bg-[#070a10] border border-white/10 rounded-xl px-2.5 py-2 font-mono">
                    <input id="accProxyPort" type="number" min="0" max="65535" placeholder="Port" class="bg-[#070a10] border border-white/10 rounded-xl px-2.5 py-2 font-mono">
                </div>
                <div class="sm:col-span-2 flex gap-4">
                    <label class="flex items-center gap-2"><input id="accEnabled" type="checkbox" checked class="accent-emerald-500"> Kích hoạt (enabled)</label>
                </div>
            </div>

            <div id="accBulkForm" class="hidden space-y-3 text-xs">
                <div class="text-slate-400">Dán mỗi dòng 1 tài khoản: <code class="text-emerald-300">email|password|totpSecret|recoveryEmail</code> (hoặc <code class="text-emerald-300">email|password</code>).</div>
                <textarea id="accBulkText" rows="7" placeholder="user1@outlook.com|MatKhau123|TOTP|rec1@gmail.com&#10;user2@gmail.com|MatKhau456" class="w-full bg-[#070a10] border border-white/10 rounded-xl p-3 font-mono text-xs text-slate-200"></textarea>
                <div class="grid grid-cols-3 gap-2">
                    <input id="accBulkGeo" type="text" value="vn" placeholder="Geo" class="bg-[#070a10] border border-white/10 rounded-xl px-2.5 py-2 font-mono">
                    <input id="accBulkLang" type="text" value="vi" placeholder="Lang" class="bg-[#070a10] border border-white/10 rounded-xl px-2.5 py-2 font-mono">
                    <input id="accBulkTag" type="text" placeholder="Tag (tuỳ chọn)" class="bg-[#070a10] border border-white/10 rounded-xl px-2.5 py-2 font-mono">
                </div>
            </div>

            <div class="flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-white/[0.08]">
                <div id="accEditExtraBtns" class="hidden flex gap-2">
                    <button onclick="deleteModalSession()" class="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-semibold">Xoá Session</button>
                    <button onclick="deleteModalAccount()" class="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold">Xoá Tài Khoản</button>
                </div>
                <div class="flex gap-2 ml-auto">
                    <button onclick="closeAccountModal()" class="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-xs rounded-xl">Huỷ</button>
                    <button onclick="saveAccountModal()" class="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl">Lưu Tài Khoản</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Toast -->
    <div id="toast" class="fixed bottom-5 right-5 panel bg-[#121a2b] border-emerald-500/40 text-white px-4 py-3 rounded-2xl shadow-2xl text-xs flex items-center gap-3 transform translate-y-24 opacity-0 transition duration-300 z-50 pointer-events-none">
        <span id="toastIcon" class="text-base">ℹ️</span>
        <div>
            <div id="toastTitle" class="font-bold text-emerald-300 text-[11px] uppercase tracking-wider">Thông báo</div>
            <div id="toastMsg" class="text-slate-200 mt-0.5">Nội dung</div>
        </div>
    </div>

    <script>
        let rawAccounts = [];
        let singlePool = { maxConcurrent: 2, activeCount: 0, queuedCount: 0, active: [], queue: [] };
        let editingEmail = null;
        let modalMode = 'single';
        let winSchedulerState = null;

        function esc(str) {
            return String(str ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function escAttrJs(str) {
            return esc(String(str ?? '').replace(/\\\\/g, '\\\\\\\\').replace(/'/g, '\\\\x27'));
        }

        function resolveClientMode(acc) {
            if (acc && acc.executionMode) return acc.executionMode;
            return /(^|[^a-z0-9_])new([^a-z0-9_]|$)/i.test(acc?.tag || '') ? 'safe' : Number(acc?.redemptionCount || 0) >= 6 ? 'fast' : 'standard';
        }

        function renderModeBadge(mode) {
            if (mode === 'safe') {
                return '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30" title="Tag new (&lt;3m): Search 22-45s, Đọc 20-40s, dừng 70-85%">🛡 Safe</span>';
            }
            if (mode === 'fast') {
                return '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30" title="Hết new &amp; 6+ quà: Search 6-12s, Đọc 5-10s, cày kỹ 100%">⚡ Fast</span>';
            }
            return '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.05] text-slate-400 border border-white/10">Std</span>';
        }

        function fmtWinDuration(totalSec) {
            const s = Math.max(0, Math.floor(Number(totalSec || 0)));
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const r = s % 60;
            return [h, m, r].map(v => String(v).padStart(2, '0')).join(':');
        }

        function fmtWinInTz(dateInput, timeZone) {
            if (!dateInput) return '--';
            const dt = new Date(dateInput);
            if (Number.isNaN(dt.getTime())) return String(dateInput);
            try {
                return new Intl.DateTimeFormat('vi-VN', {
                    timeZone: timeZone || undefined,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    day: '2-digit',
                    month: '2-digit',
                    hour12: false
                }).format(dt);
            } catch {
                return dt.toLocaleTimeString('vi-VN');
            }
        }

        function renderWinScheduler() {
            const d = winSchedulerState;
            const phaseEl = document.getElementById('winSchPhaseBadge');
            const cdEl = document.getElementById('winSchCountdown');
            const timesEl = document.getElementById('winSchTimes');
            const condDayEl = document.getElementById('winSchCondDay');
            const condHourEl = document.getElementById('winSchCondHour');
            const condProxyEl = document.getElementById('winSchCondProxy');
            const toggleBtn = document.getElementById('winSchToggleBtn');

            if (!d) {
                if (phaseEl) phaseEl.textContent = 'OFFLINE';
                if (cdEl) cdEl.textContent = 'Chưa kết nối VPS';
                return;
            }

            const cfg = (d.config && typeof d.config === 'object') ? d.config : d;
            const enabled = cfg.enabled !== false && d.phase !== 'DISABLED';
            const phase = d.phase || (enabled ? 'WAITING_NEW_DAY' : 'DISABLED');
            const localTz = cfg.localTimezone || cfg.localTz || 'Asia/Ho_Chi_Minh';
            const vpsTz = cfg.vpsTimezone || cfg.vpsTz || 'UTC';

            let remSec = 0;
            if (d.plannedTargetAt) {
                const msLeft = new Date(d.plannedTargetAt).getTime() - Date.now();
                remSec = Number.isFinite(msLeft) ? Math.max(0, Math.floor(msLeft / 1000)) : 0;
            } else if (d.countdownSec !== undefined && d.countdownSec !== null) {
                remSec = Math.max(0, Math.floor(Number(d.countdownSec)));
            } else if (d.remainingSec !== undefined && d.remainingSec !== null) {
                remSec = Math.max(0, Math.floor(Number(d.remainingSec)));
            }

            if (phaseEl) {
                phaseEl.textContent = phase;
                phaseEl.className = phase === 'COUNTDOWN'
                    ? 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    : (phase === 'DONE_TODAY' || phase === 'RUNNING')
                        ? 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : phase === 'DISABLED'
                            ? 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-white/[0.06] text-slate-400 border border-white/10'
                            : 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30';
            }

            if (cdEl) {
                if (phase === 'COUNTDOWN') {
                    cdEl.textContent = fmtWinDuration(remSec) + ' (' + fmtWinInTz(d.plannedTargetAt, localTz) + ')';
                } else if (phase === 'DONE_TODAY') {
                    cdEl.textContent = 'Xong hôm nay';
                } else if (phase === 'DISABLED') {
                    cdEl.textContent = 'Đang tắt';
                } else if (phase === 'RUNNING') {
                    cdEl.textContent = 'Đang chạy Batch';
                } else {
                    cdEl.textContent = d.plannedTargetAt ? fmtWinInTz(d.plannedTargetAt, localTz) : phase;
                }
            }

            if (timesEl) {
                const lStr = d.localDate ? (d.localDate + ' ' + (d.localTime || '')) : fmtWinInTz(Date.now(), localTz);
                const vStr = d.vpsDate ? (d.vpsDate + ' ' + (d.vpsTime || '')) : fmtWinInTz(Date.now(), vpsTz);
                timesEl.textContent = 'Local: ' + lStr.trim() + ' • VPS: ' + vStr.trim();
            }

            const cond = d.conditions || d.checks || d;
            const setPill = (el, label, val) => {
                if (!el) return;
                if (val === true) {
                    el.textContent = '✓ ' + label;
                    el.className = 'px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold';
                } else if (val === false) {
                    el.textContent = '○ ' + label;
                    el.className = 'px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/25';
                } else {
                    el.textContent = label;
                    el.className = 'px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-400 border border-white/10';
                }
            };

            const vpsDay = cond.vpsNewDay ?? cond.isVpsNewDay;
            const locDay = cond.localNewDay ?? cond.isLocalNewDay;
            const bothDay = (vpsDay === true && locDay === true) ? true : (vpsDay === false || locDay === false) ? false : undefined;
            setPill(condDayEl, 'Ngày mới (VPS+Local)', bothDay);
            setPill(condHourEl, 'Giờ Local OK', cond.localHourReady ?? cond.localHourOk ?? cond.localAfterMinHour ?? cond.withinLocalWindow);
            setPill(condProxyEl, 'Proxy OK', cond.proxyReady ?? cond.proxyOk);

            if (toggleBtn) {
                toggleBtn.textContent = enabled ? 'Bật/Tắt (Đang BẬT)' : 'Bật/Tắt (Đang TẮT)';
                toggleBtn.className = enabled
                    ? 'px-3 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 rounded-xl font-semibold transition'
                    : 'px-3 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-300 rounded-xl font-semibold transition';
            }
        }

        async function toggleVpsScheduler() {
            const cfg = (winSchedulerState && winSchedulerState.config) ? winSchedulerState.config : (winSchedulerState || {});
            const currentEnabled = cfg.enabled !== false && winSchedulerState?.phase !== 'DISABLED';
            const nextEnabled = winSchedulerState ? !currentEnabled : true;
            try {
                const res = await fetch('/api/scheduler', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: nextEnabled })
                });
                const json = await res.json();
                showToast(json.message || (nextEnabled ? 'Đã BẬT VPS Auto-Scheduler' : 'Đã TẮT VPS Auto-Scheduler'), json.success ? '⏰' : '⚠️');
                if (json.data) {
                    winSchedulerState = json.data;
                    renderWinScheduler();
                } else {
                    refreshData();
                }
            } catch (err) {
                showToast('Lỗi cập nhật scheduler: ' + err.message, '❌');
            }
        }

        async function rerollVpsScheduler() {
            try {
                const res = await fetch('/api/scheduler/reroll', { method: 'POST' });
                const json = await res.json();
                showToast(json.message || 'Đã đổi giờ chạy ngẫu nhiên trên VPS!', json.success ? '🎲' : '⚠️');
                if (json.data) {
                    winSchedulerState = json.data;
                    renderWinScheduler();
                } else {
                    refreshData();
                }
            } catch (err) {
                showToast('Lỗi đổi giờ: ' + err.message, '❌');
            }
        }

        function fmtBytes(bytes) {
            const n = Number(bytes || 0);
            if (n < 1024) return n + ' B';
            if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
            return (n / 1048576).toFixed(2) + ' MB';
        }

        function parseRatio(text, defaultMax) {
            const m = String(text || '').match(/(\\d+)\\s*\\/\\s*(\\d+)/);
            if (!m) return { pct: 0, label: text || ('0/' + defaultMax) };
            const cur = parseInt(m[1], 10);
            const max = Math.max(1, parseInt(m[2], 10));
            return { pct: Math.min(100, Math.round((cur / max) * 100)), label: cur + '/' + max };
        }

        function showToast(msg, icon = 'ℹ️', title = 'Thông báo') {
            const toast = document.getElementById('toast');
            document.getElementById('toastIcon').textContent = icon;
            document.getElementById('toastTitle').textContent = title;
            document.getElementById('toastMsg').textContent = msg;
            toast.classList.remove('translate-y-24', 'opacity-0');
            setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 4200);
        }

        async function refreshData() {
            const refreshIcon = document.getElementById('refreshIcon');
            refreshIcon.classList.add('animate-spin');
            try {
                const res = await fetch('/api/local-status');
                const data = await res.json();

                const tsBadge = document.getElementById('tsBadge');
                if (data.tailscale && data.tailscale.active) {
                    tsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-mono">TS: ' + (data.tailscale.ip || 'OK') + '</span>';
                } else {
                    tsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span><span class="text-rose-400">TS: Offline</span>';
                }

                const proxyBadge = document.getElementById('proxyBadge');
                const pStats = data.proxy?.stats;
                if (data.proxy && data.proxy.running) {
                    proxyBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-mono">Proxy :' + data.proxy.port + (pStats ? ' (' + pStats.activeTunnels + ')' : '') + '</span>';
                } else {
                    proxyBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400"></span><span class="text-amber-300">Proxy: Offline</span>';
                }

                if (pStats) {
                    document.getElementById('pxActive').textContent = pStats.activeTunnels ?? 0;
                    document.getElementById('pxTotal').textContent = pStats.totalTunnels ?? 0;
                    document.getElementById('pxBytesIn').textContent = fmtBytes(pStats.bytesIn);
                    document.getElementById('pxBytesOut').textContent = fmtBytes(pStats.bytesOut);
                    document.getElementById('pxErrors').textContent = (pStats.totalErrors ?? 0) + '/' + (pStats.blockedRequests ?? 0);
                    document.getElementById('pxUptime').textContent = (pStats.uptimeSec ?? 0) + 's';
                    document.getElementById('proxyMetaText').textContent = 'PID ' + pStats.pid + ' • ' + pStats.allowlist;
                }

                const vpsBadge = document.getElementById('vpsBadge');
                if (data.vps && data.vps.success) {
                    const vpsData = data.vps.data || {};
                    singlePool = vpsData.singlePool || singlePool;
                    const modeText = vpsData.mode === 'single' ? 'SINGLE ' + singlePool.activeCount + '/' + singlePool.maxConcurrent : (vpsData.state || 'IDLE');
                    vpsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-mono">VPS: ' + modeText + '</span>';
                } else {
                    vpsBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span><span class="text-rose-400">VPS: Offline</span>';
                }

                renderSinglePoolBar();

                if (data.autostart) {
                    const toggle = document.getElementById('toggleAutostart');
                    const badge = document.getElementById('autostartStatusBadge');
                    toggle.checked = Boolean(data.autostart.enabled);
                    badge.textContent = data.autostart.enabled ? 'BẬT' : 'TẮT';
                }

                if (data.accounts && data.accounts.data) {
                    rawAccounts = data.accounts.data;
                    const meta = data.accounts.meta || {};
                    if (meta.singlePool) singlePool = meta.singlePool;
                    renderSinglePoolBar();
                    filterAccountsTable();
                    updateKPIs(rawAccounts, meta);
                }

                const sch = data.scheduler?.data || data.scheduler || data.accounts?.meta?.scheduler || null;
                if (sch && typeof sch === 'object') {
                    winSchedulerState = sch;
                    renderWinScheduler();
                } else {
                    renderWinScheduler();
                }
            } catch (err) {
                showToast('Lỗi tải dữ liệu: ' + err.message, '⚠️');
            } finally {
                setTimeout(() => refreshIcon.classList.remove('animate-spin'), 350);
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
            const parts = ['<span class="font-bold text-emerald-300">Chạy đơn (' + active.length + '/' + (singlePool.maxConcurrent || 2) + '):</span>'];
            for (const r of active) {
                parts.push('<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 font-mono">' + r.email + ' (' + r.uptimeSec + 's) <button onclick="stopSingleAccount(\\\'' + r.email + '\\\')" class="text-rose-300 font-bold">✕</button></span>');
            }
            for (let i = 0; i < queue.length; i++) {
                const q = queue[i];
                parts.push('<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 font-mono">#' + (i + 1) + ' ' + q.email + ' <button onclick="stopSingleAccount(\\\'' + q.email + '\\\')" class="text-rose-300 font-bold">✕</button></span>');
            }
            items.innerHTML = parts.join('');
        }

        function updateKPIs(accounts, meta) {
            let total = 0, today = 0, ok = 0, err = 0, gifts = 0, fastCount = 0, safeCount = 0;
            for (const acc of accounts) {
                total += (acc.totalPoints || 0);
                today += (acc.dailyPoints || 0);
                if (acc.status === 'OK' || acc.status === 'RUNNING') ok++;
                if (acc.status === 'ERROR') err++;
                gifts += Number(acc.redemptionCount || 0);
                const mode = resolveClientMode(acc);
                if (mode === 'fast') fastCount++;
                else if (mode === 'safe') safeCount++;
            }
            document.getElementById('kpiTotalPoints').textContent = total.toLocaleString('vi-VN');
            document.getElementById('kpiTodayValue').textContent = '+' + today.toLocaleString('vi-VN');
            document.getElementById('kpiActiveAccounts').textContent = ok + ' / ' + accounts.length;
            document.getElementById('kpiErrorSuspended').textContent = err + ' / ' + Number(meta?.bannedCount || 0);
            const giftsEl = document.getElementById('kpiGiftsFast');
            if (giftsEl) giftsEl.textContent = gifts.toLocaleString('vi-VN') + ' (' + fastCount + ')';
            const modeHintEl = document.getElementById('kpiModeHint');
            if (modeHintEl) modeHintEl.textContent = 'Fast 6+: ' + fastCount + ' • Safe: ' + safeCount;
        }

        function renderAccountsTable(accounts) {
            const tbody = document.getElementById('accountsBody');
            if (!accounts || accounts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-500 font-sans">Không có tài khoản nào.</td></tr>';
                return;
            }
            tbody.innerHTML = accounts.map(acc => {
                const statusClass = acc.status === 'OK' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                    acc.status === 'RUNNING' ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40 animate-pulse' :
                    acc.status === 'ERROR' ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' :
                    'bg-white/[0.04] text-slate-300 border-white/10';

                const pc = parseRatio(acc.pcProgress, 90);
                const mob = parseRatio(acc.mobileProgress, 60);
                const mode = resolveClientMode(acc);
                const hasGift = acc.redemptionCount !== undefined && acc.redemptionCount !== null;
                const giftNum = hasGift ? Number(acc.redemptionCount) : null;
                const giftDisplay = giftNum !== null && Number.isFinite(giftNum) ? giftNum : '—';
                const giftCls = giftNum !== null && giftNum >= 6 ? 'text-emerald-300 font-bold' : 'text-slate-300 font-semibold';
                const giftTitle = acc.lastOrderTitle ? ('Gần nhất: ' + acc.lastOrderTitle) : 'Tổng đơn đổi quà';
                const isNewTag = /(^|[^a-z0-9_])new([^a-z0-9_]|$)/i.test(acc.tag || '');
                const tagHtml = acc.tag
                    ? (' <span class="px-1 py-0.2 rounded text-[9px] border ' + (isNewTag ? 'bg-amber-500/20 text-amber-300 border-amber-500/35' : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25') + '">' + esc(acc.tag) + '</span>')
                    : '';
                const emailSafe = escAttrJs(acc.email);

                let actionHtml = '';
                if (acc.singleRunning) {
                    actionHtml = \`<button onclick="stopSingleAccount('\${emailSafe}')" class="px-2 py-1 bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 rounded-lg text-[10px] font-bold border border-rose-500/35">Dừng</button>\`;
                } else if (acc.queued) {
                    actionHtml = \`<button onclick="stopSingleAccount('\${emailSafe}')" class="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/35 text-amber-300 rounded-lg text-[10px] font-bold border border-amber-500/35">#\${esc(acc.queuePosition)}</button>\`;
                } else {
                    actionHtml = \`<button onclick="runSingleAccount('\${emailSafe}')" class="px-2 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 rounded-lg text-[10px] font-semibold border border-emerald-500/25">Chạy</button>\`;
                }

                return \`
                    <tr class="hover:bg-white/[0.025] transition">
                        <td class="py-2.5 px-3.5">
                            <div class="font-semibold text-slate-100">\${esc(acc.email)}</div>
                            <div class="text-[10px] text-slate-500 font-sans">\${esc(acc.level || 'Level 1')} &bull; \${acc.enabled === false ? 'DISABLED' : esc((acc.geoLocale || 'vn').toUpperCase())}\${tagHtml}</div>
                        </td>
                        <td class="py-2.5 px-2.5 text-right tabular-nums">
                            <div class="font-bold text-white">\${(acc.totalPoints || 0).toLocaleString('vi-VN')}</div>
                            <div class="text-[11px] font-semibold text-emerald-400">+\${acc.dailyPoints || 0}</div>
                        </td>
                        <td class="py-2.5 px-3">
                            <div class="space-y-1 w-28">
                                <div><div class="flex justify-between text-[10px] text-slate-400"><span>PC</span><span class="text-slate-200">\${esc(pc.label)}</span></div><div class="h-1 bg-white/[0.06] rounded-full overflow-hidden"><div class="h-full bg-emerald-400" style="width:\${pc.pct}%"></div></div></div>
                                <div><div class="flex justify-between text-[10px] text-slate-400"><span>Mob</span><span class="text-slate-200">\${esc(mob.label)}</span></div><div class="h-1 bg-white/[0.06] rounded-full overflow-hidden"><div class="h-full bg-cyan-400" style="width:\${mob.pct}%"></div></div></div>
                            </div>
                        </td>
                        <td class="py-2.5 px-2.5 text-center text-amber-300 font-bold font-sans">\${acc.streak ? esc(acc.streak) + 'd' : '0'}</td>
                        <td class="py-2.5 px-2.5 text-center font-sans">
                            <div class="text-xs \${giftCls}" title="\${esc(giftTitle)}">🎁 \${esc(giftDisplay)}</div>
                            <div class="mt-0.5">\${renderModeBadge(mode)}</div>
                        </td>
                        <td class="py-2.5 px-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold border \${statusClass}">\${esc(acc.status)}</span></td>
                        <td class="py-2.5 px-3.5 text-center">
                            <div class="inline-flex items-center gap-1">
                                \${actionHtml}
                                <button onclick="interactiveLogin('\${emailSafe}')" title="Đăng nhập lấy cookie trên Windows" class="px-2 py-1 bg-white/[0.04] hover:bg-white/[0.1] text-amber-300 rounded-lg text-[10px] border border-white/10">🔑</button>
                                <button onclick="openAccountModal('\${emailSafe}')" title="Sửa / Xoá" class="px-2 py-1 bg-white/[0.04] hover:bg-white/[0.1] text-slate-300 rounded-lg text-[10px] border border-white/10">⚙</button>
                            </div>
                        </td>
                    </tr>
                \`;
            }).join('');
        }

        function filterAccountsTable() {
            const query = (document.getElementById('accountFilter').value || '').toLowerCase().trim();
            const filtered = !query ? rawAccounts : rawAccounts.filter(a =>
                (a.email || '').toLowerCase().includes(query) ||
                (a.status || '').toLowerCase().includes(query) ||
                (a.tag || '').toLowerCase().includes(query) ||
                resolveClientMode(a).includes(query)
            );
            renderAccountsTable(filtered);
        }

        async function triggerAction(action) {
            showToast('Đang thực hiện ' + action + '...', '⏳');
            try {
                const res = await fetch('/api/action/' + action);
                const data = await res.json();
                showToast(data.message || 'Hoàn tất!', data.success ? '✅' : '❌');
                setTimeout(refreshData, 900);
            } catch (err) { showToast(err.message, '❌'); }
        }

        async function proxyAction(action) {
            showToast('Đang kiểm tra proxy...', '⏳');
            try {
                const res = await fetch('/api/action/' + action);
                const data = await res.json();
                showToast(data.data?.message || data.message || 'Xong', data.success ? '✅' : '⚠️', 'Proxy Diagnostics');
                setTimeout(refreshData, 700);
            } catch (err) { showToast(err.message, '❌'); }
        }

        async function runSingleAccount(email) {
            const res = await fetch('/api/action/run-account?email=' + encodeURIComponent(email));
            const data = await res.json();
            showToast(data.message || ('Đã kích hoạt ' + email), data.success ? '✅' : '⚠️');
            setTimeout(refreshData, 700);
        }

        async function stopSingleAccount(email) {
            const res = await fetch('/api/action/stop-account?email=' + encodeURIComponent(email));
            const data = await res.json();
            showToast(data.message || ('Đã dừng ' + email), data.success ? '🛑' : '⚠️');
            setTimeout(refreshData, 700);
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
            showToast(data.message, data.success ? '✅' : '⚠️');
        }

        async function saveSchedule() {
            const time = document.getElementById('scheduleTime').value;
            const res = await fetch('/api/action/schedule?time=' + encodeURIComponent(time));
            const data = await res.json();
            showToast(data.message, data.success ? '⏰' : '❌');
        }

        function openVpsDashboard() { window.open('http://100.126.196.30:3030', '_blank'); }

        async function fetchLogs() {
            try {
                const res = await fetch('/api/action/logs');
                const data = await res.json();
                if (data.success && data.data) {
                    const term = document.getElementById('terminal');
                    term.innerHTML = data.data.slice(-60).map(entry => {
                        const cls = entry.level === 'error' ? 'text-rose-400' : entry.level === 'warn' ? 'text-amber-300' : 'text-slate-300';
                        return \`<div class="\${cls}">[\${(entry.timestamp || '').slice(11, 19)}] \${entry.message}</div>\`;
                    }).join('');
                    term.scrollTop = term.scrollHeight;
                }
            } catch {}
        }

        function clearTerminal() { document.getElementById('terminal').innerHTML = '<div class="text-slate-500">[System] Đã xoá log màn hình.</div>'; }

        function switchModalTab(mode) {
            modalMode = mode;
            const isBulk = mode === 'bulk';
            document.getElementById('accSingleForm').classList.toggle('hidden', isBulk);
            document.getElementById('accBulkForm').classList.toggle('hidden', !isBulk);
            document.getElementById('accTabSingle').className = !isBulk
                ? 'px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-semibold'
                : 'px-2.5 py-1 rounded-lg text-slate-400 hover:text-white font-semibold';
            document.getElementById('accTabBulk').className = isBulk
                ? 'px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-semibold'
                : 'px-2.5 py-1 rounded-lg text-slate-400 hover:text-white font-semibold';
        }

        async function openAccountModal(email = null) {
            editingEmail = email;
            document.getElementById('accountModal').classList.remove('hidden');
            document.getElementById('accModalTabs').classList.toggle('hidden', Boolean(email));
            switchModalTab('single');

            let existing = null;
            if (email) {
                try {
                    const res = await fetch('/api/accounts/manage');
                    const json = await res.json();
                    existing = (json.data || []).find(a => a.email.toLowerCase() === email.toLowerCase()) || null;
                } catch {}
            }

            document.getElementById('accModalTitle').textContent = existing ? ('Sửa: ' + existing.email) : 'Thêm tài khoản mới';
            document.getElementById('accEditExtraBtns').classList.toggle('hidden', !existing);
            document.getElementById('accPassHint').textContent = existing ? '(trống nếu giữ cũ)' : '*';

            document.getElementById('accEmail').value = existing?.email || '';
            document.getElementById('accPassword').value = '';
            document.getElementById('accTotp').value = '';
            document.getElementById('accRecovery').value = existing?.recoveryEmail || '';
            document.getElementById('accTag').value = existing?.tag || '';
            document.getElementById('accGeo').value = existing?.geoLocale || 'vn';
            document.getElementById('accLang').value = existing?.langCode || 'vi';
            document.getElementById('accProxyUrl').value = existing?.proxy?.url || '';
            document.getElementById('accProxyPort').value = existing?.proxy?.port || 0;
            document.getElementById('accEnabled').checked = existing ? existing.enabled !== false : true;
        }

        function closeAccountModal() {
            document.getElementById('accountModal').classList.add('hidden');
            editingEmail = null;
        }

        async function saveAccountModal() {
            if (!editingEmail && modalMode === 'bulk') {
                const rawText = document.getElementById('accBulkText').value.trim();
                if (!rawText) return showToast('Hãy dán danh sách tài khoản.', '⚠️');
                const res = await fetch('/api/accounts/bulk-import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rawText,
                        geoLocale: document.getElementById('accBulkGeo').value.trim() || 'vn',
                        langCode: document.getElementById('accBulkLang').value.trim() || 'vi',
                        tag: document.getElementById('accBulkTag').value.trim()
                    })
                });
                const json = await res.json();
                showToast(json.message || 'Xong', json.success ? '✅' : '❌');
                if (json.success) {
                    document.getElementById('accBulkText').value = '';
                    closeAccountModal();
                    refreshData();
                }
                return;
            }

            const payload = {
                email: document.getElementById('accEmail').value.trim(),
                password: document.getElementById('accPassword').value,
                totpSecret: document.getElementById('accTotp').value.trim(),
                recoveryEmail: document.getElementById('accRecovery').value.trim(),
                tag: document.getElementById('accTag').value.trim(),
                geoLocale: document.getElementById('accGeo').value.trim() || 'vn',
                langCode: document.getElementById('accLang').value.trim() || 'vi',
                enabled: document.getElementById('accEnabled').checked,
                proxy: {
                    url: document.getElementById('accProxyUrl').value.trim(),
                    port: Number(document.getElementById('accProxyPort').value || 0),
                    proxyAxios: true
                }
            };

            const res = await fetch(editingEmail ? '/api/accounts/manage?email=' + encodeURIComponent(editingEmail) : '/api/accounts/manage', {
                method: editingEmail ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            showToast(json.message || 'Xong', json.success ? '✅' : '❌');
            if (json.success) { closeAccountModal(); refreshData(); }
        }

        async function deleteModalSession() {
            if (!editingEmail || !confirm('Xoá session cookie của ' + editingEmail + '?')) return;
            const res = await fetch('/api/accounts/session?email=' + encodeURIComponent(editingEmail), { method: 'DELETE' });
            const json = await res.json();
            showToast(json.message || 'Xong', json.success ? '🗑' : '❌');
            refreshData();
        }

        async function deleteModalAccount() {
            if (!editingEmail || !confirm('Xoá vĩnh viễn tài khoản ' + editingEmail + '?')) return;
            const res = await fetch('/api/accounts/manage?email=' + encodeURIComponent(editingEmail), { method: 'DELETE' });
            const json = await res.json();
            showToast(json.message || 'Xong', json.success ? '🗑' : '❌');
            if (json.success) { closeAccountModal(); refreshData(); }
        }

        async function interactiveLogin(email) {
            const res = await fetch('/api/action/interactive-login?email=' + encodeURIComponent(email));
            const json = await res.json();
            showToast(json.message || 'Đã mở trình duyệt đăng nhập!', json.success ? '🔑' : '❌');
        }

        refreshData();
        fetchLogs();
        setInterval(refreshData, 10000);
        setInterval(fetchLogs, 5000);
        setInterval(renderWinScheduler, 1000);
    </script>
</body>
</html>`;

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            if (!raw.trim()) return resolve({});
            try { resolve(JSON.parse(raw)); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }

    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HTML_CONTENT);
    }

    if (parsed.pathname === '/api/accounts/manage') {
        try {
            let result;
            if (req.method === 'GET') {
                result = await WindowsController.getManageAccounts();
            } else if (req.method === 'POST') {
                const body = await readJsonBody(req);
                result = await WindowsController.createAccount(body);
            } else if (req.method === 'PUT') {
                const body = await readJsonBody(req);
                result = await WindowsController.updateAccount(parsed.query.email, body);
            } else if (req.method === 'DELETE') {
                result = await WindowsController.deleteAccount(parsed.query.email);
            } else {
                res.writeHead(405);
                return res.end('Method Not Allowed');
            }
            res.writeHead(result?.success === false ? 400 : 200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: error.message }));
        }
    }

    if (parsed.pathname === '/api/accounts/bulk-import' && req.method === 'POST') {
        try {
            const body = await readJsonBody(req);
            const result = await WindowsController.bulkImportAccounts(body);
            res.writeHead(result?.success === false ? 400 : 200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: error.message }));
        }
    }

    if (parsed.pathname === '/api/accounts/session' && req.method === 'DELETE') {
        try {
            const result = await WindowsController.deleteSession(parsed.query.email);
            res.writeHead(result?.success === false ? 400 : 200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: error.message }));
        }
    }

    if (parsed.pathname === '/api/scheduler') {
        try {
            let result;
            if (req.method === 'GET') {
                result = await WindowsController.getVPSScheduler();
            } else if (req.method === 'PUT') {
                const body = await readJsonBody(req);
                result = await WindowsController.updateVPSScheduler(body);
            } else {
                res.writeHead(405);
                return res.end('Method Not Allowed');
            }
            res.writeHead(result?.success === false ? 400 : 200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: error.message }));
        }
    }

    if (parsed.pathname === '/api/scheduler/reroll' && req.method === 'POST') {
        try {
            const result = await WindowsController.rerollVPSScheduler();
            res.writeHead(result?.success === false ? 400 : 200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: error.message }));
        }
    }

    if (parsed.pathname === '/api/local-status') {
        const tailscale = WindowsController.getTailscaleStatus();
        let proxy = { running: false, port: 10808, stats: null };
        let vps = { success: false, data: null };
        let accounts = { success: false, data: [], meta: {} };
        let scheduler = null;
        const autostart = WindowsController.getAutostartStatus();

        proxy = await WindowsController.ensureProxyRunning();
        if (tailscale.active) {
            try {
                [vps, accounts, scheduler] = await Promise.all([
                    WindowsController.getVPSStatus(),
                    WindowsController.getVPSAccounts(),
                    WindowsController.getVPSScheduler().catch(() => null)
                ]);
            } catch (err) {
                vps = { success: false, message: err.message };
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ tailscale, proxy, vps, accounts, scheduler, autostart }));
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
            } else if (action === 'interactive-login') {
                result = WindowsController.launchInteractiveLogin(parsed.query.email);
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

if (require.main === module) {
    // Background watchdog: keeps local residential proxy healthy whenever Tailscale is up
    setInterval(async () => {
        try {
            const ts = WindowsController.getTailscaleStatus();
            if (ts.active) {
                await WindowsController.ensureProxyRunning();
            }
        } catch {}
    }, 30000).unref();

    server.listen(PORT, '127.0.0.1', () => {
        console.log(`[Windows Control Center] Running at http://127.0.0.1:${PORT}`);
    });
}

module.exports = { server, HTML_CONTENT };

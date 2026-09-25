const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WindowsController = require('./controller');

const LAST_RUN_FILE = path.join(__dirname, '.last_run_date');
const MIN_JITTER_MINUTES = 15;
const MAX_JITTER_MINUTES = 60;
const ALLOWED_START_HOUR = 7;   // 07:00 sáng
const ALLOWED_END_HOUR = 21;    // 21:30 tối

function getTodayString() {
    const d = new Date();
    // Chuyển sang giờ Việt Nam (UTC+7)
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const vnTime = new Date(utc + (3600000 * 7));
    return vnTime.toISOString().slice(0, 10);
}

function getVietnamCurrentHour() {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const vnTime = new Date(utc + (3600000 * 7));
    return vnTime.getHours() + (vnTime.getMinutes() / 60);
}

function hasRunToday() {
    if (!fs.existsSync(LAST_RUN_FILE)) return false;
    try {
        const content = fs.readFileSync(LAST_RUN_FILE, 'utf-8').trim();
        return content === getTodayString();
    } catch {
        return false;
    }
}

function markRunToday() {
    try {
        fs.writeFileSync(LAST_RUN_FILE, getTodayString(), 'utf-8');
    } catch (e) {
        console.error('[Scheduler] Không thể ghi file .last_run_date:', e.message);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function installWindowsTask() {
    const taskName = 'AutoRewardPlus_Smart_Scheduler';
    const nodeExe = process.execPath;
    const scriptPath = path.join(__dirname, 'smartScheduler.js');
    
    console.log(`[Scheduler] Đang đăng ký Windows Task Scheduler: ${taskName}...`);
    try {
        // Kích hoạt khi User Logon vào Windows hàng ngày
        const cmd = `schtasks /create /tn "${taskName}" /tr "\"${nodeExe}\" \"${scriptPath}\"" /sc onlogon /f`;
        execSync(cmd, { stdio: 'inherit' });
        console.log(`[Scheduler] Đã đăng ký thành công Task "${taskName}"!`);
        console.log(`[Scheduler] Cơ chế: Mỗi khi anh mở máy/đăng nhập, script sẽ kiểm tra khung giờ và tạo độ trễ ngẫu nhiên trước khi chạy.`);
    } catch (err) {
        console.error(`[Scheduler] Lỗi khi tạo Windows Task:`, err.message);
    }
}

function removeWindowsTask() {
    const taskName = 'AutoRewardPlus_Smart_Scheduler';
    try {
        execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'inherit' });
        console.log(`[Scheduler] Đã gỡ bỏ Task "${taskName}".`);
    } catch (err) {
        console.error(`[Scheduler] Lỗi khi gỡ Task:`, err.message);
    }
}

async function run() {
    const args = process.argv.slice(2);

    if (args.includes('--install-task')) {
        installWindowsTask();
        return;
    }

    if (args.includes('--remove-task')) {
        removeWindowsTask();
        return;
    }

    const forceRun = args.includes('--force') || args.includes('--now');
    const today = getTodayString();

    console.log('=======================================================================');
    console.log('       AUTOREWARDPLUS - HUMAN-CADENCE SMART SCHEDULER');
    console.log('=======================================================================');
    console.log(`[1] Ngày hiện tại (VN): ${today}`);

    // 1. Kiểm tra Daily Guard
    if (hasRunToday() && !forceRun) {
        console.log(`[GUARD] Hôm nay (${today}) hệ thống đã hoàn thành 1 phiên chạy.`);
        console.log(`[GUARD] Bỏ qua để tránh lặp lại nhiều lần trong ngày (Multi-run detection).`);
        console.log(`(Nếu muốn chạy cưỡng bức, dùng lệnh: node smartScheduler.js --force)`);
        return;
    }

    // 2. Kiểm tra khung giờ hoạt động hợp lệ
    const currentHour = getVietnamCurrentHour();
    if ((currentHour < ALLOWED_START_HOUR || currentHour > ALLOWED_END_HOUR) && !forceRun) {
        console.log(`[TIME-WINDOW] Hiện tại là ${currentHour.toFixed(1)}h VN, nằm ngoài khung giờ cho phép (${ALLOWED_START_HOUR}h - ${ALLOWED_END_HOUR}h).`);
        console.log(`[TIME-WINDOW] Hoãn chạy để mô phỏng nhịp sinh học người dùng thật ban ngày.`);
        return;
    }

    // 3. Random Jitter Delay
    if (!forceRun) {
        const jitterMinutes = Math.floor(Math.random() * (MAX_JITTER_MINUTES - MIN_JITTER_MINUTES + 1)) + MIN_JITTER_MINUTES;
        console.log(`[JITTER] Đã sinh độ trễ ngẫu nhiên: ${jitterMinutes} phút.`);
        console.log(`[JITTER] Phá vỡ quy luật giờ cố định: bot sẽ khởi động vào khoảng ${(new Date(Date.now() + jitterMinutes * 60000)).toLocaleTimeString('vi-VN')}.`);
        console.log(`[JITTER] Đang đếm ngược... (Nhấn Ctrl+C nếu muốn hủy)`);
        await sleep(jitterMinutes * 60 * 1000);
    } else {
        console.log(`[FORCE] Kích hoạt ngay lập tức (Bỏ qua Jitter đếm ngược).`);
    }

    // 4. Kiểm tra Tailscale & Khởi động Proxy
    console.log(`[PRE-FLIGHT] Đang kiểm tra kết nối Tailscale và Proxy Windows...`);
    try {
        WindowsController.verifyTailscalePrerequisite();
        await WindowsController.ensureProxyRunning();
        console.log(`[PRE-FLIGHT] Proxy port 10808: SẴN SÀNG.`);
    } catch (err) {
        console.error(`[PRE-FLIGHT ERROR] Không thể chuẩn bị proxy: ${err.message}`);
        console.error(`[PRE-FLIGHT] Hủy phiên chạy để bảo vệ an toàn cho dàn tài khoản.`);
        return;
    }

    // 5. Kiểm tra kết nối tới VPS Dashboard
    try {
        const status = await WindowsController.testTailscaleConnection();
        if (!status.success) {
            console.error(`[VPS ERROR] Không thể kết nối tới VPS: ${status.message}`);
            return;
        }
        console.log(`[PRE-FLIGHT] Kết nối VPS: OK (${status.latencyMs}ms).`);
    } catch (err) {
        console.error(`[VPS ERROR] Lỗi kết nối VPS: ${err.message}`);
        return;
    }

    // 6. Gửi lệnh kích hoạt Bot trên VPS
    console.log(`[LAUNCH] Đang gửi lệnh kích hoạt cày điểm lên VPS...`);
    try {
        const res = await WindowsController.startBot();
        console.log(`[LAUNCH SUCCESS] ${res.message || 'Bot đã bắt đầu chạy trên VPS thành công!'}`);
        markRunToday();
        console.log(`[SUCCESS] Đã ghi nhận phiên chạy thành công cho ngày ${today}.`);
    } catch (err) {
        console.error(`[LAUNCH ERROR] Lỗi khi kích hoạt bot: ${err.message}`);
    }
}

run();

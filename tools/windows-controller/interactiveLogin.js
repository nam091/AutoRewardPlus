const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('patchright');
const { FingerprintGenerator } = require('fingerprint-generator');

const email = process.argv[2] || 'qxk4iitw@studentidcard.me';
const rootDir = path.resolve(__dirname, '../../');
const sessionDir = path.join(rootDir, 'sessions', email);

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('=======================================================================');
    console.log('          TRÌNH TRỢ GIÚP ĐĂNG NHẬP TRỰC QUAN (INTERACTIVE LOGIN)');
    console.log('=======================================================================');
    console.log(`[TARGET] Đang mở phiên đăng nhập cho: ${email}`);
    console.log('[1/4] Khởi tạo vân tay trình duyệt (Fingerprint) chuẩn Windows...');

    const fg = new FingerprintGenerator();
    const desktopFp = fg.getFingerprint({
        devices: ['desktop'],
        operatingSystems: ['windows'],
        browsers: [{ name: 'edge' }]
    });

    const mobileFp = fg.getFingerprint({
        devices: ['mobile'],
        operatingSystems: ['android'],
        browsers: [{ name: 'edge' }]
    });

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Lưu fingerprint
    fs.writeFileSync(path.join(sessionDir, 'session_fingerprint_desktop.json'), JSON.stringify(desktopFp, null, 2));
    fs.writeFileSync(path.join(sessionDir, 'session_fingerprint_mobile.json'), JSON.stringify(mobileFp, null, 2));

    console.log('[2/4] Đang bật cửa sổ Chromium nổi trên màn hình Windows...');
    console.log('      (Vui lòng nhìn lên màn hình desktop để tương tác)');

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--start-maximized',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const context = await browser.newContext({
        userAgent: desktopFp.fingerprint.navigator.userAgent,
        viewport: null, // Full window
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh'
    });

    const page = await context.newPage();

    console.log('[3/4] Đang điều hướng tới trang đăng nhập Microsoft Rewards...');
    await page.goto('https://rewards.bing.com/createuser?idru=%2F&userScenarioId=anonsignin', {
        waitUntil: 'domcontentloaded'
    }).catch(() => {});

    // Thử tự động điền email nếu trường email hiển thị
    try {
        await page.waitForSelector('input[type="email"], input#usernameEntry', { timeout: 4000 });
        await page.fill('input[type="email"], input#usernameEntry', email);
        console.log(`[AUTO] Đã tự động điền sẵn email: ${email}`);
    } catch {
        // User có thể tự gõ nếu trang đã chuyển hướng
    }

    console.log('\n=======================================================================');
    console.log(' >>> HƯỚNG DẪN DÀNH CHO ANH:');
    console.log(' 1. Cửa sổ trình duyệt Chromium đã nổi trên màn hình của anh.');
    console.log(' 2. Anh hãy nhập Mật khẩu và thực hiện xác minh mã OTP (nếu có).');
    console.log(' 3. Khi đăng nhập thành công và nhìn thấy điểm số trên rewards.bing.com:');
    console.log('    Script sẽ TỰ ĐỘNG phát hiện cookie phiên, lưu lại và đồng bộ lên VPS!');
    console.log('=======================================================================\n');
    console.log('[MONITOR] Đang lắng nghe phiên đăng nhập (Mỗi 2 giây đối soát)...');

    let loginSuccess = false;
    let authCookies = [];

    // Chờ tối đa 10 phút (300 vòng lặp)
    for (let i = 0; i < 300; i++) {
        if (browser.isConnected() === false) {
            console.log('[MONITOR] Trình duyệt đã được đóng.');
            break;
        }

        try {
            const cookies = await context.cookies();
            const hasAuthCookie = cookies.some(c => (c.name === '_U' || c.name === 'WLSSC') && c.domain.includes('bing.com'));
            const currentUrl = page.url();

            if (hasAuthCookie || (currentUrl.includes('rewards.bing.com') && !currentUrl.includes('signin') && !currentUrl.includes('login'))) {
                console.log('\n[SUCCESS] >>> ĐÃ PHÁT HIỆN ĐĂNG NHẬP THÀNH CÔNG! <<<');
                console.log(`[SUCCESS] URL hiện tại: ${currentUrl}`);
                authCookies = cookies;
                loginSuccess = true;
                break;
            }
        } catch {
            // Có thể page đang reload
        }

        await sleep(2000);
    }

    if (!loginSuccess && authCookies.length === 0) {
        // Kiểm tra lần cuối trước khi thoát
        try {
            authCookies = await context.cookies();
            if (authCookies.some(c => c.name === '_U')) {
                loginSuccess = true;
            }
        } catch {}
    }

    if (loginSuccess) {
        console.log(`[4/4] Đang trích xuất và tối ưu hóa Cookie phiên (${authCookies.length} cookies)...`);
        
        // Lưu Desktop session
        fs.writeFileSync(path.join(sessionDir, 'session_desktop.json'), JSON.stringify(authCookies, null, 2));
        // Lưu Mobile session (sử dụng chung auth token, tương thích mobile)
        fs.writeFileSync(path.join(sessionDir, 'session_mobile.json'), JSON.stringify(authCookies, null, 2));

        console.log(`[LOCAL] Đã ghi nhận session tại: ${sessionDir}`);

        // Đóng browser
        try {
            await browser.close();
        } catch {}

        console.log('[SYNC] Đang đồng bộ phiên đăng nhập mới lên VPS Oracle qua SSH...');
        try {
            const scpCmd = `scp -o StrictHostKeyChecking=no -r "${sessionDir}" oracle:/home/ubuntu/AutoRewardPlus-v7.2.1/sessions/`;
            execSync(scpCmd, { stdio: 'inherit' });
            console.log('\n=======================================================================');
            console.log(` 🎉 CHÚC MỪNG: TÀI KHOẢN ${email} ĐÃ ĐƯỢC ĐỒNG BỘ THÀNH CÔNG LÊN VPS!`);
            console.log('    Từ bây giờ bot trên VPS sẽ nhận đầy đủ cookie xác thực (_U) và tự cày điểm.');
            console.log('=======================================================================');
        } catch (syncErr) {
            console.error(`[SYNC ERROR] Không thể tự động copy lên VPS: ${syncErr.message}`);
            console.log(`Anh có thể chạy lệnh đồng bộ tay: node tools/windows-controller/cliRunner.js --sync`);
        }
    } else {
        console.log('\n[CANCELLED] Chưa phát hiện đăng nhập hoàn tất hoặc phiên bị hủy.');
        try {
            await browser.close();
        } catch {}
    }
}

main().catch(err => {
    console.error('[FATAL ERROR]', err.message);
    process.exit(1);
});

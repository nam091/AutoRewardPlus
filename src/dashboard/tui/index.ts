import select from '@inquirer/select';
import { spawn } from 'child_process';
import { SheetService } from '../../services/sheetService';
import { stateService } from '../../services/stateService';

export class CLIInteractiveDashboard {
    private isRunning = true;
    private botProcess: any = null;

    public async start() {
        console.clear();
        console.log('====================================================');
        console.log('🚀 AUTO REWARD PLUS - INTERACTIVE CLI DASHBOARD 🚀');
        console.log('====================================================\n');

        while (this.isRunning) {
            const answer = await select({
                message: 'Chọn thao tác quản trị:',
                choices: [
                    { name: '1. ▶ Khởi chạy Bot Auto (Tự động kiếm điểm)', value: 'start' },
                    { name: '2. ■ Dừng Bot Auto', value: 'stop' },
                    { name: '3. 📊 Xem bảng danh sách & trạng thái tài khoản', value: 'list' },
                    { name: '4. ☁ Đồng bộ trạng thái lên Google Sheets', value: 'sync' },
                    { name: '5. 🌐 Mở Web GUI Dashboard (Truy cập localhost:3000)', value: 'web' },
                    { name: '0. ❌ Thoát Dashboard', value: 'exit' }
                ]
            });

            switch (answer) {
                case 'start':
                    if (this.botProcess) {
                        console.log('⚠️ Bot đang chạy rồi!');
                    } else {
                        console.log('▶ Đang khởi chạy bot...');
                        const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
                        this.botProcess = spawn(cmd, ['run', 'ts-start'], { stdio: 'inherit' });
                    }
                    break;
                case 'stop':
                    if (this.botProcess) {
                        this.botProcess.kill();
                        this.botProcess = null;
                        console.log('■ Đã dừng bot.');
                    } else {
                        console.log('⚠️ Không có tiến trình bot nào đang chạy.');
                    }
                    break;
                case 'list':
                    this.showAccountTable();
                    break;
                case 'sync':
                    console.log('☁ Đang đồng bộ Google Sheets...');
                    const sheetService = new SheetService();
                    await sheetService.syncAccountsToSheet([]);
                    console.log('✅ Hoàn tất đồng bộ.');
                    break;
                case 'web':
                    console.log('🌐 Hãy mở trình duyệt và truy cập: http://localhost:3000');
                    break;
                case 'exit':
                    this.isRunning = false;
                    if (this.botProcess) this.botProcess.kill();
                    process.exit(0);
            }
        }
    }

    private showAccountTable() {
        try {
            // Reads recorded run state instead of the placeholder values this
            // table used to print, which always looked like a completed run.
            const states = stateService.getStates();

            if (!states.length) {
                console.log('\nChưa có dữ liệu tài khoản. Chạy bot ít nhất một lần.\n');
                return;
            }

            console.log('\n--- DANH SÁCH TÀI KHOẢN ---');
            console.table(states.map((state, idx) => ({
                ID: idx + 1,
                Email: state.email,
                Điểm: state.totalPoints,
                'Điểm Ngày': state.dailyPoints > 0 ? `+${state.dailyPoints}` : '0',
                PC: state.pcProgress,
                Mobile: state.mobileProgress,
                'Trạng Thái': state.status,
                'Tuổi Acc': state.accountAge,
                Chuỗi: state.streak,
                'Cập Nhật': state.updatedAt
            })));
            console.log('\n');
        } catch (e) {
            console.error('Lỗi đọc trạng thái tài khoản:', e);
        }
    }
}

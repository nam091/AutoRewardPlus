import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { sheetService } from '../services/sheetService';

export interface AccountStatus {
    id: number;
    email: string;
    totalPoints: number;
    dailyPoints: number;
    pcProgress: string;
    mobileProgress: string;
    status: 'IDLE' | 'RUNNING' | 'OK' | 'ERROR' | 'STOPPED';
    accountAge: string;
    streak: string;
    updatedAt: string;
}

export class DashboardServer {
    private app = Fastify({ logger: false });
    private accounts: AccountStatus[] = [];
    private workerProcess: ChildProcess | null = null;
    private logSubscribers: Set<any> = new Set();
    private logHistory: string[] = [];

    constructor() {
        this.loadAccounts();
        this.setupRoutes();
    }

    private loadAccounts() {
        try {
            const accPath = fs.existsSync(path.resolve('src/accounts.json')) 
                ? path.resolve('src/accounts.json') 
                : path.resolve('src/accounts.example.json');
            const data = JSON.parse(fs.readFileSync(accPath, 'utf-8'));
            this.accounts = data.map((acc: any, index: number) => ({
                id: index + 1,
                email: acc.email,
                totalPoints: Math.floor(Math.random() * 5000) + 1000,
                dailyPoints: 230,
                pcProgress: '90/90',
                mobileProgress: '60/60',
                status: 'IDLE',
                accountAge: `${Math.floor(Math.random() * 60) + 10}d`,
                streak: `${Math.floor(Math.random() * 15) + 1}`,
                updatedAt: new Date().toLocaleString('vi-VN')
            }));
        } catch (e) {
            this.broadcastLog('Error loading accounts: ' + e);
        }
    }

    public broadcastLog(message: string) {
        const timestamped = `[${new Date().toLocaleTimeString('vi-VN')}] ${message}`;
        this.logHistory.push(timestamped);
        if (this.logHistory.length > 200) this.logHistory.shift();
        for (const ws of this.logSubscribers) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'LOG', data: timestamped }));
        }
    }

    private setupRoutes() {
        this.app.register(cors, { origin: true });
        this.app.register(websocket);

        const webDir = path.resolve('src/dashboard/web');
        if (fs.existsSync(webDir)) {
            this.app.register(fastifyStatic, {
                root: webDir,
                prefix: '/',
            });
        }

        this.app.get('/api/accounts', async () => ({ success: true, data: this.accounts }));

        this.app.post('/api/start', async () => {
            if (this.workerProcess) {
                return { success: false, message: 'Bot đang chạy rồi.' };
            }
            this.broadcastLog('Khởi động tiến trình bot...');
            this.accounts.forEach(a => a.status = 'RUNNING');
            
            // Spawn background process
            const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            this.workerProcess = spawn(cmd, ['run', 'ts-start'], { cwd: process.cwd() });

            this.workerProcess.stdout?.on('data', (data) => {
                this.broadcastLog(data.toString().trim());
            });

            this.workerProcess.stderr?.on('data', (data) => {
                this.broadcastLog(`[ERR] ${data.toString().trim()}`);
            });

            this.workerProcess.on('close', (code) => {
                this.broadcastLog(`Tiến trình bot kết thúc với mã lỗi: ${code}`);
                this.workerProcess = null;
                this.accounts.forEach(a => a.status = code === 0 ? 'OK' : 'ERROR');
                this.syncToSheets();
            });

            return { success: true, message: 'Đã khởi động bot thành công.' };
        });

        this.app.post('/api/stop', async () => {
            if (!this.workerProcess) {
                return { success: false, message: 'Không có tiến trình nào đang chạy.' };
            }
            this.broadcastLog('Dừng tiến trình bot...');
            this.workerProcess.kill('SIGINT');
            this.workerProcess = null;
            this.accounts.forEach(a => a.status = 'STOPPED');
            return { success: true, message: 'Đã dừng bot.' };
        });

        this.app.post('/api/sync-sheets', async () => {
            this.broadcastLog('Đồng bộ dữ liệu lên Google Sheets...');
            await this.syncToSheets();
            return { success: true, message: 'Đồng bộ Google Sheets hoàn tất.' };
        });

        this.app.register(async (instance) => {
            instance.get('/ws/logs', { websocket: true }, (connection) => {
                this.logSubscribers.add(connection.socket);
                // Send recent logs
                this.logHistory.forEach(log => connection.socket.send(JSON.stringify({ type: 'LOG', data: log })));
                connection.socket.on('close', () => this.logSubscribers.delete(connection.socket));
            });
        });
    }

    private async syncToSheets() {
        const rows = this.accounts.map(a => ({
            email: a.email,
            totalPoints: a.totalPoints,
            dailyPoints: a.dailyPoints,
            pcProgress: a.pcProgress,
            mobileProgress: a.mobileProgress,
            status: a.status,
            accountAge: a.accountAge,
            updatedAt: a.updatedAt,
            streak: a.streak
        }));
        await sheetService.syncAccountsToSheet(rows);
    }

    public async start(port = 3000) {
        try {
            await this.app.listen({ port, host: '0.0.0.0' });
            console.log(`[DashboardServer] Running at http://localhost:${port}`);
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    }
}

const { execSync, spawn } = require('child_process');
const http = require('http');
const net = require('net');
const tls = require('tls');
const path = require('path');
const fs = require('fs');

const VPS_TAILSCALE_IP = process.env.VPS_TAILSCALE_IP || '100.126.196.30';
const VPS_PORT = parseInt(process.env.VPS_PORT || '3030', 10);
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '10808', 10);

class WindowsController {
    /**
     * Check if Tailscale is running on Windows and get the Tailscale IP
     */
    static getTailscaleStatus() {
        try {
            const out = execSync('tailscale status --json', { encoding: 'utf-8', timeout: 3000 });
            const data = JSON.parse(out);
            const isRunning = data.BackendState === 'Running' && data.Self && data.Self.Online === true;
            if (!isRunning) {
                const state = data.BackendState || 'Stopped';
                return {
                    active: false,
                    state,
                    ip: null,
                    error: `Tailscale is DISCONNECTED (${state}). Please connect Tailscale on Windows!`
                };
            }
            const myIp = data.Self && data.Self.TailscaleIPs && data.Self.TailscaleIPs[0] ? data.Self.TailscaleIPs[0] : null;
            return {
                active: true,
                ip: myIp,
                state: 'Running',
                raw: 'Tailscale is active'
            };
        } catch {
            return {
                active: false,
                state: 'Stopped',
                ip: null,
                error: 'Tailscale is DISCONNECTED. Please start Tailscale on Windows!'
            };
        }
    }

    /**
     * Test active connection from Windows to VPS over Tailscale
     */
    static async testTailscaleConnection() {
        const ts = this.getTailscaleStatus();
        if (!ts.active) {
            return {
                success: false,
                tailscaleActive: false,
                message: ts.error || 'Tailscale is DISCONNECTED!'
            };
        }

        try {
            const startTime = Date.now();
            const res = await fetch(`http://${VPS_TAILSCALE_IP}:${VPS_PORT}/api/status`, {
                signal: AbortSignal.timeout(3000)
            });
            const latency = Date.now() - startTime;
            const data = await res.json();
            return {
                success: true,
                tailscaleActive: true,
                vpsOnline: true,
                ip: ts.ip,
                vpsIp: VPS_TAILSCALE_IP,
                latencyMs: latency,
                vpsState: data.data?.state || 'OK',
                message: `VPS Connection OK (${latency}ms) | IP: ${ts.ip} -> VPS: ${VPS_TAILSCALE_IP}`
            };
        } catch (err) {
            return {
                success: false,
                tailscaleActive: true,
                vpsOnline: false,
                ip: ts.ip,
                message: `Cannot connect to VPS (${VPS_TAILSCALE_IP}:${VPS_PORT}): ${err.message}`
            };
        }
    }

    /**
     * Query local proxy /health endpoint
     */
    static getProxyHealth(timeoutMs = 1200) {
        return new Promise(resolve => {
            const req = http.get(`http://127.0.0.1:${PROXY_PORT}/health`, { timeout: timeoutMs }, res => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        if (res.statusCode === 200 && parsed && parsed.ok) {
                            return resolve({ running: true, upgraded: true, port: PROXY_PORT, stats: parsed });
                        }
                    } catch {}
                    resolve({ running: true, upgraded: false, port: PROXY_PORT, stats: null });
                });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve({ running: false, upgraded: false, port: PROXY_PORT, stats: null });
            });
            req.on('error', () => {
                resolve({ running: false, upgraded: false, port: PROXY_PORT, stats: null });
            });
        });
    }

    static spawnProxyProcess() {
        const proxyScript = path.join(__dirname, 'proxyServer.js');
        const child = spawn(process.execPath, [proxyScript], {
            detached: true,
            stdio: 'ignore',
            cwd: __dirname,
            windowsHide: true
        });
        child.unref();
    }

    /**
     * Ensure local residential proxy is running on Windows (and auto-upgrade legacy proxy)
     */
    static async ensureProxyRunning() {
        const health = await this.getProxyHealth();
        if (health.running && health.upgraded) {
            return { running: true, port: PROXY_PORT, stats: health.stats };
        }

        if (health.running && !health.upgraded) {
            await this.stopLocalProxyProcesses();
        }

        this.spawnProxyProcess();
        await new Promise(r => setTimeout(r, 1200));
        const after = await this.getProxyHealth();
        return {
            running: after.running,
            port: PROXY_PORT,
            spawned: true,
            stats: after.stats
        };
    }

    static async stopLocalProxyProcesses() {
        if (process.platform !== 'win32') return;
        try {
            execSync(
                `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*proxyServer.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
                { stdio: 'ignore', timeout: 5000 }
            );
            await new Promise(r => setTimeout(r, 400));
        } catch {}
    }

    static async restartProxy() {
        await this.stopLocalProxyProcesses();
        this.spawnProxyProcess();
        await new Promise(r => setTimeout(r, 1200));
        const health = await this.getProxyHealth();
        return {
            success: health.running,
            running: health.running,
            port: PROXY_PORT,
            stats: health.stats,
            message: health.running
                ? `Đã khởi động lại Residential Proxy :${PROXY_PORT} (PID ${health.stats?.pid || '?'})`
                : `Không thể khởi động lại proxy trên cổng :${PROXY_PORT}`
        };
    }

    /**
     * Test outbound HTTPS tunnel through local 127.0.0.1:PROXY_PORT
     */
    static testLocalProxyOutbound() {
        return new Promise(resolve => {
            const start = Date.now();
            const socket = net.connect(PROXY_PORT, '127.0.0.1', () => {
                socket.write('CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n\r\n');
            });
            let buffer = '';
            const timer = setTimeout(() => {
                socket.destroy();
                resolve({ success: false, message: 'Timeout khi test tunnel qua proxy local' });
            }, 8000);

            socket.once('data', chunk => {
                buffer += chunk.toString('utf8');
                if (!buffer.includes('200')) {
                    clearTimeout(timer);
                    socket.destroy();
                    return resolve({ success: false, message: `Proxy từ chối CONNECT: ${buffer.trim()}` });
                }
                const tlsSock = tls.connect({ socket, servername: 'api.ipify.org' }, () => {
                    tlsSock.write('GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
                });
                let resp = '';
                tlsSock.on('data', d => { resp += d.toString('utf8'); });
                tlsSock.on('end', () => {
                    clearTimeout(timer);
                    const latencyMs = Date.now() - start;
                    const match = resp.match(/\{[\s\S]*\}/);
                    let ip = null;
                    if (match) {
                        try { ip = JSON.parse(match[0]).ip; } catch {}
                    }
                    resolve({
                        success: true,
                        ip,
                        latencyMs,
                        message: `Local Proxy Tunnel OK (${latencyMs}ms) | Exit IP: ${ip || 'unknown'}`
                    });
                });
                tlsSock.on('error', err => {
                    clearTimeout(timer);
                    resolve({ success: false, message: `TLS tunnel lỗi: ${err.message}` });
                });
            });

            socket.on('error', err => {
                clearTimeout(timer);
                resolve({ success: false, message: `Không kết nối được proxy local :${PROXY_PORT}: ${err.message}` });
            });
        });
    }

    /**
     * Ensure Tailscale prerequisite is strictly met
     */
    static verifyTailscalePrerequisite() {
        const ts = this.getTailscaleStatus();
        if (!ts.active) {
            throw new Error('Tailscale is DISCONNECTED! Please start Tailscale before controlling VPS.');
        }
        return ts;
    }

    /**
     * API request to VPS Dashboard over Tailscale
     */
    static async vpsRequest(endpoint, method = 'GET', body = null) {
        this.verifyTailscalePrerequisite();
        await this.ensureProxyRunning();

        const url = `http://${VPS_TAILSCALE_IP}:${VPS_PORT}${endpoint}`;
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000)
        };
        if (body) options.body = JSON.stringify(body);

        try {
            const res = await fetch(url, options);
            return await res.json();
        } catch (err) {
            throw new Error(`Cannot connect to VPS via Tailscale (${url}): ${err.message}`);
        }
    }

    static async startBot() {
        return await this.vpsRequest('/api/start', 'POST');
    }

    static async stopBot() {
        return await this.vpsRequest('/api/stop', 'POST');
    }

    static async runSingleAccount(email) {
        return await this.vpsRequest(`/api/run-account/${encodeURIComponent(email)}`, 'POST');
    }

    static async stopSingleAccount(email) {
        return await this.vpsRequest(`/api/stop-account/${encodeURIComponent(email)}`, 'POST');
    }

    static async runUnfinishedAccounts() {
        return await this.vpsRequest('/api/run-unfinished', 'POST');
    }

    static async testVpsProxy() {
        return await this.vpsRequest('/api/proxy/test', 'POST', {});
    }

    static async syncProxyIpToVps() {
        const ts = this.verifyTailscalePrerequisite();
        if (!ts.ip) throw new Error('Không lấy được IP Tailscale trên Windows.');
        return await this.vpsRequest('/api/settings', 'PUT', {
            defaultProxyUrl: `http://${ts.ip}`,
            defaultProxyPort: PROXY_PORT
        });
    }

    static async getVPSStatus() {
        return await this.vpsRequest('/api/status', 'GET');
    }

    static async getVPSAccounts() {
        return await this.vpsRequest('/api/accounts', 'GET');
    }

    static async getVPSLogs() {
        return await this.vpsRequest('/api/logs', 'GET');
    }

    static async getManageAccounts() {
        return await this.vpsRequest('/api/accounts/manage', 'GET');
    }

    static async createAccount(payload) {
        return await this.vpsRequest('/api/accounts/manage', 'POST', payload);
    }

    static async bulkImportAccounts(payload) {
        return await this.vpsRequest('/api/accounts/bulk-import', 'POST', payload);
    }

    static async updateAccount(email, payload) {
        return await this.vpsRequest(`/api/accounts/manage/${encodeURIComponent(email)}`, 'PUT', payload);
    }

    static async toggleAccount(email, enabled) {
        return await this.vpsRequest(`/api/accounts/manage/${encodeURIComponent(email)}/toggle`, 'PATCH', { enabled });
    }

    static async deleteAccount(email) {
        return await this.vpsRequest(`/api/accounts/manage/${encodeURIComponent(email)}`, 'DELETE');
    }

    static async deleteSession(email) {
        return await this.vpsRequest(`/api/sessions/${encodeURIComponent(email)}`, 'DELETE');
    }

    static launchInteractiveLogin(email) {
        if (!email || !email.includes('@')) throw new Error('Email không hợp lệ.');
        const script = path.join(__dirname, 'interactiveLogin.js');
        const child = spawn(process.execPath, [script, email], {
            detached: true,
            stdio: 'ignore',
            cwd: path.resolve(__dirname, '../../')
        });
        child.unref();
        return { success: true, message: `Đã mở cửa sổ trình duyệt đăng nhập thủ công cho ${email}.` };
    }

    static getAutostartStatus() {
        try {
            const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "AutoRewardPlus"', {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 3000
            });
            return { enabled: out.includes('AutoRewardPlus') };
        } catch {
            return { enabled: false };
        }
    }

    static setAutostart(enabled) {
        const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
        const rootDir = path.resolve(__dirname, '../../');
        const launcher = path.join(rootDir, 'AutoReward-WebControl.bat');

        if (enabled) {
            const cmd = `reg add "${regKey}" /v "AutoRewardPlus" /t REG_SZ /d "\"${launcher}\" --silent" /f`;
            execSync(cmd, { stdio: 'ignore', timeout: 5000 });
            return { success: true, enabled: true, message: 'Đã kích hoạt tự động khởi động web control center cùng Windows.' };
        } else {
            try {
                const cmd = `reg delete "${regKey}" /v "AutoRewardPlus" /f`;
                execSync(cmd, { stdio: 'ignore', timeout: 5000 });
            } catch {}
            return { success: true, enabled: false, message: 'Đã hủy kích hoạt tự động chạy cùng Windows.' };
        }
    }

    static syncToVPS() {
        this.verifyTailscalePrerequisite();
        const rootDir = path.resolve(__dirname, '../../');
        const srcAccounts = path.join(rootDir, 'src', 'accounts.json');
        const distAccounts = path.join(rootDir, 'dist', 'accounts.json');
        const accountsFile = fs.existsSync(srcAccounts) ? srcAccounts : distAccounts;
        const sessionsDir = path.join(rootDir, 'sessions');
        const cmd = `scp -o StrictHostKeyChecking=no -r "${sessionsDir}" "${accountsFile}" oracle:/home/ubuntu/AutoRewardPlus-v7.2.1/ && ssh oracle "cp /home/ubuntu/AutoRewardPlus-v7.2.1/accounts.json /home/ubuntu/AutoRewardPlus-v7.2.1/src/accounts.json 2>/dev/null || true; cp /home/ubuntu/AutoRewardPlus-v7.2.1/accounts.json /home/ubuntu/AutoRewardPlus-v7.2.1/dist/accounts.json 2>/dev/null || true; cp -r /home/ubuntu/AutoRewardPlus-v7.2.1/sessions/* /home/ubuntu/AutoRewardPlus-v7.2.1/src/browser/sessions/ 2>/dev/null || true; cp -r /home/ubuntu/AutoRewardPlus-v7.2.1/sessions/* /home/ubuntu/AutoRewardPlus-v7.2.1/dist/browser/sessions/ 2>/dev/null || true"`;
        execSync(cmd, { stdio: 'inherit' });
        return { success: true, message: 'Sessions and accounts synced to VPS successfully.' };
    }

    static scheduleDailyTask(time = '07:30') {
        this.verifyTailscalePrerequisite();
        const taskName = 'AutoRewardPlus_Daily_VPS';
        const nodeExe = process.execPath;
        const scriptPath = path.join(__dirname, 'cliRunner.js');
        const cmd = `schtasks /create /tn "${taskName}" /tr "\"${nodeExe}\" \"${scriptPath}\" --run-all" /sc daily /st ${time} /f`;

        execSync(cmd, { stdio: 'inherit' });
        return { success: true, message: `Daily schedule task ${taskName} set for ${time} everyday.` };
    }
}

module.exports = WindowsController;

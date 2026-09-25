const { execSync, spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const VPS_TAILSCALE_IP = '100.126.196.30';
const VPS_PORT = 3030;
const PROXY_PORT = 10808;
const SSH_KEY = fs.existsSync('F:/PERSIONAL/Users/Downloads/ssh-key-2026-07-01.key')
    ? path.resolve('F:/PERSIONAL/Users/Downloads/ssh-key-2026-07-01.key')
    : path.resolve('F:/Users/Downloads/ssh-key-2026-07-01.key');
const SSH_USER_HOST = 'oracle';

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
        } catch (err) {
            const msg = err.stdout ? err.stdout.toString() : (err.message || '');
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
     * Ensure local residential proxy is running on Windows
     */
    static async ensureProxyRunning() {
        return new Promise(resolve => {
            const req = http.get(`http://127.0.0.1:${PROXY_PORT}`, { timeout: 1000 }, () => {
                resolve({ running: true, port: PROXY_PORT });
            });
            req.on('error', () => {
                // Not running, spawn background process
                const proxyScript = path.join(__dirname, 'proxyServer.js');
                const child = spawn(process.execPath, [proxyScript], {
                    detached: true,
                    stdio: 'ignore',
                    cwd: __dirname,
                    windowsHide: true
                });
                child.unref();
                setTimeout(() => resolve({ running: true, port: PROXY_PORT, spawned: true }), 1500);
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
            headers: { 'Content-Type': 'application/json' }
        };
        if (body) options.body = JSON.stringify(body);

        try {
            const res = await fetch(url, options);
            return await res.json();
        } catch (err) {
            throw new Error(`Cannot connect to VPS via Tailscale (${url}): ${err.message}`);
        }
    }

    /**
     * Start bot on VPS
     */
    static async startBot() {
        return await this.vpsRequest('/api/start', 'POST');
    }

    /**
     * Stop bot on VPS
     */
    static async stopBot() {
        return await this.vpsRequest('/api/stop', 'POST');
    }

    /**
     * Run single account on VPS
     */
    static async runSingleAccount(email) {
        return await this.vpsRequest(`/api/run-account/${encodeURIComponent(email)}`, 'POST');
    }

    /**
     * Get VPS status
     */
    static async getVPSStatus() {
        return await this.vpsRequest('/api/status', 'GET');
    }

    /**
     * Get VPS accounts
     */
    static async getVPSAccounts() {
        return await this.vpsRequest('/api/accounts', 'GET');
    }

    /**
     * Sync sessions & accounts from Windows to VPS
     */
    static syncToVPS() {
        this.verifyTailscalePrerequisite();
        const rootDir = path.resolve(__dirname, '../../');
        const accountsFile = path.join(rootDir, 'dist', 'accounts.json');
        const sessionsDir = path.join(rootDir, 'sessions');
        const cmd = `scp -o StrictHostKeyChecking=no -r "${sessionsDir}" "${accountsFile}" oracle:/home/ubuntu/AutoRewardPlus-v7.2.1/ && ssh oracle "cp /home/ubuntu/AutoRewardPlus-v7.2.1/accounts.json /home/ubuntu/AutoRewardPlus-v7.2.1/dist/accounts.json 2>/dev/null || true"`;
        execSync(cmd, { stdio: 'inherit' });
        return { success: true, message: 'Sessions and accounts synced to VPS successfully.' };
    }

    /**
     * Schedule daily automatic run via Windows Task Scheduler
     */
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

const http = require('http');
const net = require('net');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = parseInt(process.env.PROXY_PORT || '10808', 10);
const HOST = process.env.PROXY_HOST || '0.0.0.0';
const ALLOW_ALL = process.env.PROXY_ALLOW_ALL === '1';
const ALLOW_LAN = process.env.PROXY_ALLOW_LAN === '1';
const AUTH_USER = process.env.PROXY_USERNAME || '';
const AUTH_PASS = process.env.PROXY_PASSWORD || '';
const EXTRA_ALLOWED_IPS = new Set(
    (process.env.PROXY_ALLOWED_IPS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
);

const startedAt = Date.now();
const stats = {
    activeConnections: 0,
    activeTunnels: 0,
    totalHttpRequests: 0,
    totalTunnels: 0,
    totalErrors: 0,
    blockedRequests: 0,
    bytesIn: 0,
    bytesOut: 0,
    recentErrors: []
};

function pushError(scope, message) {
    stats.totalErrors += 1;
    stats.recentErrors.push({
        time: new Date().toISOString(),
        scope,
        message: String(message).slice(0, 200)
    });
    if (stats.recentErrors.length > 25) {
        stats.recentErrors.shift();
    }
}

function normalizeIp(raw) {
    if (!raw) return '';
    return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function isClientAllowed(remoteAddress) {
    if (ALLOW_ALL) return true;
    const ip = normalizeIp(remoteAddress);
    if (!ip) return false;
    if (ip === '127.0.0.1' || ip === '::1') return true;
    if (EXTRA_ALLOWED_IPS.has(ip)) return true;

    const parts = ip.split('.').map(n => parseInt(n, 10));
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
        return false;
    }
    const [a, b] = parts;

    // Tailscale CGNAT: 100.64.0.0/10
    if (a === 100 && b >= 64 && b <= 127) return true;

    if (ALLOW_LAN) {
        if (a === 10) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
    }

    return false;
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function isProxyAuthorized(req) {
    if (!AUTH_USER && !AUTH_PASS) return true;
    const header = req.headers['proxy-authorization'];
    if (!header || !header.startsWith('Basic ')) return false;
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return false;
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    return safeEqual(user, AUTH_USER) && safeEqual(pass, AUTH_PASS);
}

function parseConnectTarget(rawTarget) {
    const target = (rawTarget || '').trim();
    if (!target) return null;

    // IPv6 literal: [::1]:443
    if (target.startsWith('[')) {
        const endBracket = target.indexOf(']');
        if (endBracket === -1) return null;
        const host = target.slice(1, endBracket);
        const rest = target.slice(endBracket + 1);
        const port = rest.startsWith(':') ? parseInt(rest.slice(1), 10) || 443 : 443;
        return { host, port };
    }

    const lastColon = target.lastIndexOf(':');
    if (lastColon === -1) {
        return { host: target, port: 443 };
    }
    const host = target.slice(0, lastColon);
    const port = parseInt(target.slice(lastColon + 1), 10) || 443;
    return { host, port };
}

function buildSnapshot() {
    return {
        ok: true,
        service: 'AutoRewardPlus-Proxy',
        host: HOST,
        port: PORT,
        pid: process.pid,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        activeConnections: stats.activeConnections,
        activeTunnels: stats.activeTunnels,
        totalHttpRequests: stats.totalHttpRequests,
        totalTunnels: stats.totalTunnels,
        totalErrors: stats.totalErrors,
        blockedRequests: stats.blockedRequests,
        bytesIn: stats.bytesIn,
        bytesOut: stats.bytesOut,
        allowlist: ALLOW_ALL ? 'all' : ALLOW_LAN ? 'localhost+tailscale+lan' : 'localhost+tailscale',
        authEnabled: Boolean(AUTH_USER || AUTH_PASS),
        recentErrors: stats.recentErrors.slice(-10)
    };
}

const server = http.createServer((req, res) => {
    const clientIp = req.socket?.remoteAddress;
    if (!isClientAllowed(clientIp)) {
        stats.blockedRequests += 1;
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Forbidden IP' }));
    }

    // Direct management / health endpoints (relative path, not absolute proxy URL)
    if (req.url && req.url.startsWith('/')) {
        const pathname = req.url.split('?')[0];
        if (pathname === '/favicon.ico') {
            res.writeHead(204);
            return res.end();
        }
        if (pathname === '/' || pathname === '/health' || pathname === '/stats' || pathname === '/metrics') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(buildSnapshot()));
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Direct relative path is not a proxy target' }));
    }

    if (!isProxyAuthorized(req)) {
        res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="AutoRewardPlus Proxy"' });
        return res.end('Proxy Authentication Required');
    }

    stats.totalHttpRequests += 1;
    try {
        const parsedUrl = new URL(req.url);
        const outboundHeaders = { ...req.headers };
        delete outboundHeaders['proxy-connection'];
        delete outboundHeaders['proxy-authorization'];

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method: req.method,
            headers: outboundHeaders
        };

        const proxyReq = http.request(options, proxyRes => {
            proxyRes.on('data', chunk => {
                stats.bytesOut += chunk.length;
            });
            if (!res.headersSent) {
                res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            }
            proxyRes.pipe(res);
        });

        proxyReq.setTimeout(30000, () => {
            proxyReq.destroy(new Error('Upstream HTTP timeout'));
        });

        proxyReq.on('error', err => {
            pushError('HTTP', `${req.url}: ${err.message}`);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
            }
            if (!res.writableEnded) {
                res.end(`Proxy error: ${err.message}`);
            }
        });

        req.on('data', chunk => {
            stats.bytesIn += chunk.length;
        });
        req.on('aborted', () => proxyReq.destroy());
        req.on('error', () => proxyReq.destroy());
        res.on('close', () => {
            if (!proxyReq.destroyed) proxyReq.destroy();
        });

        req.pipe(proxyReq);
    } catch (err) {
        pushError('HTTP-PARSE', err.message);
        if (!res.headersSent) res.writeHead(400);
        if (!res.writableEnded) res.end(`Proxy exception: ${err.message}`);
    }
});

// Handle HTTPS CONNECT tunneling
server.on('connect', (req, clientSocket, head) => {
    if (!isClientAllowed(clientSocket.remoteAddress)) {
        stats.blockedRequests += 1;
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        clientSocket.destroy();
        return;
    }

    if (!isProxyAuthorized(req)) {
        clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="AutoRewardPlus Proxy"\r\n\r\n');
        clientSocket.destroy();
        return;
    }

    const parsed = parseConnectTarget(req.url);
    if (!parsed || !parsed.host || parsed.port < 1 || parsed.port > 65535) {
        clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        clientSocket.destroy();
        return;
    }

    stats.totalTunnels += 1;
    stats.activeTunnels += 1;
    let cleaned = false;
    let serverSocket = null;

    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        stats.activeTunnels = Math.max(0, stats.activeTunnels - 1);
        if (serverSocket && !serverSocket.destroyed) serverSocket.destroy();
        if (!clientSocket.destroyed) clientSocket.destroy();
    };

    clientSocket.setNoDelay(true);
    clientSocket.setKeepAlive(true, 15000);
    clientSocket.setTimeout(180000, cleanup);

    serverSocket = net.connect(parsed.port, parsed.host, () => {
        if (cleaned || clientSocket.destroyed) {
            cleanup();
            return;
        }
        serverSocket.setNoDelay(true);
        serverSocket.setKeepAlive(true, 15000);
        serverSocket.setTimeout(180000, cleanup);

        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length > 0) {
            stats.bytesIn += head.length;
            serverSocket.write(head);
        }

        serverSocket.on('data', chunk => {
            stats.bytesOut += chunk.length;
        });
        clientSocket.on('data', chunk => {
            stats.bytesIn += chunk.length;
        });

        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
    });

    serverSocket.setTimeout(15000, () => {
        // Connect timeout only before connection succeeds; updated to 180s inside connect callback
        if (!serverSocket.destroyed && !serverSocket.writableFinished) {
            pushError('CONNECT-TIMEOUT', `${parsed.host}:${parsed.port}`);
            if (!clientSocket.destroyed) {
                clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
            }
            cleanup();
        }
    });

    serverSocket.on('error', err => {
        pushError('CONNECT', `${parsed.host}:${parsed.port}: ${err.message}`);
        if (!clientSocket.destroyed && !clientSocket.writableEnded) {
            try {
                clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\nProxy error: ${err.message}`);
            } catch {}
        }
        cleanup();
    });

    clientSocket.on('error', cleanup);
    clientSocket.on('close', cleanup);
    serverSocket.on('close', cleanup);
});

server.on('connection', socket => {
    stats.activeConnections += 1;
    socket.on('close', () => {
        stats.activeConnections = Math.max(0, stats.activeConnections - 1);
    });
});

server.on('clientError', (err, socket) => {
    if (err && err.code !== 'ECONNRESET') {
        pushError('CLIENT', err.message);
    }
    if (socket && socket.writable && !socket.destroyed) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
});

server.on('error', err => {
    pushError('SERVER', err.message);
    console.error(`[Residential Proxy Error] ${err.message}`);
    process.exit(1);
});

server.maxConnections = 1000;
server.headersTimeout = 30000;
server.requestTimeout = 0;
server.keepAliveTimeout = 60000;

server.listen(PORT, HOST, () => {
    console.log(`[Residential Proxy] Running on ${HOST}:${PORT} (Allowlist: ${buildSnapshot().allowlist})`);
});

function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

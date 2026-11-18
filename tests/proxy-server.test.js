const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { spawn } = require('node:child_process')

const proxyScript = path.join(__dirname, '..', 'tools', 'windows-controller', 'proxyServer.js')

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer()
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address()
            srv.close(() => resolve(addr.port))
        })
        srv.on('error', reject)
    })
}

async function startProxy(envOverrides = {}) {
    const port = await getFreePort()
    const child = spawn(process.execPath, [proxyScript], {
        env: { ...process.env, PROXY_PORT: String(port), PROXY_HOST: '127.0.0.1', ...envOverrides },
        stdio: ['ignore', 'pipe', 'pipe']
    })
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Proxy startup timeout')), 5000)
        child.stdout.on('data', chunk => {
            if (String(chunk).includes('Running on')) {
                clearTimeout(timer)
                resolve()
            }
        })
        child.on('exit', code => {
            clearTimeout(timer)
            reject(new Error(`Proxy exited early with code ${code}`))
        })
    })
    return { port, child }
}

test('proxyServer exposes /health and /stats and tunnels HTTP + CONNECT requests', async () => {
    const targetServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: req.url }))
    })
    await new Promise(resolve => targetServer.listen(0, '127.0.0.1', resolve))
    const targetPort = targetServer.address().port

    const { port: proxyPort, child } = await startProxy()
    try {
        // 1. Direct /health check
        const healthRes = await fetch(`http://127.0.0.1:${proxyPort}/health`)
        assert.equal(healthRes.status, 200)
        const healthJson = await healthRes.json()
        assert.equal(healthJson.ok, true)
        assert.equal(healthJson.service, 'AutoRewardPlus-Proxy')

        // 2. Standard HTTP proxy request
        const proxyHttpBody = await new Promise((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1',
                port: proxyPort,
                path: `http://127.0.0.1:${targetPort}/hello`,
                method: 'GET',
                headers: { Host: `127.0.0.1:${targetPort}` }
            }, res => {
                let data = ''
                res.on('data', d => { data += d })
                res.on('end', () => resolve({ status: res.statusCode, data }))
            })
            req.on('error', reject)
            req.end()
        })
        assert.equal(proxyHttpBody.status, 200)
        assert.deepEqual(JSON.parse(proxyHttpBody.data), { ok: true, path: '/hello' })

        // 3. CONNECT tunnel to targetServer
        const tunnelResp = await new Promise((resolve, reject) => {
            const sock = net.connect(proxyPort, '127.0.0.1', () => {
                sock.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`)
            })
            let stage = 0
            let buf = ''
            sock.on('data', chunk => {
                buf += chunk.toString('utf8')
                if (stage === 0 && buf.includes('\r\n\r\n')) {
                    assert.ok(buf.startsWith('HTTP/1.1 200'))
                    stage = 1
                    buf = ''
                    sock.write(`GET /via-tunnel HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`)
                }
            })
            sock.on('end', () => resolve(buf))
            sock.on('error', reject)
        })
        assert.ok(tunnelResp.includes('/via-tunnel'))

        // 4. Stats reflect traffic
        const statsRes = await fetch(`http://127.0.0.1:${proxyPort}/stats`)
        const stats = await statsRes.json()
        assert.ok(stats.totalHttpRequests >= 1)
        assert.ok(stats.totalTunnels >= 1)
        assert.equal(stats.activeTunnels, 0)
    } finally {
        child.kill('SIGTERM')
        await new Promise(resolve => targetServer.close(resolve))
    }
})

test('proxyServer enforces Proxy-Authorization when PROXY_USERNAME and PROXY_PASSWORD are set', async () => {
    const { port: proxyPort, child } = await startProxy({ PROXY_USERNAME: 'u1', PROXY_PASSWORD: 'p1' })
    try {
        const unauth = await new Promise((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1',
                port: proxyPort,
                path: 'http://example.com/',
                method: 'GET'
            }, res => resolve(res.statusCode))
            req.on('error', reject)
            req.end()
        })
        assert.equal(unauth, 407)
    } finally {
        child.kill('SIGTERM')
    }
})

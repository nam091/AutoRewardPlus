const http = require('http');
const net = require('net');
const url = require('url');

const PORT = parseInt(process.env.PROXY_PORT || '10808', 10);
const HOST = process.env.PROXY_HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
    // Handle standard HTTP requests
    try {
        const parsedUrl = url.parse(req.url);
        const options = {
            hostname: parsedUrl.hostname || req.headers.host,
            port: parsedUrl.port || 80,
            path: parsedUrl.path,
            method: req.method,
            headers: req.headers
        };

        const proxyReq = http.request(options, proxyRes => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', err => {
            console.error(`[HTTP Proxy Error] ${req.url}:`, err.message);
            if (!res.headersSent) res.writeHead(502);
            res.end(`Proxy error: ${err.message}`);
        });

        req.pipe(proxyReq);
    } catch (err) {
        if (!res.headersSent) res.writeHead(500);
        res.end(`Proxy exception: ${err.message}`);
    }
});

// Handle HTTPS CONNECT tunneling
server.on('connect', (req, clientSocket, head) => {
    const [targetHost, targetPort] = req.url.split(':');
    const port = parseInt(targetPort, 10) || 443;

    const serverSocket = net.connect(port, targetHost, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', err => {
        clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\nProxy error: ${err.message}`);
        clientSocket.destroy();
    });

    clientSocket.on('error', () => {
        serverSocket.destroy();
    });
});

server.listen(PORT, HOST, () => {
    console.log(`[Residential Proxy] Running on ${HOST}:${PORT} (Ready for Tailscale VPS traffic)`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});

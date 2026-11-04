/**
 * Regression test: accounts must report RUNNING while a bot process is alive,
 * even when the dashboard did not spawn that process itself.
 *
 * The check used to look only at `processManager`'s own child handle, so runs
 * started from the CLI (or the Windows control center) appeared IDLE forever
 * although db.json still held status RUNNING.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

test('dashboard consults a live process probe, not only its own child', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard', 'server.ts'), 'utf8')

    assert.ok(src.includes('hasLiveBotProcess'), 'loadAccounts must probe live bot processes')
    assert.ok(
        /staleRunning\s*=\s*state\.status\s*===\s*'RUNNING'\s*&&\s*!isProcessActive\s*&&\s*!this\.hasLiveBotProcess\(\)/.test(
            src
        ),
        'RUNNING is only stale when no bot process exists at all'
    )
})

test('live probe matches the bot entrypoint but never the dashboard', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard', 'server.ts'), 'utf8')
    const body = src.slice(src.indexOf('private hasLiveBotProcess'), src.indexOf('private applyProcessStatus'))

    assert.ok(body.includes("'dist/index.js'"), 'probe must look for the bot entrypoint')
    assert.ok(body.includes("!line.includes('dist/dashboard')"), 'probe must ignore the dashboard process')
})

/**
 * Functional tests for the same-day batch checkpoint.
 *
 * RunCheckpointService resolves its data file from process.cwd(), so these
 * tests execute from a temporary directory and never touch the real db.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DIST = path.join(__dirname, '..', 'dist', 'services', 'runCheckpointService.js')
const originalCwd = process.cwd()
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-checkpoint-'))
process.chdir(tempDir)
const { RunCheckpointService, localDay } = require(DIST)

process.on('exit', () => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
})

test('checkpoint is disabled until a batch run enables it', () => {
    const service = new RunCheckpointService()
    service.mark('a@example.com', 'error')
    assert.strictEqual(service.load(), null)
})

test('same-day checkpoint survives a later started account and an explicit error', () => {
    const service = new RunCheckpointService()
    service.enabled = true
    service.clear()

    service.mark('first@example.com', 'error')
    service.mark('second@example.com', 'started')
    assert.strictEqual(service.getResumeEmail(), 'first@example.com')

    service.mark('third@example.com', 'error')
    assert.strictEqual(service.getResumeEmail(), 'first@example.com')
})

test('a checkpoint from another day is ignored and clear removes it', () => {
    const service = new RunCheckpointService()
    service.enabled = true
    service.clear()

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    service.mark('old@example.com', 'error', yesterday)
    assert.strictEqual(service.getResumeEmail(), null)

    service.mark('today@example.com', 'started')
    assert.strictEqual(service.getResumeEmail(), 'today@example.com')
    service.clear()
    assert.strictEqual(service.load(), null)
    assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/)
})

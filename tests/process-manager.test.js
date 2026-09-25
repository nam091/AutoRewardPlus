const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const process = require('node:process')

const { ProcessManager } = require('../dist/dashboard/processManager')

const fixture = path.join(__dirname, 'fixtures', 'process-fixture.js')

function manager(mode, stopTimeoutMs = 1000) {
    return new ProcessManager({
        command: process.execPath,
        args: [fixture, mode],
        cwd: path.dirname(fixture),
        stopTimeoutMs,
        logBufferSize: 100,
        historySize: 10
    })
}

test('ProcessManager records a successful run and structured logs', async () => {
    const instance = manager('success')
    const finished = new Promise(resolve => instance.once('finished', resolve))
    const status = await instance.start()
    assert.equal(status.state, 'RUNNING')
    await finished

    const final = instance.getStatus()
    assert.equal(final.state, 'OK')
    assert.equal(final.active, false)
    assert.ok(instance.getLogs().some(entry => entry.message === 'fixture started'))
    assert.equal(instance.getHistory(1)[0].state, 'OK')
})

test('ProcessManager rejects duplicate starts', async () => {
    const instance = manager('sleep')
    const finished = new Promise(resolve => instance.once('finished', resolve))
    await instance.start()
    await assert.rejects(() => instance.start(), /already running/i)
    await instance.stop()
    await finished
    assert.equal(instance.getStatus().state, 'STOPPED')
})

test('ProcessManager classifies non-zero exit as ERROR', async () => {
    const instance = manager('error')
    const finished = new Promise(resolve => instance.once('finished', resolve))
    await instance.start()
    await finished
    assert.equal(instance.getStatus().state, 'ERROR')
    assert.ok(instance.getErrors().some(entry => entry.message === 'fixture failed'))
})

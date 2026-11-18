const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const process = require('node:process')

const { SingleAccountPool } = require('../dist/dashboard/singleAccountPool')

const fixture = path.join(__dirname, 'fixtures', 'process-fixture.js')

function createPool(mode = 'sleep', maxConcurrent = 2) {
    return new SingleAccountPool({
        command: process.execPath,
        args: [fixture, mode],
        cwd: path.dirname(fixture),
        maxConcurrent,
        stopTimeoutMs: 500
    })
}

test('SingleAccountPool runs up to 2 accounts concurrently and auto-queues the 3rd', async () => {
    const pool = createPool('sleep', 2)
    try {
        const r1 = await pool.enqueueOrStart('acc1@example.com')
        assert.equal(r1.status, 'started')
        assert.equal(r1.snapshot.activeCount, 1)

        const r2 = await pool.enqueueOrStart('acc2@example.com')
        assert.equal(r2.status, 'started')
        assert.equal(r2.snapshot.activeCount, 2)

        const r3 = await pool.enqueueOrStart('acc3@example.com')
        assert.equal(r3.status, 'queued')
        assert.equal(r3.position, 1)
        assert.equal(r3.snapshot.activeCount, 2)
        assert.equal(r3.snapshot.queuedCount, 1)

        // Duplicate account (running or queued) must be rejected
        await assert.rejects(() => pool.enqueueOrStart('acc1@example.com'), /đang chạy/i)
        await assert.rejects(() => pool.enqueueOrStart('acc3@example.com'), /hàng đợi/i)

        // Stopping acc1 should promote acc3 from queue into the freed slot
        const startedAcc3 = new Promise(resolve => {
            pool.on('status', snap => {
                if (snap.active.some(a => a.email === 'acc3@example.com')) resolve(snap)
            })
        })
        await pool.stopAccount('acc1@example.com')
        const snapAfterPromote = await startedAcc3
        assert.equal(snapAfterPromote.activeCount, 2)
        assert.equal(snapAfterPromote.queuedCount, 0)
        assert.ok(snapAfterPromote.active.some(a => a.email === 'acc2@example.com'))
        assert.ok(snapAfterPromote.active.some(a => a.email === 'acc3@example.com'))
    } finally {
        await pool.stopAll()
    }
})

test('SingleAccountPool stopAccount removes queued entry and stopAll clears everything', async () => {
    const pool = createPool('sleep', 2)
    try {
        await pool.enqueueOrStart('a@example.com')
        await pool.enqueueOrStart('b@example.com')
        await pool.enqueueOrStart('c@example.com')

        const cancelRes = await pool.stopAccount('c@example.com')
        assert.equal(cancelRes.removedFromQueue, true)
        assert.equal(cancelRes.stopped, false)
        assert.equal(cancelRes.snapshot.queuedCount, 0)

        await pool.enqueueOrStart('d@example.com')
        const finalSnap = await pool.stopAll()
        assert.equal(finalSnap.activeCount, 0)
        assert.equal(finalSnap.queuedCount, 0)
        assert.equal(pool.isActive(), false)
    } finally {
        await pool.stopAll()
    }
})

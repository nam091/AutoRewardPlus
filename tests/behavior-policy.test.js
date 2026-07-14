const assert = require('node:assert/strict')
const test = require('node:test')

const { SeededRandom } = require('../dist/browser/humanize/SeededRandom')
const {
    chooseResultInteraction,
    getAccountStartDelayMs,
    getSessionBreakMs,
    maskAccount
} = require('../dist/browser/humanize/BehaviorPolicy')
const { getRetryDelayMs } = require('../dist/util/Axios')

test('result interactions are deterministic and respect disabled actions', () => {
    const first = new SeededRandom('interactions')
    const second = new SeededRandom('interactions')
    const options = { allowScroll: true, allowClick: true }
    const a = Array.from({ length: 100 }, () => chooseResultInteraction(first, options))
    const b = Array.from({ length: 100 }, () => chooseResultInteraction(second, options))
    assert.deepEqual(a, b)
    assert.equal(new Set(a).size, 3)
    assert.equal(chooseResultInteraction(new SeededRandom('read'), { allowScroll: false, allowClick: false }), 'read')
})

test('account scheduling is stable and telemetry IDs do not expose account names', () => {
    const first = getAccountStartDelayMs('person@example.com', '2026-07-14', 2000, 10000)
    const second = getAccountStartDelayMs('person@example.com', '2026-07-14', 2000, 10000)
    assert.equal(first, second)
    assert.ok(first >= 2000 && first <= 10000)
    assert.doesNotMatch(maskAccount('person@example.com'), /person|example/i)
})

test('session breaks stay off for short sessions and bounded for long sessions', () => {
    assert.equal(getSessionBreakMs(new SeededRandom('short'), 14 * 60000), 0)
    for (let i = 0; i < 100; i++) {
        const delay = getSessionBreakMs(new SeededRandom(`long-${i}`), 90 * 60000)
        assert.ok(delay === 0 || (delay >= 15000 && delay <= 45000))
    }
})

test('429 retry delay honors Retry-After and caps excessive values', () => {
    assert.equal(getRetryDelayMs(1, '3'), 3000)
    assert.equal(getRetryDelayMs(1, '9999'), 300000)
    const fallback = getRetryDelayMs(3, undefined)
    assert.ok(fallback >= 4000 && fallback < 4500)
})

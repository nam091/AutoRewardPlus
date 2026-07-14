const assert = require('node:assert/strict')
const test = require('node:test')

const { SeededRandom, stableSeed } = require('../dist/browser/humanize/SeededRandom')

test('same seed produces the same session sequence', () => {
    const first = SeededRandom.fromParts('account', true, '2026-07-14')
    const second = SeededRandom.fromParts('account', true, '2026-07-14')
    assert.deepEqual(
        Array.from({ length: 20 }, () => first.next()),
        Array.from({ length: 20 }, () => second.next())
    )
    assert.equal(stableSeed('account', true), stableSeed('account', true))
    assert.notEqual(stableSeed('account', true), stableSeed('account', false))
})

test('weighted selection and shuffle are deterministic without collapsing variety', () => {
    const first = new SeededRandom('weighted')
    const second = new SeededRandom('weighted')
    const choices = [{ value: 'skip', weight: 2 }, { value: 'read', weight: 5 }, { value: 'click', weight: 3 }]
    const firstValues = Array.from({ length: 100 }, () => first.weighted(choices))
    const secondValues = Array.from({ length: 100 }, () => second.weighted(choices))
    assert.deepEqual(firstValues, secondValues)
    assert.ok(new Set(firstValues).size >= 3)
    assert.deepEqual(new SeededRandom('shuffle').shuffle([1, 2, 3, 4]), new SeededRandom('shuffle').shuffle([1, 2, 3, 4]))
})

test('integer and gaussian helpers stay usable at boundary values', () => {
    const random = new SeededRandom('bounds')
    for (let i = 0; i < 100; i++) {
        const value = random.int(5, 2)
        assert.ok(value >= 2 && value <= 5)
        assert.ok(Number.isFinite(random.gaussian(10, 2)))
    }
})

const assert = require('node:assert/strict')
const test = require('node:test')

const Utils = require('../dist/util/Utils').default

test('duration parsing and chunking are deterministic', () => {
    const utils = new Utils()
    assert.equal(utils.stringToNumber('1.5sec'), 1500)
    assert.deepEqual(utils.chunkArray([1, 2, 3, 4, 5], 2), [[1, 2, 3], [4, 5]])
})

test('random delay stays inside configured bounds', () => {
    const utils = new Utils()
    for (let i = 0; i < 100; i++) {
        const delay = utils.randomDelay('1sec', '2sec')
        assert.ok(delay >= 1000 && delay <= 2000)
    }
})

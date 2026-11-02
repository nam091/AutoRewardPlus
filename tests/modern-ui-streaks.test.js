/**
 * Regression tests for the May 2026 /earn redesign.
 *
 * Two behaviour changes are pinned here:
 *   1. Mission cards are <a href="/earn/quest/..."> punchcards that carry an
 *      "Expires in N days" caption. The old scan matched the daily "Streaks"
 *      section too, reported "Bing Search Streak" as a mission and then failed
 *      with "Could not locate mission card".
 *   2. "Keep earning" pulse cards (puzzle / trivia) have no "N/M tasks" counter
 *      and were silently dropped, so the section reported zero earnable cards.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const SELECTORS_SRC = path.join(__dirname, '..', 'dist', 'functions', 'ModernUISelectors.js')

function loadSelectors() {
    delete require.cache[require.resolve(SELECTORS_SRC)]
    return require(SELECTORS_SRC)
}

test('STREAK_PROGRESS_PATTERN matches the streak captions rendered on /earn', () => {
    const { STREAK_PROGRESS_PATTERN } = loadSelectors()
    const re = new RegExp(STREAK_PROGRESS_PATTERN, 'i')

    const cases = [
        ['Search: 1/1', '1', '1'],
        ['Activity: 3/3', '3', '3'],
        ['Check-in: 0/1', '0', '1'],
        ['Check in: 0/1', '0', '1'],
        ['Tìm kiếm: 2/3', '2', '3'],
        ['Hoạt động: 1/1', '1', '1']
    ]

    for (const [text, done, total] of cases) {
        const match = text.match(re)
        assert.ok(match, `expected "${text}" to match`)
        assert.strictEqual(match[1], done)
        assert.strictEqual(match[2], total)
    }
})

test('STREAK_PROGRESS_PATTERN does not match task counters', () => {
    const { STREAK_PROGRESS_PATTERN } = loadSelectors()
    const re = new RegExp(STREAK_PROGRESS_PATTERN, 'i')
    assert.strictEqual(re.test('0/8 tasks'), false)
    assert.strictEqual(re.test('4/4 tasks'), false)
})

test('MISSION_EXPIRY_PATTERN separates punchcards from daily streaks', () => {
    const { MISSION_EXPIRY_PATTERN } = loadSelectors()
    const re = new RegExp(MISSION_EXPIRY_PATTERN, 'i')

    assert.ok(re.test('Expires in 6 days'))
    assert.ok(re.test('Expires in 4 weeks'))

    // The streak section never renders an expiry caption, which is precisely how
    // the mission scanner now tells the two apart.
    assert.strictEqual(re.test('Daily streaks reset in 12h'), false)
})

test('mission card selectors include the button-based redesign', () => {
    const { MISSION_CARD_SELECTORS } = loadSelectors()
    assert.ok(
        MISSION_CARD_SELECTORS.some(selector => selector.includes('button[aria-expanded]')),
        'mission cards render as <button aria-expanded> since the redesign'
    )
    assert.ok(MISSION_CARD_SELECTORS.some(selector => selector.includes('/earn/quest/')))
})

test('completion probe must stop at the section boundary', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'functions', 'ModernUIWorkers.ts'), 'utf8')

    // Walking parents past <section> reached <main>, where the already-completed
    // Daily Set cards expose success badges. Every punchcard then looked finished
    // and was dropped before it could be clicked, so Quests never ran.
    const guards = src.match(/if \(temp\.tagName === 'SECTION'\) break/g) || []
    assert.strictEqual(guards.length, 2, 'both mission scanners need the section-boundary guard')
})

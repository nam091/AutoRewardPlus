const assert = require('node:assert/strict')
const test = require('node:test')
const { chromium: patchrightChromium } = require('patchright')
const { chromium } = require('playwright-core')

const { ModernUIWorkers } = require('../dist/functions/ModernUIWorkers')
const { SECTIONS } = require('../dist/functions/ModernUISelectors')

/**
 * These tests exercise the modern-UI DOM scraping against fixtures instead of
 * the live Rewards site. The scraping is the most breakage-prone part of the
 * project and previously had no coverage at all.
 */

function createStubBot() {
    return {
        isMobile: false,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        utils: { wait: async () => {}, randomDelay: () => 0 },
        browser: { utils: { getLatestTab: async page => page, tryDismissAllMessages: async () => {} } }
    }
}

function card({ href, title, points, completed = false, locked = false, extra = '' }) {
    return `
        <a target="_blank" href="${href}">
            <p class="text-globalBody2Strong">${title}</p>
            ${points ? `<p class="text-statusInformativeTintFg">${points}</p>` : ''}
            ${completed ? '<span class="bg-statusSuccessRewardsBg">Completed</span>' : ''}
            ${locked ? '<span>Silver level required</span>' : ''}
            ${extra}
        </a>`
}

function dashboardFixture(heading, cards) {
    return `<!doctype html><html><body>
        <section>
            <h2>${heading}</h2>
            <button aria-expanded="true" slot="trigger">toggle</button>
            <div>${cards.join('')}</div>
        </section>
    </body></html>`
}

async function withPage(html, fn) {
    const browser = await chromium.launch({ headless: true, executablePath: patchrightChromium.executablePath() })
    try {
        const page = await browser.newPage()
        await page.setContent(html)
        return await fn(page)
    } finally {
        await browser.close()
    }
}

test('daily set cards are found via the English heading', async () => {
    const html = dashboardFixture('Daily set', [
        card({ href: 'https://example.com/a', title: 'Task A', points: '+10' }),
        card({ href: 'https://example.com/b', title: 'Task B', points: '+5', completed: true })
    ])

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findDailySetCards'](page))

    assert.equal(found.length, 2)
    assert.equal(found[0].title, 'Task A')
    assert.equal(found[0].points, '+10')
    assert.equal(found[0].completed, false)
    assert.equal(found[0].href, 'https://example.com/a')
    assert.equal(found[1].completed, true, 'card with a success badge must be marked completed')
})

test('daily set cards are found via a localized heading', async () => {
    // Accounts commonly run with a non-US geoLocale; the previous single
    // hardcoded English heading silently matched nothing.
    const html = dashboardFixture('Nhiệm vụ hằng ngày', [
        card({ href: 'https://example.com/a', title: 'Nhiệm vụ A', points: '+10' })
    ])

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findDailySetCards'](page))

    assert.equal(found.length, 1)
    assert.equal(found[0].title, 'Nhiệm vụ A')
})

test('daily set headings are matched case-insensitively', async () => {
    const html = dashboardFixture('DAILY SET', [
        card({ href: 'https://example.com/a', title: 'Task A', points: '+10' })
    ])

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findDailySetCards'](page))

    assert.equal(found.length, 1)
})

test('keep earning skips completed, locked and mission cards', async () => {
    const html = dashboardFixture('Keep earning', [
        card({ href: 'https://example.com/ok', title: 'Earnable', points: '+20' }),
        card({ href: 'https://example.com/done', title: 'Done', points: '+20', completed: true }),
        card({ href: 'https://example.com/locked', title: 'Locked', points: '+20', locked: true }),
        card({ href: 'https://example.com/mission', title: 'Mission', points: '+50', extra: '<span>0/4 tasks</span>' })
    ])

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findKeepEarningCards'](page))

    assert.deepEqual(
        found.map(c => c.title),
        ['Earnable']
    )
})

test('keep earning reads points from a description when no badge is present', async () => {
    const html = dashboardFixture('Keep earning', [
        `<a target="_blank" href="https://example.com/desc">
            <p class="text-globalBody2Strong">Read an article</p>
            <p class="text-secondary">Read to earn 30 points</p>
         </a>`,
        `<a target="_blank" href="https://example.com/vi">
            <p class="text-globalBody2Strong">Đọc bài viết</p>
            <p class="text-secondary">Đọc để nhận 25 điểm</p>
         </a>`
    ])

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findKeepEarningCards'](page))

    assert.deepEqual(
        found.map(c => c.points),
        ['+30', '+25']
    )
})

test('keep earning returns nothing when the section heading is absent', async () => {
    const html = dashboardFixture('Some unrelated section', [
        card({ href: 'https://example.com/a', title: 'Task A', points: '+10' })
    ])

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findKeepEarningCards'](page))

    assert.equal(found.length, 0)
})

test('a card is clicked by href even when its position shifts', async () => {
    // A promoted card appearing above the target used to shift every index and
    // send the click to the wrong task.
    const html = dashboardFixture('Daily set', [
        card({ href: 'https://example.com/promo', title: 'Promo', points: '+1' }),
        card({ href: 'https://example.com/target', title: 'Target', points: '+10' })
    ])

    const clickedHref = await withPage(html, async page => {
        await page.evaluate(() => {
            window.__clicked = null
            document.querySelectorAll('a').forEach(a => {
                a.addEventListener('click', event => {
                    event.preventDefault()
                    window.__clicked = a.getAttribute('href')
                })
            })
        })

        const workers = new ModernUIWorkers(createStubBot())
        // Stale index 0 (from before the promo card appeared) plus the correct href.
        await workers['clickCardInSection'](
            page,
            SECTIONS.dailySet,
            { index: 0, title: 'Target', points: '+10', href: 'https://example.com/target' },
            'TEST'
        )

        return page.evaluate(() => window.__clicked)
    })

    assert.equal(clickedHref, 'https://example.com/target')
})

test('mission sub-tasks are clicked by identity, not by shifting index', async () => {
    // Regression: sub-tasks were clicked by their position in the *incomplete*
    // list. Completing one removed it from that list and shifted every later
    // index, so the loop clicked the wrong row and skipped the last task.
    const html = `<!doctype html><html><body>
        <div><a href="https://example.com/task1"><h3>Task one</h3></a></div>
        <div><a href="https://example.com/task2"><h3>Task two</h3></a></div>
        <div><a href="https://example.com/task3"><h3>Task three</h3></a></div>
    </body></html>`

    const result = await withPage(html, async page => {
        const workers = new ModernUIWorkers(createStubBot())

        const tasks = await workers['findMissionSubTasks'](page)

        await page.evaluate(() => {
            window.__clicked = []
            document.querySelectorAll('a').forEach(a => {
                a.addEventListener('click', event => {
                    event.preventDefault()
                    window.__clicked.push(a.getAttribute('href'))
                })
            })

            // Simulate the first task completing, which removes it from the
            // incomplete list and shifts the remaining indices.
            const firstRow = document.querySelector('div')
            firstRow.insertAdjacentHTML('beforeend', '<span class="bg-statusSuccessRewardsBg">Completed</span>')
        })

        // Ask for what was originally the second task.
        await workers['clickMissionSubTask'](page, tasks[1])

        return { tasks, clicked: await page.evaluate(() => window.__clicked) }
    })

    assert.equal(result.tasks.length, 3)
    assert.deepEqual(
        result.clicked,
        ['https://example.com/task2'],
        'must click the task it was asked for, not the one now at that index'
    )
})

test('a sub-task that already completed is reported as not clicked', async () => {
    const html = `<!doctype html><html><body>
        <div><a href="https://example.com/task1"><h3>Task one</h3></a></div>
    </body></html>`

    const clicked = await withPage(html, async page => {
        const workers = new ModernUIWorkers(createStubBot())
        const tasks = await workers['findMissionSubTasks'](page)

        await page.evaluate(() => {
            document
                .querySelector('div')
                .insertAdjacentHTML('beforeend', '<span class="bg-statusSuccessRewardsBg">Completed</span>')
        })

        return workers['clickMissionSubTask'](page, tasks[0])
    })

    assert.equal(clicked, false)
})

test('claim card points are read across locales', async () => {
    const html = `<!doctype html><html><body>
        <div class="bg-bgCardOnPrimaryDefaultRest">
            <span>Sẵn sàng nhận</span>
            <p class="text-pageHeader">124</p>
        </div>
    </body></html>`

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findClaimCard'](page))

    assert.deepEqual(found, { points: 124 })
})

/*
 * The fixtures below reproduce markup observed on the live Rewards site on
 * 2026-07-26, and cover the failures found during that inspection.
 */

test('daily set points are read when the badge has no plus sign', async () => {
    // Observed on /dashboard: the figure renders as a bare "10" inside
    // p.text-metadata.text-fgCtrlOnImage. "+N" appears nowhere on that page, so
    // requiring the plus produced no point value and the card was filtered out.
    const html = `<!doctype html><html><body>
        <section id="dailyset">
            <h2>Daily set</h2>
            <a target="_blank" href="https://example.com/a">
                <p class="line-clamp-3 text-globalBody2Strong">Aegean Gem?</p>
                <p class="line-clamp-3 text-fgCtrlNeutralSecondaryRest">Test your knowledge.</p>
                <p class="text-metadata text-fgCtrlOnImage">10</p>
            </a>
        </section>
    </body></html>`

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findDailySetCards'](page))

    assert.equal(found.length, 1)
    assert.equal(found[0].points, '+10')
    assert.equal(found[0].completed, false)
})

test('a section is resolved from whichever copy actually holds the cards', async () => {
    // Observed on /earn: two elements share id="moreactivities" and the heading
    // "Keep earning". The first is a skeleton with no cards; the second holds
    // them. Taking the first match found nothing and skipped every task.
    const html = `<!doctype html><html><body>
        <section id="moreactivities">
            <h2>Keep earning</h2>
            <div class="animate-pulse"></div>
        </section>
        <div hidden>
            <section id="moreactivities">
                <h2>Keep earning</h2>
                <a target="_blank" href="https://example.com/quiz">
                    <p class="text-globalBody2Strong">Do you know the answer?</p>
                    <p class="text-statusInformativeTintFg">+5</p>
                </a>
            </section>
        </div>
    </body></html>`

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findKeepEarningCards'](page))

    assert.deepEqual(
        found.map(c => ({ title: c.title, points: c.points })),
        [{ title: 'Do you know the answer?', points: '+5' }]
    )
})

test('the section info popover is never mistaken for the expand trigger', async () => {
    // Observed on /dashboard: a section contains both an "About Daily set"
    // popover button with aria-expanded="false" and the real disclosure trigger
    // with slot="trigger". Matching button[aria-expanded] first selected the
    // popover and opened a tooltip instead of expanding the section.
    const html = `<!doctype html><html><body>
        <section id="dailyset">
            <h2>Daily set</h2>
            <button aria-expanded="false" aria-label="About Daily set"></button>
            <button aria-expanded="false" aria-label="Daily set" slot="trigger"></button>
        </section>
    </body></html>`

    const clicked = await withPage(html, async page => {
        await page.evaluate(() => {
            window.__clicked = []
            document.querySelectorAll('button').forEach(b => {
                b.addEventListener('click', () => window.__clicked.push(b.getAttribute('aria-label')))
            })
        })

        await new ModernUIWorkers(createStubBot())['expandDashboardSection'](page, SECTIONS.dailySet)
        return page.evaluate(() => window.__clicked)
    })

    assert.deepEqual(clicked, ['Daily set'], 'must expand the section, not open the About popover')
})

test('sections are located by stable id even when the heading is localized', async () => {
    // Section ids (dailyset, moreactivities, quests) are not localized, so they
    // work for an account whose interface language is not English.
    const html = `<!doctype html><html><body>
        <section id="dailyset">
            <h2>Bộ nhiệm vụ trong ngày</h2>
            <a target="_blank" href="https://example.com/a">
                <p class="text-globalBody2Strong">Nhiệm vụ A</p>
                <p class="text-metadata">10</p>
            </a>
        </section>
    </body></html>`

    const found = await withPage(html, page => new ModernUIWorkers(createStubBot())['findDailySetCards'](page))

    assert.equal(found.length, 1, 'id must resolve the section when no heading alias matches')
    assert.equal(found[0].points, '+10')
})

test('waiting for section content ignores a skeleton placeholder', async () => {
    const html = `<!doctype html><html><body>
        <section id="dailyset">
            <h2>Daily set</h2>
            <div class="animate-pulse"></div>
        </section>
    </body></html>`

    const ready = await withPage(html, page =>
        new ModernUIWorkers(createStubBot())['waitForSectionContent'](page, SECTIONS.dailySet, 2000)
    )

    assert.equal(ready, false, 'a section showing only skeletons must not be reported as loaded')
})

test('waiting for section content succeeds once cards replace the skeleton', async () => {
    const html = `<!doctype html><html><body>
        <section id="dailyset"><h2>Daily set</h2><div class="animate-pulse" id="sk"></div></section>
        <script>
            setTimeout(() => {
                document.getElementById('sk').remove()
                document.querySelector('#dailyset').insertAdjacentHTML(
                    'beforeend',
                    '<a target="_blank" href="https://example.com/a"><p class="text-metadata">10</p></a>'
                )
            }, 1200)
        </script>
    </body></html>`

    const ready = await withPage(html, page =>
        new ModernUIWorkers(createStubBot())['waitForSectionContent'](page, SECTIONS.dailySet, 10000)
    )

    assert.equal(ready, true)
})

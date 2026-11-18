const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const test = require('node:test')
const { chromium: patchrightChromium } = require('patchright')
const { chromium } = require('playwright-core')

const { ModernUIWorkers } = require('../dist/functions/ModernUIWorkers')
const { QueryCore } = require('../dist/functions/QueryEngine')
const { Search } = require('../dist/functions/activities/browser/Search')
const { chooseResultInteraction } = require('../dist/browser/humanize/BehaviorPolicy')
const { SeededRandom } = require('../dist/browser/humanize/SeededRandom')

function createStubBot(overrides = {}) {
    return {
        isMobile: false,
        userData: { geoLocale: 'vn', langCode: 'vi' },
        config: {
            ai: { baseUrl: 'https://mock-ai.local/v1', model: 'mock-model', apiKey: 'mock-key', maxRetries: 1 },
            proxy: { queryEngine: false },
            searchSettings: {
                scrollRandomResults: true,
                clickRandomResults: true,
                parallelSearching: false,
                queryEngines: ['local'],
                searchResultVisitTime: '1sec',
                searchDelay: { min: '1sec', max: '2sec' },
                readDelay: { min: '1sec', max: '2sec' }
            }
        },
        axios: { request: async () => ({ data: {} }) },
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        utils: {
            wait: async () => {},
            randomDelay: () => 0,
            shuffleArray: arr => arr
        },
        browser: {
            utils: {
                getLatestTab: async page => page,
                tryDismissAllMessages: async () => {}
            }
        },
        ...overrides
    }
}

async function withPage(fn) {
    const browser = await chromium.launch({
        headless: true,
        executablePath: patchrightChromium.executablePath()
    })
    try {
        const page = await browser.newPage()
        return await fn(page)
    } finally {
        await browser.close()
    }
}

test('quests section detects and clicks activity cards with changed href/title/missing expiry', async () => {
    const html = `<!doctype html><html><body>
        <section id="streaks">
            <h2>Streaks</h2>
            <button type="button">
                <p class="text-globalBody2Strong">Bing Search Streak</p>
                <span>Search: 1/1</span>
            </button>
        </section>
        <section id="quests">
            <h2>Nhiệm vụ</h2>
            <a href="/earn/activity/custom-monthly-nov" id="activity-card">
                <p class="text-globalBody2Strong">Monthly Exploration</p>
                <span>Activity: 0/3</span>
                <p class="text-statusInformativeTintFg">+50</p>
            </a>
            <a href="/earn/activity/bare-action" id="bare-card">
                <p class="text-globalBody2Strong">Bare Challenge Card</p>
                <span>0/4</span>
            </a>
        </section>
    </body></html>`

    const outcome = await withPage(async page => {
        await page.setContent(html)
        const workers = new ModernUIWorkers(createStubBot())
        const found = await workers['findMissionCards'](page)

        await page.evaluate(() => {
            window.__clickedIds = []
            document.querySelectorAll('a, button').forEach(el => {
                el.addEventListener('click', event => {
                    event.preventDefault()
                    window.__clickedIds.push(el.id || el.textContent.trim())
                })
            })
        })

        if (found[0]) {
            await workers['completeMission'](page, found[0])
        }

        const clicked = await page.evaluate(() => window.__clickedIds)
        return { found, clicked }
    })

    assert.equal(outcome.found.length, 2, 'must find both custom activity cards and ignore Streaks')
    assert.equal(outcome.found[0].title, 'Monthly Exploration')
    assert.equal(outcome.found[0].completedTasks, 0)
    assert.equal(outcome.found[0].totalTasks, 3)
    assert.equal(outcome.found[0].points, '+50')
    assert.equal(outcome.found[1].title, 'Bare Challenge Card')
    assert.equal(outcome.found[1].totalTasks, 4)
    assert.ok(outcome.clicked.includes('activity-card'), 'expected custom activity card to be clicked')
})

test('Path 2 detects button[aria-expanded] with outer expiry span and nested 0/3 tasks span and handles inline expansion', async () => {
    const html = `<!doctype html><html><body>
        <section id="quests">
            <h2>Quests</h2>
            <button aria-expanded="false" aria-label="About Quests"></button>
            <button aria-expanded="false" aria-label="Quests" slot="trigger"></button>
            <div class="quest-wrapper">
                <button id="btn-quest" aria-expanded="false" aria-controls="panel-quest">
                    <p class="text-globalBody2Strong">Nested Counter Quest</p>
                    <span>Expires in 5 days</span>
                    <div><span>0/3 tasks</span></div>
                    <span>+100</span>
                </button>
                <div id="panel-quest" hidden>
                    <a id="inline-subtask" target="_blank" href="https://example.com/sub">Open sub-task</a>
                </div>
            </div>
        </section>
        <script>
            document.getElementById('btn-quest').addEventListener('click', () => {
                const btn = document.getElementById('btn-quest')
                btn.setAttribute('aria-expanded', 'true')
                document.getElementById('panel-quest').hidden = false
            })
            window.__inlineClicked = false
            document.getElementById('inline-subtask').addEventListener('click', e => {
                e.preventDefault()
                window.__inlineClicked = true
                document.getElementById('inline-subtask').insertAdjacentHTML('afterend', '<span class="bg-statusSuccessRewardsBg">Completed</span>')
            })
        </script>
    </body></html>`

    const outcome = await withPage(async page => {
        await page.setContent(html)
        const workers = new ModernUIWorkers(createStubBot())
        const found = await workers['findMissionCards'](page)
        assert.equal(found.length, 1, 'button[aria-expanded] with nested 0/3 tasks must be detected')
        await workers['completeMission'](page, found[0])
        const inlineClicked = await page.evaluate(() => window.__inlineClicked)
        return { found, inlineClicked }
    })

    assert.equal(outcome.found[0].title, 'Nested Counter Quest')
    assert.equal(outcome.found[0].completedTasks, 0)
    assert.equal(outcome.found[0].totalTasks, 3)
    assert.equal(outcome.found[0].points, '+100')
    assert.equal(outcome.inlineClicked, true, 'inline expanded quest panel sub-task must be executed')
})

test('same-tab sub-task navigation restores missionUrl cleanly for subsequent attempts', async () => {
    const visited = []
    let task1Done = false
    let task2Done = false

    const server = http.createServer((req, res) => {
        visited.push(req.url)
        if (req.url === '/earn/quest/same-tab') {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(`<!doctype html><html><body>
                <main>
                    <div class="task-row">
                        <a href="/sub-1"><h3>Web Task One</h3></a>
                        ${task1Done ? '<span class="bg-statusSuccessRewardsBg">Completed</span>' : ''}
                    </div>
                    <div class="task-row">
                        <a href="/sub-2"><h3>Web Task Two</h3></a>
                        ${task2Done ? '<span class="bg-statusSuccessRewardsBg">Completed</span>' : ''}
                    </div>
                </main>
            </body></html>`)
            return
        }
        if (req.url === '/sub-1') {
            task1Done = true
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<!doctype html><html><body>Bing search target 1</body></html>')
            return
        }
        if (req.url === '/sub-2') {
            task2Done = true
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<!doctype html><html><body>Bing search target 2</body></html>')
            return
        }
        res.writeHead(404)
        res.end()
    })

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    try {
        await withPage(async page => {
            await page.goto(`${baseUrl}/earn/quest/same-tab`, { waitUntil: 'domcontentloaded' })
            const workers = new ModernUIWorkers(createStubBot())
            await workers['completeMissionTasks'](page, 'Same-Tab Quest')
            assert.equal(page.url(), `${baseUrl}/earn/quest/same-tab`)
        })
        assert.ok(visited.includes('/sub-1'), 'task 1 should have been navigated')
        assert.ok(visited.includes('/sub-2'), 'task 2 should have been navigated after restoring missionUrl')
        assert.equal(task1Done, true)
        assert.equal(task2Done, true)
    } finally {
        await new Promise(resolve => server.close(resolve))
    }
})

test('per-sub-task unreachable filtering skips Bing app row while completing web sub-task', async () => {
    const html = `<!doctype html><html><body>
        <main>
            <div class="row">
                <p class="text-globalBody2Strong">Mobile App Check-in</p>
                <p>Download the Bing app to claim this step</p>
                <a id="app-task" href="https://example.com/app-promo">Get Bing App</a>
            </div>
            <div class="row">
                <p class="text-globalBody2Strong">Read More Toggle</p>
                <span href="">Read more</span>
            </div>
            <div class="row">
                <p class="text-globalBody2Strong">Scholarly Search Task</p>
                <a id="web-task" target="_blank" href="https://example.com/web-search">Search online</a>
            </div>
        </main>
        <script>
            window.__clickedTasks = []
            document.querySelectorAll('a').forEach(a => {
                a.addEventListener('click', e => {
                    e.preventDefault()
                    window.__clickedTasks.push(a.id)
                    a.closest('.row').insertAdjacentHTML('beforeend', '<span class="bg-statusSuccessRewardsBg">Completed</span>')
                })
            })
        </script>
    </body></html>`

    const result = await withPage(async page => {
        await page.setContent(html)
        const workers = new ModernUIWorkers(createStubBot())
        const tasks = await workers['findMissionSubTasks'](page)
        await workers['completeMissionTasks'](page, 'Mixed Quest')
        const clicked = await page.evaluate(() => window.__clickedTasks)
        return { tasks, clicked }
    })

    assert.equal(result.tasks.length, 1, 'only the actionable web sub-task should be returned')
    assert.equal(result.tasks[0].href, 'https://example.com/web-search')
    assert.deepEqual(result.clicked, ['web-task'], 'must skip Bing app task and click web task')
})

test('QueryCore builds scholarly tech/academic prompts in vi and en and ships curated local academic queries', async () => {
    const core = new QueryCore(createStubBot())
    core.getGoogleTrends = async () => ['NVIDIA Blackwell Architecture']
    core.getWikipediaTrending = async () => ['Transformer (deep learning architecture)']
    core.getRedditTopics = async () => ['FlashAttention-3 paper analysis']

    const capturedPrompts = []
    const origFetch = global.fetch
    global.fetch = async (_url, init) => {
        const body = JSON.parse(init.body)
        capturedPrompts.push(body.messages[0].content)
        return {
            ok: true,
            json: async () => ({
                choices: [
                    {
                        message: {
                            content: [
                                'flashattention memory tiling',
                                'flashattention 3 warp specialization arxiv paper',
                                'pagedattention vs flashattention benchmark',
                                'kv cache int4 quantization impact on perplexity'
                            ].join('\n')
                        }
                    }
                ]
            })
        }
    }

    try {
        const viSessions = await core.generateAISessionQueries(2, 'vi')
        const enSessions = await core.generateAISessionQueries(2, 'en-US')

        assert.equal(viSessions.length, 1)
        assert.equal(enSessions.length, 1)
        assert.equal(capturedPrompts.length, 2)

        const [viPrompt, enPrompt] = capturedPrompts
        assert.match(viPrompt, /nghiên cứu sinh|học thuật/i)
        assert.match(viPrompt, /Transformer|FlashAttention|Raft|zk-SNARK|LLVM|RISC-V|B\+Tree|QUIC/i)
        assert.match(enPrompt, /computer science researcher/i)
        assert.match(enPrompt, /Transformer|FlashAttention|Raft|zk-SNARK|LLVM|RISC-V|B\+Tree|QUIC/i)
        assert.doesNotMatch(viPrompt, /bún bò huế/i)
        assert.doesNotMatch(enPrompt, /bún bò huế/i)
    } finally {
        global.fetch = origFetch
    }

    const localQueries = core.getLocalQueryList()
    assert.ok(localQueries.length >= 150, `expected >= 150 academic/tech queries, got ${localQueries.length}`)
    assert.equal(localQueries.includes('how to boil eggs'), false)
    assert.equal(localQueries.includes('how to cook pasta'), false)

    const jsonPath = path.join(__dirname, '..', 'src', 'functions', 'search-queries.json')
    const rawArr = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    assert.ok(Array.isArray(rawArr) && rawArr.length >= 200)
})

test('Search target ratio math and BehaviorPolicy custom weights behave deterministically', () => {
    const safeDesktop = Search.computeTargetPlan(90, false, true, { mode: 'safe', searchTargetRatio: 0.7 })
    assert.equal(safeDesktop.fullTarget, 33)
    assert.equal(safeDesktop.targetQueries, 23)
    assert.equal(safeDesktop.pointCap, null)

    const safeLegacy = Search.computeTargetPlan(90, false, false, { mode: 'safe', searchTargetRatio: 0.75 })
    assert.equal(safeLegacy.pointCap, 68)

    const fastMobile = Search.computeTargetPlan(60, true, true, { mode: 'fast', searchTargetRatio: 1.0 })
    assert.equal(fastMobile.fullTarget, 23)
    assert.equal(fastMobile.targetQueries, 23)
    assert.equal(fastMobile.pointCap, null)

    const empty = Search.computeTargetPlan(0, false, true, { mode: 'safe', searchTargetRatio: 0.7 })
    assert.deepEqual(empty, { fullTarget: 0, targetQueries: 0, pointCap: null })

    // Custom weights via options.weights and 3rd argument
    const scrollOnly = Array.from({ length: 20 }, (_, i) =>
        chooseResultInteraction(new SeededRandom(`w-${i}`), {
            allowScroll: true,
            allowClick: true,
            weights: { read: 0, scroll: 10, click: 0 }
        })
    )
    assert.ok(scrollOnly.every(x => x === 'scroll'))

    const clickOnlyThirdArg = chooseResultInteraction(
        new SeededRandom('click-only'),
        { allowScroll: true, allowClick: true },
        { read: 0, scroll: 0, click: 5 }
    )
    assert.equal(clickOnlyThirdArg, 'click')
})

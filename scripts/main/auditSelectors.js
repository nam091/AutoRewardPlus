/**
 * Audits the modern-UI selector profile against the live Rewards site.
 *
 * The modern-UI workers scrape markup Microsoft controls and can change without
 * notice. This opens a real page using an existing saved session and reports,
 * for every selector and heading alias in the profile, how many elements it
 * actually matches — so a broken selector is visible before a run silently
 * collects nothing.
 *
 * Usage:  node ./scripts/main/auditSelectors.js -email you@example.com
 *         node ./scripts/main/auditSelectors.js -email you@example.com -headless
 *
 * Requires a saved session for the account (run the bot once first).
 */
import fs from 'fs'
import path from 'path'
import { chromium as patchrightChromium } from 'patchright'
import { chromium } from 'playwright-core'
import { newInjectedContext } from 'fingerprint-injector'

import {
    getDirname,
    getProjectRoot,
    log,
    parseArgs,
    validateEmail,
    loadConfig,
    loadAccounts,
    findAccountByEmail,
    getRuntimeBase,
    getSessionPath,
    loadCookies,
    loadFingerprint,
    buildProxyConfig,
    setupCleanupHandlers
} from '../utils.js'

import { SECTIONS, buildEvaluateProfile, CLAIM_BUTTON_TEXTS } from '../../dist/functions/ModernUISelectors.js'

const __dirname = getDirname(import.meta.url)
const projectRoot = getProjectRoot(__dirname)

const args = parseArgs()
args.dev = args.dev || false

validateEmail(args.email)

const { data: config } = loadConfig(projectRoot, args.dev)
const { data: accounts } = loadAccounts(projectRoot, args.dev)

const account = findAccountByEmail(accounts, args.email)
if (!account) {
    log('ERROR', `Account not found: ${args.email}`)
    process.exit(1)
}

const profile = buildEvaluateProfile()

/**
 * Reports how a section resolves.
 *
 * The live page renders more than one element per section id and heading (a
 * visible copy and a hidden one) and only one of them holds the cards, so every
 * candidate is reported rather than just the first.
 */
async function auditSection(page, section) {
    return page.evaluate(
        ({ ids, headings, key, label, cardSelectors, skeletonSelectors }) => {
            const all = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => (h.textContent ?? '').trim())
            const matchedAlias = headings.find(alias => all.some(t => t.toLowerCase().startsWith(alias))) ?? null

            const candidates = []
            const seen = []
            const push = (el, via) => {
                if (!el || seen.includes(el)) return
                seen.push(el)
                let cards = 0
                for (const selector of cardSelectors) {
                    const n = el.querySelectorAll(selector).length
                    if (n) {
                        cards = n
                        break
                    }
                }
                candidates.push({
                    via,
                    id: el.id || null,
                    visible: !!el.offsetParent,
                    cards,
                    skeletons: skeletonSelectors.reduce((sum, s) => sum + el.querySelectorAll(s).length, 0)
                })
            }

            for (const id of ids) {
                document.querySelectorAll(`section[id="${id}"]`).forEach(el => push(el, `id#${id}`))
            }
            Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                const text = (h.textContent ?? '').trim().toLowerCase()
                if (!headings.some(alias => text.startsWith(alias))) return
                push(h.closest('section') ?? h.parentElement?.parentElement, 'heading')
            })

            return { key, label, matchedAlias, candidates, pageHeadings: all.filter(Boolean).slice(0, 25) }
        },
        {
            ids: [...section.ids],
            headings: [...section.headings],
            key: section.key,
            label: section.label,
            cardSelectors: profile.cardLinkSelectors,
            skeletonSelectors: profile.skeletonSelectors
        }
    )
}

/** Counts matches for each selector in a chain, page-wide and in the richest section copy. */
async function auditSelectorChain(page, section, selectors) {
    return page.evaluate(
        ({ ids, headings, selectors, cardSelectors }) => {
            const candidates = []
            for (const id of ids) {
                document.querySelectorAll(`section[id="${id}"]`).forEach(el => candidates.push(el))
            }
            Array.from(document.querySelectorAll('h2, h3')).forEach(h => {
                const text = (h.textContent ?? '').trim().toLowerCase()
                if (!headings.some(alias => text.startsWith(alias))) return
                const el = h.closest('section') ?? h.parentElement?.parentElement
                if (el && !candidates.includes(el)) candidates.push(el)
            })

            // Audit against the copy the workers would actually use.
            let container = null
            let best = -1
            for (const el of candidates) {
                let cards = 0
                for (const selector of cardSelectors) {
                    const n = el.querySelectorAll(selector).length
                    if (n) {
                        cards = n
                        break
                    }
                }
                if (cards > best) {
                    best = cards
                    container = el
                }
            }

            return selectors.map(selector => {
                try {
                    return {
                        selector,
                        pageWide: document.querySelectorAll(selector).length,
                        inSection: container ? container.querySelectorAll(selector).length : 0
                    }
                } catch {
                    return { selector, error: 'invalid selector' }
                }
            })
        },
        { ids: [...section.ids], headings: [...section.headings], selectors, cardSelectors: profile.cardLinkSelectors }
    )
}

function printChain(title, rows) {
    log('INFO', `  ${title}`)
    for (const row of rows) {
        if (row.error) {
            log('ERROR', `    ${row.selector.padEnd(42)} ${row.error}`)
            continue
        }
        const status = row.inSection > 0 ? 'OK  ' : row.pageWide > 0 ? 'PAGE' : 'MISS'
        log(
            row.inSection > 0 ? 'SUCCESS' : row.pageWide > 0 ? 'WARN' : 'ERROR',
            `    [${status}] ${row.selector.padEnd(42)} section=${row.inSection} page=${row.pageWide}`
        )
    }
}

async function auditPage(page, url, sections) {
    log('INFO', '')
    log('INFO', `=== ${url} ===`)

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1500)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1000)

    // Expand collapsed sections, skipping the "About <section>" info popovers,
    // which also carry aria-expanded but only open a tooltip.
    await page.evaluate(infoPrefixes => {
        document.querySelectorAll('button[aria-expanded="false"]').forEach(btn => {
            const label = (btn.getAttribute('aria-label') ?? '').trim().toLowerCase()
            if (infoPrefixes.some(prefix => label.startsWith(prefix))) return
            btn.click()
        })
    }, profile.infoButtonLabelPrefixes)

    // Sections load asynchronously and show skeleton placeholders meanwhile.
    // Reading them too early makes every section look empty.
    const deadline = Date.now() + 30000
    let skeletons = 0
    do {
        skeletons = await page.evaluate(
            sel => sel.reduce((sum, s) => sum + document.querySelectorAll(s).length, 0),
            profile.skeletonSelectors
        )
        if (skeletons === 0) break
        await page.waitForTimeout(1000)
    } while (Date.now() < deadline)

    if (skeletons > 0) {
        log('WARN', `Page still shows ${skeletons} skeleton placeholder(s) after 30s; results may be incomplete.`)
    }

    for (const section of sections) {
        const result = await auditSection(page, section)

        log('INFO', '')
        if (!result.candidates.length) {
            log('ERROR', `Section "${result.label}" NOT FOUND.`)
            log('ERROR', `  ids tried     : ${section.ids.join(', ')}`)
            log('ERROR', `  headings tried: ${section.headings.join(' | ')}`)
            log('ERROR', `  headings on page: ${result.pageHeadings.join(' / ') || '(none)'}`)
            continue
        }

        log('SUCCESS', `Section "${result.label}" resolved (${result.candidates.length} candidate element(s))`)
        log('INFO', `  heading alias matched: ${result.matchedAlias ?? '(none — resolved by id)'}`)
        for (const c of result.candidates) {
            log(
                c.cards > 0 ? 'SUCCESS' : 'WARN',
                `    via ${String(c.via).padEnd(18)} id=${c.id ?? '-'} visible=${c.visible} cards=${c.cards} skeletons=${c.skeletons}`
            )
        }
        if (result.candidates.every(c => c.cards === 0)) {
            log('ERROR', '  No candidate has cards. If skeletons > 0 the section was still loading.')
        }

        printChain('card link selectors:', await auditSelectorChain(page, section, profile.cardLinkSelectors))
        printChain('title selectors:', await auditSelectorChain(page, section, profile.titleSelectors))
        printChain('points badges:', await auditSelectorChain(page, section, profile.pointsBadgeSelectors))
        printChain('completed badges:', await auditSelectorChain(page, section, profile.completedBadgeSelectors))
        printChain('expand triggers:', await auditSelectorChain(page, section, profile.expandTriggerSelectors))
    }

    // Text markers actually present, so locale drift is visible.
    const textReport = await page.evaluate(
        ({ completedTexts, lockedTexts, claimReadyTexts, claimButtonTexts, taskCountPattern }) => {
            const body = (document.body.innerText ?? '').toLowerCase()
            const taskCountRegex = new RegExp(taskCountPattern, 'gi')
            return {
                completed: completedTexts.filter(t => body.includes(t)),
                locked: lockedTexts.filter(t => body.includes(t)),
                claimReady: claimReadyTexts.filter(t => body.includes(t)),
                claimButton: claimButtonTexts.filter(t => body.includes(t)),
                taskCounts: Array.from(new Set(body.match(taskCountRegex) ?? [])).slice(0, 10)
            }
        },
        {
            completedTexts: profile.completedTexts,
            lockedTexts: profile.lockedTexts,
            claimReadyTexts: profile.claimReadyTexts,
            claimButtonTexts: [...CLAIM_BUTTON_TEXTS],
            taskCountPattern: profile.taskCountPattern
        }
    )

    log('INFO', '')
    log('INFO', '  text markers found on page:')
    log('INFO', `    completed : ${textReport.completed.join(', ') || '(none)'}`)
    log('INFO', `    locked    : ${textReport.locked.join(', ') || '(none)'}`)
    log('INFO', `    claimReady: ${textReport.claimReady.join(', ') || '(none)'}`)
    log('INFO', `    claimBtn  : ${textReport.claimButton.join(', ') || '(none)'}`)
    log('INFO', `    taskCounts: ${textReport.taskCounts.join(', ') || '(none)'}`)

    // Keep the markup so selectors can be rebuilt offline against a fixture.
    const outDir = path.join(projectRoot, 'diagnostics', 'selector-audit')
    fs.mkdirSync(outDir, { recursive: true })
    const name = url.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
    fs.writeFileSync(path.join(outDir, `${name}.html`), await page.content(), 'utf-8')
    log('INFO', `  markup saved to diagnostics/selector-audit/${name}.html`)
}

async function main() {
    const runtimeBase = getRuntimeBase(projectRoot, args.dev)
    const sessionBase = getSessionPath(runtimeBase, config.sessionPath, args.email)

    if (!fs.existsSync(sessionBase)) {
        log('ERROR', `No session directory for ${args.email}: ${sessionBase}`)
        log('ERROR', 'Run the bot once so a session is created, then re-run this audit.')
        process.exit(1)
    }

    let cookies = await loadCookies(sessionBase, 'desktop')
    let sessionType = 'desktop'
    if (cookies.length === 0) {
        cookies = await loadCookies(sessionBase, 'mobile')
        sessionType = 'mobile'
    }
    if (cookies.length === 0) {
        log('ERROR', 'No cookies found in the desktop or mobile session')
        process.exit(1)
    }

    const isMobile = sessionType === 'mobile'
    const fingerprintEnabled = isMobile ? account.saveFingerprint?.mobile : account.saveFingerprint?.desktop
    const fingerprint = fingerprintEnabled ? await loadFingerprint(sessionBase, sessionType) : null
    const proxy = buildProxyConfig(account)

    log('INFO', `Auditing selectors for ${args.email} (${sessionType} session, ${cookies.length} cookies)`)

    const browser = await chromium.launch({
        executablePath: patchrightChromium.executablePath(),
        headless: Boolean(args.headless),
        ...(proxy ? { proxy } : {}),
        args: ['--no-sandbox', '--mute-audio', '--disable-setuid-sandbox', '--no-first-run']
    })

    try {
        const context = fingerprint
            ? await newInjectedContext(browser, { fingerprint })
            : await browser.newContext({
                  viewport: isMobile ? { width: 375, height: 667 } : { width: 1366, height: 900 }
              })

        await context.addCookies(cookies)
        const page = await context.newPage()

        await auditPage(page, 'https://rewards.bing.com/dashboard', [SECTIONS.yourProgress, SECTIONS.dailySet])
        await auditPage(page, 'https://rewards.bing.com/earn', [
            SECTIONS.keepEarning,
            SECTIONS.quests,
            SECTIONS.levelUp
        ])

        log('INFO', '')
        log('SUCCESS', 'Audit complete. [OK]=matched in section, [PAGE]=only outside section, [MISS]=no match.')

        if (!args.headless) {
            log('INFO', 'Browser left open for inspection. Press Ctrl+C to exit.')
            await new Promise(() => {})
        }
    } finally {
        if (args.headless) {
            await browser.close()
        }
        setupCleanupHandlers(async () => {
            if (browser?.isConnected?.()) await browser.close()
        })
    }
}

main()

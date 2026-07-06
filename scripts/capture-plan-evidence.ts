/**
 * Runs plan verification steps 1-6 atomically and captures logs to SCRATCH/implementer/.
 * Usage: npx ts-node scripts/capture-plan-evidence.ts
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const SCRATCH = process.env.GOAL_SCRATCH ?? 'C:\\Users\\Knowm\\AppData\\Local\\Temp\\grok-goal-3f902cf214ab'
const OUT_DIR = path.join(SCRATCH, 'implementer')

function run(cmd: string, logFile: string): void {
    const logPath = path.join(OUT_DIR, logFile)
    console.log(`[capture] ${cmd} -> ${logPath}`)
    try {
        const output = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
        fs.writeFileSync(logPath, output)
        process.stdout.write(output)
    } catch (error) {
        const err = error as { stdout?: string; stderr?: string; status?: number }
        const combined = [err.stdout ?? '', err.stderr ?? ''].filter(Boolean).join('\n')
        fs.writeFileSync(logPath, combined || String(error))
        process.stdout.write(combined)
        throw error
    }
}

function grepWiring(): void {
    const filePatterns: Record<string, string[]> = {
        'src/functions/activities/browser/Search.ts': ['SessionRiskController'],
        'src/functions/activities/browser/SearchOnBing.ts': ['SessionRiskController'],
        'src/browser/auth/Login.ts': ['SessionRiskController'],
        'src/functions/SearchManager.ts': [
            'runStarSearchIfEnabled',
            'runDesktopPhase',
            'runWithDesktopFingerprint',
            'desktopSessionPolicy'
        ],
        'src/functions/desktopSessionPolicy.ts': ['needsDesktopSession', 'needsModernTasks'],
        'src/index.ts': ['AccountJob', 'mobileFingerprint', 'desktopFingerprint'],
        'src/functions/QueryEngine.ts': ['generateStarSearchKeywords'],
        'src/browser/Browser.ts': ['createInPrivateContext'],
        'scripts/verify-v8-integration.ts': ['risk-evaluatePage-clean', 'inprivate-webdriver']
    }

    const lines: string[] = []
    const missing: string[] = []
    for (const [file, patterns] of Object.entries(filePatterns)) {
        const full = path.join(ROOT, file)
        const content = fs.readFileSync(full, 'utf-8')
        lines.push(`=== ${file} ===`)
        for (const pattern of patterns) {
            const found = content.includes(pattern)
            lines.push(`${found ? 'OK' : 'MISS'} | ${pattern}`)
            if (!found) {
                missing.push(`${file}: ${pattern}`)
            }
        }
        lines.push('')
    }

    const logPath = path.join(OUT_DIR, 'grep-wiring.log')
    fs.writeFileSync(logPath, lines.join('\n'))
    console.log(`[capture] grep-wiring -> ${logPath}`)
    if (missing.length > 0) {
        throw new Error(`grep-wiring: ${missing.join(', ')}`)
    }
}

function configSnippet(): void {
    const examplePath = path.join(ROOT, 'src/config.example.json')
    const example = JSON.parse(fs.readFileSync(examplePath, 'utf-8'))
    const snippet = {
        doStarSearch: example.workers?.doStarSearch,
        starSearchSettings: example.starSearchSettings,
        maxAccountRetries: example.maxAccountRetries,
        aiFallbackProviders: example.ai?.fallbackProviders?.length,
        googleSheetsEnabled: example.googleSheets?.enabled
    }
    const logPath = path.join(OUT_DIR, 'config-example-snippet.log')
    fs.writeFileSync(logPath, JSON.stringify(snippet, null, 2))
    console.log(`[capture] config-example-snippet -> ${logPath}`)
}

function main(): void {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const steps: Array<{ fn: () => void; name: string }> = [
        { fn: () => run('npx tsc --noEmit', 'tsc-noemit.log'), name: 'tsc-noemit' },
        {
            fn: () => {
                run('npx tsc', 'tsc-build.log')
                const distIndex = path.join(ROOT, 'dist', 'index.js')
                if (!fs.existsSync(distIndex)) {
                    throw new Error('tsc-build: dist/index.js missing after compile')
                }
                console.log('[capture] OK | dist/index.js exists')
            },
            name: 'tsc-build'
        },
        { fn: grepWiring, name: 'grep-wiring' },
        {
            fn: () => {
                const branch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf-8' }).trim()
                const head = execSync('git log -1 --oneline', { cwd: ROOT, encoding: 'utf-8' }).trim()
                const remote = execSync('git ls-remote --heads origin v8', { cwd: ROOT, encoding: 'utf-8' }).trim()

                const lines = [branch, head, remote, '']
                if (branch !== 'v8') {
                    lines.push(`FAIL | branch=${branch}, expected v8`)
                    throw new Error(`git-v8: branch is ${branch}, expected v8`)
                }
                if (!/feat v8/i.test(head)) {
                    lines.push(`FAIL | HEAD missing "feat v8": ${head}`)
                    throw new Error(`git-v8: HEAD must contain "feat v8": ${head}`)
                }
                if (!remote.includes('refs/heads/v8')) {
                    lines.push(`FAIL | origin/v8 not found`)
                    throw new Error('git-v8: origin/v8 ref missing')
                }
                lines.push('OK | branch=v8')
                lines.push('OK | HEAD contains feat v8')
                lines.push('OK | origin/v8 ref present')

                const combined = lines.join('\n')
                fs.writeFileSync(path.join(OUT_DIR, 'git-v8.log'), combined)
                process.stdout.write(combined)
            },
            name: 'git-v8'
        },
        { fn: configSnippet, name: 'config-example' },
        { fn: () => run('npm run verify-v8', 'verify-v8.log'), name: 'verify-v8' },
        { fn: () => run('npm run stealth-check', 'stealth-check.log'), name: 'stealth-check' }
    ]

    const failures: string[] = []
    for (const step of steps) {
        try {
            step.fn()
            console.log(`[capture] PASS | ${step.name}`)
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            failures.push(`${step.name}: ${msg}`)
            console.error(`[capture] FAIL | ${step.name} | ${msg}`)
            if (step.name === 'stealth-check') {
                console.warn('[capture] stealth-check failure is non-gating per plan')
            } else {
                break
            }
        }
    }

    if (failures.filter(f => !f.startsWith('stealth-check')).length > 0) {
        console.error(`[capture] Evidence capture incomplete: ${failures.join('; ')}`)
        process.exit(1)
    }

    console.log(`[capture] All evidence saved to ${OUT_DIR}`)
}

main()
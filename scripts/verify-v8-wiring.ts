/**
 * Structural + behavioral verification for v8 automation + Star Search wiring.
 * Usage: npm run verify-v8
 */
import fs from 'fs'
import path from 'path'

import { validateConfig } from '../src/util/Validator'
import { validateProxyGeoAlignment } from '../src/util/GeoValidator'
import { SessionRiskController } from '../src/browser/humanize/SessionRiskController'
import { needsDesktopSession, needsModernTasks } from '../src/functions/desktopSessionPolicy'
import type { MicrosoftRewardsBot } from '../src/index'
import type { Account } from '../src/interface/Account'
import type { ConfigWorkers } from '../src/interface/Config'

const ROOT = path.join(__dirname, '..')

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message)
    }
}

function read(relPath: string): string {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf-8')
}

function mustInclude(relPath: string, needle: string, label: string): void {
    const content = read(relPath)
    assert(content.includes(needle), `${label}: missing "${needle}" in ${relPath}`)
}

function main(): void {
    const failures: string[] = []

    const check = (fn: () => void, name: string) => {
        try {
            fn()
            console.log(`[verify-v8] PASS | ${name}`)
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            failures.push(`${name}: ${msg}`)
            console.error(`[verify-v8] FAIL | ${name} | ${msg}`)
        }
    }

    check(() => {
        mustInclude('src/functions/activities/browser/Search.ts', 'SessionRiskController', 'Search risk')
        mustInclude('src/functions/activities/browser/SearchOnBing.ts', 'SessionRiskController', 'SearchOnBing risk')
        mustInclude('src/browser/auth/Login.ts', 'SessionRiskController', 'Login risk')
        mustInclude('src/functions/SearchManager.ts', 'runStarSearchIfEnabled', 'Star Search wiring')
        mustInclude('src/functions/SearchManager.ts', 'runDesktopPhase', 'Single desktop executor')
        mustInclude('src/functions/SearchManager.ts', 'runWithDesktopFingerprint', 'Desktop fingerprint swap')
        mustInclude('src/functions/SearchManager.ts', 'desktopSessionPolicy', 'Desktop session policy import')
        mustInclude('src/functions/desktopSessionPolicy.ts', 'needsDesktopSession', 'Policy needsDesktopSession')
        mustInclude('src/functions/desktopSessionPolicy.ts', 'needsModernTasks', 'Policy needsModernTasks')
        mustInclude('src/index.ts', 'mobileFingerprint', 'Mobile fingerprint stored')
        mustInclude('src/index.ts', 'AccountJob', 'In-run retry queue')
        mustInclude('src/functions/QueryEngine.ts', 'generateStarSearchKeywords', 'Star keyword pool')
    }, 'source-wiring')

    check(() => {
        mustInclude('src/browser/Browser.ts', 'createInPrivateContext', 'Browser InPrivate helper')
        mustInclude('src/browser/Browser.ts', 'newInjectedContext', 'Browser fingerprint injection')
        mustInclude('src/browser/Browser.ts', 'AntiDetectionEngine.applyAll', 'Browser anti-detection')
        mustInclude('src/functions/activities/browser/StarSearch.ts', 'desktopFingerprint', 'Star uses desktop fingerprint')
        mustInclude('src/functions/activities/browser/StarSearch.ts', 'createInPrivateContext', 'Star calls Browser InPrivate')
        const starSrc = read('src/functions/activities/browser/StarSearch.ts')
        assert(!starSrc.includes('browser.newContext('), 'StarSearch must not use raw browser.newContext')
    }, 'star-inprivate-stack')

    check(() => {
        const required = [
            'src/functions/modern/DailySet.ts',
            'src/functions/modern/KeepEarning.ts',
            'src/functions/modern/Missions.ts',
            'src/functions/modern/ClaimPoints.ts',
            'src/functions/activities/browser/StarSearch.ts',
            'src/browser/humanize/SessionRiskController.ts',
            'src/browser/humanize/ChallengeNotifier.ts'
        ]
        for (const file of required) {
            assert(fs.existsSync(path.join(ROOT, file)), `Missing file: ${file}`)
        }
    }, 'required-files')

    check(() => {
        const example = JSON.parse(read('src/config.example.json'))
        assert(example.workers?.doStarSearch === true, 'config.example workers.doStarSearch')
        assert(example.starSearchSettings?.keywordPoolSize === 700, 'config.example starSearchSettings')
        assert(example.maxAccountRetries === 2, 'config.example maxAccountRetries')
        assert(Array.isArray(example.ai?.fallbackProviders), 'config.example ai.fallbackProviders')
        assert(example.googleSheets?.enabled !== undefined, 'config.example googleSheets')

        const parsed = validateConfig(example)
        assert(parsed.workers.doStarSearch === true, 'validateConfig preserves doStarSearch')
        assert(parsed.ai?.fallbackProviders?.length === 2, 'validateConfig preserves ai.fallbackProviders')
        assert(parsed.starSearchSettings?.keywordPoolSize === 700, 'validateConfig preserves starSearchSettings')
    }, 'config-schema')

    check(() => {
        const bot = {
            userData: { geoLocale: 'VN' },
            logger: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} }
        } as unknown as MicrosoftRewardsBot
        const account = {
            email: 'test@example.com',
            geoLocale: 'vn',
            proxy: { url: 'http://hanoi.vn.proxy.example:8080', port: 8080, username: '', password: '', proxyAxios: false }
        } as Account
        validateProxyGeoAlignment(bot, account)
    }, 'geo-validator-runs')

    check(() => {
        const risk = new SessionRiskController()
        const afterSuccess = risk.evaluateSearchOutcome(true)
        assert(afterSuccess.action !== 'stop', 'risk should not stop after successful search')

        let switchStrategySeen = false
        for (let i = 0; i < 10; i++) {
            const decision = risk.evaluateSearchOutcome(false)
            if (decision.action === 'switch_strategy') {
                switchStrategySeen = true
                break
            }
        }
        assert(switchStrategySeen, 'risk engine should switch strategy after repeated no-point searches')

        let breakSeen = false
        for (let i = 0; i < 6; i++) {
            const decision = risk.recordFailure()
            if (decision.action === 'take_break') {
                breakSeen = true
                break
            }
        }
        assert(breakSeen, 'risk engine should take break after repeated failures')
        assert(risk.isCaptchaDetected() === false, 'no captcha without page evaluation')
    }, 'session-risk-engine')

    check(() => {
        const indexSrc = read('src/index.ts')
        assert(indexSrc.includes('process.exit(1)'), 'main must exit non-zero on failure')
        assert(indexSrc.includes('desktopFingerprint'), 'bot stores desktop fingerprint')
        assert(indexSrc.includes('mobileFingerprint'), 'bot stores mobile fingerprint')
        assert(indexSrc.includes('console.error'), 'direct-run guard logs fatal error')
    }, 'index-error-handling')

    check(() => {
        const baseWorkers: ConfigWorkers = {
            doDailySet: false,
            doSpecialPromotions: false,
            doMorePromotions: false,
            doPunchCards: false,
            doAppPromotions: false,
            doDesktopSearch: true,
            doMobileSearch: true,
            doDailyCheckIn: false,
            doReadToEarn: false,
            doMissions: false,
            doClaimPoints: false,
            doStarSearch: false
        }

        const scenarios: Array<{ name: string; workers: ConfigWorkers; version: string; shouldDoDesktop: boolean; expect: boolean }> = [
            { name: 'star-only-no-points', workers: { ...baseWorkers, doStarSearch: true, doDesktopSearch: false }, version: 'legacy', shouldDoDesktop: false, expect: true },
            { name: 'modern-dailyset-only', workers: { ...baseWorkers, doDailySet: true, doDesktopSearch: false }, version: 'modern', shouldDoDesktop: false, expect: true },
            { name: 'desktop-plus-star', workers: { ...baseWorkers, doStarSearch: true }, version: 'legacy', shouldDoDesktop: true, expect: true },
            { name: 'legacy-no-desktop-work', workers: baseWorkers, version: 'legacy', shouldDoDesktop: false, expect: false },
            { name: 'parallel-irrelevant-star', workers: { ...baseWorkers, doStarSearch: true, doDesktopSearch: false }, version: 'modern', shouldDoDesktop: false, expect: true }
        ]

        for (const scenario of scenarios) {
            const result = needsDesktopSession(scenario.workers, scenario.version, scenario.shouldDoDesktop)
            assert(
                result === scenario.expect,
                `${scenario.name}: needsDesktopSession=${result}, expected ${scenario.expect}`
            )
        }

        assert(needsModernTasks({ ...baseWorkers, doMissions: true }, 'modern') === true, 'modern missions need desktop')
        assert(needsModernTasks({ ...baseWorkers, doMissions: true }, 'legacy') === false, 'legacy skips modern tasks')
    }, 'desktop-session-policy-matrix')

    if (failures.length > 0) {
        console.error(`[verify-v8] ${failures.length} check(s) failed`)
        process.exit(1)
    }

    console.log('[verify-v8] All checks passed')
}

main()
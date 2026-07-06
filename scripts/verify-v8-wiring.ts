/**
 * Structural verification for v8 automation + Star Search wiring.
 * Usage: npm run verify-v8
 */
import fs from 'fs'
import path from 'path'

import { validateConfig } from '../src/util/Validator'
import { validateProxyGeoAlignment } from '../src/util/GeoValidator'
import type { MicrosoftRewardsBot } from '../src/index'
import type { Account } from '../src/interface/Account'

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
        mustInclude('src/functions/SearchManager.ts', 'runStarSearchIfEnabled', 'Star Search wiring')
        mustInclude('src/index.ts', 'AccountJob', 'In-run retry queue')
        mustInclude('src/functions/QueryEngine.ts', 'generateStarSearchKeywords', 'Star keyword pool')
    }, 'source-wiring')

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

    if (failures.length > 0) {
        console.error(`[verify-v8] ${failures.length} check(s) failed`)
        process.exit(1)
    }

    console.log('[verify-v8] All checks passed')
}

main()
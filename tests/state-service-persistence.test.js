/**
 * Regression test for the dashboard-wipe bug.
 *
 * StateService.getStates() used to call initializeFromAccounts() during
 * reconciliation, and that helper wrote a zeroed row set to db.json as a side
 * effect. Every dashboard poll therefore erased real points, streaks and level.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DIST = path.join(__dirname, '..', 'dist', 'services', 'stateService.js')

test('getStates() must not rewrite db.json when rows already exist', () => {
    process.env.DEFAULT_PROXY_URL = 'http://127.0.0.1'
    process.env.DEFAULT_PROXY_PORT = '10808'

    const { StateService } = require(DIST)
    const service = new StateService()
    const dbPath = path.resolve('src/dashboard/db.json')
    const backup = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf-8') : null

    try {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true })
        fs.writeFileSync(
            dbPath,
            JSON.stringify(
                [
                    {
                        email: 'probe@example.com',
                        totalPoints: 4321,
                        dailyPoints: 210,
                        pcProgress: '90/90',
                        mobileProgress: '60/60',
                        status: 'OK',
                        accountAge: '1y (400d)',
                        streak: '11',
                        updatedAt: 'now',
                        level: 'Gold Member',
                        lifetimePoints: 9999
                    }
                ],
                null,
                4
            )
        )

        // Seed accounts.json so the account survives reconciliation.
        const accountsPath = path.resolve('dist/accounts.json')
        const accountsBackup = fs.existsSync(accountsPath) ? fs.readFileSync(accountsPath, 'utf-8') : null
        fs.writeFileSync(accountsPath, JSON.stringify([{ email: 'probe@example.com' }], null, 4))

        try {
            service.getStates()
            const after = JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
            const row = after.find(entry => entry.email === 'probe@example.com')
            assert.ok(row, 'account row must survive')
            assert.strictEqual(row.totalPoints, 4321, 'points must not be zeroed by a read')
            assert.strictEqual(row.streak, '11')
        } finally {
            if (accountsBackup !== null) fs.writeFileSync(accountsPath, accountsBackup)
        }
    } finally {
        if (backup !== null) fs.writeFileSync(dbPath, backup)
    }
})

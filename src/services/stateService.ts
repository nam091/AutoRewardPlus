import cluster from 'cluster'
import fs from 'fs'
import path from 'path'

export interface AccountState {
    email: string
    totalPoints: number
    dailyPoints: number
    pcProgress: string
    mobileProgress: string
    status: 'IDLE' | 'RUNNING' | 'OK' | 'ERROR' | 'STOPPED' | 'SUSPENDED'
    accountAge: string
    streak: string
    updatedAt: string
    level?: string
    lifetimePoints?: number
    questPoints?: number
    redeemGoalTitle?: string
    redeemGoalPrice?: number
    geoLocale?: string
    proxy?: string
    lastError?: string
}

export interface StateUpdateMessage {
    __stateUpdate: {
        email: string
        update: Partial<AccountState>
    }
}

export function isStateUpdateMessage(msg: unknown): msg is StateUpdateMessage {
    return typeof msg === 'object' && msg !== null && '__stateUpdate' in msg
}

export class StateService {
    private dbPath = path.resolve('src/dashboard/db.json')

    public getStates(): AccountState[] {
        try {
            if (fs.existsSync(this.dbPath)) {
                const stored: AccountState[] = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'))
                return this.syncWithAccounts(stored)
            }
        } catch (error) {
            console.error('[StateService] Error reading state DB:', error)
        }

        // No database yet: seed it once from accounts.json
        return this.initializeFromAccounts({ persist: true })
    }

    /**
     * Reconciles the persisted DB with accounts.json.
     *
     * db.json is also the dashboard cache. Reading it verbatim meant accounts
     * added to accounts.json never appeared in the UI, and accounts removed
     * (banned nicknames) lingered forever. New entries are appended as IDLE and
     * entries whose account no longer exists are dropped.
     *
     * IMPORTANT: this must never persist on read. The previous version called
     * initializeFromAccounts(), which wrote a zeroed row set to disk as a side
     * effect, so every dashboard poll silently wiped real points/streaks.
     */
    private syncWithAccounts(stored: AccountState[]): AccountState[] {
        const blankTemplates = this.initializeFromAccounts({ persist: false })
        const byEmail = new Map(stored.map(s => [s.email.toLowerCase(), s]))

        const merged: AccountState[] = []
        for (const template of blankTemplates) {
            const hit = byEmail.get(template.email.toLowerCase())
            merged.push(hit ? hit : template)
        }

        return merged
    }

    public saveStates(states: AccountState[]) {
        try {
            const dir = path.dirname(this.dbPath)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }

            // Atomic write: a partially written db.json would be unparseable for
            // the dashboard, so stage the payload and rename it into place.
            const tempPath = `${this.dbPath}.${process.pid}.tmp`
            fs.writeFileSync(tempPath, JSON.stringify(states, null, 4), 'utf-8')
            fs.renameSync(tempPath, this.dbPath)
        } catch (error) {
            console.error('[StateService] Error writing state DB:', error)
        }
    }

    /**
     * Records an account state change.
     *
     * With `clusters > 1` every account runs in its own child process. A
     * read-modify-write of a shared JSON file from several processes loses
     * updates, so children forward the change to the primary over IPC and only
     * the primary ever touches the file.
     */
    public updateAccountState(email: string, update: Partial<AccountState>) {
        if (cluster.isWorker && process.send) {
            const message: StateUpdateMessage = { __stateUpdate: { email, update } }
            process.send(message)
            return
        }

        this.applyAccountState(email, update)
    }

    /** Writes a state change to disk. Primary process only. */
    public applyAccountState(email: string, update: Partial<AccountState>) {
        const states = this.getStates()
        const idx = states.findIndex(s => s.email.toLowerCase() === email.toLowerCase())
        if (idx !== -1) {
            states[idx] = { ...states[idx]!, ...update, updatedAt: new Date().toLocaleString('vi-VN') }
        } else {
            states.push({
                email,
                totalPoints: update.totalPoints || 0,
                dailyPoints: update.dailyPoints || 0,
                pcProgress: update.pcProgress || '0/90',
                mobileProgress: update.mobileProgress || '0/60',
                status: update.status || 'IDLE',
                accountAge: update.accountAge || 'N/A',
                streak: update.streak || '0',
                updatedAt: new Date().toLocaleString('vi-VN'),
                level: update.level || 'Level 1',
                lifetimePoints: update.lifetimePoints || 0,
                questPoints: update.questPoints || 0,
                redeemGoalTitle: update.redeemGoalTitle || 'None',
                redeemGoalPrice: update.redeemGoalPrice || 0,
                geoLocale: update.geoLocale || 'vn',
                proxy: update.proxy || 'Direct',
                lastError: update.lastError
            })
        }
        this.saveStates(states)
    }

    /**
     * Builds blank IDLE rows from accounts.json.
     *
     * `persist` defaults to false: seeding a fresh database and reconciling an
     * existing one both read this, and only the former may touch the disk.
     */
    private initializeFromAccounts(options: { persist?: boolean } = {}): AccountState[] {
        const { persist = false } = options
        try {
            const candidates = [
                path.resolve('dist/accounts.json'),
                path.resolve('src/accounts.json'),
                path.resolve('accounts.json'),
                path.resolve('src/accounts.example.json')
            ]
            const accPath = candidates.find(c => fs.existsSync(c))

            if (accPath && fs.existsSync(accPath)) {
                const accounts = JSON.parse(fs.readFileSync(accPath, 'utf-8'))
                const defaultProxyUrl = process.env.DEFAULT_PROXY_URL?.trim()
                const defaultProxyPort = process.env.DEFAULT_PROXY_PORT ? parseInt(process.env.DEFAULT_PROXY_PORT, 10) : 0
                const defaultProxyStr = defaultProxyUrl ? `${defaultProxyUrl}:${defaultProxyPort}` : 'Direct'

                const states: AccountState[] = accounts.map((acc: any) => ({
                    email: acc.email,
                    totalPoints: 0,
                    dailyPoints: 0,
                    pcProgress: '0/90',
                    mobileProgress: '0/60',
                    status: 'IDLE',
                    accountAge: 'N/A',
                    streak: '0',
                    updatedAt: new Date().toLocaleString('vi-VN'),
                    level: 'Level 1',
                    lifetimePoints: 0,
                    questPoints: 0,
                    redeemGoalTitle: 'None',
                    redeemGoalPrice: 0,
                    geoLocale: acc.geoLocale || 'vn',
                    proxy: acc.proxy?.url ? `${acc.proxy.url}:${acc.proxy.port}` : defaultProxyStr
                }))
                if (persist) this.saveStates(states)
                return states
            }
        } catch (error) {
            console.error('[StateService] Error initializing states from accounts:', error)
        }
        return []
    }
}

export const stateService = new StateService()

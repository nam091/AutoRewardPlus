import cluster from 'cluster'
import fs from 'fs'
import path from 'path'

export interface AccountState {
    email: string
    totalPoints: number
    dailyPoints: number
    pcProgress: string
    mobileProgress: string
    status: 'IDLE' | 'RUNNING' | 'OK' | 'ERROR' | 'STOPPED'
    accountAge: string
    streak: string
    updatedAt: string
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
                return JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'))
            }
        } catch (error) {
            console.error('[StateService] Error reading state DB:', error)
        }

        // Initialize from accounts.json
        return this.initializeFromAccounts()
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
                updatedAt: new Date().toLocaleString('vi-VN')
            })
        }
        this.saveStates(states)
    }

    private initializeFromAccounts(): AccountState[] {
        try {
            const accPath = fs.existsSync(path.resolve('src/accounts.json'))
                ? path.resolve('src/accounts.json')
                : path.resolve('src/accounts.example.json')

            if (fs.existsSync(accPath)) {
                const accounts = JSON.parse(fs.readFileSync(accPath, 'utf-8'))
                const states: AccountState[] = accounts.map((acc: any) => ({
                    email: acc.email,
                    totalPoints: 0,
                    dailyPoints: 0,
                    pcProgress: '0/90',
                    mobileProgress: '0/60',
                    status: 'IDLE',
                    accountAge: 'N/A',
                    streak: '0',
                    updatedAt: new Date().toLocaleString('vi-VN')
                }))
                this.saveStates(states)
                return states
            }
        } catch (error) {
            console.error('[StateService] Error initializing states from accounts:', error)
        }
        return []
    }
}

export const stateService = new StateService()

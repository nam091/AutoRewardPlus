import fs from 'fs';
import path from 'path';

export interface AccountState {
    email: string;
    totalPoints: number;
    dailyPoints: number;
    pcProgress: string;
    mobileProgress: string;
    status: 'IDLE' | 'RUNNING' | 'OK' | 'ERROR' | 'RETRY' | 'STOPPED';
    retryCount?: number;
    accountAge: string;
    streak: string;
    updatedAt: string;
}

export class StateService {
    private dbPath = path.resolve('src/dashboard/db.json');

    public getStates(): AccountState[] {
        try {
            if (fs.existsSync(this.dbPath)) {
                return JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
            }
        } catch (error) {
            console.error('[StateService] Error reading state DB:', error);
        }

        // Initialize from accounts.json
        return this.initializeFromAccounts();
    }

    public saveStates(states: AccountState[]) {
        try {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.dbPath, JSON.stringify(states, null, 4), 'utf-8');
        } catch (error) {
            console.error('[StateService] Error writing state DB:', error);
        }
    }

    public updateAccountState(email: string, update: Partial<AccountState>) {
        const states = this.getStates();
        const idx = states.findIndex(s => s.email.toLowerCase() === email.toLowerCase());
        if (idx !== -1) {
            states[idx] = { ...states[idx]!, ...update, updatedAt: new Date().toLocaleString('vi-VN') };
        } else {
            states.push({
                email,
                totalPoints: update.totalPoints || 0,
                dailyPoints: update.dailyPoints || 0,
                pcProgress: update.pcProgress || '0/90',
                mobileProgress: update.mobileProgress || '0/60',
                status: update.status || 'IDLE',
                retryCount: update.retryCount ?? 0,
                accountAge: update.accountAge || 'N/A',
                streak: update.streak || '0',
                updatedAt: new Date().toLocaleString('vi-VN')
            });
        }
        this.saveStates(states);
    }

    private initializeFromAccounts(): AccountState[] {
        try {
            const accPath = fs.existsSync(path.resolve('src/accounts.json'))
                ? path.resolve('src/accounts.json')
                : path.resolve('src/accounts.example.json');
            
            if (fs.existsSync(accPath)) {
                const accounts = JSON.parse(fs.readFileSync(accPath, 'utf-8'));
                const states: AccountState[] = accounts.map((acc: any) => ({
                    email: acc.email,
                    totalPoints: 0,
                    dailyPoints: 0,
                    pcProgress: '0/90',
                    mobileProgress: '0/60',
                    status: 'IDLE',
                    retryCount: 0,
                    accountAge: 'N/A',
                    streak: '0',
                    updatedAt: new Date().toLocaleString('vi-VN')
                }));
                this.saveStates(states);
                return states;
            }
        } catch (error) {
            console.error('[StateService] Error initializing states from accounts:', error);
        }
        return [];
    }
}

export const stateService = new StateService();

import fs from 'fs'
import path from 'path'

/**
 * Per-day resume point for a full batch run.
 *
 * The bot used to restart from accounts.json[0] on every launch. If a run
 * stopped at account 5, the next launch repeated accounts 1-4 and wasted both
 * proxy bandwidth and the daily Microsoft Rewards attempt budget.
 *
 * This checkpoint is written by the primary process only. Workers report the
 * account they started through the existing state-update IPC channel, so
 * concurrent clusters cannot clobber the file.
 */
export interface RunCheckpoint {
    /** Local calendar day in YYYY-MM-DD form. */
    date: string
    /** Account the last run reached. */
    email: string
    /** Why the checkpoint was written. */
    reason: 'started' | 'error'
    /** ISO timestamp of the last write. */
    updatedAt: string
}

export function localDay(date = new Date()): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export class RunCheckpointService {
    private readonly filePath = path.resolve('src/dashboard/run-checkpoint.json')
    /** Disabled for single-account runs so they cannot hijack the batch resume point. */
    enabled = false

    load(): RunCheckpoint | null {
        try {
            if (!fs.existsSync(this.filePath)) return null
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as RunCheckpoint
            if (!parsed || typeof parsed.email !== 'string' || typeof parsed.date !== 'string') return null
            return parsed
        } catch {
            return null
        }
    }

    /** Only a checkpoint from the same local day is a valid resume point. */
    getResumeEmail(date = new Date()): string | null {
        const checkpoint = this.load()
        if (!checkpoint || checkpoint.date !== localDay(date)) return null
        return checkpoint.email
    }

    mark(email: string, reason: RunCheckpoint['reason'] = 'started', date = new Date()): void {
        if (!this.enabled) return
        // An error is more important than a start: keep it if this account is
        // already the checkpoint, and never overwrite an error with a later
        // successful account's start within the same run.
        // The first failure of a batch is the most useful resume point. Later
        // accounts may also fail, but restarting from the earliest one avoids
        // skipping the account that actually broke the run.
        const previous = this.load()
        if (previous && previous.date === localDay(date) && previous.reason === 'error') {
            if (previous.email.toLowerCase() !== email.toLowerCase() || reason === 'error') return
        }

        this.write({ date: localDay(date), email, reason, updatedAt: date.toISOString() })
    }

    /** Called after a complete pass so the next launch starts from the top. */
    clear(): void {
        try {
            if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath)
        } catch {
            // A stale checkpoint is harmless: it is ignored on a different day.
        }
    }

    private write(checkpoint: RunCheckpoint): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
            const temp = `${this.filePath}.${process.pid}.tmp`
            fs.writeFileSync(temp, JSON.stringify(checkpoint, null, 2), 'utf-8')
            fs.renameSync(temp, this.filePath)
        } catch {
            // Checkpoint writes are best-effort; the batch must never abort.
        }
    }
}

export const runCheckpointService = new RunCheckpointService()

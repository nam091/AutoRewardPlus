import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface SessionEntry {
    account: string
    files: string[]
    updatedAt: string
}

export class SessionService {
    private readonly root: string

    constructor(sessionPath = process.env.SESSION_PATH?.trim() || 'sessions') {
        const base = path.resolve(process.cwd(), sessionSourceRoot())
        this.root = path.resolve(base, sessionPath)
    }

    async list(): Promise<SessionEntry[]> {
        try {
            const children = await fs.readdir(this.root, { withFileTypes: true })
            const output: SessionEntry[] = []
            for (const child of children.filter(entry => entry.isDirectory())) {
                const accountDir = path.join(this.root, child.name)
                const files = (await fs.readdir(accountDir)).sort()
                const stats = await Promise.all(
                    files.map(file => fs.stat(path.join(accountDir, file)).catch(() => null))
                )
                const updatedAt = new Date(
                    Math.max(...stats.filter(Boolean).map(stat => stat!.mtimeMs), 0)
                ).toISOString()
                output.push({ account: child.name, files, updatedAt })
            }
            return output.sort((left, right) => left.account.localeCompare(right.account))
        } catch {
            return []
        }
    }

    async remove(account: string): Promise<boolean> {
        if (
            !account ||
            path.basename(account) !== account ||
            account.includes('..') ||
            account.includes('/') ||
            account.includes('\\')
        ) {
            throw new Error('Invalid account identifier.')
        }
        const accountDir = path.resolve(this.root, account)
        if (!accountDir.startsWith(`${this.root}${path.sep}`)) throw new Error('Invalid session path.')
        try {
            await fs.rm(accountDir, { recursive: true, force: false })
            return true
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
            if (code === 'ENOENT') return false
            throw error
        }
    }
}

function sessionSourceRoot(): string {
    return existsSync(path.resolve(process.cwd(), 'src/browser')) ? 'src/browser' : 'dist/browser'
}

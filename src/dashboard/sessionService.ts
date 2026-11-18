import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface SessionEntry {
    account: string
    files: string[]
    hasDesktop: boolean
    hasMobile: boolean
    updatedAt: string
}

export class SessionService {
    private readonly roots: string[]

    constructor(sessionPath = process.env.SESSION_PATH?.trim() || 'sessions') {
        const candidates = [
            path.resolve(process.cwd(), sessionPath),
            path.resolve(process.cwd(), 'src/browser', sessionPath),
            path.resolve(process.cwd(), 'dist/browser', sessionPath)
        ]
        this.roots = [...new Set(candidates)]
    }

    async list(): Promise<SessionEntry[]> {
        const byAccount = new Map<string, { files: Set<string>; latestMs: number }>()

        for (const root of this.roots) {
            if (!existsSync(root)) continue
            try {
                const children = await fs.readdir(root, { withFileTypes: true })
                for (const child of children.filter(entry => entry.isDirectory())) {
                    const accountDir = path.join(root, child.name)
                    const files = await fs.readdir(accountDir).catch(() => [])
                    if (files.length === 0) continue

                    const stats = await Promise.all(
                        files.map(file => fs.stat(path.join(accountDir, file)).catch(() => null))
                    )
                    const maxMs = Math.max(...stats.filter(Boolean).map(stat => stat!.mtimeMs), 0)

                    const existing = byAccount.get(child.name) ?? { files: new Set<string>(), latestMs: 0 }
                    for (const f of files) existing.files.add(f)
                    if (maxMs > existing.latestMs) existing.latestMs = maxMs
                    byAccount.set(child.name, existing)
                }
            } catch {
                // Skip unreadable root
            }
        }

        const output: SessionEntry[] = []
        for (const [account, meta] of byAccount.entries()) {
            const files = Array.from(meta.files).sort()
            output.push({
                account,
                files,
                hasDesktop: files.includes('session_desktop.json'),
                hasMobile: files.includes('session_mobile.json'),
                updatedAt: new Date(meta.latestMs || 0).toISOString()
            })
        }

        return output.sort((left, right) => left.account.localeCompare(right.account))
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

        let removedAny = false
        for (const root of this.roots) {
            const accountDir = path.resolve(root, account)
            if (!accountDir.startsWith(`${root}${path.sep}`)) throw new Error('Invalid session path.')
            try {
                await fs.rm(accountDir, { recursive: true, force: false })
                removedAny = true
            } catch (error) {
                const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
                if (code === 'ENOENT') continue
                throw error
            }
        }
        return removedAny
    }
}

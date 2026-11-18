import fs from 'node:fs/promises'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { Account } from '../interface/Account'
import { atomicWriteFileAsync, atomicWriteFileSync, withFileLockAsync, withFileLockSync } from '../util/FileLock'
import { isNewAccountAge, syncNewTagByAge } from '../util/RewardUtils'
import { AccountSchema, validateAccounts } from '../util/Validator'

export interface RedactedAccount extends Omit<Account, 'password' | 'totpSecret' | 'totp' | 'proxy'> {
    password: ''
    totpSecret: ''
    hasPassword: boolean
    hasTotp: boolean
    hasProxyPassword: boolean
    enabled: boolean
    proxy: {
        proxyAxios: boolean
        url: string
        port: number
        username: string
        password: ''
    }
}

export interface AccountUpsertPayload {
    email?: string
    password?: string
    totpSecret?: string
    clearTotp?: boolean
    recoveryEmail?: string
    geoLocale?: string
    langCode?: string
    tag?: string
    enabled?: boolean
    proxy?: {
        proxyAxios?: boolean
        url?: string
        port?: number | string
        username?: string
        password?: string
        clearPassword?: boolean
    }
    saveFingerprint?: {
        mobile?: boolean
        desktop?: boolean
    }
}

export class AccountService {
    private readonly customPath = process.env.ACCOUNTS_PATH?.trim() || null

    private findPrimaryReadPath(): string | null {
        const order = [
            this.customPath,
            path.resolve('src/accounts.json'),
            path.resolve('dist/accounts.json'),
            path.resolve('accounts.json')
        ].filter((p): p is string => Boolean(p))

        for (const candidate of order) {
            const resolved = path.resolve(candidate)
            if (existsSync(resolved)) return resolved
        }
        return null
    }

    readRawAccounts(): Account[] {
        const target = this.findPrimaryReadPath()
        if (!target) return []
        const raw = JSON.parse(readFileSync(target, 'utf8'))
        return Array.isArray(raw) ? (raw as Account[]) : []
    }

    getRawAccount(email: string): Account | null {
        const normalized = email.trim().toLowerCase()
        return this.readRawAccounts().find(a => a.email.toLowerCase() === normalized) || null
    }

    list(): RedactedAccount[] {
        return this.readRawAccounts().map(acc => ({
            email: acc.email,
            password: '',
            totpSecret: '',
            hasPassword: Boolean(acc.password),
            hasTotp: Boolean(acc.totpSecret || acc.totp),
            hasProxyPassword: Boolean(acc.proxy?.password),
            recoveryEmail: acc.recoveryEmail || '',
            geoLocale: acc.geoLocale || 'vn',
            langCode: acc.langCode || 'vi',
            tag: acc.tag || '',
            enabled: acc.enabled !== false,
            proxy: {
                proxyAxios: acc.proxy?.proxyAxios ?? true,
                url: acc.proxy?.url || '',
                port: Number(acc.proxy?.port || 0),
                username: acc.proxy?.username || '',
                password: ''
            },
            saveFingerprint: {
                mobile: acc.saveFingerprint?.mobile ?? true,
                desktop: acc.saveFingerprint?.desktop ?? true
            }
        }))
    }

    async create(payload: AccountUpsertPayload): Promise<RedactedAccount> {
        const email = payload.email?.trim() || ''
        if (!email || !email.includes('@')) {
            throw new Error('Email không hợp lệ.')
        }
        if (!payload.password || !payload.password.trim()) {
            throw new Error('Mật khẩu không được để trống khi thêm tài khoản mới.')
        }

        return withFileLockAsync(this.getLockTarget(), async () => {
            const current = this.readRawAccounts()
            if (current.some(a => a.email.toLowerCase() === email.toLowerCase())) {
                throw new Error(`Tài khoản ${email} đã tồn tại trong accounts.json.`)
            }

            const proxyUrl = payload.proxy?.url?.trim() || ''
            const proxyPort = proxyUrl ? Number(payload.proxy?.port || 0) : 0
            const nextAccount: Account = AccountSchema.parse({
                email,
                password: payload.password,
                ...(payload.totpSecret?.trim() ? { totpSecret: payload.totpSecret.trim() } : {}),
                recoveryEmail: payload.recoveryEmail?.trim() || '',
                geoLocale: (payload.geoLocale?.trim() || 'vn').toLowerCase(),
                langCode: (payload.langCode?.trim() || 'vi').toLowerCase(),
                ...(payload.tag?.trim() ? { tag: payload.tag.trim() } : {}),
                enabled: payload.enabled !== false,
                proxy: {
                    proxyAxios: payload.proxy?.proxyAxios ?? true,
                    url: proxyUrl,
                    port: Number.isFinite(proxyPort) ? proxyPort : 0,
                    username: payload.proxy?.username?.trim() || '',
                    password: payload.proxy?.password || ''
                },
                saveFingerprint: {
                    mobile: payload.saveFingerprint?.mobile ?? true,
                    desktop: payload.saveFingerprint?.desktop ?? true
                }
            })

            const nextList = [...current, nextAccount]
            await this.persistAccounts(nextList)
            return this.list().find(a => a.email.toLowerCase() === email.toLowerCase())!
        })
    }

    async update(targetEmail: string, payload: AccountUpsertPayload): Promise<RedactedAccount> {
        return withFileLockAsync(this.getLockTarget(), () => this.updateUnlocked(targetEmail, payload))
    }

    private async updateUnlocked(targetEmail: string, payload: AccountUpsertPayload): Promise<RedactedAccount> {
        const current = this.readRawAccounts()
        const idx = current.findIndex(a => a.email.toLowerCase() === targetEmail.trim().toLowerCase())
        if (idx === -1) {
            throw new Error(`Không tìm thấy tài khoản ${targetEmail}.`)
        }

        const existing = current[idx]!
        const nextEmail = payload.email?.trim() || existing.email

        if (
            nextEmail.toLowerCase() !== existing.email.toLowerCase() &&
            current.some((a, i) => i !== idx && a.email.toLowerCase() === nextEmail.toLowerCase())
        ) {
            throw new Error(`Email mới ${nextEmail} bị trùng với tài khoản khác.`)
        }

        const nextPassword =
            payload.password && payload.password !== '[REDACTED]' ? payload.password : existing.password

        let nextTotp = existing.totpSecret || existing.totp || ''
        if (payload.clearTotp) {
            nextTotp = ''
        } else if (payload.totpSecret && payload.totpSecret !== '[REDACTED]') {
            nextTotp = payload.totpSecret.trim()
        }

        const nextProxyUrl = payload.proxy?.url !== undefined ? payload.proxy.url.trim() : existing.proxy?.url || ''
        const rawPort =
            payload.proxy?.port !== undefined ? Number(payload.proxy.port) : Number(existing.proxy?.port || 0)
        const nextProxyPort = nextProxyUrl ? (Number.isFinite(rawPort) ? rawPort : 0) : 0

        let nextProxyPassword = existing.proxy?.password || ''
        if (payload.proxy?.clearPassword) {
            nextProxyPassword = ''
        } else if (payload.proxy?.password && payload.proxy.password !== '[REDACTED]') {
            nextProxyPassword = payload.proxy.password
        }

        const nextTag = payload.tag !== undefined ? payload.tag.trim() : existing.tag || ''

        const updated: Account = AccountSchema.parse({
            email: nextEmail,
            password: nextPassword,
            ...(nextTotp ? { totpSecret: nextTotp } : {}),
            recoveryEmail:
                payload.recoveryEmail !== undefined ? payload.recoveryEmail.trim() : existing.recoveryEmail || '',
            geoLocale: (payload.geoLocale !== undefined ? payload.geoLocale.trim() : existing.geoLocale || 'vn').toLowerCase(),
            langCode: (payload.langCode !== undefined ? payload.langCode.trim() : existing.langCode || 'vi').toLowerCase(),
            ...(nextTag ? { tag: nextTag } : {}),
            enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : existing.enabled !== false,
            proxy: {
                proxyAxios: payload.proxy?.proxyAxios ?? existing.proxy?.proxyAxios ?? true,
                url: nextProxyUrl,
                port: nextProxyPort,
                username:
                    payload.proxy?.username !== undefined
                        ? payload.proxy.username.trim()
                        : existing.proxy?.username || '',
                password: nextProxyPassword
            },
            saveFingerprint: {
                mobile: payload.saveFingerprint?.mobile ?? existing.saveFingerprint?.mobile ?? true,
                desktop: payload.saveFingerprint?.desktop ?? existing.saveFingerprint?.desktop ?? true
            }
        })

        const nextList = [...current]
        nextList[idx] = updated
        await this.persistAccounts(nextList)
        return this.list().find(a => a.email.toLowerCase() === nextEmail.toLowerCase())!
    }

    async toggleEnabled(targetEmail: string, enabled?: boolean): Promise<RedactedAccount> {
        return withFileLockAsync(this.getLockTarget(), async () => {
            const existing = this.getRawAccount(targetEmail)
            if (!existing) {
                throw new Error(`Không tìm thấy tài khoản ${targetEmail}.`)
            }
            const nextEnabled = enabled !== undefined ? enabled : existing.enabled === false
            return this.updateUnlocked(targetEmail, { enabled: nextEnabled })
        })
    }

    async remove(targetEmail: string): Promise<boolean> {
        return withFileLockAsync(this.getLockTarget(), async () => {
            const current = this.readRawAccounts()
            const filtered = current.filter(a => a.email.toLowerCase() !== targetEmail.trim().toLowerCase())
            if (filtered.length === current.length) return false
            await this.persistAccounts(filtered)
            return true
        })
    }

    async bulkImport(
        rawText: string,
        defaults: { geoLocale?: string; langCode?: string; tag?: string; enabled?: boolean } = {}
    ): Promise<{ added: number; skipped: number; errors: string[] }> {
        const lines = rawText
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))

        if (lines.length === 0) {
            throw new Error('Danh sách import trống.')
        }

        return withFileLockAsync(this.getLockTarget(), async () => {
            const current = this.readRawAccounts()
            const existingSet = new Set(current.map(a => a.email.toLowerCase()))
            const toAdd: Account[] = []
            const errors: string[] = []
            let skipped = 0

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]!
                const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : line.includes(',') ? ',' : ':'
                const parts = line.split(sep).map(p => p.trim())
                const email = parts[0] || ''
                const password = parts[1] || ''
                const totpSecret = parts[2] || ''
                const recoveryEmail = parts[3] || ''

                if (!email.includes('@') || !password) {
                    errors.push(`Dòng ${i + 1}: thiếu email hoặc mật khẩu`)
                    continue
                }
                if (existingSet.has(email.toLowerCase())) {
                    skipped++
                    continue
                }

                existingSet.add(email.toLowerCase())
                toAdd.push(
                    AccountSchema.parse({
                        email,
                        password,
                        ...(totpSecret ? { totpSecret } : {}),
                        recoveryEmail,
                        geoLocale: (defaults.geoLocale?.trim() || 'vn').toLowerCase(),
                        langCode: (defaults.langCode?.trim() || 'vi').toLowerCase(),
                        ...(defaults.tag?.trim() ? { tag: defaults.tag.trim() } : {}),
                        enabled: defaults.enabled !== false,
                        proxy: { proxyAxios: true, url: '', port: 0, username: '', password: '' },
                        saveFingerprint: { mobile: true, desktop: true }
                    })
                )
            }

            if (toAdd.length > 0) {
                await this.persistAccounts([...current, ...toAdd])
            }

            return { added: toAdd.length, skipped, errors }
        })
    }

    /** Synchronizes the `'new'` tag for a single account asynchronously under file lock. */
    async syncNewTagByEmail(
        email: string,
        isNew: boolean | null
    ): Promise<{ tag: string; changed: boolean } | null> {
        const normalized = email.trim().toLowerCase()
        if (!normalized) return null

        if (isNew === null) {
            const existing = this.getRawAccount(normalized)
            return existing ? syncNewTagByAge(existing.tag, null) : null
        }

        return withFileLockAsync(this.getLockTarget(), async () => {
            const applied = this.applySyncedTag(this.readRawAccounts(), normalized, isNew)
            if (!applied) return null
            if (applied.result.changed) {
                await this.persistAccounts(applied.nextList)
            }
            return applied.result
        })
    }

    /** Synchronizes the `'new'` tag for a single account synchronously under file lock. */
    syncNewTagByEmailSync(email: string, isNew: boolean | null): { tag: string; changed: boolean } | null {
        const normalized = email.trim().toLowerCase()
        if (!normalized) return null

        if (isNew === null) {
            const existing = this.getRawAccount(normalized)
            return existing ? syncNewTagByAge(existing.tag, null) : null
        }

        return withFileLockSync(this.getLockTarget(), () => {
            const applied = this.applySyncedTag(this.readRawAccounts(), normalized, isNew)
            if (!applied) return null
            if (applied.result.changed) {
                this.persistAccountsSync(applied.nextList)
            }
            return applied.result
        })
    }

    /** Reconciles `'new'` tags across accounts from persisted state `accountAge` labels. */
    async reconcileNewTagsFromStates(states: Array<{ email: string; accountAge?: string }>): Promise<number> {
        const updatesByEmail = new Map<string, boolean>()
        for (const state of states) {
            const emailKey = state.email?.trim().toLowerCase()
            if (!emailKey) continue
            const isNew = isNewAccountAge(state.accountAge)
            if (isNew !== null) {
                updatesByEmail.set(emailKey, isNew)
            }
        }

        if (updatesByEmail.size === 0) return 0

        return withFileLockAsync(this.getLockTarget(), async () => {
            const current = this.readRawAccounts()
            let changedCount = 0
            const nextList = current.map(acc => {
                const isNew = updatesByEmail.get(acc.email.toLowerCase())
                if (isNew === undefined) return acc
                const synced = syncNewTagByAge(acc.tag, isNew)
                if (!synced.changed) return acc

                changedCount++
                return this.withUpdatedTag(acc, synced.tag)
            })

            if (changedCount > 0) {
                await this.persistAccounts(nextList)
            }
            return changedCount
        })
    }

    private applySyncedTag(
        current: Account[],
        normalizedEmail: string,
        isNew: boolean | null
    ): { nextList: Account[]; result: { tag: string; changed: boolean } } | null {
        const idx = current.findIndex(a => a.email.toLowerCase() === normalizedEmail)
        if (idx === -1) return null

        const existing = current[idx]!
        const synced = syncNewTagByAge(existing.tag, isNew)
        if (!synced.changed) {
            return { nextList: current, result: synced }
        }

        const nextList = [...current]
        nextList[idx] = this.withUpdatedTag(existing, synced.tag)
        return { nextList, result: synced }
    }

    private withUpdatedTag(account: Account, nextTag: string): Account {
        const copy: Account = { ...account }
        if (nextTag) {
            copy.tag = nextTag
        } else {
            delete copy.tag
        }
        return copy
    }

    private getLockTarget(): string {
        return this.findPrimaryReadPath() ?? this.resolveWriteTargets()[0] ?? path.resolve('src/accounts.json')
    }

    private async persistAccounts(accounts: Account[]): Promise<void> {
        const validated = validateAccounts(accounts)
        const serialized = `${JSON.stringify(validated, null, 4)}\n`
        const writeTargets = this.resolveWriteTargets()

        for (const target of writeTargets) {
            await fs.mkdir(path.dirname(target), { recursive: true })
            try {
                await fs.copyFile(target, `${target}.bak`)
            } catch {
                // Fresh install without existing file
            }
            await atomicWriteFileAsync(target, serialized, 0o600)
        }
    }

    private persistAccountsSync(accounts: Account[]): void {
        const validated = validateAccounts(accounts)
        const serialized = `${JSON.stringify(validated, null, 4)}\n`
        const writeTargets = this.resolveWriteTargets()

        for (const target of writeTargets) {
            mkdirSync(path.dirname(target), { recursive: true })
            try {
                copyFileSync(target, `${target}.bak`)
            } catch {
                // Fresh install without existing file
            }
            atomicWriteFileSync(target, serialized, 0o600)
        }
    }

    private resolveWriteTargets(): string[] {
        if (this.customPath) return [path.resolve(this.customPath)]

        const targets: string[] = []
        const srcPath = path.resolve('src/accounts.json')
        const distDir = path.resolve('dist')
        const distPath = path.resolve('dist/accounts.json')
        const rootPath = path.resolve('accounts.json')

        if (existsSync(path.dirname(srcPath))) targets.push(srcPath)
        if (existsSync(distDir)) targets.push(distPath)
        if (existsSync(rootPath)) targets.push(rootPath)
        if (targets.length === 0) targets.push(srcPath)

        return [...new Set(targets)]
    }
}

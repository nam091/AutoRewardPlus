import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { Account } from '../interface/Account'
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
    }

    async update(targetEmail: string, payload: AccountUpsertPayload): Promise<RedactedAccount> {
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
        const existing = this.getRawAccount(targetEmail)
        if (!existing) {
            throw new Error(`Không tìm thấy tài khoản ${targetEmail}.`)
        }
        const nextEnabled = enabled !== undefined ? enabled : existing.enabled === false
        return this.update(targetEmail, { enabled: nextEnabled })
    }

    async remove(targetEmail: string): Promise<boolean> {
        const current = this.readRawAccounts()
        const filtered = current.filter(a => a.email.toLowerCase() !== targetEmail.trim().toLowerCase())
        if (filtered.length === current.length) return false
        await this.persistAccounts(filtered)
        return true
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
            const tempPath = `${target}.${process.pid}.tmp`
            await fs.writeFile(tempPath, serialized, { encoding: 'utf8', mode: 0o600 })
            await fs.rename(tempPath, target)
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

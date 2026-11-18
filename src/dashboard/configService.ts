import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { validateConfig } from '../util/Validator'

export interface ConfigSnapshot {
    path: string | null
    updatedAt: string | null
    data: unknown
}

const SECRET_KEY_RE = /password|apikey|api_key|token|secret|keyfilepath/i

export class ConfigService {
    private readonly configuredPath = process.env.CONFIG_PATH?.trim() || null

    async snapshot(): Promise<ConfigSnapshot> {
        const target = await this.findPath()
        if (!target) return { path: null, updatedAt: null, data: null }
        const [raw, stats] = await Promise.all([fs.readFile(target, 'utf8'), fs.stat(target)])
        return {
            path: target,
            updatedAt: stats.mtime.toISOString(),
            data: redact(JSON.parse(raw))
        }
    }

    async write(data: unknown): Promise<ConfigSnapshot> {
        const primaryTarget = (await this.findPath()) || path.resolve('src/config.json')
        let existingRaw: unknown = null
        try {
            if (existsSync(primaryTarget)) {
                existingRaw = JSON.parse(await fs.readFile(primaryTarget, 'utf8'))
            }
        } catch {
            existingRaw = null
        }

        const merged = mergePreservingSecrets(data, existingRaw)
        const config = validateConfig(merged)
        const serialized = `${JSON.stringify(config, null, 4)}\n`
        const writeTargets = this.resolveWriteTargets(primaryTarget)

        for (const target of writeTargets) {
            await fs.mkdir(path.dirname(target), { recursive: true })
            try {
                await fs.copyFile(target, `${target}.bak`)
            } catch {
                // Fresh install without existing config
            }
            const tempPath = `${target}.${process.pid}.tmp`
            await fs.writeFile(tempPath, serialized, { encoding: 'utf8', mode: 0o600 })
            await fs.rename(tempPath, target)
        }

        return this.snapshot()
    }

    private resolveWriteTargets(primaryTarget: string): string[] {
        if (this.configuredPath) {
            return [path.resolve(this.configuredPath)]
        }

        const targets = [path.resolve(primaryTarget)]
        const srcConfig = path.resolve('src/config.json')
        const distDir = path.resolve('dist')
        const distConfig = path.resolve('dist/config.json')

        if (existsSync(path.dirname(srcConfig))) targets.push(srcConfig)
        if (existsSync(distDir)) targets.push(distConfig)

        return [...new Set(targets)]
    }

    private async findPath(): Promise<string | null> {
        const candidates = [
            this.configuredPath,
            path.resolve('src/config.json'),
            path.resolve('dist/config.json')
        ].filter((candidate): candidate is string => Boolean(candidate))
        for (const candidate of candidates) {
            try {
                await fs.access(candidate)
                return path.resolve(candidate)
            } catch {
                // Try the next supported runtime location.
            }
        }
        return null
    }
}

function redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(item => redact(item))
    if (!value || typeof value !== 'object') return value
    const output: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
        if (SECRET_KEY_RE.test(childKey) && typeof childValue === 'string' && childValue.length > 0) {
            output[childKey] = '[REDACTED]'
        } else {
            output[childKey] = redact(childValue)
        }
    }
    return output
}

function mergePreservingSecrets(incoming: unknown, existing: unknown): unknown {
    if (Array.isArray(incoming)) {
        const existingArr = Array.isArray(existing) ? existing : []
        return incoming.map((item, idx) => {
            // For fallbackProviders array, match by name first if objects
            if (item && typeof item === 'object' && 'name' in item) {
                const match = existingArr.find(
                    e => e && typeof e === 'object' && (e as Record<string, unknown>).name === (item as Record<string, unknown>).name
                )
                return mergePreservingSecrets(item, match ?? existingArr[idx])
            }
            return mergePreservingSecrets(item, existingArr[idx])
        })
    }

    if (!incoming || typeof incoming !== 'object') {
        return incoming
    }

    const existingObj = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {}
    const output: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
        if (SECRET_KEY_RE.test(key) && value === '[REDACTED]') {
            output[key] = existingObj[key] ?? ''
        } else {
            output[key] = mergePreservingSecrets(value, existingObj[key])
        }
    }

    return output
}

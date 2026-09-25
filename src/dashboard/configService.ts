import fs from 'node:fs/promises'
import path from 'node:path'

import { validateConfig } from '../util/Validator'

export interface ConfigSnapshot {
    path: string | null
    updatedAt: string | null
    data: unknown
}

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
        const config = validateConfig(data)
        const target = (await this.findPath()) || path.resolve('src/config.json')
        await fs.mkdir(path.dirname(target), { recursive: true })
        try {
            await fs.copyFile(target, `${target}.bak`)
        } catch {
            // There may be no existing config on a fresh install.
        }
        const tempPath = `${target}.${process.pid}.tmp`
        await fs.writeFile(tempPath, `${JSON.stringify(config, null, 4)}\n`, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(tempPath, target)
        return this.snapshot()
    }

    private async findPath(): Promise<string | null> {
        const candidates = [
            this.configuredPath,
            path.resolve('dist/config.json'),
            path.resolve('src/config.json')
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

function redact(value: unknown, key = ''): unknown {
    if (Array.isArray(value)) return value.map(item => redact(item, key))
    if (!value || typeof value !== 'object') return value
    const output: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
        output[childKey] = /password|apikey|api_key|token|secret|keyfilepath/i.test(childKey)
            ? '[REDACTED]'
            : redact(childValue, childKey)
    }
    return output
}

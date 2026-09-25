import fs from 'node:fs/promises'
import path from 'node:path'

export interface DiagnosticEntry {
    relativePath: string
    files: string[]
    updatedAt: string
}

const DEFAULT_LIMIT = 100

export class DiagnosticService {
    private readonly root: string

    constructor(root = process.env.DIAGNOSTICS_PATH?.trim() || path.resolve('diagnostics')) {
        this.root = path.resolve(root)
    }

    async list(limit = DEFAULT_LIMIT): Promise<DiagnosticEntry[]> {
        try {
            const entries: DiagnosticEntry[] = []
            await this.walk(this.root, entries, Math.max(1, Math.min(limit, 500)))
            return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit)
        } catch {
            return []
        }
    }

    private async walk(directory: string, output: DiagnosticEntry[], limit: number): Promise<void> {
        if (output.length >= limit) return
        let children
        try {
            children = await fs.readdir(directory, { withFileTypes: true })
        } catch {
            return
        }

        const files = children
            .filter(child => child.isFile())
            .map(child => child.name)
            .sort()
        if (files.length > 0) {
            const stats = await Promise.all(files.map(file => fs.stat(path.join(directory, file)).catch(() => null)))
            const updatedAt = new Date(Math.max(...stats.filter(Boolean).map(stat => stat!.mtimeMs), 0)).toISOString()
            output.push({
                relativePath: path.relative(this.root, directory) || '.',
                files,
                updatedAt
            })
        }

        for (const child of children.filter(entry => entry.isDirectory())) {
            await this.walk(path.join(directory, child.name), output, limit)
            if (output.length >= limit) return
        }
    }
}

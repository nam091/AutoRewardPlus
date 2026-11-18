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

    async readFile(relativePath: string, filename: string): Promise<{ buffer: Buffer; contentType: string }> {
        const cleanRel = (relativePath || '.').replace(/\\/g, '/')
        if (cleanRel.includes('..') || path.isAbsolute(cleanRel) || !filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            throw new Error('Invalid diagnostic path.')
        }

        const target = path.resolve(this.root, cleanRel, filename)
        if (!target.startsWith(`${this.root}${path.sep}`)) {
            throw new Error('Path traversal denied.')
        }

        const buffer = await fs.readFile(target)
        const ext = path.extname(filename).toLowerCase()
        const contentType =
            ext === '.png'
                ? 'image/png'
                : ext === '.html'
                  ? 'text/html; charset=utf-8'
                  : 'text/plain; charset=utf-8'

        return { buffer, contentType }
    }

    async clearAll(): Promise<void> {
        await fs.rm(this.root, { recursive: true, force: true })
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
                relativePath: (path.relative(this.root, directory) || '.').replace(/\\/g, '/'),
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

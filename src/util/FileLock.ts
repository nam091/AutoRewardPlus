import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

export interface FileLockOptions {
    timeoutMs?: number
    staleMs?: number
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_STALE_MS = 15000
const RETRYABLE_LOCK_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY'])
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

const asyncMutexTails = new Map<string, Promise<void>>()

function resolveLockConfig(targetPath: string, options?: FileLockOptions) {
    return {
        lockPath: `${path.resolve(targetPath)}.lock`,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        staleMs: options?.staleMs ?? DEFAULT_STALE_MS
    }
}

function getErrnoCode(err: unknown): string | undefined {
    return typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : undefined
}

function isRetryableLockError(err: unknown): boolean {
    const code = getErrnoCode(err)
    return code !== undefined && RETRYABLE_LOCK_CODES.has(code)
}

function isRetryableRenameError(err: unknown): boolean {
    const code = getErrnoCode(err)
    return code !== undefined && RETRYABLE_RENAME_CODES.has(code)
}

function buildTempPath(filePath: string): string {
    const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
    return `${filePath}.${suffix}.tmp`
}

function sleepSync(msDelay: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, msDelay)
}

function sleepAsync(msDelay: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, msDelay))
}

/**
 * Executes `fn` while holding an exclusive advisory lockfile (`<targetPath>.lock`).
 * Uses `Atomics.wait` backoff so synchronous primary-process callers serialize cleanly across processes.
 */
export function withFileLockSync<T>(targetPath: string, fn: () => T, options?: FileLockOptions): T {
    const { lockPath, timeoutMs, staleMs } = resolveLockConfig(targetPath, options)
    const dir = path.dirname(lockPath)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }

    const deadline = Date.now() + timeoutMs
    let acquired = false

    do {
        try {
            const fd = fs.openSync(lockPath, 'wx')
            try {
                fs.writeFileSync(fd, `${process.pid}\n${Date.now()}`)
            } finally {
                fs.closeSync(fd)
            }
            acquired = true
            break
        } catch (err: unknown) {
            if (!isRetryableLockError(err)) break
            if (getErrnoCode(err) === 'EEXIST') {
                try {
                    const stat = fs.statSync(lockPath)
                    if (Date.now() - stat.mtimeMs > staleMs) {
                        fs.unlinkSync(lockPath)
                        continue
                    }
                } catch {
                    // Lock may have just been released or is transient; retry after backoff
                }
            }
            if (Date.now() >= deadline) break
            sleepSync(25)
        }
    } while (Date.now() < deadline)

    try {
        return fn()
    } finally {
        if (acquired) {
            try {
                fs.unlinkSync(lockPath)
            } catch {
                // Best-effort unlock
            }
        }
    }
}

/**
 * Executes an async operation while holding an exclusive lockfile (`<targetPath>.lock`).
 * Combines an in-process FIFO gate with non-blocking file-lock backoff so both intra-process
 * and cross-process writers serialize cleanly without Windows NTFS delete-pending races.
 */
export async function withFileLockAsync<T>(
    targetPath: string,
    fn: () => Promise<T>,
    options?: FileLockOptions
): Promise<T> {
    const { lockPath, timeoutMs, staleMs } = resolveLockConfig(targetPath, options)
    await fsPromises.mkdir(path.dirname(lockPath), { recursive: true })

    const deadline = Date.now() + timeoutMs
    const previous = asyncMutexTails.get(lockPath) ?? Promise.resolve()
    let releaseInProcess!: () => void
    const currentGate = new Promise<void>(resolve => {
        releaseInProcess = resolve
    })
    const nextTail = previous.then(
        () => currentGate,
        () => currentGate
    )
    asyncMutexTails.set(lockPath, nextTail)

    let acquired = false
    try {
        const remainingForGate = Math.max(0, deadline - Date.now())
        let gateTimer: ReturnType<typeof setTimeout> | undefined
        const timeoutGate = new Promise<void>(resolve => {
            gateTimer = setTimeout(resolve, remainingForGate)
        })
        await Promise.race([previous, timeoutGate])
        if (gateTimer !== undefined) clearTimeout(gateTimer)

        do {
            try {
                const handle = await fsPromises.open(lockPath, 'wx')
                try {
                    await handle.writeFile(`${process.pid}\n${Date.now()}`)
                } finally {
                    await handle.close()
                }
                acquired = true
                break
            } catch (err: unknown) {
                if (!isRetryableLockError(err)) break
                if (getErrnoCode(err) === 'EEXIST') {
                    try {
                        const stat = await fsPromises.stat(lockPath)
                        if (Date.now() - stat.mtimeMs > staleMs) {
                            await fsPromises.unlink(lockPath).catch(() => {})
                            continue
                        }
                    } catch {
                        // Lock may have just been released; retry after backoff
                    }
                }
                if (Date.now() >= deadline) break
                await sleepAsync(15 + Math.floor(Math.random() * 15))
            }
        } while (Date.now() < deadline)

        return await fn()
    } finally {
        if (acquired) {
            await fsPromises.unlink(lockPath).catch(() => {})
        }
        releaseInProcess()
        if (asyncMutexTails.get(lockPath) === nextTail) {
            asyncMutexTails.delete(lockPath)
        }
    }
}

/** Atomically writes a UTF-8 file via a unique temporary sibling file and rename. */
export function atomicWriteFileSync(filePath: string, content: string, mode?: number): void {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
    const tempPath = buildTempPath(filePath)
    try {
        fs.writeFileSync(tempPath, content, mode !== undefined ? { encoding: 'utf8', mode } : 'utf8')
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                fs.renameSync(tempPath, filePath)
                return
            } catch (err) {
                if (attempt === 4 || !isRetryableRenameError(err)) throw err
                sleepSync(15 * (attempt + 1))
            }
        }
    } catch (err) {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
        } catch {
            // Best-effort cleanup
        }
        throw err
    }
}

/** Asynchronously and atomically writes a UTF-8 file via a unique temporary sibling file and rename. */
export async function atomicWriteFileAsync(filePath: string, content: string, mode?: number): Promise<void> {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
    const tempPath = buildTempPath(filePath)
    try {
        await fsPromises.writeFile(
            tempPath,
            content,
            mode !== undefined ? { encoding: 'utf8', mode } : 'utf8'
        )
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                await fsPromises.rename(tempPath, filePath)
                return
            } catch (err) {
                if (attempt === 4 || !isRetryableRenameError(err)) throw err
                await sleepAsync(15 * (attempt + 1))
            }
        }
    } catch (err) {
        await fsPromises.unlink(tempPath).catch(() => {})
        throw err
    }
}

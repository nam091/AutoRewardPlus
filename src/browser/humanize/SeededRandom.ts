import { createHash } from 'crypto'

export type WeightedValue<T> = { value: T; weight: number }

/** Deterministic pseudo-random source for stable per-session behavior. */
export class SeededRandom {
    private state: number
    private spareGaussian: number | null = null

    constructor(seed: string | number) {
        const normalized = typeof seed === 'number' ? String(seed) : seed
        const digest = createHash('sha256').update(normalized).digest()
        this.state = digest.readUInt32LE(0) || 0x6d2b79f5
    }

    static fromParts(...parts: Array<string | number | boolean>): SeededRandom {
        return new SeededRandom(parts.map(String).join('\u001f'))
    }

    next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0
        let value = this.state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }

    chance(probability: number): boolean {
        return this.next() < Math.max(0, Math.min(1, probability))
    }

    int(min: number, max: number): number {
        const low = Math.ceil(Math.min(min, max))
        const high = Math.floor(Math.max(min, max))
        return low + Math.floor(this.next() * (high - low + 1))
    }

    gaussian(mean: number, standardDeviation: number): number {
        if (this.spareGaussian !== null) {
            const spare = this.spareGaussian
            this.spareGaussian = null
            return mean + spare * standardDeviation
        }

        const u = Math.max(Number.EPSILON, this.next())
        const v = this.next()
        const magnitude = Math.sqrt(-2 * Math.log(u))
        const angle = 2 * Math.PI * v
        this.spareGaussian = magnitude * Math.sin(angle)
        return mean + magnitude * Math.cos(angle) * standardDeviation
    }

    weighted<T>(items: WeightedValue<T>[]): T | undefined {
        const valid = items.filter(item => Number.isFinite(item.weight) && item.weight > 0)
        const total = valid.reduce((sum, item) => sum + item.weight, 0)
        if (total <= 0) return undefined

        let cursor = this.next() * total
        for (const item of valid) {
            cursor -= item.weight
            if (cursor <= 0) return item.value
        }
        return valid[valid.length - 1]?.value
    }

    shuffle<T>(values: readonly T[]): T[] {
        const result = [...values]
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.int(0, i)
            const current = result[i]!
            result[i] = result[j]!
            result[j] = current
        }
        return result
    }

    derive(label: string): SeededRandom {
        return SeededRandom.fromParts(this.state, label)
    }
}

export function stableSeed(...parts: Array<string | number | boolean>): number {
    const digest = createHash('sha256').update(parts.map(String).join('\u001f')).digest()
    return digest.readUInt32LE(0)
}

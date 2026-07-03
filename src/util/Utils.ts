import ms, { StringValue } from 'ms'

export function errMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function errDetail(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}\n${error.stack ?? ''}`
    }
    return String(error)
}

export default class Util {
    async wait(time: number | string): Promise<void> {
        if (typeof time === 'string') {
            time = this.stringToNumber(time)
        }

        return new Promise<void>(resolve => {
            setTimeout(resolve, time)
        })
    }

    getFormattedDate(ms = Date.now()): string {
        const today = new Date(ms)
        const month = String(today.getMonth() + 1).padStart(2, '0') // January is 0
        const day = String(today.getDate()).padStart(2, '0')
        const year = today.getFullYear()

        return `${month}/${day}/${year}`
    }

    shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))

            const a = array[i]
            const b = array[j]

            if (a === undefined || b === undefined) continue

            array[i] = b
            array[j] = a
        }

        return array
    }

    randomNumber(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min
    }

    chunkArray<T>(arr: T[], numChunks: number): T[][] {
        const chunkSize = Math.ceil(arr.length / numChunks)
        const chunks: T[][] = []

        for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.slice(i, i + chunkSize)
            chunks.push(chunk)
        }

        return chunks
    }

    stringToNumber(input: string | number): number {
        if (typeof input === 'number') {
            return input
        }
        const value = input.trim()

        const milisec = ms(value as StringValue)

        if (milisec === undefined) {
            throw new Error(
                `The input provided (${input}) cannot be parsed to a valid time! Use a format like "1 min", "1m" or "1 minutes"`
            )
        }

        return milisec
    }

    normalizeString(string: string): string {
        return string
            .normalize('NFD')
            .trim()
            .toLowerCase()
            .replace(/[^\x20-\x7E]/g, '')
            .replace(/[?!]/g, '')
    }

    getEmailUsername(email: string): string {
        return email.split('@')[0] ?? 'Unknown'
    }

    randomDelay(min: string | number, max: string | number): number {
        const minMs = typeof min === 'number' ? min : this.stringToNumber(min)
        const maxMs = typeof max === 'number' ? max : this.stringToNumber(max)
        return Math.floor(this.randomNumber(minMs, maxMs))
    }

    /**
     * Returns delay following exponential distribution.
     * Most values cluster near minMs, with occasional long tails toward maxMs.
     * Simulates human behavior where most actions are quick but sometimes there's a longer pause.
     */
    exponentialDelay(minMs: number, maxMs: number): number {
        const range = maxMs - minMs
        return Math.floor(minMs + range * Math.pow(Math.random(), 3))
    }

    /**
     * Returns per-character typing delay in ms that mimics human typing.
     * Normal range: 30-120ms. ~15% chance of a "thinking pause" returning 200-600ms.
     */
    humanTypingDelay(): number {
        if (Math.random() < 0.15) {
            // Thinking pause between words or mid-thought
            return this.randomNumber(200, 600)
        }
        return this.randomNumber(30, 120)
    }

    /**
     * Returns true if current local hour is between 1am-5am.
     * Used to reduce search frequency during unrealistic hours.
     */
    isQuietHours(): boolean {
        const hour = new Date().getHours()
        return hour >= 1 && hour < 5
    }

    /**
     * Returns true if current day is weekend (Saturday or Sunday).
     * Humans have different activity patterns on weekends.
     */
    isWeekend(): boolean {
        const day = new Date().getDay()
        return day === 0 || day === 6
    }

    /**
     * Get time period of day for behavior adjustment.
     * Returns: 'morning' | 'afternoon' | 'evening' | 'night' | 'quiet'
     */
    getTimePeriod(): 'morning' | 'afternoon' | 'evening' | 'night' | 'quiet' {
        const hour = new Date().getHours()

        if (hour >= 5 && hour < 12) return 'morning'
        if (hour >= 12 && hour < 17) return 'afternoon'
        if (hour >= 17 && hour < 22) return 'evening'
        if (hour >= 22 || hour < 1) return 'night'
        return 'quiet' // 1am-5am
    }

    /**
     * Get activity level multiplier based on time of day.
     * Higher value = slower behavior (more cautious).
     */
    getActivityMultiplier(): number {
        const period = this.getTimePeriod()
        const weekend = this.isWeekend()

        const baseMultiplier: Record<string, number> = {
            'morning': 1.0,
            'afternoon': 1.0,
            'evening': 1.1,
            'night': 1.3,
            'quiet': 2.0
        }

        let multiplier = baseMultiplier[period] ?? 1.0

        // Weekend: people are more relaxed, less predictable
        if (weekend) {
            multiplier *= 0.9 // Slightly faster on weekends
        }

        return multiplier
    }

    /**
     * Session fatigue tracker.
     * Tracks how long the current session has been running.
     */
    private sessionStartTime: number = Date.now()

    resetSessionTimer(): void {
        this.sessionStartTime = Date.now()
    }

    getSessionDurationMinutes(): number {
        return (Date.now() - this.sessionStartTime) / 60000
    }

    /**
     * Get fatigue multiplier based on session duration.
     * Humans slow down during long repetitive sessions.
     */
    getSessionFatigueMultiplier(): number {
        const minutes = this.getSessionDurationMinutes()

        if (minutes < 5) return 1.0
        if (minutes < 15) return 1.05
        if (minutes < 30) return 1.1
        if (minutes < 60) return 1.15
        return 1.2 // After 1 hour, noticeably slower
    }

    /**
     * Should take a break?
     * Returns true if session has been running long enough to warrant a break.
     * Breaks make behavior more human-like.
     */
    shouldTakeBreak(): boolean {
        const minutes = this.getSessionDurationMinutes()

        // ~10% chance of break after 20 minutes
        if (minutes > 20 && Math.random() < 0.1) return true

        // ~25% chance of break after 45 minutes
        if (minutes > 45 && Math.random() < 0.25) return true

        // ~50% chance of break after 90 minutes
        if (minutes > 90 && Math.random() < 0.5) return true

        return false
    }

    /**
     * Generate a break duration in ms.
     * Short breaks (30s-2min) are more common than long breaks (5-15min).
     */
    getBreakDuration(): number {
        const rand = Math.random()

        if (rand < 0.7) {
            // Short break: 30s - 2min
            return this.randomDelay(30000, 120000)
        } else if (rand < 0.9) {
            // Medium break: 2-5 min
            return this.randomDelay(120000, 300000)
        } else {
            // Long break: 5-15 min
            return this.randomDelay(300000, 900000)
        }
    }

    /**
     * Combined delay with all human factors applied.
     * Use this for the most realistic timing.
     */
    humanDelay(baseMinMs: number, baseMaxMs: number): number {
        const base = this.exponentialDelay(baseMinMs, baseMaxMs)
        const timeMultiplier = this.getActivityMultiplier()
        const fatigueMultiplier = this.getSessionFatigueMultiplier()

        return Math.floor(base * timeMultiplier * fatigueMultiplier)
    }
}

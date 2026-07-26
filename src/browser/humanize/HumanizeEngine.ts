import type { Locator, Page } from 'patchright'

import { SeededRandom } from './SeededRandom'

interface Point {
    x: number
    y: number
}

interface BezierCurve {
    start: Point
    cp1: Point
    cp2: Point
    end: Point
}

/**
 * Advanced humanization engine for anti-detection.
 * Simulates realistic human behavior: mouse movement, typing, reading, clicking.
 */
export class HumanizeEngine {
    /**
     * Seeded source for every random decision this engine makes.
     *
     * The rest of the project derives behavior from a stable account/device/day
     * seed, but this engine used `Math.random()` throughout, so mouse paths,
     * typing rhythm and dwell times were unseeded. Configuring a seed here makes
     * the whole behavior profile reproducible for a given account and day.
     */
    private static random: SeededRandom | null = null

    /** Binds the engine to an account/device seed. Call once per browser session. */
    public static configureSeed(...parts: Array<string | number | boolean>): void {
        this.random = SeededRandom.fromParts(...parts)
    }

    /** Clears the seed, restoring unseeded behavior. */
    public static resetSeed(): void {
        this.random = null
    }

    /** Uniform [0, 1), seeded when configured. */
    private static rand(): number {
        return this.random ? this.random.next() : Math.random()
    }

    // ─── Mouse Movement ───────────────────────────────────────────────

    /**
     * Generates a random number following a Gaussian/Normal distribution using Box-Muller transform.
     */
    public static gaussianRandom(mean: number, stdev: number): number {
        if (this.random) {
            return Math.max(0, Math.round(this.random.gaussian(mean, stdev)));
        }

        const u = 1 - Math.random();
        const v = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        return Math.max(0, Math.round(z * stdev + mean));
    }

    /**
     * Human-like sleep using Gaussian distribution.
     */
    public static async gaussianSleep(meanMs: number, stdevMs: number): Promise<void> {
        const delay = this.gaussianRandom(meanMs, stdevMs);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Move mouse along a Bezier curve with realistic acceleration/deceleration.
     * Simulates human arm/wrist movement with micro-jitter.
     */
    public static async moveMouseBezier(page: Page, targetX: number, targetY: number): Promise<void> {
        const start = await page.evaluate(() => ({ x: (window as any).__lastMouseX ?? 0, y: (window as any).__lastMouseY ?? 0 }))
        const end: Point = { x: targetX, y: targetY }

        // Skip movement if very close (within 5px)
        const dx = end.x - start.x
        const dy = end.y - start.y
        if (Math.sqrt(dx * dx + dy * dy) < 5) {
            await page.mouse.move(end.x, end.y)
            return
        }

        // Generate natural control points with some randomness
        const curve = this.generateBezierCurve(start, end)
        const steps = this.gaussianRandom(25, 8)

        // Ease-in-out timing: slow start, fast middle, slow end
        for (let i = 0; i <= steps; i++) {
            const t = i / steps
            const easedT = this.easeInOutCubic(t)
            const point = this.evaluateBezier(curve, easedT)

            // Add micro-jitter (hand tremor) - gaussian for more natural tremor
            const jitterX = this.gaussianRandom(0, 0.5)
            const jitterY = this.gaussianRandom(0, 0.5)

            await page.mouse.move(point.x + jitterX, point.y + jitterY)

            // Variable speed: faster in middle, slower at start/end
            const speedFactor = Math.sin(t * Math.PI) * 0.8 + 0.2
            const delay = Math.floor(5 + (1 - speedFactor) * 15)
            await new Promise(resolve => setTimeout(resolve, delay))
        }

        // Store last position for next movement
        await page.evaluate(({ x, y }: Point) => {
            (window as any).__lastMouseX = x;
            (window as any).__lastMouseY = y
        }, end)
    }

    /**
     * Generate a natural Bezier curve between two points.
     * Control points simulate wrist/arm pivot.
     */
    private static generateBezierCurve(start: Point, end: Point): BezierCurve {
        const dx = end.x - start.x
        const dy = end.y - start.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        // Control points offset perpendicular to the line
        const perpX = -dy / dist
        const perpY = dx / dist

        // Random curvature (humans don't move in perfect lines)
        const curvature = (this.rand() - 0.5) * dist * 0.3

        const cp1: Point = {
            x: start.x + dx * 0.25 + perpX * curvature * (0.5 + this.rand()),
            y: start.y + dy * 0.25 + perpY * curvature * (0.5 + this.rand())
        }

        const cp2: Point = {
            x: start.x + dx * 0.75 + perpX * curvature * (0.3 + this.rand()),
            y: start.y + dy * 0.75 + perpY * curvature * (0.3 + this.rand())
        }

        return { start, cp1, cp2, end }
    }

    /**
     * Evaluate cubic Bezier at parameter t.
     */
    private static evaluateBezier(curve: BezierCurve, t: number): Point {
        const mt = 1 - t
        const mt2 = mt * mt
        const mt3 = mt2 * mt
        const t2 = t * t
        const t3 = t2 * t

        return {
            x: mt3 * curve.start.x + 3 * mt2 * t * curve.cp1.x + 3 * mt * t2 * curve.cp2.x + t3 * curve.end.x,
            y: mt3 * curve.start.y + 3 * mt2 * t * curve.cp1.y + 3 * mt * t2 * curve.cp2.y + t3 * curve.end.y
        }
    }

    /**
     * Cubic ease-in-out for natural acceleration.
     */
    private static easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    }

    // ─── Click Patterns ───────────────────────────────────────────────

    /**
     * Human-like click: move to element, hover briefly, then click.
     * Variable click duration simulates real mouse button press.
     */
    public static async humanClick(page: Page, selector: string): Promise<void> {
        await this.humanClickLocator(page, page.locator(selector).first())
    }

    public static async humanClickLocator(page: Page, locator: Locator): Promise<boolean> {
        const box = await locator.boundingBox()
        if (!box) return false

        // Click target: random point within element (not exact center)
        const targetX = box.x + box.width * (0.3 + this.rand() * 0.4)
        const targetY = box.y + box.height * (0.3 + this.rand() * 0.4)

        // Move mouse naturally to target
        await this.moveMouseBezier(page, targetX, targetY)

        // Hover pause (humans pause before clicking)
        await this.gaussianSleep(150, 60)

        // Click with variable press duration
        await page.mouse.down()
        await this.gaussianSleep(80, 25)
        await page.mouse.up()

        // Post-click micro-pause
        await this.gaussianSleep(50, 20)
        return true
    }

    /**
     * Human-like double-click with natural timing between clicks.
     */
    public static async humanDoubleClick(page: Page, selector: string): Promise<void> {
        const element = await page.$(selector)
        if (!element) return

        const box = await element.boundingBox()
        if (!box) return

        // Click target: random point within element
        const targetX = box.x + box.width * (0.3 + this.rand() * 0.4)
        const targetY = box.y + box.height * (0.3 + this.rand() * 0.4)

        // Move mouse naturally to target
        await this.moveMouseBezier(page, targetX, targetY)

        // Hover pause
        await this.gaussianSleep(100, 40)

        // First click
        await page.mouse.down()
        await this.gaussianSleep(70, 20)
        await page.mouse.up()

        // Inter-click interval (humans double-click with 50-150ms between clicks)
        await this.gaussianSleep(100, 30)

        // Second click
        await page.mouse.down()
        await this.gaussianSleep(70, 20)
        await page.mouse.up()

        // Post-click pause
        await this.gaussianSleep(80, 30)
    }

    /**
     * Human-like right-click (context menu).
     */
    public static async humanRightClick(page: Page, selector: string): Promise<void> {
        const element = await page.$(selector)
        if (!element) return

        const box = await element.boundingBox()
        if (!box) return

        // Click target: random point within element
        const targetX = box.x + box.width * (0.3 + this.rand() * 0.4)
        const targetY = box.y + box.height * (0.3 + this.rand() * 0.4)

        // Move mouse naturally to target
        await this.moveMouseBezier(page, targetX, targetY)

        // Hover pause
        await this.gaussianSleep(200, 80)

        // Right-click with variable press duration
        await page.mouse.down({ button: 'right' })
        await this.gaussianSleep(90, 30)
        await page.mouse.up({ button: 'right' })

        // Post-click pause
        await this.gaussianSleep(100, 40)
    }

    /**
     * Human-like hover with natural mouse movement.
     */
    public static async humanHover(page: Page, selector: string, durationMs?: number): Promise<void> {
        await this.humanHoverLocator(page, page.locator(selector).first(), durationMs)
    }

    public static async humanHoverLocator(page: Page, locator: Locator, durationMs?: number): Promise<boolean> {
        const box = await locator.boundingBox()
        if (!box) return false

        // Hover target: random point within element
        const targetX = box.x + box.width * (0.3 + this.rand() * 0.4)
        const targetY = box.y + box.height * (0.3 + this.rand() * 0.4)

        // Move mouse naturally to target
        await this.moveMouseBezier(page, targetX, targetY)

        // Hover for specified duration or random
        const hoverTime = durationMs ?? this.gaussianRandom(500, 200)
        await this.gaussianSleep(hoverTime, hoverTime * 0.2)
        return true
    }

    // ─── Typing Patterns ──────────────────────────────────────────────

    /**
     * Types text like a real human with advanced patterns:
     * - Variable speed based on word boundaries
     * - Fat-finger errors (adjacent keys)
     * - Common typo patterns
     * - Hesitation pauses mid-thought
     * - Faster typing for common words
     */
    public static async typeHumanlike(page: Page, selector: string, text: string): Promise<void> {
        await page.focus(selector)

        const words = text.split(/(\s+)/)
        let prevChar = ''

        for (let wordIdx = 0; wordIdx < words.length; wordIdx++) {
            const word = words[wordIdx]
            if (!word) continue

            // Word boundary pause (longer between words)
            if (wordIdx > 0 && /^\s+$/.test(word)) {
                await this.gaussianSleep(180, 60)
                continue
            }

            // Common words are typed faster
            const isCommonWord = this.COMMON_WORDS.has(word.toLowerCase())
            const baseSpeed = isCommonWord ? 80 : 110

            for (let i = 0; i < word.length; i++) {
                const char = word.charAt(i)
                if (!char) continue

                // Hesitation pause: ~8% chance of thinking pause (longer at word starts)
                if (this.rand() < (i === 0 ? 0.12 : 0.06)) {
                    await this.gaussianSleep(400, 150)
                }

                 // Fat-finger error: ~5% chance of hitting adjacent key
                if (this.rand() < 0.05 && i > 0) {
                    const adjacentKey = this.getAdjacentKey(char)
                    if (adjacentKey && adjacentKey.charCodeAt(0) < 128) {
                        await page.keyboard.down(adjacentKey)
                        await new Promise(resolve => setTimeout(resolve, this.gaussianRandom(45, 15)))
                        await page.keyboard.up(adjacentKey)
                        await this.gaussianSleep(100, 35)
                        await page.keyboard.press('Backspace')
                        await this.gaussianSleep(120, 40)
                    }
                }

                // Double-letter hesitation (e.g., "ll", "ss", "tt")
                if (i > 0 && char === prevChar && this.rand() < 0.3) {
                    await this.gaussianSleep(60, 20)
                }

                const isStandardKey = char.charCodeAt(0) < 128
                if (isStandardKey) {
                    await page.keyboard.down(char)
                    await new Promise(resolve => setTimeout(resolve, this.gaussianRandom(45, 15)))
                    await page.keyboard.up(char)
                } else {
                    await page.keyboard.type(char)
                }

                // Variable typing speed with Gaussian distribution
                const jitter = this.gaussianRandom(0, 15)
                await this.gaussianSleep(baseSpeed + jitter, 25)

                prevChar = char
            }

            // Brief pause after completing a word
            await this.gaussianSleep(40, 15)
        }
    }

    /** Common English words typed faster (muscle memory) */
    private static readonly COMMON_WORDS = new Set([
        'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
        'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
        'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
        'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
        'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
        'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
        'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
        'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also'
    ])

    /** Keyboard layout adjacency for fat-finger simulation */
    private static readonly KEY_ADJACENCY: Record<string, string[]> = {
        'q': ['w', 'a'], 'w': ['q', 'e', 's'], 'e': ['w', 'r', 'd'],
        'r': ['e', 't', 'f'], 't': ['r', 'y', 'g'], 'y': ['t', 'u', 'h'],
        'u': ['y', 'i', 'j'], 'i': ['u', 'o', 'k'], 'o': ['i', 'p', 'l'],
        'p': ['o', 'l'], 'a': ['q', 's', 'z'], 's': ['a', 'd', 'x', 'w'],
        'd': ['s', 'f', 'c', 'e'], 'f': ['d', 'g', 'v', 'r'], 'g': ['f', 'h', 'b', 't'],
        'h': ['g', 'j', 'n', 'y'], 'j': ['h', 'k', 'm', 'u'], 'k': ['j', 'l', 'i'],
        'l': ['k', 'o', 'p'], 'z': ['a', 'x'], 'x': ['z', 'c', 's'],
        'c': ['x', 'v', 'd'], 'v': ['c', 'b', 'f'], 'b': ['v', 'n', 'g'],
        'n': ['b', 'm', 'h'], 'm': ['n', 'j']
    }

    /**
     * Get an adjacent key for fat-finger error simulation.
     */
    private static getAdjacentKey(char: string): string | null {
        const lower = char.toLowerCase()
        const adjacent = this.KEY_ADJACENCY[lower]
        if (!adjacent || adjacent.length === 0) return null
        const picked = adjacent[Math.floor(this.rand() * adjacent.length)]
        if (!picked) return null
        return char === char.toUpperCase() ? picked.toUpperCase() : picked
    }

    // ─── Scroll / Reading Patterns ────────────────────────────────────

    /**
     * Simulates natural reading behavior with variable scroll patterns:
     * - Scanning (fast scroll down)
     * - Reading (slow scroll with pauses)
     * - Backtracking (occasional scroll up to re-read)
     * - Fixation pauses (stopping to read content)
     * - Momentum scrolling (acceleration/deceleration)
     */
    public static async naturalScroll(page: Page): Promise<void> {
        const viewportHeight = await page.evaluate(() => window.innerHeight)
        const totalHeight = await page.evaluate(() => document.body.scrollHeight)
        const scrollableHeight = totalHeight - viewportHeight

        if (scrollableHeight <= 0) return

        let currentScroll = 0
        const scrollSteps = this.gaussianRandom(5, 2)

        for (let i = 0; i < scrollSteps; i++) {
            const isReading = this.rand() < 0.6 // 60% reading, 40% scanning

            if (isReading) {
                // Reading mode: small scrolls with fixation pauses
                const readSteps = this.gaussianRandom(3, 1)
                for (let r = 0; r < readSteps; r++) {
                    const deltaY = this.gaussianRandom(120, 40)
                    currentScroll = Math.min(currentScroll + deltaY, scrollableHeight)

                    // Momentum scroll: split into smaller increments with acceleration
                    await this.momentumScroll(page, deltaY)

                    // Fixation pause (simulates reading time)
                    const fixationTime = this.gaussianRandom(800, 300)
                    await this.gaussianSleep(fixationTime, 200)
                }

                // 15% chance of backtracking (re-reading)
                if (this.rand() < 0.15 && currentScroll > 100) {
                    const backtrack = this.gaussianRandom(80, 30)
                    currentScroll = Math.max(0, currentScroll - backtrack)
                    await page.mouse.wheel(0, -backtrack)
                    await this.gaussianSleep(600, 200)
                }
            } else {
                // Scanning mode: faster, larger scrolls
                const deltaY = this.gaussianRandom(350, 100)
                currentScroll = Math.min(currentScroll + deltaY, scrollableHeight)

                // Momentum scroll for scanning too
                await this.momentumScroll(page, deltaY)

                await this.gaussianSleep(400, 150)
            }
        }
    }

    /**
     * Momentum scroll with acceleration and deceleration.
     * Simulates finger flick on trackpad/touchscreen.
     */
    private static async momentumScroll(page: Page, totalDeltaY: number): Promise<void> {
        const steps = Math.max(3, Math.floor(Math.abs(totalDeltaY) / 50))
        const direction = totalDeltaY > 0 ? 1 : -1

        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1)
            // Ease-out: fast start, slow end
            const easedT = 1 - Math.pow(1 - t, 2)
            const deltaY = Math.round(totalDeltaY / steps * (1 + easedT * 0.5))

            await page.mouse.wheel(0, deltaY * direction)
            await new Promise(resolve => setTimeout(resolve, 5 + this.rand() * 10))
        }
    }

    /**
     * Simulate reading time based on content length.
     * Estimates reading speed: ~200-250 words per minute.
     */
    public static estimateReadingTime(textLength: number): number {
        const wordsEstimate = textLength / 5 // avg word length
        const readingSpeedWPM = this.gaussianRandom(225, 25)
        const readingTimeMs = (wordsEstimate / readingSpeedWPM) * 60 * 1000

        // Add some variance and minimum/maximum bounds
        const variance = readingTimeMs * (this.rand() * 0.3 - 0.15)
        return Math.max(1000, Math.min(15000, readingTimeMs + variance))
    }

    // ─── Schedule / Timing ────────────────────────────────────────────

    /**
     * Calculates a random start time offset within a window (e.g. random window schedule).
     */
    public static getRandomScheduleOffset(minMinutes: number, maxMinutes: number): number {
        return Math.floor(this.rand() * (maxMinutes - minMinutes + 1) + minMinutes) * 60 * 1000
    }

    /**
     * Time-of-day aware delay adjustment.
     * Returns a multiplier for delays based on current hour.
     * - Peak hours (9am-11pm): normal speed
     * - Off-peak (11pm-1am): slightly slower
     * - Quiet hours (1am-5am): much slower (suspicious to be active)
     */
    public static getTimeOfDayMultiplier(): number {
        const hour = new Date().getHours()

        if (hour >= 9 && hour < 23) return 1.0      // Normal hours (9am-11pm)
        if (hour >= 23 || hour < 1) return 1.3       // Late night (11pm-1am)
        if (hour >= 1 && hour < 5) return 2.0        // Quiet hours (1am-5am)
        return 1.2                                    // Early morning (5-9am)
    }

    /**
     * Weekend behavior adjustment.
     * Humans tend to be more active at different times on weekends.
     */
    public static isWeekend(): boolean {
        const day = new Date().getDay()
        return day === 0 || day === 6
    }

    /**
     * Session fatigue simulation.
     * Returns a delay multiplier that increases over long sessions.
     * Humans slow down when doing repetitive tasks for a while.
     */
    public static getSessionFatigueMultiplier(sessionStartTime: number): number {
        const elapsedMinutes = (Date.now() - sessionStartTime) / 60000

        if (elapsedMinutes < 5) return 1.0
        if (elapsedMinutes < 15) return 1.1
        if (elapsedMinutes < 30) return 1.2
        return 1.3 // After 30 minutes, noticeably slower
    }
}

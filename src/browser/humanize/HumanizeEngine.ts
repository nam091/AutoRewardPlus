import { Page } from 'patchright';

export class HumanizeEngine {
    /**
     * Generates a random number following a Gaussian/Normal distribution using Box-Muller transform.
     */
    public static gaussianRandom(mean: number, stdev: number): number {
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
     * Types text like a real human: random delays between keystrokes, occasional typos and backspaces.
     */
    public static async typeHumanlike(page: Page, selector: string, text: string): Promise<void> {
        await page.focus(selector);
        for (let i = 0; i < text.length; i++) {
            const char = text.charAt(i);
            if (!char) continue;
            
            // 4% chance of typing a wrong character and correcting it
            if (Math.random() < 0.04 && i > 0) {
                const wrongChar = String.fromCharCode(char.charCodeAt(0) + 1);
                await page.keyboard.type(wrongChar);
                await this.gaussianSleep(120, 40);
                await page.keyboard.press('Backspace');
                await this.gaussianSleep(150, 50);
            }

            await page.keyboard.type(char);
            // Typing speed variance: 60ms to 220ms
            await this.gaussianSleep(110, 45);
        }
    }

    /**
     * Simulates natural reading & multi-step scrolling.
     */
    public static async naturalScroll(page: Page): Promise<void> {
        const scrollSteps = Math.floor(Math.random() * 4) + 2;
        for (let i = 0; i < scrollSteps; i++) {
            const deltaY = this.gaussianRandom(350, 120);
            await page.mouse.wheel(0, deltaY);
            await this.gaussianSleep(1200, 450);
        }
    }

    /**
     * Calculates a random start time offset within a window (e.g. random window schedule).
     */
    public static getRandomScheduleOffset(minMinutes: number, maxMinutes: number): number {
        return Math.floor(Math.random() * (maxMinutes - minMinutes + 1) + minMinutes) * 60 * 1000;
    }
}

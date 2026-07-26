export interface AntiDetectionProfile {
    seed: number
    isMobile: boolean
}

interface InitScriptContext {
    addInitScript(script: { content: string }): Promise<unknown>
}

function applyProfile({ seed, isMobile }: AntiDetectionProfile): void {
    const mix = (value: number): number => {
        let result = (value ^ seed) >>> 0
        result = Math.imul(result ^ (result >>> 16), 0x45d9f3b)
        result = Math.imul(result ^ (result >>> 16), 0x45d9f3b)
        return (result ^ (result >>> 16)) >>> 0
    }

    try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
    } catch {
        // Some builds define `webdriver` as non-configurable. Throwing here
        // would abort the rest of the patches, which matter more.
    }
    delete (window as unknown as Record<string, unknown>).__playwright
    delete (window as unknown as Record<string, unknown>).__pw_manual
    delete (window as unknown as Record<string, unknown>).__PW_inspect

    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        const imageData = originalGetImageData.apply(this, args as [number, number, number, number])
        const data = imageData.data
        for (let i = 0; i < data.length; i += 4) {
            const sample = mix(i + data.length)
            if (sample % 29 === 0) {
                const delta = (sample & 1) === 0 ? 1 : -1
                data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + delta))
                data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + delta))
                data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + delta))
            }
        }
        return imageData
    }

    Object.defineProperty(window, '__arpProfile', {
        value: Object.freeze({ seed, device: isMobile ? 'mobile' : 'desktop' }),
        enumerable: false,
        configurable: false,
        writable: false
    })
}

/** Applies one combined fingerprint and deterministic profile init script. */
export class AntiDetectionEngine {
    static getInitScript(profile: AntiDetectionProfile, fingerprintScript = ''): string {
        const guardedFingerprint = fingerprintScript ? `try {\n${fingerprintScript}\n} catch {}` : ''
        return `${guardedFingerprint}\n(${applyProfile.toString()})(${JSON.stringify(profile)});`
    }

    static async applyAll(
        context: InitScriptContext,
        profile: AntiDetectionProfile,
        fingerprintScript = ''
    ): Promise<void> {
        await context.addInitScript({ content: this.getInitScript(profile, fingerprintScript) })
    }
}

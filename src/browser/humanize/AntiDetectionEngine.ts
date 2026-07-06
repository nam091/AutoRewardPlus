import type { Page } from 'patchright'

export interface AntiDetectionOptions {
    isMobile?: boolean
    langCode?: string
    /** Stable per-account seed for deterministic fingerprint noise */
    sessionSeed?: string
    /** When true, only patch automation signals — do not override injected fingerprint */
    trustInjectedFingerprint?: boolean
}

/**
 * Anti-detection engine for browser automation.
 * Patches automation signals; respects fingerprint-injector profiles when configured.
 */
export class AntiDetectionEngine {
    /**
     * Apply anti-detection patches to a browser context.
     * Call this after creating a new injected context.
     */
    static async applyAll(context: any, options: AntiDetectionOptions = {}): Promise<void> {
        const {
            isMobile = false,
            langCode = 'en',
            sessionSeed = 'default',
            trustInjectedFingerprint = true
        } = options

        const seed = this.hashSeed(sessionSeed)
        const languages = this.buildLanguages(langCode)

        await context.addInitScript(
            ({ trustFp, mobile, langs, noiseSeed }: {
                trustFp: boolean
                mobile: boolean
                langs: string[]
                noiseSeed: number
            }) => {
                const seededRandom = (offset: number) => {
                    const x = Math.sin(noiseSeed + offset) * 10000
                    return x - Math.floor(x)
                }

                const evadeWebDriver = () => {
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => false,
                        configurable: true
                    })

                    if (window.navigator) {
                        Object.defineProperty(window.navigator, 'webdriver', {
                            get: () => false
                        })
                    }

                    delete (window as any).__playwright
                    delete (window as any).__pw_manual
                    delete (window as any).__PW_inspect
                }

                const patchNavigator = () => {
                    Object.defineProperty(navigator, 'languages', {
                        get: () => langs,
                        configurable: true
                    })

                    const cores = [4, 8, 12, 16]
                    const memoryOptions = [4, 8, 16]
                    const selectedCores = cores[Math.floor(seededRandom(1) * cores.length)] || 8
                    const selectedMemory = memoryOptions[Math.floor(seededRandom(2) * memoryOptions.length)] || 8

                    Object.defineProperty(navigator, 'hardwareConcurrency', {
                        get: () => selectedCores,
                        configurable: true
                    })

                    Object.defineProperty(navigator, 'deviceMemory', {
                        get: () => selectedMemory,
                        configurable: true
                    })

                    Object.defineProperty(navigator, 'maxTouchPoints', {
                        get: () => (mobile ? 5 + Math.floor(seededRandom(3) * 6) : 0),
                        configurable: true
                    })

                    if ((navigator as any).connection) {
                        Object.defineProperty((navigator as any).connection, 'rtt', {
                            get: () => 50 + Math.floor(seededRandom(4) * 100),
                            configurable: true
                        })
                    }
                }

                const spoofPlugins = () => {
                    const pluginData = [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                    ]

                    const plugins = pluginData.map(p => ({
                        name: p.name,
                        filename: p.filename,
                        description: p.description,
                        length: 1,
                        item: () => null,
                        namedItem: () => null,
                        [Symbol.iterator]: function* () { yield* [] }
                    }))

                    Object.defineProperty(navigator, 'plugins', {
                        get: () => {
                            const list = plugins as any
                            list.length = plugins.length
                            list.item = (i: number) => plugins[i] ?? null
                            list.namedItem = (name: string) => plugins.find(p => p.name === name) ?? null
                            list.refresh = () => {}
                            return list
                        },
                        configurable: true
                    })
                }

                const evadeDevToolsDetection = () => {
                    Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Array', { get: () => undefined })
                    Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Promise', { get: () => undefined })
                    Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Symbol', { get: () => undefined })

                    const originalPrepareStackTrace = Error.prepareStackTrace
                    Error.prepareStackTrace = (error, structuredStackTrace) => {
                        const filtered = structuredStackTrace.filter(callSite => {
                            const fileName = callSite.getFileName() ?? ''
                            return !fileName.includes('puppeteer') &&
                                   !fileName.includes('playwright') &&
                                   !fileName.includes('patchright')
                        })
                        if (originalPrepareStackTrace) {
                            return originalPrepareStackTrace(error, filtered)
                        }
                        return filtered.map(cs => `    at ${cs}`).join('\n')
                    }
                }

                const patchPermissions = () => {
                    const originalQuery = Permissions.prototype.query
                    Permissions.prototype.query = async function (desc) {
                        const result = await originalQuery.call(this, desc)
                        if (['notifications', 'geolocation', 'camera', 'microphone'].includes(desc.name)) {
                            Object.defineProperty(result, 'state', { get: () => 'prompt' })
                        }
                        return result
                    }
                }

                const patchIframeAccess = () => {
                    const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')
                    if (originalContentWindow) {
                        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
                            get: function () {
                                const iframe = originalContentWindow.get?.call(this)
                                if (iframe) {
                                    try {
                                        Object.defineProperty(iframe.navigator, 'webdriver', {
                                            get: () => false
                                        })
                                    } catch {}
                                }
                                return iframe
                            },
                            configurable: true
                        })
                    }
                }

                const applyCanvasNoise = () => {
                    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
                    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData

                    const addNoise = (imageData: ImageData): ImageData => {
                        const data = imageData.data
                        for (let i = 0; i < data.length; i += 4) {
                            const noise = seededRandom(i) < 0.1 ? (seededRandom(i + 1) < 0.5 ? 1 : -1) : 0
                            data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + noise))
                            data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + noise))
                            data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + noise))
                        }
                        return imageData
                    }

                    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
                        const imageData = originalGetImageData.apply(this, args as [number, number, number, number])
                        return addNoise(imageData)
                    }

                    HTMLCanvasElement.prototype.toDataURL = function (...args) {
                        const ctx = this.getContext('2d')
                        if (ctx) {
                            const temp = ctx.getImageData
                            ctx.getImageData = function (...imgArgs) {
                                const data = temp.apply(this, imgArgs)
                                return addNoise(data)
                            }
                            const result = originalToDataURL.apply(this, args)
                            ctx.getImageData = temp
                            return result
                        }
                        return originalToDataURL.apply(this, args)
                    }
                }

                const applyWebGLNoise = () => {
                    const commonVendors = [
                        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
                        { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
                        { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' }
                    ]

                    const vendorIdx = Math.min(
                        Math.floor(seededRandom(10) * commonVendors.length),
                        commonVendors.length - 1
                    )
                    const selectedVendor = commonVendors[vendorIdx]!.vendor
                    const selectedRenderer = commonVendors[vendorIdx]!.renderer

                    const getParameter = WebGLRenderingContext.prototype.getParameter
                    WebGLRenderingContext.prototype.getParameter = function (param) {
                        if (param === 0x9245) return selectedVendor
                        if (param === 0x9246) return selectedRenderer
                        return getParameter.call(this, param)
                    }

                    if (typeof WebGL2RenderingContext !== 'undefined') {
                        const getParameter2 = WebGL2RenderingContext.prototype.getParameter
                        WebGL2RenderingContext.prototype.getParameter = function (param) {
                            if (param === 0x9245) return selectedVendor
                            if (param === 0x9246) return selectedRenderer
                            return getParameter2.call(this, param)
                        }
                    }
                }

                const applyAudioNoise = () => {
                    if (typeof AudioContext !== 'undefined') {
                        const originalCreateOscillator = AudioContext.prototype.createOscillator
                        AudioContext.prototype.createOscillator = function () {
                            const oscillator = originalCreateOscillator.call(this)
                            const originalStart = oscillator.start
                            oscillator.start = function (...args) {
                                oscillator.frequency.value += seededRandom(20) * 0.001
                                return originalStart.apply(this, args)
                            }
                            return oscillator
                        }
                    }
                }

                evadeWebDriver()
                evadeDevToolsDetection()
                patchPermissions()
                patchIframeAccess()

                if (!trustFp) {
                    patchNavigator()
                    spoofPlugins()
                    applyCanvasNoise()
                    applyWebGLNoise()
                    try {
                        applyAudioNoise()
                    } catch {}
                }
            },
            {
                trustFp: trustInjectedFingerprint,
                mobile: isMobile,
                langs: languages,
                noiseSeed: seed
            }
        )
    }

    private static hashSeed(input: string): number {
        let hash = 0
        for (let i = 0; i < input.length; i++) {
            hash = (hash << 5) - hash + input.charCodeAt(i)
            hash |= 0
        }
        return Math.abs(hash)
    }

    private static buildLanguages(langCode: string): string[] {
        const code = (langCode || 'en').toLowerCase()
        if (code === 'en') return ['en-US', 'en']
        if (code.includes('-')) return [code, code.split('-')[0] ?? code, 'en']
        return [`${code}-${code.toUpperCase()}`, code, 'en']
    }

    static async applyCanvasNoise(_page: Page): Promise<void> {}
    static async applyWebGLNoise(_page: Page): Promise<void> {}
    static async applyAudioNoise(_page: Page): Promise<void> {}
}
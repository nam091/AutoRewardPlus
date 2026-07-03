import type { Page } from 'patchright'

/**
 * Anti-detection engine for browser automation.
 * Patches various browser APIs to avoid bot detection.
 */
export class AntiDetectionEngine {

    /**
     * Apply all anti-detection patches to a browser context.
     * Call this after creating a new context.
     */
    static async applyAll(context: any): Promise<void> {
        await context.addInitScript(() => {
            // 1. WebDriver detection evasion
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

            // 2. Navigator property patches
            const patchNavigator = () => {
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en', 'vi'],
                    configurable: true
                })

                const cores = [4, 8, 12, 16]
                const selectedCores = cores[Math.floor(Math.random() * cores.length)] || 8
                Object.defineProperty(navigator, 'hardwareConcurrency', {
                    get: () => selectedCores,
                    configurable: true
                })

                const memoryOptions = [4, 8, 16]
                const selectedMemory = memoryOptions[Math.floor(Math.random() * memoryOptions.length)] || 8
                Object.defineProperty(navigator, 'deviceMemory', {
                    get: () => selectedMemory,
                    configurable: true
                })

                Object.defineProperty(navigator, 'maxTouchPoints', {
                    get: () => 0,
                    configurable: true
                })

                if ((navigator as any).connection) {
                    Object.defineProperty((navigator as any).connection, 'rtt', {
                        get: () => 50 + Math.floor(Math.random() * 100),
                        configurable: true
                    })
                }
            }

            // 3. Plugin/MimeType spoofing
            const spoofPlugins = () => {
                const pluginData = [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                ]

                const plugins = pluginData.map(p => {
                    const plugin = {
                        name: p.name,
                        filename: p.filename,
                        description: p.description,
                        length: 1,
                        item: () => null,
                        namedItem: () => null,
                        [Symbol.iterator]: function* () { yield* [] }
                    }
                    return plugin
                })

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

            // 4. Chrome DevTools protocol detection evasion
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

            // 5. Permission API patch
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

            // 6. iframe contentWindow patch
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

            // 7. Canvas fingerprint noise
            const applyCanvasNoise = () => {
                const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
                const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData

                const addNoise = (imageData: ImageData): ImageData => {
                    const data = imageData.data
                    for (let i = 0; i < data.length; i += 4) {
                        const noise = Math.random() < 0.1 ? (Math.random() < 0.5 ? 1 : -1) : 0
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

            // 8. WebGL vendor/renderer spoofing
            const applyWebGLNoise = () => {
                const commonVendors = [
                    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
                    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
                    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' }
                ]

                const selected = (commonVendors[Math.floor(Math.random() * commonVendors.length)] || commonVendors[0]) as { vendor: string; renderer: string }

                const getParameter = WebGLRenderingContext.prototype.getParameter
                WebGLRenderingContext.prototype.getParameter = function (param) {
                    if (param === 0x9245) return selected.vendor
                    if (param === 0x9246) return selected.renderer
                    return getParameter.call(this, param)
                }

                if (typeof WebGL2RenderingContext !== 'undefined') {
                    const getParameter2 = WebGL2RenderingContext.prototype.getParameter
                    WebGL2RenderingContext.prototype.getParameter = function (param) {
                        if (param === 0x9245) return selected.vendor
                        if (param === 0x9246) return selected.renderer
                        return getParameter2.call(this, param)
                    }
                }
            }

            // 9. Audio context fingerprint noise
            const applyAudioNoise = () => {
                if (typeof AudioContext !== 'undefined') {
                    const originalCreateOscillator = AudioContext.prototype.createOscillator
                    AudioContext.prototype.createOscillator = function () {
                        const oscillator = originalCreateOscillator.call(this)
                        const originalStart = oscillator.start
                        oscillator.start = function (...args) {
                            oscillator.frequency.value += Math.random() * 0.001
                            return originalStart.apply(this, args)
                        }
                        return oscillator
                    }
                }
            }

            // Execute all evasions and fingerprint spoofing inside page context
            evadeWebDriver()
            patchNavigator()
            spoofPlugins()
            evadeDevToolsDetection()
            patchPermissions()
            patchIframeAccess()
            applyCanvasNoise()
            applyWebGLNoise()
            try {
                applyAudioNoise()
            } catch {}
        })
    }

    // Keep empty functions for backwards compatibility if needed
    static async applyCanvasNoise(page: Page): Promise<void> {}
    static async applyWebGLNoise(page: Page): Promise<void> {}
    static async applyAudioNoise(page: Page): Promise<void> {}
}

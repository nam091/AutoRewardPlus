import fs from 'fs/promises'
import path from 'path'
import type { Page } from 'patchright'

/**
 * Captures the page when a UI selector fails to match.
 *
 * Modern-UI work is DOM scraping against markup Microsoft controls, so the
 * usual failure is "section not found" with nothing to inspect afterwards.
 * Saving the HTML and a screenshot makes those failures diagnosable without
 * having to reproduce the run interactively.
 */
export async function uiDiagnostic(page: Page, label: string, details: string): Promise<string | null> {
    try {
        if (!page || page.isClosed()) {
            return null
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()
        const outputDir = path.join(process.cwd(), 'diagnostics', 'modern-ui', `${safeLabel}-${timestamp}`)

        const report = [
            `Label: ${label}`,
            `Details: ${details}`,
            `URL: ${page.url()}`,
            `Timestamp: ${new Date().toISOString()}`
        ].join('\n')

        const [htmlContent, screenshotBuffer] = await Promise.all([
            page.content(),
            page.screenshot({ fullPage: true, type: 'png' }).catch(() => null)
        ])

        await fs.mkdir(outputDir, { recursive: true })

        await Promise.all([
            fs.writeFile(path.join(outputDir, 'dump.html'), htmlContent),
            fs.writeFile(path.join(outputDir, 'context.txt'), report),
            screenshotBuffer
                ? fs.writeFile(path.join(outputDir, 'screenshot.png'), screenshotBuffer)
                : Promise.resolve()
        ])

        return outputDir
    } catch {
        return null
    }
}

export async function errorDiagnostic(page: Page, error: Error): Promise<void> {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const folderName = `error-${timestamp}`
        const outputDir = path.join(process.cwd(), 'diagnostics', folderName)

        if (!page) {
            return
        }

        if (page.isClosed()) {
            return
        }

        // Error log content
        const errorLog = `
Name: ${error.name}
Message: ${error.message}
Timestamp: ${new Date().toISOString()}
---------------------------------------------------
Stack Trace:
${error.stack || 'No stack trace available'}
        `.trim()

        const [htmlContent, screenshotBuffer] = await Promise.all([
            page.content(),
            page.screenshot({ fullPage: true, type: 'png' })
        ])

        await fs.mkdir(outputDir, { recursive: true })

        await Promise.all([
            fs.writeFile(path.join(outputDir, 'dump.html'), htmlContent),
            fs.writeFile(path.join(outputDir, 'screenshot.png'), screenshotBuffer),
            fs.writeFile(path.join(outputDir, 'error.txt'), errorLog)
        ])

        console.log(`Diagnostics saved to: ${outputDir}`)
    } catch (error) {
        console.error('Unable to create error diagnostics:', error)
    }
}

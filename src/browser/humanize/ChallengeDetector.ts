import type { Page } from 'patchright'

const CHALLENGE_URL_PATTERNS = [
    /captcha/i,
    /challenge/i,
    /identity\/confirm/i,
    /account\.live\.com\/Abuse/i,
    /account\.live\.com\/proofs/i,
    /arkoselabs/i,
    /funcaptcha/i,
    /recaptcha/i,
    /hcaptcha/i,
    /enforcement/i
]

const CHALLENGE_SELECTORS = [
    'iframe[src*="captcha"]',
    'iframe[src*="arkoselabs"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '#enforcementContainer',
    '#hipTemplateContainer',
    '[data-testid="captcha"]',
    'div[role="alert"]:has-text("verify")',
    '#serviceAbuseLandingTitle'
]

export interface ChallengeDetectionResult {
    detected: boolean
    reason?: string
}

/**
 * Detect captcha, abuse, or identity challenge pages during automation.
 */
export async function detectChallenge(page: Page): Promise<ChallengeDetectionResult> {
    if (page.isClosed()) {
        return { detected: false }
    }

    const url = page.url()
    for (const pattern of CHALLENGE_URL_PATTERNS) {
        if (pattern.test(url)) {
            return { detected: true, reason: `URL match: ${pattern.source}` }
        }
    }

    for (const selector of CHALLENGE_SELECTORS) {
        const visible = await page.locator(selector).first().isVisible().catch(() => false)
        if (visible) {
            return { detected: true, reason: `DOM match: ${selector}` }
        }
    }

    const title = await page.title().catch(() => '')
    if (/verify|challenge|captcha|locked/i.test(title)) {
        return { detected: true, reason: `Page title: ${title}` }
    }

    return { detected: false }
}
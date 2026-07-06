import type { Page } from 'patchright'

import type { MicrosoftRewardsBot } from '../../index'
import { HumanizeEngine } from '../../browser/humanize/HumanizeEngine'

export async function humanPause(bot: MicrosoftRewardsBot, minMs = 1000, maxMs = 3000): Promise<void> {
    const mult = HumanizeEngine.getTimeOfDayMultiplier()
    await bot.utils.wait(
        bot.utils.exponentialDelay(Math.floor(minMs * mult), Math.floor(maxMs * mult))
    )
}

export async function humanClickInSection(
    page: Page,
    heading: string,
    cardIndex: number,
    linkSelector = 'a[target="_blank"]'
): Promise<boolean> {
    const box = await page.evaluate(
        ({ sectionHeading, index, selector }) => {
            const headings = document.querySelectorAll('h2, h3')
            for (const h of headings) {
                if (h.textContent?.trim()?.startsWith(sectionHeading)) {
                    const section = h.closest('section') || h.parentElement?.parentElement
                    if (section) {
                        const target = section.querySelectorAll(selector)[index] as HTMLElement | undefined
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            const rect = target.getBoundingClientRect()
                            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                        }
                    }
                    break
                }
            }
            return null
        },
        { sectionHeading: heading, index: cardIndex, selector: linkSelector }
    )

    if (!box || box.width <= 0 || box.height <= 0) {
        return false
    }

    await page.waitForTimeout(500)
    await HumanizeEngine.humanClickBox(page, box)
    return true
}

export async function humanExpandSection(page: Page, sectionHeading: string): Promise<'expanded' | 'already-expanded' | 'not-found'> {
    const button = page
        .locator('section')
        .filter({ has: page.locator('h2, h3', { hasText: new RegExp(`^${sectionHeading}`) }) })
        .locator('button[aria-expanded="false"], button[slot="trigger"]')
        .first()

    const visible = await button.isVisible().catch(() => false)
    if (visible) {
        await HumanizeEngine.humanClickLocator(page, button)
        return 'expanded'
    }

    const alreadyExpanded = await page
        .locator('section')
        .filter({ has: page.locator('h2, h3', { hasText: new RegExp(`^${sectionHeading}`) }) })
        .locator('button[aria-expanded="true"]')
        .first()
        .isVisible()
        .catch(() => false)

    return alreadyExpanded ? 'already-expanded' : 'not-found'
}

export async function humanClickMissionTarget(page: Page, mission: { title: string; href: string }): Promise<boolean> {
    const box = await page.evaluate((m: { title: string; href: string }) => {
        const elements = document.querySelectorAll('a[href], [role="link"], div[class*="Card"], li')
        for (const el of elements) {
            const fullText = el.textContent?.trim() || ''
            if (!/\d+\/\d+\s*(?:tasks?|nhiệm\s*vụ|nv)/i.test(fullText)) continue

            const anchor = el.tagName === 'A' ? (el as HTMLAnchorElement) : el.querySelector('a[href]')
            const href = anchor ? (anchor as HTMLAnchorElement).href : el.getAttribute('href') || ''
            if ((m.href && href === m.href) || fullText.includes(m.title)) {
                const target = (anchor || el) as HTMLElement
                target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                const rect = target.getBoundingClientRect()
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            }
        }
        return null
    }, mission)

    if (!box || box.width <= 0) return false
    await page.waitForTimeout(400)
    await HumanizeEngine.humanClickBox(page, box)
    return true
}

export async function humanClickSubTaskByIndex(page: Page, taskIndex: number): Promise<boolean> {
    const box = await page.evaluate((idx: number) => {
        const allLinks = document.querySelectorAll('a[href], button, [role="link"], div[class*="cursor-pointer"]')
        const seen = new Set<string>()
        let logicalIndex = 0

        for (const link of allLinks) {
            const el = link as HTMLElement
            const fullText = el.textContent?.trim() || ''

            if (el.getAttribute('aria-disabled') === 'true') continue
            if (el.getAttribute('data-disabled') === 'true') continue
            if (el.closest('[aria-disabled="true"], [data-disabled="true"]')) continue
            if (fullText.includes('Completed') || fullText.includes('Hoàn thành')) continue

            const parentRow = el.closest('div, li, article')
            if (parentRow?.querySelector('[class*="bg-statusSuccessRewardsBg"]')) continue
            if (el.closest('header, footer, nav, [role="banner"], [role="navigation"]')) continue

            const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href : el.getAttribute('href') || ''
            if (href) {
                try {
                    const path = new URL(href, window.location.origin).pathname
                    if (path === '/earn' || path === '/earn/' || path === '/dashboard' || path === '/dashboard/') continue
                } catch {}
            }

            if (fullText.length < 2) continue

            const dedupeKey = href || fullText.substring(0, 40)
            if (seen.has(dedupeKey)) continue
            seen.add(dedupeKey)

            if (logicalIndex === idx) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                const rect = el.getBoundingClientRect()
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            }
            logicalIndex++
        }
        return null
    }, taskIndex)

    if (!box || box.width <= 0) return false
    await page.waitForTimeout(400)
    await HumanizeEngine.humanClickBox(page, box)
    return true
}

export async function humanClickClaimCard(page: Page, points: number): Promise<boolean> {
    const box = await page.evaluate((targetPoints: number) => {
        const cards = document.querySelectorAll('div[class*="bg-bgCardOnPrimaryDefaultRest"]')
        for (const card of cards) {
            const fullText = card.textContent?.trim() || ''
            if (!fullText.includes('Ready to claim')) continue

            const pointsEl = card.querySelector('p[class*="text-pageHeader"]')
            if (!pointsEl) continue

            const cardPoints = parseInt(pointsEl.textContent?.trim() || '')
            if (cardPoints === targetPoints) {
                const rect = (card as HTMLElement).getBoundingClientRect()
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            }
        }
        return null
    }, points)

    if (!box || box.width <= 0) return false
    await HumanizeEngine.humanClickBox(page, box)
    return true
}
const NEW_ACCOUNT_MAX_DAYS = 90

export function calculateAccountAge(created?: string | Date): string {
    if (!created) return 'N/A'
    const createdDate = new Date(created)
    if (isNaN(createdDate.getTime())) return 'N/A'
    const diffDays = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return 'N/A'
    if (diffDays < 30) return `${diffDays}d`
    const months = Math.floor(diffDays / 30.4375)
    if (months < 12) return `${months}m (${diffDays}d)`
    const years = (diffDays / 365.25).toFixed(1)
    return `${years}y (${diffDays}d)`
}

/** Returns exact whole days since account creation, or null when missing/invalid/future. */
export function calculateAccountAgeDays(created?: string | Date): number | null {
    if (!created) return null
    if (typeof created === 'string' && !created.trim()) return null
    const createdDate = new Date(created)
    if (isNaN(createdDate.getTime())) return null
    const diffDays = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24))
    return diffDays < 0 ? null : diffDays
}

/** Parses formatted age labels such as `'22d'`, `'2m (65d)'`, `'2.0y (731d)'`, or `'6m'` into whole days. */
export function parseAccountAgeDays(ageLabel?: string): number | null {
    if (!ageLabel) return null
    const trimmed = ageLabel.trim()
    if (!trimmed || /^n\/a$/i.test(trimmed)) return null

    const parenDays = trimmed.match(/\((\d+)\s*d\)/i)
    if (parenDays?.[1]) {
        return Number.parseInt(parenDays[1], 10)
    }

    const directDays = trimmed.match(/^(\d+)\s*d$/i)
    if (directDays?.[1]) {
        return Number.parseInt(directDays[1], 10)
    }

    const monthsMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*m(?:\b|$)/i)
    if (monthsMatch?.[1]) {
        return Math.floor(Number.parseFloat(monthsMatch[1]) * 30)
    }

    const yearsMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*y(?:\b|$)/i)
    if (yearsMatch?.[1]) {
        return Math.floor(Number.parseFloat(yearsMatch[1]) * 365)
    }

    return null
}

/** Evaluates whether an account is under 3 months (< 90 days) old from a Date, ISO string, or age label. */
export function isNewAccountAge(createdOrLabel?: string | Date): boolean | null {
    if (!createdOrLabel) return null
    if (createdOrLabel instanceof Date) {
        const days = calculateAccountAgeDays(createdOrLabel)
        return days === null ? null : days < NEW_ACCOUNT_MAX_DAYS
    }

    const trimmed = createdOrLabel.trim()
    if (!trimmed || /^n\/a$/i.test(trimmed)) return null

    const parsedDays = parseAccountAgeDays(trimmed)
    if (parsedDays !== null) {
        return parsedDays < NEW_ACCOUNT_MAX_DAYS
    }

    if (trimmed.length >= 4 && /[-/T]/.test(trimmed)) {
        const days = calculateAccountAgeDays(trimmed)
        return days === null ? null : days < NEW_ACCOUNT_MAX_DAYS
    }

    return null
}

/** Splits and trims a comma-separated tag string while deduplicating case-insensitively. */
export function parseTags(tag?: string): string[] {
    if (!tag) return []
    const seen = new Set<string>()
    const result: string[] = []

    for (const part of tag.split(',')) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push(trimmed)
    }

    return result
}

/** Checks whether a comma-separated tag string includes `target` (case-insensitive). */
export function hasTag(tag: string | undefined, target: string): boolean {
    const needle = target.trim().toLowerCase()
    if (!needle) return false
    return parseTags(tag).some(t => t.toLowerCase() === needle)
}

/** Appends `target` to a comma-separated tag string if not already present. */
export function addTag(tag: string | undefined, target: string): string {
    const cleanTarget = target.trim()
    const tags = parseTags(tag)
    if (!cleanTarget) return tags.join(', ')
    if (tags.some(t => t.toLowerCase() === cleanTarget.toLowerCase())) {
        return tags.join(', ')
    }
    return [...tags, cleanTarget].join(', ')
}

/** Removes `target` (case-insensitive) from a comma-separated tag string. */
export function removeTag(tag: string | undefined, target: string): string {
    const needle = target.trim().toLowerCase()
    const tags = parseTags(tag)
    if (!needle) return tags.join(', ')
    return tags.filter(t => t.toLowerCase() !== needle).join(', ')
}

/** Synchronizes the `'new'` tag based on age classification (`true` adds, `false` removes, `null` leaves untouched). */
export function syncNewTagByAge(tag: string | undefined, isNew: boolean | null): { tag: string; changed: boolean } {
    const normalizedCurrent = tag?.trim() || ''
    if (isNew === null) {
        return { tag: normalizedCurrent, changed: false }
    }

    const currentlyHasNew = hasTag(normalizedCurrent, 'new')
    if (isNew) {
        if (currentlyHasNew) {
            return { tag: normalizedCurrent, changed: false }
        }
        return { tag: addTag(normalizedCurrent, 'new'), changed: true }
    }

    if (!currentlyHasNew) {
        return { tag: normalizedCurrent, changed: false }
    }
    return { tag: removeTag(normalizedCurrent, 'new'), changed: true }
}

/** Returns true only when `userStatus` explicitly confirms zero lifetime redemptions and no last order. */
export function hasZeroRedemptionEvidence(
    userStatus?: { lifetimePointsRedeemed?: number; lastOrder?: unknown } | null
): boolean {
    return (
        typeof userStatus?.lifetimePointsRedeemed === 'number' &&
        userStatus.lifetimePointsRedeemed === 0 &&
        !userStatus.lastOrder
    )
}

function parseIntegerCount(raw: string): number | null {
    const digits = raw.replace(/[,.]/g, '')
    if (!digits) return null
    const parsed = Number.parseInt(digits, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Extracts total redemption order count from `/redeem/orderhistory` page text, or null if unrecognizable. */
export function parseOrderHistoryText(text: string): number | null {
    if (!text || typeof text !== 'string') return null
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return null

    const countPatterns: RegExp[] = [
        /your\s+orders?\s+(\d[\d,.]*)\s+results?/i,
        /đơn\s+hàng[^\d]{0,30}(\d[\d,.]*)\s+(?:kết\s*quả|đơn)/i,
        /(?:showing|hiển\s+thị)[^\d]{0,30}\d+\s*[-–]\s*\d+\s+(?:of|của)\s+(\d[\d,.]*)/i,
        /(?:^|[\s(])(\d[\d,.]*)\s+(?:results?|orders?|kết\s*quả)(?=$|[\s.,;:!?)])/i
    ]

    for (const pattern of countPatterns) {
        const match = normalized.match(pattern)
        if (match?.[1]) {
            const parsed = parseIntegerCount(match[1])
            if (parsed !== null) return parsed
        }
    }

    if (
        /(?:no\s+orders(?:\s+found|\s+yet)?|haven't\s+placed\s+any\s+orders|have\s+not\s+placed\s+any\s+orders|don't\s+have\s+any\s+orders|chưa\s+có\s+đơn\s+hàng|không\s+có\s+đơn\s+hàng)/i.test(
            normalized
        )
    ) {
        return 0
    }

    const rowMatches = normalized.match(/(?:order\s+no\.|mã\s+đơn\s+hàng)/gi)
    if (rowMatches && rowMatches.length > 0) {
        return rowMatches.length
    }

    return null
}

export function extractStreak(data?: any): string {
    if (!data) return '0'
    const promoProgress = data.streakPromotion?.attributes?.activity_progress
    if (promoProgress && promoProgress !== '0') return String(promoProgress)

    const protectionCount = data.streakProtectionPromo?.streakCount
    if (protectionCount && protectionCount !== '0') return String(protectionCount)

    const levelStreak = data.userStatus?.levelInfo?.levelUpActivityDailySetStreakDays
    if (levelStreak) return String(levelStreak)

    if (Array.isArray(data.streakBonusPromotions) && data.streakBonusPromotions.length > 0) {
        const bonusStreak = data.streakBonusPromotions[0]?.attributes?.activity_progress
        if (bonusStreak) return String(bonusStreak)
    }

    return promoProgress || protectionCount || '0'
}

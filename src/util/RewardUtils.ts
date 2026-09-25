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

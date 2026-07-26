/**
 * Selector profile for the modern Microsoft Rewards UI (April 2026+).
 *
 * Everything the modern-UI workers rely on to find things in the page lives
 * here rather than being spread across `page.evaluate` bodies. Two problems
 * this addresses:
 *
 *  1. Section lookup used to match a single hardcoded English heading, so an
 *     account rendering the UI in another language (accounts commonly run with
 *     a non-US `geoLocale`) silently found nothing.
 *  2. Class-name and structural selectors were inlined per call site, so when
 *     Microsoft changes markup the fix had to be applied in several places.
 *
 * These objects are passed into `page.evaluate` as arguments, so they must stay
 * plain serializable data — no functions, no regexes.
 */

export interface SectionProfile {
    /** Stable identifier used in logs and diagnostics. */
    key: string
    /** Human-readable name for log output. */
    label: string
    /**
     * `section` element ids observed on the live site. These are not localized,
     * so they are tried before heading text. Note the page renders more than one
     * element per id (a visible copy and a hidden one), so a resolver must
     * consider every match rather than the first.
     */
    ids: string[]
    /**
     * Lowercased heading prefixes, one per supported locale. A heading matches
     * when it starts with any entry. Used when no id matches.
     */
    headings: string[]
}

export const SECTIONS = {
    yourProgress: {
        key: 'yourProgress',
        label: 'Your progress',
        ids: ['yourprogress', 'progress'],
        headings: ['your progress', 'tiến trình của bạn', 'tiến độ của bạn', 'tiến trình', 'tiến độ']
    },
    dailySet: {
        key: 'dailySet',
        label: 'Daily set',
        ids: ['dailyset'],
        headings: ['daily set', 'chuỗi hoạt động hằng ngày', 'nhiệm vụ hằng ngày', 'hoạt động hằng ngày', 'hằng ngày']
    },
    keepEarning: {
        key: 'keepEarning',
        label: 'Keep earning',
        ids: ['moreactivities'],
        headings: ['keep earning', 'tiếp tục kiếm điểm', 'tiếp tục kiếm', 'kiếm thêm điểm', 'kiếm thêm']
    },
    quests: {
        key: 'quests',
        label: 'Quests',
        ids: ['quests'],
        headings: ['quests', 'quest', 'nhiệm vụ', 'thử thách']
    },
    levelUp: {
        key: 'levelUp',
        label: 'Level up activities',
        ids: ['levelup'],
        headings: ['level up', 'nâng cấp', 'thăng hạng']
    }
} as const satisfies Record<string, SectionProfile>

/**
 * Ordered fallback chain for locating clickable task cards inside a section.
 * Tried in order; the first selector returning matches wins.
 */
export const CARD_LINK_SELECTORS = [
    'a[target="_blank"]',
    'a[href][role="link"]',
    'a[href*="/earn/"]',
    'a[href^="http"]'
] as const

/** Fallback chain for a card's title element. */
export const TITLE_SELECTORS = [
    'p[class*="Body2Strong"]',
    'p[class*="body2Strong"]',
    '[class*="globalBody2Strong"]',
    'h3',
    'h4',
    '[class*="title"]'
] as const

/** Fallback chain for a card's short description. */
export const DESCRIPTION_SELECTORS = [
    'p[class*="Secondary"]',
    'p[class*="secondary"]',
    '[class*="description"]'
] as const

/**
 * Elements that carry a card's point value.
 *
 * The value is not always prefixed with `+`: on `/earn` cards render `+5`, but
 * on `/dashboard` the same figure renders as a bare `10` inside
 * `p.text-metadata.text-fgCtrlOnImage`. Requiring the `+` meant daily set cards
 * were parsed with no point value and then filtered out as "not earnable", so
 * the daily set worker clicked nothing at all.
 */
export const POINTS_BADGE_SELECTORS = [
    'p[class*="statusInformativeTintFg"]',
    'p[class*="text-metadata"]',
    'span[class*="metadata"]',
    '[class*="badge"]'
] as const

/** Upper bound for a per-card point value; guards against matching unrelated numbers. */
export const MAX_CARD_POINTS = 500

/** Markers indicating a card has already been completed. */
export const COMPLETED_BADGE_SELECTORS = [
    '[class*="statusSuccessRewards"]',
    '[class*="StatusSuccess"]',
    '[class*="statusSuccess"]'
] as const

/** Lowercased text markers meaning "already completed", per locale. */
export const COMPLETED_TEXTS = ['completed', 'complete', 'đã hoàn thành', 'hoàn thành', 'hoàn tất'] as const

/** Lowercased text markers meaning "locked / not eligible", per locale. */
export const LOCKED_TEXTS = [
    'level required',
    'locked',
    'yêu cầu cấp',
    'yêu cầu hạng',
    'đã khoá',
    'đã khóa',
    'bị khoá',
    'bị khóa'
] as const

/**
 * Fallback chain for section expand/collapse triggers.
 *
 * `button[slot="trigger"]` comes first deliberately. A section also contains an
 * info popover button (`aria-label="About <section>"`) that carries
 * `aria-expanded="false"`; matching the generic attribute selector first
 * selected that button and opened a tooltip instead of expanding the section.
 */
export const EXPAND_TRIGGER_SELECTORS = [
    'button[slot="trigger"]',
    '[data-rac] > div > div > button[aria-expanded]',
    'button[aria-expanded]',
    '[role="button"][aria-expanded]'
] as const

/**
 * Lowercased `aria-label` prefixes belonging to informational popovers rather
 * than to the section disclosure. Buttons matching these are never treated as
 * expand triggers.
 */
export const INFO_BUTTON_LABEL_PREFIXES = ['about ', 'thông tin về ', 'giới thiệu về '] as const

/**
 * Markers for placeholder content rendered while a section loads. Cards must not
 * be read while any of these are present, otherwise the section looks empty and
 * its tasks are silently skipped.
 */
export const SKELETON_SELECTORS = [
    '[class*="skeleton"]',
    '[class*="Skeleton"]',
    '[class*="animate-pulse"]',
    '[aria-busy="true"]'
] as const

/** Fallback chain for elements that behave as mission/quest cards. */
export const MISSION_CARD_SELECTORS = [
    'a[href*="/earn/quest/"]',
    'a[href*="/quest"]',
    'a[href]',
    '[role="link"]',
    'div[class*="Card"]',
    'div[class*="cursor-pointer"]',
    'li'
] as const

/** Fallback chain for sub-task rows on a mission detail page. */
export const MISSION_TASK_SELECTORS = ['a[href]', 'button', '[role="link"]', 'div[class*="cursor-pointer"]'] as const

/** Fallback chain for the "Ready to claim" card container. */
export const CLAIM_CARD_SELECTORS = [
    'div[class*="bg-bgCardOnPrimaryDefaultRest"]',
    'div[class*="bgCardOnPrimary"]',
    'section div[class*="Card"]'
] as const

/** Fallback chain for the points figure inside a claim card. */
export const CLAIM_POINTS_SELECTORS = ['p[class*="text-pageHeader"]', 'p[class*="pageHeader"]', 'h2', 'h3'] as const

/** Lowercased text markers for a claimable points card, per locale. */
export const CLAIM_READY_TEXTS = ['ready to claim', 'sẵn sàng nhận', 'sẵn sàng để nhận', 'chờ nhận'] as const

/** Lowercased labels for the confirm button in the claim flyout, per locale. */
export const CLAIM_BUTTON_TEXTS = ['claim points', 'claim', 'nhận điểm', 'nhận'] as const

/**
 * Everything a `page.evaluate` body needs, bundled for a single serializable
 * argument. Regex sources are passed as strings and rebuilt inside the page.
 */
export interface EvaluateProfile {
    cardLinkSelectors: string[]
    titleSelectors: string[]
    descriptionSelectors: string[]
    completedBadgeSelectors: string[]
    completedTexts: string[]
    lockedTexts: string[]
    expandTriggerSelectors: string[]
    missionCardSelectors: string[]
    missionTaskSelectors: string[]
    claimCardSelectors: string[]
    claimPointsSelectors: string[]
    claimReadyTexts: string[]
    pointsBadgeSelectors: string[]
    skeletonSelectors: string[]
    infoButtonLabelPrefixes: string[]
    maxCardPoints: number
    /** Source for the "N/M tasks" pattern, multi-locale. */
    taskCountPattern: string
    /** Source for the "earn N points" description pattern, multi-locale. */
    earnPointsPattern: string
    /** Source for the bare "N points" pattern, multi-locale. */
    barePointsPattern: string
}

export const TASK_COUNT_PATTERN = '(\\d+)\\s*\\/\\s*(\\d+)\\s*(?:tasks?|nhiệm\\s*vụ|nv|hoạt\\s*động)'
export const EARN_POINTS_PATTERN =
    '(?:earn|pick\\s*up|get|collect|nhận|kiếm|thu\\s*thập)\\s+(\\d+)\\s+(?:bonus\\s+)?(?:rewards\\s+)?(?:points?|điểm)'
export const BARE_POINTS_PATTERN = '(\\d+)\\s+(?:points?|điểm)\\b'

export function buildEvaluateProfile(): EvaluateProfile {
    return {
        cardLinkSelectors: [...CARD_LINK_SELECTORS],
        titleSelectors: [...TITLE_SELECTORS],
        descriptionSelectors: [...DESCRIPTION_SELECTORS],
        completedBadgeSelectors: [...COMPLETED_BADGE_SELECTORS],
        completedTexts: [...COMPLETED_TEXTS],
        lockedTexts: [...LOCKED_TEXTS],
        expandTriggerSelectors: [...EXPAND_TRIGGER_SELECTORS],
        missionCardSelectors: [...MISSION_CARD_SELECTORS],
        missionTaskSelectors: [...MISSION_TASK_SELECTORS],
        claimCardSelectors: [...CLAIM_CARD_SELECTORS],
        claimPointsSelectors: [...CLAIM_POINTS_SELECTORS],
        claimReadyTexts: [...CLAIM_READY_TEXTS],
        pointsBadgeSelectors: [...POINTS_BADGE_SELECTORS],
        skeletonSelectors: [...SKELETON_SELECTORS],
        infoButtonLabelPrefixes: [...INFO_BUTTON_LABEL_PREFIXES],
        maxCardPoints: MAX_CARD_POINTS,
        taskCountPattern: TASK_COUNT_PATTERN,
        earnPointsPattern: EARN_POINTS_PATTERN,
        barePointsPattern: BARE_POINTS_PATTERN
    }
}

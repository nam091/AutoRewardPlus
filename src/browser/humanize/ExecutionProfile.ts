import ms, { StringValue } from 'ms'

import type { Config, ConfigDelay, ConfigProfileSettings, ExecutionMode } from '../../interface/Config'
import { hasTag } from '../../util/RewardUtils'
import type { SeededRandom } from './SeededRandom'

export interface ResolvedExecutionProfile {
    mode: ExecutionMode
    isNewTag: boolean
    redemptionCount: number
    searchDelay: { minMs: number; maxMs: number }
    readDelay: { minMs: number; maxMs: number }
    searchTargetRatio: number
    readArticlesTarget: number
    readFractionMin: number
    readFractionMax: number
    interactionWeights: { read: number; scroll: number; click: number }
    typingMultiplier: number
    waitMultiplier: number
    resultVisitMultiplier: number
    extraSearchVerifyRounds: number
    thoroughTasks: boolean
}

interface ModeDefaults {
    searchDelay: { minMs: number; maxMs: number }
    readDelay: { minMs: number; maxMs: number }
    searchTargetRatioMin: number
    searchTargetRatioMax: number
    readArticlesMin: number
    readArticlesMax: number
    readFractionMin: number
    readFractionMax: number
    interactionWeights: { read: number; scroll: number; click: number }
    typingMultiplier: number
    waitMultiplier: number
    resultVisitMultiplier: number
    extraSearchVerifyRounds: number
    thoroughTasks: boolean
}

const MODE_DEFAULTS: Record<ExecutionMode, ModeDefaults> = {
    safe: {
        searchDelay: { minMs: 22000, maxMs: 45000 },
        readDelay: { minMs: 20000, maxMs: 40000 },
        searchTargetRatioMin: 0.7,
        searchTargetRatioMax: 0.85,
        readArticlesMin: 7,
        readArticlesMax: 10,
        readFractionMin: 0.65,
        readFractionMax: 1.0,
        interactionWeights: { read: 4, scroll: 4, click: 3 },
        typingMultiplier: 1.2,
        waitMultiplier: 1.25,
        resultVisitMultiplier: 1.35,
        extraSearchVerifyRounds: 0,
        thoroughTasks: false
    },
    standard: {
        searchDelay: { minMs: 30000, maxMs: 60000 },
        readDelay: { minMs: 30000, maxMs: 60000 },
        searchTargetRatioMin: 1.0,
        searchTargetRatioMax: 1.0,
        readArticlesMin: 10,
        readArticlesMax: 10,
        readFractionMin: 0.3,
        readFractionMax: 0.7,
        interactionWeights: { read: 5, scroll: 3, click: 2 },
        typingMultiplier: 1.0,
        waitMultiplier: 1.0,
        resultVisitMultiplier: 1.0,
        extraSearchVerifyRounds: 0,
        thoroughTasks: false
    },
    fast: {
        searchDelay: { minMs: 6000, maxMs: 12000 },
        readDelay: { minMs: 5000, maxMs: 10000 },
        searchTargetRatioMin: 1.0,
        searchTargetRatioMax: 1.0,
        readArticlesMin: 10,
        readArticlesMax: 10,
        readFractionMin: 0.25,
        readFractionMax: 0.55,
        interactionWeights: { read: 6, scroll: 2, click: 2 },
        typingMultiplier: 0.6,
        waitMultiplier: 0.6,
        resultVisitMultiplier: 0.65,
        extraSearchVerifyRounds: 2,
        thoroughTasks: true
    }
}

/** Parses a numeric millisecond value or `ms`-formatted duration string, returning `fallbackMs` on invalid input. */
export function toMs(value: number | string | undefined, fallbackMs: number): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : fallbackMs
    }
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return fallbackMs
        try {
            const parsed = ms(trimmed as StringValue)
            return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackMs
        } catch {
            return fallbackMs
        }
    }
    return fallbackMs
}

function resolveDelayRange(
    delay: ConfigDelay | undefined,
    fallback: { minMs: number; maxMs: number }
): { minMs: number; maxMs: number } {
    const minMs = toMs(delay?.min, fallback.minMs)
    const maxMs = Math.max(minMs, toMs(delay?.max, fallback.maxMs))
    return { minMs, maxMs }
}

function resolveOrderedPair(minVal: number, maxVal: number): [number, number] {
    return minVal <= maxVal ? [minVal, maxVal] : [maxVal, minVal]
}

/**
 * Resolves the execution profile (`safe`, `standard`, or `fast`) for an account.
 * Accounts tagged `'new'` always resolve to `'safe'` regardless of redemption history.
 */
export function resolveExecutionProfile(params: {
    tag?: string
    redemptionCount?: number | null
    config?: Config
    random?: SeededRandom
}): ResolvedExecutionProfile {
    const isNewTag = hasTag(params.tag, 'new')
    const rawCount = params.redemptionCount
    const redemptionCount =
        typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount >= 0 ? Math.trunc(rawCount) : 0

    const mode: ExecutionMode = isNewTag ? 'safe' : redemptionCount >= 6 ? 'fast' : 'standard'
    const defaults = MODE_DEFAULTS[mode]
    const profileCfg: ConfigProfileSettings | undefined =
        mode === 'safe' ? params.config?.profiles?.safe : mode === 'fast' ? params.config?.profiles?.fast : undefined

    const searchDelayCfg =
        profileCfg?.searchDelay ?? (mode === 'standard' ? params.config?.searchSettings?.searchDelay : undefined)
    const readDelayCfg =
        profileCfg?.readDelay ?? (mode === 'standard' ? params.config?.searchSettings?.readDelay : undefined)

    const [ratioMin, ratioMax] = resolveOrderedPair(
        profileCfg?.searchTargetRatioMin ?? defaults.searchTargetRatioMin,
        profileCfg?.searchTargetRatioMax ?? defaults.searchTargetRatioMax
    )
    const searchTargetRatio =
        ratioMin === ratioMax
            ? ratioMin
            : ratioMin + (params.random ? params.random.next() : 0.5) * (ratioMax - ratioMin)

    const [articlesMin, articlesMax] = resolveOrderedPair(
        Math.round(profileCfg?.readArticlesMin ?? defaults.readArticlesMin),
        Math.round(profileCfg?.readArticlesMax ?? defaults.readArticlesMax)
    )
    const readArticlesTarget =
        articlesMin === articlesMax
            ? articlesMin
            : params.random
              ? params.random.int(articlesMin, articlesMax)
              : Math.round((articlesMin + articlesMax) / 2)

    const [readFractionMin, readFractionMax] = resolveOrderedPair(
        profileCfg?.readFractionMin ?? defaults.readFractionMin,
        profileCfg?.readFractionMax ?? defaults.readFractionMax
    )

    return {
        mode,
        isNewTag,
        redemptionCount,
        searchDelay: resolveDelayRange(searchDelayCfg, defaults.searchDelay),
        readDelay: resolveDelayRange(readDelayCfg, defaults.readDelay),
        searchTargetRatio,
        readArticlesTarget,
        readFractionMin,
        readFractionMax,
        interactionWeights: { ...defaults.interactionWeights },
        typingMultiplier: profileCfg?.typingMultiplier ?? defaults.typingMultiplier,
        waitMultiplier: profileCfg?.waitMultiplier ?? defaults.waitMultiplier,
        resultVisitMultiplier: profileCfg?.resultVisitMultiplier ?? defaults.resultVisitMultiplier,
        extraSearchVerifyRounds: profileCfg?.extraSearchVerifyRounds ?? defaults.extraSearchVerifyRounds,
        thoroughTasks: profileCfg?.thoroughTasks ?? defaults.thoroughTasks
    }
}

import type { ConfigWorkers } from '../interface/Config'

export type DesktopSessionWorkers = Pick<
    ConfigWorkers,
    'doStarSearch' | 'doDailySet' | 'doMorePromotions' | 'doMissions' | 'doClaimPoints'
>

/**
 * Whether modern UI workers should run on a desktop browser session.
 */
export function needsModernTasks(workers: DesktopSessionWorkers, rewardsVersion: string): boolean {
    return (
        rewardsVersion === 'modern' &&
        (workers.doDailySet || workers.doMorePromotions || workers.doMissions || workers.doClaimPoints)
    )
}

/**
 * Whether a desktop browser session is required (search points, star, or modern tasks).
 */
export function needsDesktopSession(
    workers: DesktopSessionWorkers,
    rewardsVersion: string,
    shouldDoDesktop: boolean
): boolean {
    return shouldDoDesktop || workers.doStarSearch || needsModernTasks(workers, rewardsVersion)
}
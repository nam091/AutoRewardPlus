import type { Page } from 'patchright'

import type { MicrosoftRewardsBot } from '../index'
import { doClaimPoints } from './modern/ClaimPoints'
import { doDailySet } from './modern/DailySet'
import { doKeepEarning } from './modern/KeepEarning'
import { doMissions } from './modern/Missions'

/**
 * Facade for Modern UI task workers (April 2026+).
 * Implementation split across src/functions/modern/* modules.
 */
export class ModernUIWorkers {
    constructor(private bot: MicrosoftRewardsBot) {}

    async doDailySet(page: Page): Promise<void> {
        return doDailySet(this.bot, page)
    }

    async doKeepEarning(page: Page): Promise<void> {
        return doKeepEarning(this.bot, page)
    }

    async doMissions(page: Page): Promise<void> {
        return doMissions(this.bot, page)
    }

    async doClaimPoints(page: Page): Promise<{ claimed: boolean; points: number }> {
        return doClaimPoints(this.bot, page)
    }
}
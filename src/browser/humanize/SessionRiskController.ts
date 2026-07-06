import type { Page } from 'patchright'

import { AIDecisionEngine, type BehaviorDecision } from './AIDecisionEngine'
import { detectChallenge } from './ChallengeDetector'

export class SessionRiskController {
    private readonly engine = new AIDecisionEngine()
    private readonly sessionStart = Date.now()
    private recentFailures = 0
    private consecutiveNoPoints = 0
    private pointsGainedThisSession = 0
    private tasksCompleted = 0
    private captchaDetected = false
    private challengeReason?: string
    private onChallenge?: (reason?: string) => Promise<void>

    setChallengeHandler(handler: (reason?: string) => Promise<void>): void {
        this.onChallenge = handler
    }

    async evaluatePage(page: Page): Promise<BehaviorDecision> {
        const challenge = await detectChallenge(page)
        if (challenge.detected) {
            this.captchaDetected = true
            this.challengeReason = challenge.reason
            if (this.onChallenge) {
                await this.onChallenge(challenge.reason)
            }
        }

        return this.engine.analyzeContext(this.buildContext())
    }

    getChallengeReason(): string | undefined {
        return this.challengeReason
    }

    evaluateSearchOutcome(earnedPoints: boolean): BehaviorDecision {
        if (earnedPoints) {
            this.consecutiveNoPoints = 0
            this.pointsGainedThisSession++
            this.tasksCompleted++
        } else {
            this.consecutiveNoPoints++
        }

        return this.engine.analyzeContext(this.buildContext())
    }

    recordFailure(): BehaviorDecision {
        this.recentFailures++
        return this.engine.analyzeContext(this.buildContext())
    }

    async applyDecision(
        decision: BehaviorDecision,
        wait: (ms: number) => Promise<void>,
        log: (message: string) => void
    ): Promise<'continue' | 'stop'> {
        log(`Risk decision: ${decision.action} | ${decision.reason} | multiplier=${decision.delayMultiplier}`)

        if (decision.action === 'stop' || (decision.action === 'take_break' && this.captchaDetected)) {
            return 'stop'
        }

        if (decision.action === 'take_break' && decision.breakDurationMs) {
            await wait(decision.breakDurationMs)
            this.recentFailures = Math.max(0, this.recentFailures - 1)
            return 'continue'
        }

        if (decision.action === 'slow_down' || decision.action === 'switch_strategy') {
            const extraDelay = Math.floor(5000 * decision.delayMultiplier)
            await wait(extraDelay)
        }

        return 'continue'
    }

    getDelayMultiplier(decision: BehaviorDecision): number {
        return decision.delayMultiplier
    }

    isCaptchaDetected(): boolean {
        return this.captchaDetected
    }

    private buildContext() {
        const now = new Date()
        return {
            recentFailures: this.recentFailures,
            consecutiveNoPoints: this.consecutiveNoPoints,
            pointsGainedThisSession: this.pointsGainedThisSession,
            sessionDurationMinutes: (Date.now() - this.sessionStart) / 60000,
            currentHour: now.getHours(),
            isWeekend: now.getDay() === 0 || now.getDay() === 6,
            tasksCompleted: this.tasksCompleted,
            captchaDetected: this.captchaDetected
        }
    }
}
export interface SessionContext {
    recentFailures: number
    consecutiveNoPoints: number
    pointsGainedThisSession: number
    sessionDurationMinutes: number
    currentHour: number
    isWeekend: boolean
    tasksCompleted: number
    lastErrorType?: string
    captchaDetected: boolean
}

export interface BehaviorDecision {
    action: 'continue' | 'slow_down' | 'take_break' | 'switch_strategy' | 'stop'
    delayMultiplier: number
    reason: string
    suggestedTopic?: string
    breakDurationMs?: number
}

/**
 * AI-powered decision engine for dynamic behavior adjustment.
 * Analyzes session context and risk signals to make human-like decisions.
 */
export class AIDecisionEngine {
    private decisionHistory: BehaviorDecision[] = []
    private topicSuccessMap: Map<string, { success: number; fail: number }> = new Map()

    constructor(_bot?: unknown) {
        // Bot reference reserved for future AI API integration
    }

    /**
     * Analyze current context and make a behavior decision.
     */
    analyzeContext(context: SessionContext): BehaviorDecision {
        // Rule-based decision tree (fast, no API call needed)

        // Critical: Captcha detected
        if (context.captchaDetected) {
            return this.makeDecision('take_break', 3.0, 'Captcha detected, taking extended break', 300000)
        }

        // Critical: Too many consecutive failures
        if (context.recentFailures >= 5) {
            return this.makeDecision('take_break', 2.5, 'Too many failures, cooling down', 180000)
        }

        // High: Long session without points
        if (context.consecutiveNoPoints >= 8) {
            return this.makeDecision('switch_strategy', 1.5, 'No points for too long, switching topic')
        }

        // Medium: Session fatigue
        if (context.sessionDurationMinutes > 60) {
            const shouldBreak = this.shouldTakeFatigueBreak(context.sessionDurationMinutes)
            if (shouldBreak) {
                return this.makeDecision('take_break', 1.0, 'Session fatigue break', 120000)
            }
            return this.makeDecision('slow_down', 1.3, 'Long session, reducing pace')
        }

        // Medium: Quiet hours
        if (context.currentHour >= 1 && context.currentHour < 5) {
            return this.makeDecision('slow_down', 2.0, 'Quiet hours, very slow pace')
        }

        // Medium: Night time
        if (context.currentHour >= 22 || context.currentHour < 1) {
            return this.makeDecision('slow_down', 1.3, 'Night time, slightly slower')
        }

        // Low: Recent failures
        if (context.recentFailures >= 2) {
            return this.makeDecision('slow_down', 1.2, 'Some failures, reducing pace')
        }

        // Low: Weekend adjustment
        if (context.isWeekend) {
            return this.makeDecision('continue', 0.9, 'Weekend, normal pace')
        }

        // Default: Continue normally
        return this.makeDecision('continue', 1.0, 'Normal operation')
    }

    /**
     * Record feedback for a search query to learn topic success rates.
     */
    recordTopicFeedback(query: string, earnedPoints: boolean): void {
        // Extract topic keywords (first 2 words)
        const topic = query.toLowerCase().split(/\s+/).slice(0, 2).join(' ')
        const existing = this.topicSuccessMap.get(topic) ?? { success: 0, fail: 0 }

        if (earnedPoints) {
            existing.success++
        } else {
            existing.fail++
        }

        this.topicSuccessMap.set(topic, existing)
    }

    /**
     * Get the best performing topic based on historical feedback.
     */
    getBestTopic(): string | undefined {
        let bestTopic: string | undefined
        let bestRate = 0

        for (const [topic, stats] of this.topicSuccessMap.entries()) {
            const total = stats.success + stats.fail
            if (total < 3) continue // Need minimum data

            const rate = stats.success / total
            if (rate > bestRate) {
                bestRate = rate
                bestTopic = topic
            }
        }

        return bestTopic
    }

    /**
     * Get the worst performing topic to avoid.
     */
    getWorstTopic(): string | undefined {
        let worstTopic: string | undefined
        let worstRate = 1

        for (const [topic, stats] of this.topicSuccessMap.entries()) {
            const total = stats.success + stats.fail
            if (total < 3) continue

            const rate = stats.success / total
            if (rate < worstRate) {
                worstRate = rate
                worstTopic = topic
            }
        }

        return worstTopic
    }

    /**
     * Get a summary of topic performance for logging.
     */
    getTopicPerformanceSummary(): string {
        const entries = [...this.topicSuccessMap.entries()]
        if (entries.length === 0) return 'no data'

        const sorted = entries
            .map(([topic, stats]) => ({
                topic,
                total: stats.success + stats.fail,
                rate: stats.success / (stats.success + stats.fail)
            }))
            .filter(x => x.total >= 2)
            .sort((a, b) => b.rate - a.rate)

        if (sorted.length === 0) return 'insufficient data'

        const top3 = sorted.slice(0, 3)
        return top3.map(x => `${x.topic}:${(x.rate * 100).toFixed(0)}%`).join(' | ')
    }

    /**
     * Determine if a break should be taken based on session duration.
     */
    private shouldTakeFatigueBreak(durationMinutes: number): boolean {
        // Increasing probability of break as session lengthens
        if (durationMinutes < 30) return false
        if (durationMinutes < 45) return Math.random() < 0.1
        if (durationMinutes < 60) return Math.random() < 0.2
        if (durationMinutes < 90) return Math.random() < 0.35
        return Math.random() < 0.5
    }

    /**
     * Helper to create a decision object.
     */
    private makeDecision(
        action: BehaviorDecision['action'],
        delayMultiplier: number,
        reason: string,
        breakDurationMs?: number
    ): BehaviorDecision {
        const decision: BehaviorDecision = {
            action,
            delayMultiplier,
            reason,
            breakDurationMs
        }

        this.decisionHistory.push(decision)

        // Keep history manageable
        if (this.decisionHistory.length > 100) {
            this.decisionHistory = this.decisionHistory.slice(-50)
        }

        return decision
    }

    /**
     * Get recent decision history for debugging.
     */
    getDecisionHistory(limit: number = 10): BehaviorDecision[] {
        return this.decisionHistory.slice(-limit)
    }
}

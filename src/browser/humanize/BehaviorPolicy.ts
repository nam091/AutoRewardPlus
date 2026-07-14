import { createHash } from 'crypto'
import { SeededRandom } from './SeededRandom'

export type ResultInteraction = 'read' | 'scroll' | 'click'

export function chooseResultInteraction(
    random: SeededRandom,
    options: { allowScroll: boolean; allowClick: boolean }
): ResultInteraction {
    const choices: Array<{ value: ResultInteraction; weight: number }> = [{ value: 'read', weight: 5 }]
    if (options.allowScroll) choices.push({ value: 'scroll', weight: 3 })
    if (options.allowClick) choices.push({ value: 'click', weight: 2 })
    return random.weighted(choices) ?? 'read'
}

export function getSessionBreakMs(random: SeededRandom, elapsedMs: number): number {
    const minutes = elapsedMs / 60000
    if (minutes < 15) return 0
    const probability = minutes < 30 ? 0.06 : minutes < 60 ? 0.12 : 0.2
    return random.chance(probability) ? random.int(15000, 45000) : 0
}

export function maskAccount(value: string): string {
    return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 10)
}

export function getAccountStartDelayMs(
    account: string,
    runKey: string,
    minMs: number,
    maxMs: number
): number {
    return SeededRandom.fromParts(account.trim().toLowerCase(), runKey, 'account-start').int(minMs, maxMs)
}

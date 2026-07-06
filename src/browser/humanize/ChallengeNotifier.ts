import type { MicrosoftRewardsBot } from '../../index'
import { sendDiscord } from '../../logging/Discord'
import { sendNtfy } from '../../logging/Ntfy'

export async function notifyChallengeDetected(
    bot: MicrosoftRewardsBot,
    context: string,
    accountEmail: string,
    reason?: string
): Promise<void> {
    const message = `[CHALLENGE] ${context} | account=${accountEmail} | ${reason ?? 'unknown challenge'}`

    bot.logger.warn('main', 'CHALLENGE-ALERT', message)

    const { webhook } = bot.config
    if (webhook.discord?.enabled && webhook.discord.url) {
        await sendDiscord(webhook.discord.url, message, 'warn')
    }
    if (webhook.ntfy?.enabled && webhook.ntfy.url) {
        await sendNtfy(webhook.ntfy, message, 'warn')
    }
}
import type { Account } from '../interface/Account'
import type { MicrosoftRewardsBot } from '../index'

const COUNTRY_TLD_MAP: Record<string, string[]> = {
    us: ['.us', 'america', 'toronto', 'newyork', 'chicago'],
    ca: ['.ca', 'canada', 'toronto'],
    gb: ['.uk', 'britain', 'london'],
    au: ['.au', 'australia', 'sydney'],
    de: ['.de', 'germany', 'frankfurt', 'berlin'],
    fr: ['.fr', 'france', 'paris'],
    vn: ['.vn', 'vietnam', 'hanoi', 'hochiminh'],
    jp: ['.jp', 'japan', 'tokyo'],
    in: ['.in', 'india', 'mumbai']
}

/**
 * Warn when account geoLocale and proxy hostname appear misaligned.
 * Non-blocking — logs only.
 */
export function validateProxyGeoAlignment(bot: MicrosoftRewardsBot, account: Account): void {
    const geo = (account.geoLocale === 'auto' ? bot.userData.geoLocale : account.geoLocale).toLowerCase()
    const proxyUrl = (account.proxy?.url ?? '').toLowerCase()

    if (!proxyUrl || geo === 'auto' || geo.length !== 2) {
        return
    }

    const hints = COUNTRY_TLD_MAP[geo]
    if (!hints) {
        bot.logger.debug('main', 'GEO-VALIDATOR', `No proxy hints for geo=${geo}, skipping alignment check`)
        return
    }

    const aligned = hints.some(hint => proxyUrl.includes(hint))
    if (!aligned) {
        bot.logger.warn(
            'main',
            'GEO-VALIDATOR',
            `Proxy may not match geoLocale | email=${account.email} | geo=${geo} | proxy=${account.proxy.url}`
        )
    } else {
        bot.logger.debug('main', 'GEO-VALIDATOR', `Proxy/geo alignment OK | geo=${geo}`)
    }
}
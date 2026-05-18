import * as crypto from 'crypto'

export type QueryCategory =
    | 'navigational'
    | 'calculation'
    | 'conversion'
    | 'local_intent'
    | 'transactional'
    | 'entertainment'
    | 'short_noise'
    | 'question'

export interface SyntheticOptions {
    sessionSeed?: string
    count?: number
    includeTypos?: boolean
    categoryWeights?: Partial<Record<QueryCategory, number>>
}

export interface TaggedQuery {
    query: string
    category: QueryCategory
}

const DEFAULT_WEIGHTS: Record<QueryCategory, number> = {
    navigational: 15,
    calculation: 10,
    conversion: 10,
    local_intent: 10,
    transactional: 8,
    entertainment: 8,
    short_noise: 12,
    question: 12
}

class SeededRNG {
    private s: [number, number, number, number]

    constructor(seed: string) {
        const hash = crypto.createHash('sha256').update(seed).digest()
        this.s = [
            hash.readUInt32LE(0),
            hash.readUInt32LE(4),
            hash.readUInt32LE(8),
            hash.readUInt32LE(12)
        ]
    }

    next(): number {
        const t = this.s[0]! ^ (this.s[0]! << 11)
        this.s[0] = this.s[1]!
        this.s[1] = this.s[2]!
        this.s[2] = this.s[3]!
        this.s[3] = (this.s[3]! ^ (this.s[3]! >>> 19) ^ (t ^ (t >>> 8))) >>> 0
        return this.s[3]! / 0xFFFFFFFF
    }

    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min
    }

    pick<T>(arr: readonly T[]): T {
        return arr[this.nextInt(0, arr.length - 1)]!
    }

    pickN<T>(arr: readonly T[], n: number): T[] {
        const copy = [...arr]
        const result: T[] = []
        const count = Math.min(n, copy.length)
        for (let i = 0; i < count; i++) {
            const idx = this.nextInt(0, copy.length - 1)
            result.push(copy[idx]!)
            copy.splice(idx, 1)
        }
        return result
    }

    shuffle<T>(arr: readonly T[]): T[] {
        const copy = [...arr]
        for (let i = copy.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i)
            const temp = copy[i]!
            copy[i] = copy[j]!
            copy[j] = temp
        }
        return copy
    }
}

const NAVIGATIONAL_POOL = [
    'youtube', 'facebook', 'gmail', 'amazon', 'twitter', 'instagram', 'reddit',
    'netflix', 'spotify', 'linkedin', 'github', 'stackoverflow', 'walmart',
    'target', 'ebay', 'craigslist', 'pinterest', 'tiktok', 'discord', 'twitch',
    'outlook', 'yahoo mail', 'google drive', 'dropbox', 'zoom', 'microsoft teams',
    'slack', 'whatsapp web', 'telegram', 'signal', 'hulu', 'disney plus',
    'hbo max', 'apple music', 'soundcloud', 'bandcamp', 'etsy', 'shopify',
    'paypal', 'venmo', 'chase bank', 'bank of america', 'wells fargo',
    'capital one', 'robinhood', 'coinbase', 'binance', 'airbnb', 'booking.com',
    'expedia', 'tripadvisor', 'yelp', 'doordash', 'uber eats', 'grubhub',
    'instacart', 'costco', 'home depot', 'lowes', 'best buy', 'newegg',
    'ikea', 'wayfair', 'zillow', 'realtor.com', 'indeed', 'glassdoor',
    'monster jobs', 'upwork', 'fiverr', 'canva', 'figma', 'notion',
    'trello', 'asana', 'jira', 'confluence', 'google maps', 'waze',
    'uber', 'lyft', 'fedex tracking', 'ups tracking', 'usps tracking',
    'weather.com', 'accuweather', 'cnn', 'bbc news', 'fox news', 'nytimes',
    'washington post', 'reuters', 'associated press', 'espn', 'bleacher report',
    'yahoo sports', 'nfl', 'nba', 'mlb', 'wikipedia', 'quora',
    'medium', 'substack', 'wordpress', 'blogger', 'tumblr', 'flickr',
    'imgur', 'giphy', 'unsplash', 'pexels', 'shutterstock', 'adobe',
    'photoshop online', 'google docs', 'google sheets', 'onedrive',
    'icloud', 'protonmail', 'tutanota', 'duckduckgo', 'bing',
    'google translate', 'deepl translator', 'grammarly', 'duolingo',
    'khan academy', 'coursera', 'udemy', 'skillshare', 'masterclass',
    'twitch', 'kick', 'rumble', 'dailymotion', 'vimeo'
] as const

const NAVIGATIONAL_SUFFIXES = [
    '', '', '', '', ' login', ' sign in', ' app', ' download', ' website', ' online'
] as const

const CALC_OPERATORS = ['+', '-', '*', '/'] as const

const CONVERSION_PAIRS: readonly [string, string][] = [
    ['USD', 'EUR'], ['USD', 'GBP'], ['USD', 'JPY'], ['USD', 'CAD'],
    ['USD', 'AUD'], ['EUR', 'GBP'], ['EUR', 'JPY'], ['USD', 'INR'],
    ['USD', 'CNY'], ['USD', 'KRW'], ['USD', 'BRL'], ['USD', 'MXN'],
    ['km', 'miles'], ['miles', 'km'], ['kg', 'lbs'], ['lbs', 'kg'],
    ['celsius', 'fahrenheit'], ['fahrenheit', 'celsius'],
    ['inches', 'cm'], ['cm', 'inches'], ['feet', 'meters'], ['meters', 'feet'],
    ['gallons', 'liters'], ['liters', 'gallons'], ['ounces', 'grams'],
    ['grams', 'ounces'], ['mph', 'kph'], ['kph', 'mph'],
    ['acres', 'hectares'], ['hectares', 'acres'], ['yards', 'meters'],
    ['cups', 'ml'], ['tablespoons', 'ml'], ['teaspoons', 'ml'],
    ['stone', 'kg'], ['nautical miles', 'km'], ['light years', 'km']
]

const LOCAL_INTENT_TEMPLATES = [
    'weather today', 'weather tomorrow', 'weather this week',
    'weather {city}', 'restaurants near me', 'pizza near me',
    'coffee shops near me', 'gas stations near me', 'pharmacy near me',
    'ATM near me', 'grocery store near me', 'hospital near me',
    'dentist near me', 'mechanic near me', 'laundromat near me',
    'movie theaters near me', 'parks near me', 'gym near me',
    'library near me', 'post office near me', 'bank near me',
    'hair salon near me', 'pet store near me', 'car wash near me',
    'time in {city}', 'sunrise time today', 'sunset time today',
    'traffic {city}', 'gas prices today', 'pollen count today',
    'air quality today', 'uv index today', 'humidity today'
] as const

const CITIES = [
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
    'San Francisco', 'Seattle', 'Denver', 'Miami', 'Boston',
    'London', 'Paris', 'Tokyo', 'Sydney', 'Toronto',
    'Berlin', 'Amsterdam', 'Dubai', 'Singapore', 'Seoul',
    'Barcelona', 'Rome', 'Bangkok', 'Mumbai', 'Istanbul'
] as const

const TRANSACTIONAL_ACTIONS = [
    'buy', 'cheap', 'best price', 'discount', 'deals on',
    'where to buy', 'order', 'subscribe to', 'rent', 'hire'
] as const

const TRANSACTIONAL_PRODUCTS = [
    'airpods', 'iphone case', 'laptop stand', 'wireless mouse',
    'bluetooth speaker', 'running shoes', 'yoga mat', 'water bottle',
    'backpack', 'sunglasses', 'headphones', 'keyboard', 'monitor',
    'webcam', 'desk lamp', 'office chair', 'standing desk',
    'air purifier', 'humidifier', 'electric toothbrush',
    'protein powder', 'vitamins', 'coffee maker', 'blender',
    'instant pot', 'air fryer', 'robot vacuum', 'smart watch',
    'fitness tracker', 'gaming mouse', 'mechanical keyboard',
    'usb hub', 'phone charger', 'power bank', 'tablet',
    'e-reader', 'noise canceling headphones', 'smart speaker',
    'security camera', 'doorbell camera', 'smart thermostat'
] as const

const ENTERTAINMENT_PREFIXES = [
    'lyrics', 'chords', 'tabs', 'trailer', 'cast of',
    'who plays', 'soundtrack', 'release date', 'review',
    'rating', 'episodes', 'season', 'schedule', 'score',
    'highlights', 'stats', 'roster', 'standings', 'results'
] as const

const ENTERTAINMENT_ITEMS = [
    'bohemian rhapsody', 'hotel california', 'stairway to heaven',
    'imagine dragons', 'taylor swift', 'drake', 'kendrick lamar',
    'the weeknd', 'billie eilish', 'dua lipa', 'ed sheeran',
    'avengers', 'batman', 'spider man', 'star wars', 'lord of the rings',
    'stranger things', 'breaking bad', 'game of thrones', 'the office',
    'friends', 'seinfeld', 'the mandalorian', 'wednesday',
    'lakers', 'warriors', 'celtics', 'yankees', 'dodgers',
    'chiefs', 'eagles', 'cowboys', 'manchester united', 'real madrid',
    'barcelona', 'liverpool', 'psg', 'bayern munich'
] as const

const SHORT_NOISE_POOL = [
    'ok', 'test', 'hello', 'hi', 'yes', 'no', 'thanks', 'cool',
    'nice', 'wow', 'lol', 'hmm', 'idk', 'brb', 'omg', 'wtf',
    'please', 'help', 'why', 'how', 'what', 'when', 'where', 'who',
    'news', 'today', 'tomorrow', 'time', 'date', 'map', 'food',
    'music', 'video', 'game', 'book', 'movie', 'show', 'app',
    'phone', 'car', 'house', 'dog', 'cat', 'baby', 'love',
    'money', 'work', 'school', 'home', 'life', 'world', 'people',
    'good morning', 'good night', 'thank you', 'how are you',
    'whats up', 'see you', 'bye', 'later', 'sure', 'maybe',
    'absolutely', 'definitely', 'probably', 'actually', 'basically'
] as const

const QUESTION_STARTERS = [
    'how to', 'what is', 'why do', 'when was', 'where is',
    'how many', 'how much does', 'what are the best', 'is it safe to',
    'can you', 'should I', 'what happens if', 'how long does',
    'how far is', 'what time does', 'who invented', 'who discovered',
    'what year was', 'how old is', 'what is the difference between'
] as const

const QUESTION_SUBJECTS = [
    'change a tire', 'cook rice', 'tie a tie', 'fold a shirt',
    'remove a stain', 'fix a leaky faucet', 'unclog a drain',
    'jump start a car', 'parallel park', 'write a resume',
    'the meaning of life', 'the speed of light', 'the deepest ocean',
    'the tallest building', 'the longest river', 'the largest country',
    'the human brain', 'black holes', 'quantum physics', 'DNA',
    'climate change', 'solar energy', 'electric cars', 'AI',
    'blockchain', 'cryptocurrency', 'stock market', 'inflation',
    'a passport cost', 'a gallon of milk cost', 'netflix cost',
    'spotify cost', 'an oil change cost', 'a new roof cost',
    'it take to learn guitar', 'it take to boil water',
    'it take to fly to japan', 'it take to get a passport',
    'the earth', 'the universe', 'the pyramids', 'the internet',
    'english', 'spanish', 'python', 'javascript',
    'the sun and a star', 'a virus and bacteria', 'weather and climate',
    'college and university', 'affect and effect', 'their and there'
] as const

export class SyntheticQueryGenerator {
    private rng: SeededRNG

    constructor(seed: string) {
        this.rng = new SeededRNG(seed)
    }

    generate(options: SyntheticOptions = {}): TaggedQuery[] {
        const { count = 50, includeTypos = true, categoryWeights } = options
        const weights = { ...DEFAULT_WEIGHTS, ...categoryWeights }

        const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
        const queries: TaggedQuery[] = []

        for (const [category, weight] of Object.entries(weights) as [QueryCategory, number][]) {
            const categoryCount = Math.round((weight / totalWeight) * count)
            const generated = this.generateCategory(category, categoryCount)
            queries.push(...generated)
        }

        if (includeTypos) {
            const typoCount = Math.floor(queries.length * 0.05)
            for (let i = 0; i < typoCount; i++) {
                const idx = this.rng.nextInt(0, queries.length - 1)
                queries[idx]!.query = this.introduceTypo(queries[idx]!.query)
            }
        }

        return queries
    }

    private generateCategory(category: QueryCategory, count: number): TaggedQuery[] {
        const generators: Record<QueryCategory, (n: number) => string[]> = {
            navigational: (n) => this.generateNavigational(n),
            calculation: (n) => this.generateCalculation(n),
            conversion: (n) => this.generateConversion(n),
            local_intent: (n) => this.generateLocalIntent(n),
            transactional: (n) => this.generateTransactional(n),
            entertainment: (n) => this.generateEntertainment(n),
            short_noise: (n) => this.generateShortNoise(n),
            question: (n) => this.generateQuestion(n)
        }

        const gen = generators[category]
        if (!gen) return []

        return gen(count).map(query => ({ query, category }))
    }

    private generateNavigational(count: number): string[] {
        const results: string[] = []
        const picks = this.rng.pickN(NAVIGATIONAL_POOL, count)
        for (const site of picks) {
            const suffix = this.rng.pick(NAVIGATIONAL_SUFFIXES)
            results.push(site + suffix)
        }
        return results
    }

    private generateCalculation(count: number): string[] {
        const results: string[] = []
        for (let i = 0; i < count; i++) {
            const type = this.rng.nextInt(0, 3)
            switch (type) {
                case 0: {
                    const a = this.rng.nextInt(1, 999)
                    const b = this.rng.nextInt(1, 999)
                    const op = this.rng.pick(CALC_OPERATORS)
                    results.push(`${a} ${op} ${b}`)
                    break
                }
                case 1: {
                    const n = this.rng.nextInt(1, 10000)
                    results.push(`sqrt ${n}`)
                    break
                }
                case 2: {
                    const base = this.rng.nextInt(2, 20)
                    const exp = this.rng.nextInt(2, 8)
                    results.push(`${base}^${exp}`)
                    break
                }
                case 3: {
                    const pct = this.rng.nextInt(1, 99)
                    const of_ = this.rng.nextInt(10, 9999)
                    results.push(`${pct}% of ${of_}`)
                    break
                }
            }
        }
        return results
    }

    private generateConversion(count: number): string[] {
        const results: string[] = []
        const picks = this.rng.pickN(CONVERSION_PAIRS, Math.min(count, CONVERSION_PAIRS.length))
        for (let i = 0; i < count; i++) {
            const pair = picks[i % picks.length]!
            const isCurrency = pair[0].length === 3 && pair[0] === pair[0].toUpperCase()
            const value = isCurrency
                ? this.rng.nextInt(1, 5000)
                : this.rng.nextInt(1, 500)
            results.push(`${value} ${pair[0]} to ${pair[1]}`)
        }
        return results
    }

    private generateLocalIntent(count: number): string[] {
        const results: string[] = []
        const picks = this.rng.pickN(LOCAL_INTENT_TEMPLATES, Math.min(count, LOCAL_INTENT_TEMPLATES.length))
        for (let i = 0; i < count; i++) {
            let template: string = picks[i % picks.length]!
            if (template.includes('{city}')) {
                template = template.replace('{city}', this.rng.pick(CITIES))
            }
            results.push(template)
        }
        return results
    }

    private generateTransactional(count: number): string[] {
        const results: string[] = []
        for (let i = 0; i < count; i++) {
            const action = this.rng.pick(TRANSACTIONAL_ACTIONS)
            const product = this.rng.pick(TRANSACTIONAL_PRODUCTS)
            results.push(`${action} ${product}`)
        }
        return results
    }

    private generateEntertainment(count: number): string[] {
        const results: string[] = []
        for (let i = 0; i < count; i++) {
            const prefix = this.rng.pick(ENTERTAINMENT_PREFIXES)
            const item = this.rng.pick(ENTERTAINMENT_ITEMS)
            results.push(`${prefix} ${item}`)
        }
        return results
    }

    private generateShortNoise(count: number): string[] {
        return this.rng.pickN(SHORT_NOISE_POOL, Math.min(count, SHORT_NOISE_POOL.length))
    }

    private generateQuestion(count: number): string[] {
        const results: string[] = []
        for (let i = 0; i < count; i++) {
            const starter = this.rng.pick(QUESTION_STARTERS)
            const subject = this.rng.pick(QUESTION_SUBJECTS)
            results.push(`${starter} ${subject}`)
        }
        return results
    }

    private introduceTypo(query: string): string {
        if (query.length < 4) return query
        const type = this.rng.nextInt(0, 2)
        const chars = query.split('')
        switch (type) {
            case 0: {
                const pos = this.rng.nextInt(1, chars.length - 2)
                const temp = chars[pos]!
                chars[pos] = chars[pos + 1]!
                chars[pos + 1] = temp
                break
            }
            case 1: {
                const pos = this.rng.nextInt(1, chars.length - 1)
                chars.splice(pos, 1)
                break
            }
            case 2: {
                const pos = this.rng.nextInt(1, chars.length - 1)
                chars[pos] = chars[pos]! + chars[pos]!
                break
            }
        }
        return chars.join('')
    }
}

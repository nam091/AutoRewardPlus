import type { AxiosRequestConfig } from 'axios'
import * as fs from 'fs'
import path from 'path'
import type { GoogleSearch, GoogleTrendsResponse, RedditListing, WikipediaTopResponse } from '../interface/Search'
import type { MicrosoftRewardsBot } from '../index'
import { QueryEngine } from '../interface/Config'
import { errDetail, errMsg } from '../util/Utils'

interface AiEndpoint {
    baseUrl: string
    model: string
    apiKey: string
    priority: number
    lastFailure?: number
    failureCount: number
}

interface CachedQueries {
    queries: string[]
    timestamp: number
    langCode: string
}

export class QueryCore {
    private aiEndpoints: AiEndpoint[] = []
    private queryCache: CachedQueries | null = null
    private static readonly CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes
    private static readonly MAX_RETRIES = 3
    private static readonly RETRY_DELAY_MS = 2000

    constructor(private bot: MicrosoftRewardsBot) {
        this.initializeAiEndpoints()
    }

    async queryManager(
        options: {
            shuffle?: boolean
            sourceOrder?: QueryEngine[]
            related?: boolean
            langCode?: string
            geoLocale?: string
        } = {}
    ): Promise<string[]> {
        const {
            shuffle = false,
            sourceOrder = ['google', 'wikipedia', 'reddit', 'local'],
            related = true,
            langCode = 'en',
            geoLocale = 'US'
        } = options

        try {
            this.bot.logger.debug(
                this.bot.isMobile,
                'QUERY-MANAGER',
                `start | shuffle=${shuffle}, related=${related}, lang=${langCode}, geo=${geoLocale}, sources=${sourceOrder.join(',')}`
            )

            const topicLists: string[][] = []

            const sourceHandlers: Record<
                'google' | 'wikipedia' | 'reddit' | 'local',
                (() => Promise<string[]>) | (() => string[])
            > = {
                google: async () => {
                    const topics = await this.getGoogleTrends(geoLocale.toUpperCase()).catch(() => [])
                    this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', `google: ${topics.length}`)
                    return topics
                },
                wikipedia: async () => {
                    const topics = await this.getWikipediaTrending(langCode).catch(() => [])
                    this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', `wikipedia: ${topics.length}`)
                    return topics
                },
                reddit: async () => {
                    const topics = await this.getRedditTopics().catch(() => [])
                    this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', `reddit: ${topics.length}`)
                    return topics
                },
                local: () => {
                    const topics = this.getLocalQueryList()
                    this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', `local: ${topics.length}`)
                    return topics
                }
            }

            for (const source of sourceOrder) {
                const handler = sourceHandlers[source]
                if (!handler) continue

                const topics = await Promise.resolve(handler())
                if (topics.length) topicLists.push(topics)
            }

            this.bot.logger.debug(
                this.bot.isMobile,
                'QUERY-MANAGER',
                `sources combined | rawTotal=${topicLists.flat().length}`
            )

            const baseTopics = this.normalizeAndDedupe(topicLists.flat())

            if (!baseTopics.length) {
                this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', 'No base topics found (all sources empty)')
                return []
            }

            this.bot.logger.debug(
                this.bot.isMobile,
                'QUERY-MANAGER',
                `baseTopics dedupe | before=${topicLists.flat().length} | after=${baseTopics.length}`
            )
            this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', `baseTopics: ${baseTopics.length}`)

            const clusters = related ? await this.buildRelatedClusters(baseTopics, langCode) : baseTopics.map(t => [t])

            this.bot.utils.shuffleArray(clusters)
            this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', 'clusters shuffled')

            let finalQueries = clusters.flat()
            this.bot.logger.debug(
                this.bot.isMobile,
                'QUERY-MANAGER',
                `clusters flattened | total=${finalQueries.length}`
            )

            // Do not cluster searches and shuffle
            if (shuffle) {
                this.bot.utils.shuffleArray(finalQueries)
                this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', 'finalQueries shuffled')
            }

            finalQueries = this.normalizeAndDedupe(finalQueries)
            this.bot.logger.debug(
                this.bot.isMobile,
                'QUERY-MANAGER',
                `finalQueries dedupe | after=${finalQueries.length}`
            )

            if (!finalQueries.length) {
                this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', 'finalQueries deduped to 0')
                return []
            }

            this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', `final queries: ${finalQueries.length}`)

            return finalQueries
        } catch (error) {
            this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', `error: ${errDetail(error)}`)
            return []
        }
    }

    private async buildRelatedClusters(baseTopics: string[], langCode: string): Promise<string[][]> {
        const LIMIT = 50
        const CONCURRENCY = 5
        const head = baseTopics.slice(0, LIMIT)
        const tail = baseTopics.slice(LIMIT)

        this.bot.logger.debug(
            this.bot.isMobile,
            'QUERY-MANAGER',
            `related enabled | baseTopics=${baseTopics.length} | expand=${head.length} | passthrough=${tail.length} | lang=${langCode}`
        )
        this.bot.logger.debug(
            this.bot.isMobile,
            'QUERY-MANAGER',
            `bing expansion enabled | limit=${LIMIT} | concurrency=${CONCURRENCY} | totalCalls=${head.length * 2}`
        )

        const expandTopic = async (topic: string): Promise<string[]> => {
            const [suggestions, relatedTerms] = await Promise.all([
                this.getBingSuggestions(topic, langCode).catch(() => []),
                this.getBingRelatedTerms(topic).catch(() => [])
            ])

            const usedSuggestions = suggestions.slice(0, 6)
            const usedRelated = relatedTerms.slice(0, 3)
            const cluster = this.normalizeAndDedupe([topic, ...usedSuggestions, ...usedRelated])

            this.bot.logger.debug(
                this.bot.isMobile,
                'QUERY-MANAGER',
                `cluster expanded | topic="${topic}" | suggestions=${suggestions.length}->${usedSuggestions.length} | related=${relatedTerms.length}->${usedRelated.length} | clusterSize=${cluster.length}`
            )

            return cluster
        }

        const clusters: string[][] = []

        for (let i = 0; i < head.length; i += CONCURRENCY) {
            const batch = head.slice(i, i + CONCURRENCY)
            const results = await Promise.all(batch.map(topic => expandTopic(topic)))
            clusters.push(...results)
        }

        if (tail.length) {
            this.bot.logger.debug(this.bot.isMobile, 'QUERY-MANAGER', `cluster passthrough | topics=${tail.length}`)

            for (const topic of tail) {
                clusters.push([topic])
            }
        }

        return clusters
    }

    private normalizeAndDedupe(queries: string[]): string[] {
        const seen = new Set<string>()
        const out: string[] = []

        for (const q of queries) {
            if (!q) continue
            const trimmed = q.trim()
            if (!trimmed) continue

            const norm = trimmed.replace(/\s+/g, ' ').toLowerCase()
            if (seen.has(norm)) continue

            seen.add(norm)
            out.push(trimmed)
        }

        return out
    }

    async getGoogleTrends(geoLocale: string): Promise<string[]> {
        const queryTerms: GoogleSearch[] = []

        try {
            const request: AxiosRequestConfig = {
                url: 'https://trends.google.com/_/TrendsUi/data/batchexecute',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                data: `f.req=[[[i0OFE,"[null, null, \\"${geoLocale.toUpperCase()}\\", 0, null, 48]"]]]`
            }

            const response = await this.bot.axios.request(request, this.bot.config.proxy.queryEngine)
            const trendsData = this.extractJsonFromResponse(response.data)
            if (!trendsData) {
                this.bot.logger.debug(this.bot.isMobile, 'SEARCH-GOOGLE-TRENDS', 'No trendsData parsed from response')
                return []
            }

            const mapped = trendsData.map(q => [q[0], q[9]!.slice(1)])

            if (mapped.length < 90 && geoLocale !== 'US') {
                return this.getGoogleTrends('US')
            }

            for (const [topic, related] of mapped) {
                queryTerms.push({
                    topic: topic as string,
                    related: related as string[]
                })
            }
        } catch (error) {
            this.bot.logger.debug(this.bot.isMobile, 'SEARCH-GOOGLE-TRENDS', `request failed: ${errDetail(error)}`)
            return []
        }

        return queryTerms.flatMap(x => [x.topic, ...x.related])
    }

    private extractJsonFromResponse(text: string): GoogleTrendsResponse[1] | null {
        for (const line of text.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('[')) continue
            try {
                return JSON.parse(JSON.parse(trimmed)[0][2])[1]
            } catch {}
        }
        return null
    }

    async getBingSuggestions(query = '', langCode = 'en'): Promise<string[]> {
        try {
            const request: AxiosRequestConfig = {
                url: `https://www.bingapis.com/api/v7/suggestions?q=${encodeURIComponent(
                    query
                )}&appid=6D0A9B8C5100E9ECC7E11A104ADD76C10219804B&cc=xl&setlang=${langCode}`,
                method: 'POST',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                }
            }

            const response = await this.bot.axios.request(request, this.bot.config.proxy.queryEngine)
            const suggestions =
                response.data.suggestionGroups?.[0]?.searchSuggestions?.map((x: { query: any }) => x.query) ?? []

            if (!suggestions.length) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-BING-SUGGESTIONS',
                    `empty suggestions | query="${query}" | lang=${langCode}`
                )
            }

            return suggestions
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-BING-SUGGESTIONS',
                `request failed | query="${query}" | lang=${langCode} | error=${errDetail(error)}`
            )
            return []
        }
    }

    async getBingRelatedTerms(query: string): Promise<string[]> {
        try {
            const request: AxiosRequestConfig = {
                url: `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`,
                method: 'GET',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {})
                }
            }

            const response = await this.bot.axios.request(request, this.bot.config.proxy.queryEngine)
            const related = response.data?.[1]
            const out = Array.isArray(related) ? related : []

            if (!out.length) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-BING-RELATED',
                    `empty related terms | query="${query}"`
                )
            }

            return out
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-BING-RELATED',
                `request failed | query="${query}" | error=${errDetail(error)}`
            )
            return []
        }
    }

    async getBingTrendingTopics(langCode = 'en'): Promise<string[]> {
        try {
            const request: AxiosRequestConfig = {
                url: `https://www.bing.com/api/v7/news/trendingtopics?appid=91B36E34F9D1B900E54E85A77CF11FB3BE5279E6&cc=xl&setlang=${langCode}`,
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent':
                        'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2',
                    'Content-Type': 'application/json',
                    'X-Rewards-Country': this.bot.userData.geoLocale,
                    'X-Rewards-Language': 'en',
                    'X-Rewards-ismobile': 'true'
                }
            }

            const response = await this.bot.axios.request(request, this.bot.config.proxy.queryEngine)
            const topics =
                response.data.value?.map(
                    (x: { query: { text: string }; name: string }) => x.query?.text?.trim() || x.name.trim()
                ) ?? []

            if (!topics.length) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-BING-TRENDING',
                    `empty trending topics | lang=${langCode}`
                )
            }

            return topics
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-BING-TRENDING',
                `request failed | lang=${langCode} | error=${errDetail(error)}`
            )
            return []
        }
    }

    async getWikipediaTrending(langCode = 'en'): Promise<string[]> {
        try {
            const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
            const yyyy = date.getUTCFullYear()
            const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
            const dd = String(date.getUTCDate()).padStart(2, '0')

            const request: AxiosRequestConfig = {
                url: `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${langCode}.wikipedia/all-access/${yyyy}/${mm}/${dd}`,
                method: 'GET',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {})
                }
            }

            const response = await this.bot.axios.request(request, this.bot.config.proxy.queryEngine)
            const articles = (response.data as WikipediaTopResponse).items?.[0]?.articles ?? []

            const out = articles.slice(0, 50).map(a => a.article.replace(/_/g, ' '))

            if (!out.length) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-WIKIPEDIA-TRENDING',
                    `empty wikipedia top | lang=${langCode}`
                )
            }

            return out
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-WIKIPEDIA-TRENDING',
                `request failed | lang=${langCode} | error=${errDetail(error)}`
            )
            return []
        }
    }

    async getRedditTopics(subreddit = 'popular'): Promise<string[]> {
        try {
            const safe = subreddit.replace(/[^a-zA-Z0-9_+]/g, '')
            const request: AxiosRequestConfig = {
                url: `https://www.reddit.com/r/${safe}.json?limit=50`,
                method: 'GET',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {})
                }
            }

            const response = await this.bot.axios.request(request, this.bot.config.proxy.queryEngine)
            const posts = (response.data as RedditListing).data?.children ?? []

            const out = posts.filter(p => !p.data.over_18).map(p => p.data.title)

            if (!out.length) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-REDDIT-TRENDING',
                    `empty reddit listing | subreddit=${safe}`
                )
            }

            return out
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-REDDIT',
                `request failed | subreddit=${subreddit} | error=${errDetail(error)}`
            )
            return []
        }
    }

    getLocalQueryList(): string[] {
        try {
            const file = path.join(__dirname, './search-queries.json')
            const queries = JSON.parse(fs.readFileSync(file, 'utf8')) as string[]
            const out = Array.isArray(queries) ? queries : []

            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-LOCAL-QUERY-LIST',
                'local queries loaded | file=search-queries.json'
            )

            if (!out.length) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-LOCAL-QUERY-LIST',
                    'search-queries.json parsed but empty or invalid'
                )
            }

            return out
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-LOCAL-QUERY-LIST',
                `read/parse failed | error=${errDetail(error)}`
            )
            return []
        }
    }

    /**
     * Initialize AI endpoints with fallback support
     */
    private initializeAiEndpoints(): void {
        const config = this.bot.config.ai
        if (!config) {
            this.bot.logger.debug(false, 'AI-INIT', 'No AI config found, using defaults')
            return
        }

        // Primary endpoint
        this.aiEndpoints.push({
            baseUrl: config.baseUrl,
            model: config.model,
            apiKey: config.apiKey,
            priority: 1,
            failureCount: 0
        })

        // Fallback providers from config
        if (config.fallbackProviders) {
            for (const provider of config.fallbackProviders) {
                if (provider.enabled && provider.apiKey) {
                    this.aiEndpoints.push({
                        baseUrl: provider.baseUrl,
                        model: provider.model,
                        apiKey: provider.apiKey,
                        priority: provider.priority,
                        failureCount: 0
                    })
                }
            }
        }

        // Update settings from config
        if (config.maxRetries) {
            (this as any).MAX_RETRIES = config.maxRetries
        }
        if (config.retryDelayMs) {
            (this as any).RETRY_DELAY_MS = config.retryDelayMs
        }
        if (config.cacheTtlMs) {
            (this as any).CACHE_TTL_MS = config.cacheTtlMs
        }

        // Sort by priority
        this.aiEndpoints.sort((a, b) => a.priority - b.priority)

        this.bot.logger.debug(
            false,
            'AI-INIT',
            `Initialized ${this.aiEndpoints.length} AI endpoint(s): ${this.aiEndpoints.map(e => e.baseUrl).join(', ')}`
        )
    }

    /**
     * Mark endpoint as failed
     */
    private markEndpointFailed(endpoint: AiEndpoint): void {
        endpoint.lastFailure = Date.now()
        endpoint.failureCount++
    }

    /**
     * Check if cached queries are still valid
     */
    private getCachedQueries(langCode: string): string[] | null {
        if (!this.queryCache) return null

        const now = Date.now()
        if (now - this.queryCache.timestamp > QueryCore.CACHE_TTL_MS) {
            this.queryCache = null
            return null
        }

        if (this.queryCache.langCode !== langCode) {
            return null
        }

        return this.queryCache.queries
    }

    /**
     * Cache queries for reuse
     */
    private cacheQueries(queries: string[], langCode: string): void {
        this.queryCache = {
            queries,
            timestamp: Date.now(),
            langCode
        }
    }

    /**
     * Remove queries that are too similar to each other using word-level overlap.
     * Preserves order of first occurrence. Different from normalizeAndDedupe which does exact-match only.
     */
    private enforceDiversity(queries: string[], maxOverlapRatio: number = 0.6): string[] {
        const result: string[] = []
        for (const q of queries) {
            const words = q.toLowerCase().split(/\s+/)
            const isDuplicate = result.some(existing => {
                const existingWords = existing.toLowerCase().split(/\s+/)
                const overlap = words.filter(w => existingWords.includes(w)).length
                return overlap / Math.max(words.length, existingWords.length) > maxOverlapRatio
            })
            if (!isDuplicate) result.push(q)
        }
        return result
    }

    /**
     * Generate search query sessions using AI API.
     * Each session is a group of related queries simulating a real user's search flow.
     * Uses trending topics as seeds for authenticity.
     * Falls back to local query list if API fails.
     */
    async generateAISessionQueries(sessionCount: number, langCode: string = 'vi'): Promise<string[][]> {
        // Gather trending seeds from existing sources for hybrid authenticity
        const [googleTrends, wikiTrends, redditTopics] = await Promise.all([
            this.getGoogleTrends('US').catch(() => []),
            this.getWikipediaTrending(langCode).catch(() => []),
            this.getRedditTopics().catch(() => [])
        ])
        const trendingSeeds = [
            ...googleTrends.slice(0, 5),
            ...wikiTrends.slice(0, 5),
            ...redditTopics.slice(0, 5)
        ]

        this.bot.logger.info(
            false,
            'AI-SESSION',
            `[AI] Gathering trending seeds | google=${googleTrends.length} | wiki=${wikiTrends.length} | reddit=${redditTopics.length} | seedsUsed=${trendingSeeds.length}`
        )

        const seedSection = trendingSeeds.length > 0
            ? `CHỦ ĐỀ GỢI Ý (có thể dùng hoặc không):\n${trendingSeeds.join('\n')}\n\n`
            : ''

        const prompt = `Bạn là một người dùng Bing thật ở Việt Nam. Hãy tạo ${sessionCount} phi��n tìm kiếm tự nhiên, mỗi phiên gồm 6-10 câu search liên tiếp.

${seedSection}QUY TẮC BẮT BUỘC:
- Mỗi phiên PHẢI có luồng suy nghĩ liên quan: bắt đầu từ 1 nhu cầu → đào sâu/mở rộng/chuyển hướng tự nhiên
- Mỗi phiên PHẢI chứa: ít nhất 1 query ngắn (2-4 từ), 1 query dài (8-15 từ), 1 query refine/sửa đổi từ query tr��ớc đó
- KHÔNG đánh số, KHÔNG gạch đầu dòng, KHÔNG giải thích
- Mỗi dòng 1 câu search, các phiên cách nhau bằng dòng trống
- Viết như đang NGHĨ và GÕ trên bàn phím, không phải viết văn
- Chủ đề đa dạng: ẩm thực, sức khỏe, công nghệ, du lịch, giáo dục, giải trí, thể thao, tài chính, gia đình, thời trang

VÍ D��� FORMAT ĐÚNG:
cách làm bún bò huế
bún bò huế ngon nhất sài g��n
quán bún bò huế quận 3
cách nấu bún bò huế tại nhà đơn giản
mua nguyên liệu bún bò huế ở đâu
bún bò huế bao nhiêu calo

laptop bị nóng khi chơi game
tại sao laptop dell bị nóng
cách vệ sinh quạt laptop dell
keo tản nhiệt loại nào tốt 2024
thay keo tản nhiệt laptop giá bao nhiêu`

        this.bot.logger.info(false, 'AI-SESSION', `[AI] Requesting ${sessionCount} search sessions from AI API...`)

        // Try each endpoint with retry logic
        for (const endpoint of this.aiEndpoints) {
            for (let retry = 0; retry < QueryCore.MAX_RETRIES; retry++) {
                try {
                    const controller = new AbortController()
                    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

                    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${endpoint.apiKey}`
                        },
                        body: JSON.stringify({
                            model: endpoint.model,
                            messages: [
                                { role: 'user', content: prompt }
                            ],
                            stream: false
                        }),
                        signal: controller.signal
                    })

                    clearTimeout(timeout)

                    if (!response.ok) {
                        this.bot.logger.warn(
                            false,
                            'AI-SESSION',
                            `[AI] Endpoint ${endpoint.baseUrl} failed: HTTP ${response.status} (retry ${retry + 1}/${QueryCore.MAX_RETRIES})`
                        )
                        if (retry < QueryCore.MAX_RETRIES - 1) {
                            await new Promise(r => setTimeout(r, QueryCore.RETRY_DELAY_MS * (retry + 1)))
                            continue
                        }
                        this.markEndpointFailed(endpoint)
                        break
                    }

                    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
                    const content = data.choices?.[0]?.message?.content || ''

                    this.bot.logger.info(false, 'AI-SESSION', `[AI] Raw response length: ${content.length} chars`)

                    // Parse sessions: split by double newline, then each session by single newline
                    const rawSessions = content.split(/\n\s*\n/)
                    const sessions: string[][] = []

                    for (const rawSession of rawSessions) {
                        const queries = rawSession
                            .split('\n')
                            .map((line: string) => line.trim())
                            .filter((line: string) =>
                                line.length > 3 &&
                                line.length < 200 &&
                                !/^\d+[.)]/.test(line) &&
                                !/^-/.test(line) &&
                                !/^\*/.test(line)
                            )

                        if (queries.length >= 3) {
                            sessions.push(queries)
                        }
                    }

                    if (sessions.length > 0) {
                        const totalQueries = sessions.reduce((sum, s) => sum + s.length, 0)
                        this.bot.logger.info(
                            false,
                            'AI-SESSION',
                            `[AI] ✅ Generated ${sessions.length} sessions (${totalQueries} total queries) from ${endpoint.baseUrl}`
                        )
                        this.bot.logger.info(
                            false,
                            'AI-SESSION',
                            `[AI] Sample session: ${sessions[0]?.slice(0, 3).map(q => `"${q}"`).join(' → ')}`
                        )
                        return sessions
                    } else {
                        this.bot.logger.warn(false, 'AI-SESSION', `[AI] ⚠️ No valid sessions parsed from response`)
                        break // No point retrying if parsing failed
                    }
                } catch (error) {
                    this.bot.logger.warn(
                        false,
                        'AI-SESSION',
                        `[AI] ❌ Endpoint ${endpoint.baseUrl} error (retry ${retry + 1}/${QueryCore.MAX_RETRIES}): ${errMsg(error)}`
                    )
                    if (retry < QueryCore.MAX_RETRIES - 1) {
                        await new Promise(r => setTimeout(r, QueryCore.RETRY_DELAY_MS * (retry + 1)))
                    } else {
                        this.markEndpointFailed(endpoint)
                    }
                }
            }
        }

        this.bot.logger.warn(false, 'AI-SESSION', `[AI] ❌ All AI endpoints failed`)
        return []
    }

    /**
     * Generate search queries using AI API with session-based prompting and hybrid trending sources.
     * Generates natural search sessions instead of flat random queries.
     * Applies diversity enforcement to prevent repetitive patterns.
     * Falls back to cached queries, then trending-enhanced local queries if API fails.
     */
    async generateAIQueries(count: number, langCode: string = 'vi'): Promise<string[]> {
        this.bot.logger.info(false, 'AI-QUERY', `[AI] Requesting ${count} queries via session-based generation...`)

        // Check cache first
        const cached = this.getCachedQueries(langCode)
        if (cached && cached.length >= count) {
            this.bot.logger.info(false, 'AI-QUERY', `[AI] Using ${count} cached queries`)
            return cached.slice(0, count)
        }

        try {
            // Calculate how many sessions we need (aim for ~8 queries per session)
            const sessionCount = Math.max(2, Math.ceil(count / 8))
            const sessions = await this.generateAISessionQueries(sessionCount, langCode)

            if (sessions.length === 0) {
                this.bot.logger.warn(false, 'AI-QUERY', `[AI] ⚠️ No sessions generated, falling back to trending-enhanced local`)
                return this.getEnhancedLocalQueries(count, langCode)
            }

            // Flatten sessions into single array, preserving session order
            let queries = sessions.flat()

            // Apply diversity enforcement to remove near-duplicates
            const beforeDiversity = queries.length
            queries = this.enforceDiversity(queries)
            this.bot.logger.debug(
                false,
                'AI-QUERY',
                `[AI] diversity filter | before=${beforeDiversity} | after=${queries.length}`
            )

            // Shuffle to avoid predictable session ordering
            this.bot.utils.shuffleArray(queries)

            // Trim to requested count
            queries = queries.slice(0, count)

            if (queries.length > 0) {
                this.bot.logger.info(false, 'AI-QUERY', `[AI] ✅ Generated ${queries.length} queries from ${sessions.length} sessions`)
                this.bot.logger.info(false, 'AI-QUERY', `[AI] Sample queries: ${queries.slice(0, 3).map(q => `"${q}"`).join(', ')}`)

                // Cache for future use
                this.cacheQueries(queries, langCode)
            } else {
                this.bot.logger.warn(false, 'AI-QUERY', `[AI] ⚠️ All queries filtered out, falling back to trending-enhanced local`)
                return this.getEnhancedLocalQueries(count, langCode)
            }

            return queries
        } catch (error) {
            this.bot.logger.warn(false, 'AI-QUERY', `[AI] ❌ Query generation ERROR: ${errMsg(error)}, falling back to trending-enhanced local`)
            return this.getEnhancedLocalQueries(count, langCode)
        }
    }

    /**
     * Get enhanced local queries combined with trending topics.
     * This provides better fallback than just local queries alone.
     */
    private async getEnhancedLocalQueries(count: number, langCode: string): Promise<string[]> {
        this.bot.logger.info(false, 'AI-FALLBACK', `Generating enhanced local queries...`)

        // Get trending topics
        const [googleTrends, wikiTrends, redditTopics] = await Promise.all([
            this.getGoogleTrends('US').catch(() => []),
            this.getWikipediaTrending(langCode).catch(() => []),
            this.getRedditTopics().catch(() => [])
        ])

        // Get local queries
        const localQueries = this.getLocalQueryList()

        // Combine trending topics with local queries
        const trendingQueries = [
            ...googleTrends.slice(0, 10),
            ...wikiTrends.slice(0, 10),
            ...redditTopics.slice(0, 10)
        ]

        // Mix: 60% local, 40% trending
        const mixedQueries: string[] = []
        const localCount = Math.floor(count * 0.6)
        const trendingCount = count - localCount

        // Add shuffled local queries
        const shuffledLocal = [...localQueries]
        this.bot.utils.shuffleArray(shuffledLocal)
        mixedQueries.push(...shuffledLocal.slice(0, localCount))

        // Add shuffled trending queries
        const shuffledTrending = [...trendingQueries]
        this.bot.utils.shuffleArray(shuffledTrending)
        mixedQueries.push(...shuffledTrending.slice(0, trendingCount))

        // Final shuffle
        this.bot.utils.shuffleArray(mixedQueries)

        const result = mixedQueries.slice(0, count)
        this.bot.logger.info(
            false,
            'AI-FALLBACK',
            `Generated ${result.length} enhanced queries (local: ${Math.min(localCount, shuffledLocal.length)}, trending: ${Math.min(trendingCount, shuffledTrending.length)})`
        )

        return result
    }
}

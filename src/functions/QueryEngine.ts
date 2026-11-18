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
    private cacheTtlMs = 30 * 60 * 1000 // 30 minutes
    private maxRetries = 3
    private retryDelayMs = 2000

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
            geoLocale = 'vn'
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
            } catch {
                // Most lines in this response are not the payload; skip and try
                // the next one rather than failing the whole extraction.
            }
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
            const wikiLang = (langCode || 'en').split(/[-_]/)[0]?.toLowerCase() || 'en'
            const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
            const yyyy = date.getUTCFullYear()
            const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
            const dd = String(date.getUTCDate()).padStart(2, '0')

            const request: AxiosRequestConfig = {
                url: `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${wikiLang}.wikipedia/all-access/${yyyy}/${mm}/${dd}`,
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
            model: this.resolveModelSlug(config.model, config.baseUrl),
            apiKey: config.apiKey || '',
            priority: 1,
            failureCount: 0
        })

        // Fallback providers from config
        if (config.fallbackProviders) {
            for (const provider of config.fallbackProviders) {
                if (provider.enabled && provider.apiKey !== undefined) {
                    this.aiEndpoints.push({
                        baseUrl: provider.baseUrl,
                        model: this.resolveModelSlug(provider.model, provider.baseUrl),
                        apiKey: provider.apiKey || '',
                        priority: provider.priority,
                        failureCount: 0
                    })
                }
            }
        }

        // Update settings from config
        this.maxRetries = config.maxRetries ?? this.maxRetries
        this.retryDelayMs = config.retryDelayMs ?? this.retryDelayMs
        this.cacheTtlMs = config.cacheTtlMs ?? this.cacheTtlMs

        // Sort by priority
        this.aiEndpoints.sort((a, b) => a.priority - b.priority)

        this.bot.logger.debug(
            false,
            'AI-INIT',
            `Initialized ${this.aiEndpoints.length} AI endpoint(s): ${this.aiEndpoints.map(e => e.baseUrl).join(', ')}`
        )
    }

    /**
     * Resolves model alias like *free to router-supported slugs
     */
    private resolveModelSlug(model: string, baseUrl: string): string {
        const trimmed = (model || '').trim()
        if (trimmed === '*free' || trimmed.endsWith('/*free')) {
            if (baseUrl.includes('kilo')) {
                return 'kilo-auto/free'
            }
            if (baseUrl.includes('openrouter.ai')) {
                return 'openrouter/free'
            }
            return 'reward_bing'
        }
        return trimmed
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
        if (now - this.queryCache.timestamp > this.cacheTtlMs) {
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
     * Build the AI prompt for generating academic & technology research search sessions.
     */
    public buildAISessionPrompt(
        sessionCount: number,
        langCode: string = 'vi',
        geo: string = 'VN',
        trendingSeeds: string[] = []
    ): string {
        const normalizedLang = (langCode || 'vi').trim().toLowerCase()
        const isVietnamese = normalizedLang === 'vi' || normalizedLang.startsWith('vi-') || normalizedLang.startsWith('vi_')

        if (isVietnamese) {
            const seedSection = trendingSeeds.length > 0
                ? `CHỦ ĐỀ THỜI SỰ GỢI Ý (chỉ tham khảo khi có thể khai thác dưới góc độ học thuật, khoa học máy tính hoặc kỹ thuật công nghệ):\n${trendingSeeds.join('\n')}\n\n`
                : ''

            return `Bạn là một nghiên cứu sinh và kỹ sư khoa học máy tính tại khu vực ${geo}. Hãy tạo ${sessionCount} phiên tìm kiếm học thuật trên Bing, mỗi phiên gồm 6-10 câu truy vấn liên tiếp.

${seedSection}TRỌNG TÂM NỘI DUNG (nghiên cứu học thuật & công nghệ chuyên sâu):
- Học máy & kiến trúc Transformer (FlashAttention, KV cache quantization, Mixture-of-Experts, LoRA, RLHF)
- Hệ thống phân tán & đồng thuận (thuật toán Raft, Paxos, Byzantine fault tolerance, vector clocks, CRDT)
- Mật mã học & bằng chứng không tiết lộ (zk-SNARK, zk-STARK, mật mã hậu lượng tử Kyber/ML-KEM, TLS 1.3)
- Nhân hệ điều hành & quản lý bộ nhớ (Linux eBPF, io_uring, slab allocator, page table, NUMA scheduling)
- Trình biên dịch & tối ưu hóa LLVM IR (SSA form, loop vectorization, register allocation, JIT compilation)
- Cơ sở dữ liệu nội tại (cấu trúc B+Tree, LSM-tree compaction, MVCC snapshot isolation, WAL durability)
- Mạng máy tính & giao thức (QUIC, HTTP/3, BGP routing RPKI, TCP BBR congestion control, RDMA)
- Vi mạch VLSI & kiến trúc bán dẫn RISC-V (out-of-order execution, branch prediction, EUV, FinFET vs GAAFET, HBM3E)
- Kỹ nghệ phần mềm & xác minh hình thức (TLA+, chứng minh định lý Lean 4 / Coq, static taint analysis)
- Đại số tuyến tính ứng dụng & tối ưu hóa (SVD, L-BFGS, tối ưu lồi, stochastic gradient descent)
- Phân tích bài báo khoa học trên IEEE, ACM, arXiv (đọc ablation study, benchmark thực nghiệm, độ phức tạp thuật toán)

QUY TẮC BẮT BUỘC:
- Mỗi phiên PHẢI tiến triển tự nhiên theo luồng nghiên cứu: khái niệm học thuật rộng → cơ chế kỹ thuật / bài báo IEEE ACM arXiv / benchmark → so sánh đánh giá / chi tiết triển khai
- Mỗi phiên PHẢI kết hợp: query ngắn (2-4 từ), query dài (8-15 từ) và ít nhất 1 query tinh chỉnh/mở rộng từ query ngay trước đó
- Viết bằng tiếng Việt tự nhiên (có thể giữ thuật ngữ chuyên ngành tiếng Anh chuẩn như trong nghiên cứu thực tế)
- KHÔNG đánh số, KHÔNG gạch đầu dòng, KHÔNG giải thích thêm
- Mỗi dòng đúng 1 câu truy vấn, các phiên cách nhau bằng 1 dòng trống

VÍ DỤ FORMAT ĐÚNG:
kiến trúc flashattention
cơ chế tiling giảm truy cập hbm trong flashattention 2
bài báo flashattention 3 tối ưu hóa trên hopper gpu
so sánh flashattention và pagedattention khi inference llm dài
kv cache quantization int4 ảnh hưởng thế nào đến perplexity
triển khai fused attention kernel bằng triton

thuật toán đồng thuận raft
cách raft xử lý leader election và split vote
phân tích log replication safety proof trong paper raft
so sánh độ trễ đuôi giữa raft và multi paxos
tối ưu hóa batching và pipelining cho etcd raft
mô hình hóa giao thức raft bằng tla plus`
        }

        const seedSection = trendingSeeds.length > 0
            ? `OPTIONAL TRENDING SPARKS (only use if reframed through an academic, scientific, or computer-science/engineering lens):\n${trendingSeeds.join('\n')}\n\n`
            : ''

        return `You are a computer science researcher and systems engineer in region ${geo}. Generate ${sessionCount} realistic Bing academic search sessions, each containing 6-10 connected search queries.

${seedSection}PRIMARY RESEARCH DOMAINS (scholarly & technical depth):
- Machine learning & transformer architectures (FlashAttention, KV cache quantization, Mixture-of-Experts, LoRA, RLHF, state-space models)
- Distributed systems & consensus protocols (Raft, Paxos, Byzantine fault tolerance, vector clocks, CRDTs, TrueTime)
- Cryptography & zero-knowledge proofs (zk-SNARKs, Groth16, post-quantum lattice cryptography ML-KEM, TLS 1.3 handshake)
- OS kernels & memory management (Linux eBPF verifier, io_uring, slab allocator, virtual memory page walk, NUMA scheduling)
- Compiler optimization & LLVM IR (SSA form, polyhedral loop optimization, register allocation, JIT tiered compilation)
- Database internals (B+Tree latch crabbing, LSM-tree write amplification, MVCC serializable snapshot isolation, WAL recovery)
- Computer networks & transport protocols (QUIC 0-RTT, HTTP/3, BGP RPKI security, TCP BBRv3 congestion control, RoCE RDMA)
- VLSI & RISC-V semiconductor architecture (RISC-V vector extension, out-of-order Tomasulo, EUV lithography, FinFET vs GAAFET, HBM3E)
- Software engineering & formal verification (TLA+ temporal logic, Lean 4 / Coq proofs, static taint analysis, property-based testing)
- Applied linear algebra & numerical optimization (SVD conditioning, L-BFGS-B, convex duality, Hessian-free optimization)
- Empirical reading of IEEE, ACM, and arXiv papers (ablation studies, systems benchmarks, asymptotic complexity proofs)

MANDATORY SESSION RULES:
- Every session MUST progress naturally like a real scholar researching a topic: broad academic concept -> technical mechanism / IEEE or ACM or arXiv paper / benchmark -> comparative evaluation / implementation detail
- Every session MUST mix short queries (2-4 words), long queries (8-15 words), and at least 1 refinement of an earlier query
- Write in natural English matching real technical search typing
- NO numbering, NO bullet points, NO commentary or explanations
- Exactly one query per line, separated between sessions by a single blank line

VALID OUTPUT EXAMPLE:
transformer kv cache
how flashattention reduces hbm memory bandwidth overhead
flashattention 3 asynchronous warp specialization arxiv paper
pagedattention vs ring attention long context throughput benchmark
int4 kv cache quantization impact on needle in haystack recall
implementing fused attention kernel in triton

b plus tree concurrency
latch crabbing vs optimistic lock coupling in b trees
mvcc serializable snapshot isolation write skew anomaly detection
lsm tree compaction write amplification leveled vs tiered
rocksdb vs wiredtiger latency tail under mixed olap workload
formal verification of lock free b tree in tla plus`
    }

    /**
     * Generate search query sessions using AI API.
     * Each session is a group of related queries simulating a real user's search flow.
     * Uses trending topics as seeds for authenticity.
     * Falls back to local query list if API fails.
     */
    async generateAISessionQueries(sessionCount: number, langCode: string = 'vi'): Promise<string[][]> {
        const geo = (this.bot?.userData?.geoLocale || 'VN').toUpperCase()
        const [googleTrends, wikiTrends, redditTopics] = await Promise.all([
            this.getGoogleTrends(geo).catch(() => []),
            this.getWikipediaTrending(langCode).catch(() => []),
            this.getRedditTopics('MachineLearning+compsci+programming').catch(() => [])
        ])
        const trendingSeeds = [
            ...googleTrends.slice(0, 4),
            ...wikiTrends.slice(0, 4),
            ...redditTopics.slice(0, 7)
        ]

        this.bot.logger.info(
            false,
            'AI-SESSION',
            `[AI] Gathering trending seeds | google=${googleTrends.length} | wiki=${wikiTrends.length} | reddit=${redditTopics.length} | seedsUsed=${trendingSeeds.length}`
        )

        const prompt = this.buildAISessionPrompt(sessionCount, langCode, geo, trendingSeeds)

        this.bot.logger.info(false, 'AI-SESSION', `[AI] Requesting ${sessionCount} search sessions from AI API...`)

        // Try each endpoint with retry logic
        for (const endpoint of this.aiEndpoints) {
            for (let retry = 0; retry < this.maxRetries; retry++) {
                try {
                    const controller = new AbortController()
                    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

                    const headers: Record<string, string> = {
                        'Content-Type': 'application/json'
                    }
                    if (endpoint.apiKey && endpoint.apiKey !== 'none') {
                        headers['Authorization'] = `Bearer ${endpoint.apiKey}`
                    }

                    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers,
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
                            `[AI] Endpoint ${endpoint.baseUrl} failed: HTTP ${response.status} (retry ${retry + 1}/${this.maxRetries})`
                        )
                        if (retry < this.maxRetries - 1) {
                            await new Promise(r => setTimeout(r, this.retryDelayMs * (retry + 1)))
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
                        `[AI] ❌ Endpoint ${endpoint.baseUrl} error (retry ${retry + 1}/${this.maxRetries}): ${errMsg(error)}`
                    )
                    if (retry < this.maxRetries - 1) {
                        await new Promise(r => setTimeout(r, this.retryDelayMs * (retry + 1)))
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
        const geo = (this.bot?.userData?.geoLocale || 'VN').toUpperCase()
        const [googleTrends, wikiTrends, redditTopics] = await Promise.all([
            this.getGoogleTrends(geo).catch(() => []),
            this.getWikipediaTrending(langCode).catch(() => []),
            this.getRedditTopics('MachineLearning+compsci+programming').catch(() => [])
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

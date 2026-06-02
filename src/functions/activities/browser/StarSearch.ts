import type { Page } from 'patchright'
import { randomBytes } from 'crypto'

import type { MicrosoftRewardsBot } from '../../../index'
import { errMsg } from '../../../util/Utils'

/**
 * STAR Search — Supplementary Topic-Aware Random Search
 *
 * Runs AFTER point-earning searches are complete.
 * Generates N completely different topics, then expands each topic
 * into additional related searches for a more natural browsing pattern.
 */
export class StarSearch {
    private bot: MicrosoftRewardsBot
    private bingHome = 'https://bing.com'
    private searchCount = 0

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async doStarSearch(page: Page, isMobile: boolean): Promise<void> {
        const starCount = this.bot.config.workers.starSearchCount ?? 5
        // Force Vietnamese for all searches
        const langCode = 'vi'
        const geoLocale = (this.bot.userData.geoLocale ?? 'VN').toLowerCase()

        this.bot.logger.info(isMobile, 'STAR-SEARCH', `Starting STAR Search | topics=${starCount} | lang=${langCode} | geo=${geoLocale}`)

        try {
            // Generate completely unique, meaningful queries that Bing cannot predict
            // No external sources — pure algorithmic generation
            // Queries are generated in the account's configured language for natural behavior
            const uniqueQueries = await this.generateUniqueQueries(starCount, langCode)

            if (uniqueQueries.length === 0) {
                this.bot.logger.warn(isMobile, 'STAR-SEARCH', 'No queries generated, skipping')
                return
            }

            this.bot.logger.info(
                isMobile,
                'STAR-SEARCH',
                `Generated ${uniqueQueries.length} unique queries: ${uniqueQueries.slice(0, 3).map(t => `"${t}"`).join(', ')}${uniqueQueries.length > 3 ? '...' : ''}`
            )

            // Each query stands alone — no expansion, no clustering
            const expandedSearches: { topic: string; queries: string[] }[] = uniqueQueries.map(q => ({
                topic: q,
                queries: []
            }))

            const totalSearches = uniqueQueries.length
            this.bot.logger.info(isMobile, 'STAR-SEARCH', `Total STAR searches: ${totalSearches}`)

            // Navigate to Bing
            await page.goto(this.bingHome)
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(page)

            // Step 3: Execute searches topic by topic
            let completedSearches = 0

            for (const { topic, queries } of expandedSearches) {
                this.bot.logger.info(isMobile, 'STAR-SEARCH', `Topic: "${topic}" | sub-queries=${queries.length}`)

                // Search the base topic first
                await this.executeSearch(page, topic, isMobile)
                completedSearches++

                // Then search expanded sub-queries
                for (const query of queries) {
                    await this.executeSearch(page, query, isMobile)
                    completedSearches++
                }

                this.bot.logger.info(
                    isMobile,
                    'STAR-SEARCH',
                    `Topic "${topic}" done | progress=${completedSearches}/${totalSearches}`
                )

                // Random pause between topics
                const topicPause = this.bot.utils.randomDelay(2000, 5000)
                await this.bot.utils.wait(topicPause)
            }

            this.bot.logger.info(
                isMobile,
                'STAR-SEARCH',
                `STAR Search completed | topics=${totalSearches} | totalSearches=${completedSearches}`,
                'green'
            )
        } catch (error) {
            this.bot.logger.error(isMobile, 'STAR-SEARCH', `Error: ${errMsg(error)}`)
        }
    }

    /**
     * Word pools per language for generating unique, meaningful queries.
     * Each language has its own set of domains, temporal markers, specificity,
     * patterns, actions, concepts, and query templates.
     */
    private getWordPool(langCode: string) {
        // Vietnamese word pools
        if (langCode === 'vi') {
            return {
                domains: [
                    'vật lý lượng tử', 'kiến trúc trung cổ', 'sinh học biển sâu', 'thiên văn học cổ đại',
                    'mật mã học', 'di truyền học thực vật', 'khí tượng học', 'ngôn ngữ học', 'luyện kim',
                    'hải dương học', 'cổ sinh vật học', 'khoa học thần kinh', 'nhiệt động lực học', 'bản đồ học',
                    'lý thuyết âm nhạc', 'phát triển vắc-xin', 'kỹ thuật vệ tinh', 'khảo cổ học',
                    'ẩm thực dân gian', 'văn hóa Chăm Pa', 'nghệ thuật gốm Bát Tràng', 'y học cổ truyền',
                    'nông nghiệp bền vững', 'kiến trúc nhà Nguyễn', 'thủy văn học đồng bằng'
                ],
                temporalMarkers: [
                    'thời kỳ đổi mới', 'vào năm 2087', 'trước cách mạng công nghiệp',
                    'sau nhật thực tiếp theo', 'thời nhà Lý', 'trong thế kỷ 22',
                    'sau trận động đất Huế 1904', 'thời kỳ Bắc thuộc',
                    'sau khi máy in ra đời', 'vào năm 2150',
                    'thời kỳ Phục Hưng', 'trước Thế chiến thứ nhất', 'trong thập niên 1920',
                    'thời nhà Trần chống quân Nguyên', 'thời kỳ Pháp thuộc',
                    'sau giải phóng miền Nam', 'thời kỳ bao cấp'
                ],
                specificity: [
                    'ở vùng ven biển', 'trong cộng đồng dân tộc thiểu số', 'bằng công cụ thô sơ',
                    'với nguồn lực hạn chế', 'trong điều kiện khắc nghiệt', 'ở cộng đồng biệt lập',
                    'qua phương pháp phi truyền thống', 'bằng kỹ thuật bị lãng quên', 'dùng kiến thức cổ xưa',
                    'ở vùng cao nguyên', 'trên các tuyến thương mại', 'trong hội kín',
                    'tại đồng bằng sông Cửu Long', 'ở vùng trung du Bắc Bộ', 'trên cao nguyên đá Đồng Văn'
                ],
                patterns: [
                    'tại sao', 'làm thế nào', 'điều gì đã khiến', 'nguyên nhân nào',
                    'như thế nào mà', 'sẽ ra sao nếu', 'làm sao có thể', 'vì sao',
                    'yếu tố nào dẫn đến', 'cách nào mà'
                ],
                actions: [
                    'ảnh hưởng đến', 'tác động tới', 'biến đổi', 'hỗ trợ', 'ngăn cản',
                    'thúc đẩy', 'làm phức tạp', 'đơn giản hóa', 'cách mạng hóa', 'thách thức',
                    'định hình', 'thay đổi hoàn toàn', 'tạo điều kiện cho'
                ],
                concepts: [
                    'phương thức giao tiếp', 'chiến lược sinh tồn', 'quản lý tài nguyên',
                    'kỹ thuật định vị', 'bảo tồn tri thức', 'cấu trúc xã hội',
                    'hệ thống năng lượng', 'sản xuất lương thực', 'cơ chế phòng thủ', 'mạng lưới thương mại',
                    'biểu đạt nghệ thuật', 'hiểu biết toán học', 'thực hành y học',
                    'phong tục tập quán', 'truyền thống văn hóa'
                ],
                templates: [
                    // "tại sao [domain1] ảnh hưởng đến [concept] [temporal] [specific]"
                    (p: string, d1: string, a: string, c: string, t: string, s: string) =>
                        `${p} ${d1} ${a} ${c} ${t} ${s}`,
                    // "làm thế nào [domain1] và [domain2] biến đổi [concept] [temporal]"
                    (p: string, d1: string, a: string, c: string, t: string, s: string, d2: string) =>
                        `${p} ${d1} và ${d2} ${a} ${c} ${t}`,
                    // "điều gì đã khiến [domain1] khả thi [specific] [temporal]"
                    (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                        `điều gì đã khiến ${d1} trở nên khả thi ${s} ${t}`,
                    // "[domain1] ảnh hưởng [domain2] như thế nào [temporal] [specific]"
                    (_p: string, d1: string, a: string, _c: string, t: string, s: string, d2: string) =>
                        `${d1} ${a} ${d2} như thế nào ${t} ${s}`,
                    // "[domain1] [temporal] có gì đặc biệt [specific]"
                    (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                        `${d1} ${t} có gì đặc biệt ${s}`,
                    // "tìm hiểu về [domain1] [specific]"
                    (_p: string, d1: string, _a: string, _c: string, _t: string, s: string) =>
                        `tìm hiểu về ${d1} ${s}`
                ]
            }
        }

        // Japanese word pools
        if (langCode === 'ja') {
            return {
                domains: [
                    '量子物理学', '中世建築', '深海生物学', '古代天文学',
                    '暗号技術', '植物遺伝学', '気象学', '言語学', '冶金学',
                    '海洋学', '古生物学', '神経科学', '熱力学', '地図学',
                    '音楽理論', 'ワクチン開発', '衛星工学', '考古学'
                ],
                temporalMarkers: [
                    '江戸時代に', '2087年に', '産業革命前に',
                    '次の日食後に', '唐の時代に', '22世紀に',
                    '1923年関東大震災後に', '平安時代に',
                    '活版印刷発明後に', '2150年に',
                    'ルネサンス期に', '第一次世界大戦前に', '1920年代に'
                ],
                specificity: [
                    '沿岸地域で', '遊牧民族の間で', '原始的な道具を使って',
                    '限られた資源で', '極限環境下で', '孤立した共同体で',
                    '非伝統的な方法で', '忘れ去られた技術で', '失われた知識を使って',
                    '高地環境で', '交易路に沿って', '秘密結社内で'
                ],
                patterns: [
                    'なぜ', 'どのように', '何が原因で', 'どうして',
                    '何が起きたか', 'もし〜ならどうなるか', 'どうすれば', '何が〜させたのか'
                ],
                actions: [
                    '影響した', '変えた', '変革した', '可能にした', '妨げた',
                    '加速させた', '複雑にした', '簡素化した', '革命した', '挑んだ'
                ],
                concepts: [
                    '通信手段', '生存戦略', '資源管理',
                    '航海技術', '知識の保存', '社会構造',
                    'エネルギーシステム', '食料生産', '防御機構', '交易ネットワーク',
                    '芸術表現', '数学的理解', '医療行為'
                ],
                templates: [
                    (p: string, d1: string, a: string, c: string, t: string, s: string) =>
                        `${p}${d1}は${c}を${a}のか ${t} ${s}`,
                    (p: string, d1: string, a: string, c: string, t: string, s: string, d2: string) =>
                        `${p}${d1}と${d2}は${c}を${a}のか ${t}`,
                    (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                        `何が${d1}を${s}${t}に可能にしたのか`,
                    (_p: string, d1: string, a: string, _c: string, t: string, s: string, d2: string) =>
                        `${d1}は${d2}にどう${a}か ${t} ${s}`,
                    (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                        `${d1} ${t} ${s} について`
                ]
            }
        }

        // Korean word pools
        if (langCode === 'ko') {
            return {
                domains: [
                    '양자물리학', '중세 건축', '심해 생물학', '고대 천문학',
                    '암호학', '식물 유전학', '기상학', '언어학', '야금학',
                    '해양학', '고생물학', '신경과학', '열역학', '지도학',
                    '음악 이론', '백신 개발', '위성 공학', '고고학'
                ],
                temporalMarkers: [
                    '조선 시대에', '2087년에', '산업혁명 이전에',
                    '다음 일식 이후에', '당나라 시대에', '22세기에',
                    '1906년 이후에', '삼국 시대에',
                    '인쇄술 발명 이후에', '2150년에',
                    '르네상스 시기에', '제1차 세계대전 이전에', '1920년대에'
                ],
                specificity: [
                    '해안 지역에서', '유목 민족 사이에서', '원시 도구를 사용하여',
                    '제한된 자원으로', '극한 조건에서', '고립된 공동체에서',
                    '비전통적 방법으로', '잊혀진 기술을 통해', '잃어버린 지식을 사용하여',
                    '고지대 환경에서', '무역로를 따라', '비밀 결사 내에서'
                ],
                patterns: [
                    '어떻게', '왜', '무엇이 원인이 되어', '어떠한 이유로',
                    '만약 ~라면', '어떻게 가능했는가', '왜 그렇게 되었는가'
                ],
                actions: [
                    '영향을 미쳤다', '변화시켰다', '변혁했다', '가능하게 했다', '방해했다',
                    '가속화했다', '복잡하게 만들었다', '단순화했다', '혁명했다', '도전했다'
                ],
                concepts: [
                    '의사소통 방법', '생존 전략', '자원 관리',
                    '항해 기술', '지식 보존', '사회 구조',
                    '에너지 시스템', '식량 생산', '방어 메커니즘', '무역 네트워크',
                    '예술적 표현', '수학적 이해', '의료 관행'
                ],
                templates: [
                    (p: string, d1: string, a: string, c: string, t: string, s: string) =>
                        `${p} ${d1}이(가) ${c}에 ${a} ${t} ${s}`,
                    (p: string, d1: string, a: string, c: string, t: string, s: string, d2: string) =>
                        `${p} ${d1}과 ${d2}이(가) ${c}를 ${a} ${t}`,
                    (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                        `무엇이 ${d1}을(를) ${s} ${t}에 가능하게 했는가`,
                    (_p: string, d1: string, a: string, _c: string, t: string, s: string, d2: string) =>
                        `${d1}이(가) ${d2}에 어떻게 ${a} ${t} ${s}`,
                    (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                        `${d1} ${t} ${s}에 대하여`
                ]
            }
        }

        // French word pools
        if (langCode === 'fr') {
            return {
                domains: [
                    'physique quantique', 'architecture médiévale', 'biologie des abysses', 'astronomie ancienne',
                    'cryptographie', 'génétique botanique', 'météorologie', 'linguistique', 'métallurgie',
                    'océanographie', 'paléontologie', 'neuroscience', 'thermodynamique', 'cartographie',
                    'théorie musicale', 'développement de vaccins', 'ingénierie satellitaire', 'archéologie'
                ],
                temporalMarkers: [
                    'pendant la Révolution française', 'en 2087', 'avant la révolution industrielle',
                    'après la prochaine éclipse solaire', 'sous la dynastie Tang', 'au 22e siècle',
                    'après le séisme de 1906', 'à l\'ère viking',
                    'après l\'invention de l\'imprimerie', 'en l\'an 2150',
                    'pendant la Renaissance', 'avant la Première Guerre mondiale', 'dans les années 1920'
                ],
                specificity: [
                    'dans les régions côtières', 'parmi les tribus nomades', 'avec des outils primitifs',
                    'avec des ressources limitées', 'dans des conditions extrêmes', 'dans des communautés isolées',
                    'par des méthodes non conventionnelles', 'via des techniques oubliées', 'avec des savoirs perdus',
                    'en haute altitude', 'le long des routes commerciales', 'au sein de sociétés secrètes'
                ],
                patterns: [
                    'comment', 'pourquoi', 'qu\'est-ce qui a', 'quelle est la cause de',
                    'que se passerait-il si', 'comment pourrait-on', 'pourquoi est-ce que', 'qu\'est-ce qui a conduit à'
                ],
                actions: [
                    'a influencé', 'a transformé', 'a révolutionné', 'a permis', 'a empêché',
                    'a accéléré', 'a compliqué', 'a simplifié', 'a remis en question', 'a façonné'
                ],
                concepts: [
                    'les méthodes de communication', 'les stratégies de survie', 'la gestion des ressources',
                    'les techniques de navigation', 'la préservation du savoir', 'les structures sociales',
                    'les systèmes énergétiques', 'la production alimentaire', 'les mécanismes de défense', 'les réseaux commerciaux',
                    'l\'expression artistique', 'la compréhension mathématique', 'les pratiques médicales'
                ],
                templates: [
                    (p: string, d1: string, a: string, c: string, t: string, s: string) =>
                        `${p} la ${d1} ${a} ${c} ${t} ${s}`,
                    (p: string, d1: string, a: string, c: string, t: string, s: string, d2: string) =>
                        `${p} la ${d1} et la ${d2} ${a} ${c} ${t}`,
                    (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                        `qu'est-ce qui a rendu la ${d1} possible ${s} ${t}`,
                    (_p: string, d1: string, a: string, _c: string, t: string, s: string, d2: string) =>
                        `comment la ${d1} ${a} la ${d2} ${t} ${s}`,
                    (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                        `${d1} ${t} ${s} pourquoi est-ce important`
                ]
            }
        }

        // Default: English word pools (fallback for all other languages)
        return {
            domains: [
                'quantum physics', 'medieval architecture', 'deep sea biology', 'ancient astronomy',
                'cryptography', 'botanical genetics', 'meteorology', 'linguistics', 'metallurgy',
                'oceanography', 'paleontology', 'neuroscience', 'thermodynamics', 'cartography',
                'music theory', 'vaccine development', 'satellite engineering', 'archaeology'
            ],
            temporalMarkers: [
                'during the 1847 gold rush', 'in 2087', 'before the industrial revolution',
                'after the next solar eclipse', 'during the Tang dynasty', 'in the 22nd century',
                'following the 1906 San Francisco earthquake', 'during the Viking age',
                'after the invention of the printing press', 'in the year 2150',
                'during the Renaissance period', 'before World War I', 'in the 1920s jazz age'
            ],
            specificity: [
                'in coastal regions', 'among nomadic tribes', 'using primitive tools',
                'with limited resources', 'under extreme conditions', 'in isolated communities',
                'through unconventional methods', 'via forgotten techniques', 'using lost knowledge',
                'in high-altitude environments', 'across trade routes', 'within secret societies'
            ],
            patterns: [
                'how', 'why', 'what made', 'what caused', 'how did',
                'what would happen if', 'how could', 'why would', 'what led to'
            ],
            actions: [
                'affected', 'influenced', 'transformed', 'enabled', 'prevented',
                'accelerated', 'complicated', 'simplified', 'revolutionized', 'challenged'
            ],
            concepts: [
                'communication methods', 'survival strategies', 'resource management',
                'navigation techniques', 'knowledge preservation', 'social structures',
                'energy systems', 'food production', 'defense mechanisms', 'trade networks',
                'artistic expression', 'mathematical understanding', 'medical practices'
            ],
            templates: [
                (p: string, d1: string, a: string, c: string, t: string, s: string) =>
                    `${p} ${d1} ${a} ${c} ${t} ${s}`,
                (p: string, d1: string, a: string, c: string, t: string, s: string, d2: string) =>
                    `${p} ${d1} and ${d2} ${a} ${c} ${t}`,
                (_p: string, d1: string, _a: string, _c: string, t: string, s: string) =>
                    `what made ${d1} possible ${s} ${t}`,
                (_p: string, d1: string, a: string, _c: string, t: string, s: string, d2: string) =>
                    `how did ${d1} influence ${d2} ${t} ${s}`
            ]
        }
    }

    /**
     * Default AI API configuration (used when config.json has no ai section)
     */
    private readonly defaultAiConfig = {
        baseUrl: 'https://9router.qwen2api.pp.ua/v1',
        model: 'reward_bing',
        apiKey: 'sk-d8d38c4dbe7182c6-5wpch9-c84f2f0a'
    }

    /**
     * Get AI config from config.json or fall back to defaults
     */
    private get aiConfig() {
        return this.bot.config.ai ?? this.defaultAiConfig
    }

    /**
     * Generate search queries using Qwen AI API.
     * Always generates in Vietnamese. Falls back to algorithmic generation if API fails.
     */
    private async generateQueriesWithAI(count: number, _langCode: string): Promise<string[]> {
        // Always use Vietnamese
        const prompt = `Tạo chính xác ${count} câu search bằng tiếng Việt. QUY TẮC FORMAT:
- Chỉ trả về các câu search, mỗi dòng một câu
- KHÔNG đánh số (không "1.", "2.", v.v.)
- KHÔNG gạch đầu dòng (không "-", "*", v.v.)
- KHÔNG thêm giải thích, tiêu đề hay văn bản thừa
- Mỗi câu: 5-15 từ, nghe tự nhiên như người thật tìm kiếm
- Chủ đề đa dạng: khoa học, lịch sử, công nghệ, văn hóa, sức khỏe, du lịch, ẩm thực, giáo dục, thể thao, giải trí

Ví dụ format đúng:
cách làm bánh flan dừa tại nhà
lịch sử đền hùng phú thọ
tác dụng của trà xanh với sức khỏe`

        this.bot.logger.info(false, 'STAR-SEARCH', `[AI] Requesting ${count} Vietnamese queries from Qwen API...`)

        try {
            const response = await fetch(`${this.aiConfig.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.aiConfig.apiKey}`
                },
                body: JSON.stringify({
                    model: this.aiConfig.model,
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    stream: false
                })
            })

            if (!response.ok) {
                this.bot.logger.warn(false, 'STAR-SEARCH', `[AI] Query generation FAILED: HTTP ${response.status}`)
                return []
            }

            const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
            const content = data.choices?.[0]?.message?.content || ''

            this.bot.logger.info(false, 'STAR-SEARCH', `[AI] Raw response length: ${content.length} chars`)

            const queries = content
                .split('\n')
                .map((line: string) => line.trim())
                .filter((line: string) => line.length > 5 && line.length < 200 && !/^\d+[.)]/.test(line) && !/^-/.test(line) && !/^\*/.test(line))
                .slice(0, count)

            if (queries.length > 0) {
                this.bot.logger.info(false, 'STAR-SEARCH', `[AI] ✅ Generated ${queries.length} Vietnamese queries`)
                this.bot.logger.info(false, 'STAR-SEARCH', `[AI] Sample queries: ${queries.slice(0, 3).map(q => `"${q}"`).join(', ')}`)
            } else {
                this.bot.logger.warn(false, 'STAR-SEARCH', `[AI] ⚠️ No valid queries parsed from response`)
            }
            return queries
        } catch (error) {
            this.bot.logger.warn(false, 'STAR-SEARCH', `[AI] ❌ Query generation ERROR: ${errMsg(error)}`)
            return []
        }
    }

    /**
     * Generate completely unique, meaningful search queries.
     * Tries AI-powered generation first, falls back to algorithmic word-pool templates.
     *
     * Queries are generated in the account's configured language (vi, en, ja, ko, fr...).
     * Vietnamese example: "tại sao vật lý lượng tử ảnh hưởng đến phương thức giao tiếp thời kỳ đổi mới ở vùng ven biển"
     * English example: "how quantum physics affected communication methods during the 1847 gold rush in coastal regions"
     */
    private async generateUniqueQueries(count: number, langCode: string): Promise<string[]> {
        // Try AI-powered generation first
        const aiQueries = await this.generateQueriesWithAI(count, langCode)
        if (aiQueries.length >= count) {
            return aiQueries.slice(0, count)
        }

        // Fallback to algorithmic generation
        const queries: string[] = [...aiQueries]
        const seen = new Set<string>(aiQueries.map(q => q.toLowerCase()))

        const pool = this.getWordPool(langCode)

        let attempts = 0
        const maxAttempts = count * 10

        while (queries.length < count && attempts < maxAttempts) {
            attempts++

            const pattern = pool.patterns[Math.floor(Math.random() * pool.patterns.length)] ?? ''
            const domain1 = pool.domains[Math.floor(Math.random() * pool.domains.length)] ?? ''
            const domain2 = pool.domains[Math.floor(Math.random() * pool.domains.length)] ?? ''
            const temporal = pool.temporalMarkers[Math.floor(Math.random() * pool.temporalMarkers.length)] ?? ''
            const specific = pool.specificity[Math.floor(Math.random() * pool.specificity.length)] ?? ''
            const action = pool.actions[Math.floor(Math.random() * pool.actions.length)] ?? ''
            const concept = pool.concepts[Math.floor(Math.random() * pool.concepts.length)] ?? ''

            // Skip if same domain twice or empty
            if (domain1 === domain2 || !domain1 || !domain2) continue

            // Pick a random template
            const templateIdx = Math.floor(Math.random() * pool.templates.length)
            const template = pool.templates[templateIdx]
            if (!template) continue

            const query = template(pattern, domain1, action, concept, temporal, specific, domain2).trim()

            if (!query) continue

            const normalized = query.toLowerCase().trim()
            if (!seen.has(normalized)) {
                seen.add(normalized)
                queries.push(query)
            }
        }

        return queries
    }

    /**
     * Execute a single Bing search with human-like behavior.
     * Includes random scrolling, clicking, text selection, and fake interactions.
     */
    private async executeSearch(page: Page, query: string, isMobile: boolean): Promise<void> {
        const refreshThreshold = 10
        this.searchCount++

        try {
            // Refresh page periodically to avoid sluggishness
            if (this.searchCount % refreshThreshold === 0) {
                const cvid = randomBytes(16).toString('hex')
                const url = `${this.bingHome}/search?q=${encodeURIComponent(query)}&PC=U531&FORM=ANNTA1&cvid=${cvid}`
                await page.goto(url)
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
                await this.bot.browser.utils.tryDismissAllMessages(page)
            }

            const searchBar = '#sb_form_q'
            const searchBox = page.locator(searchBar)

            await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'auto' }))
            await page.keyboard.press('Home')
            await searchBox.waitFor({ state: 'visible', timeout: 15000 })

            await this.bot.utils.wait(1000)
            await this.bot.browser.utils.ghostClick(page, searchBar, { clickCount: 3 })
            await searchBox.fill('')

            // Type query with human-like variable delay (not perfectly uniform)
            await this.typeLikeHuman(page, query)
            await page.keyboard.press('Enter')

            this.bot.logger.info(isMobile, 'STAR-SEARCH', `Searched: "${query}"`)

            await this.bot.utils.wait(3000)

            // Perform fake actions on search results page (70% chance)
            if (Math.random() < 0.7) {
                await this.performFakeActions(page, isMobile)
            }

            // Visit a random result page (60% chance) with fake actions inside
            if (this.bot.config.searchSettings.clickRandomResults || Math.random() < 0.6) {
                await this.visitRandomResult(page, isMobile)
            }

            // Random delay between searches
            await this.bot.utils.wait(
                this.bot.utils.randomDelay(
                    this.bot.config.searchSettings.searchDelay.min,
                    this.bot.config.searchSettings.searchDelay.max
                )
            )
        } catch (error) {
            this.bot.logger.warn(isMobile, 'STAR-SEARCH', `Search failed for "${query}": ${errMsg(error)}`)
        }
    }

    /**
     * Type text with variable delay like a real human (not uniform 50ms).
     * Occasional micro-pauses simulate thinking.
     */
    private async typeLikeHuman(page: Page, text: string): Promise<void> {
        for (const char of text) {
            // 5% chance of a longer pause (thinking), 20% short pause, rest normal
            const rand = Math.random()
            let delay: number
            if (rand < 0.05) {
                delay = this.bot.utils.randomNumber(180, 350)
            } else if (rand < 0.25) {
                delay = this.bot.utils.randomNumber(90, 150)
            } else {
                delay = this.bot.utils.randomNumber(30, 80)
            }
            await page.keyboard.type(char, { delay: 0 })
            await this.bot.utils.wait(delay)
        }
    }

    /**
     * Perform a random sequence of fake actions on the current page.
     * Randomly picks 3-6 actions from: scroll, select text, click element, mouse move, read pause.
     */
    private async performFakeActions(page: Page, isMobile: boolean): Promise<void> {
        const actionCount = this.bot.utils.randomNumber(3, 6)
        const actions = ['scroll', 'scroll', 'selectText', 'clickElement', 'mouseMove', 'readPause']

        for (let i = 0; i < actionCount; i++) {
            const action = actions[Math.floor(Math.random() * actions.length)] ?? 'scroll'
            try {
                switch (action) {
                    case 'scroll':
                        await this.naturalScroll(page, isMobile)
                        break
                    case 'selectText':
                        await this.selectRandomText(page, isMobile)
                        break
                    case 'clickElement':
                        await this.clickRandomElement(page, isMobile)
                        break
                    case 'mouseMove':
                        if (!isMobile) await this.moveMouseRandomly(page)
                        else await this.naturalScroll(page, isMobile)
                        break
                    case 'readPause':
                        await this.simulateReading(page, isMobile)
                        break
                }
            } catch (error) {
                this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Fake action "${action}" error: ${errMsg(error)}`)
            }

            // Random pause between actions (300-1500ms)
            await this.bot.utils.wait(this.bot.utils.randomDelay(300, 1500))
        }
    }

    /**
     * Natural scrolling: multiple small scrolls with pauses, up and down.
     * Simulates reading through content.
     */
    private async naturalScroll(page: Page, isMobile: boolean): Promise<void> {
        try {
            const scrollSteps = this.bot.utils.randomNumber(2, 5)
            const scrollDirection = Math.random() < 0.7 ? 1 : -1 // 70% down, 30% up

            for (let i = 0; i < scrollSteps; i++) {
                const scrollAmount = Math.floor(Math.random() * 400 + 100) * scrollDirection
                await page.evaluate(
                    (amount: number) => window.scrollBy({ left: 0, top: amount, behavior: 'smooth' }),
                    scrollAmount
                )
                // Small pause between scrolls (like reading)
                await this.bot.utils.wait(this.bot.utils.randomDelay(200, 600))
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Natural scroll error: ${errMsg(error)}`)
        }
    }

    /**
     * Select random text on the page (highlight like reading).
     * Uses Range API to select a random text node.
     */
    private async selectRandomText(page: Page, isMobile: boolean): Promise<void> {
        try {
            const selected = await page.evaluate(() => {
                // Find all text-containing elements (paragraphs, headings, spans)
                const candidates = document.querySelectorAll('p, h1, h2, h3, h4, li, span, .b_algo .b_caption')
                const textElements = Array.from(candidates).filter(el => {
                    const text = el.textContent?.trim() ?? ''
                    return text.length > 20 && text.length < 500
                })

                if (textElements.length === 0) return false

                const target = textElements[Math.floor(Math.random() * textElements.length)]
                if (!target) return false

                try {
                    const selection = window.getSelection()
                    if (!selection) return false

                    // Create a range and select a portion of the text
                    const range = document.createRange()
                    const text = target.textContent ?? ''
                    const start = Math.floor(Math.random() * Math.max(1, text.length / 2))
                    const end = Math.min(text.length, start + Math.floor(Math.random() * 60 + 20))

                    const textNode = target.firstChild
                    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                        range.setStart(textNode, Math.min(start, textNode.textContent?.length ?? 0))
                        range.setEnd(textNode, Math.min(end, textNode.textContent?.length ?? 0))
                        selection.removeAllRanges()
                        selection.addRange(range)
                        return true
                    }
                } catch {
                    return false
                }
                return false
            })

            if (selected) {
                // Hold selection for a moment (like reading)
                await this.bot.utils.wait(this.bot.utils.randomDelay(800, 2000))

                // Deselect by clicking elsewhere
                await page.mouse.click(10, 10)
                await this.bot.utils.wait(300)
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Select text error: ${errMsg(error)}`)
        }
    }

    /**
     * Click a random non-link element on the page (headings, images, paragraphs).
     * Avoids navigation - just clicks in place.
     */
    private async clickRandomElement(page: Page, isMobile: boolean): Promise<void> {
        try {
            const clicked = await page.evaluate(() => {
                // Clickable non-navigation elements
                const selectors = [
                    'h1',
                    'h2',
                    'h3',
                    'h4',
                    'p',
                    'img',
                    'li',
                    '.b_algo h2',
                    '.b_algo .b_caption',
                    'span.b_snippetBig',
                    '.b_top',
                    '.b_ans'
                ]

                const elements: Element[] = []
                for (const sel of selectors) {
                    elements.push(...Array.from(document.querySelectorAll(sel)))
                }

                // Filter visible, non-empty elements
                const visible = elements.filter(el => {
                    const rect = el.getBoundingClientRect()
                    return (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        rect.top > 0 &&
                        rect.top < window.innerHeight * 3 &&
                        (el.textContent?.trim().length ?? 0) > 0
                    )
                })

                if (visible.length === 0) return null

                const target = visible[Math.floor(Math.random() * visible.length)]
                if (!target) return null

                const rect = target.getBoundingClientRect()
                return {
                    x: rect.left + rect.width / 2 + window.scrollX,
                    y: rect.top + rect.height / 2 + window.scrollY,
                    tag: target.tagName
                }
            })

            if (clicked && clicked.x > 0 && clicked.y > 0) {
                // Move mouse to element, then click
                await page.mouse.move(clicked.x, clicked.y, { steps: this.bot.utils.randomNumber(5, 15) })
                await this.bot.utils.wait(this.bot.utils.randomDelay(100, 300))
                await page.mouse.click(clicked.x, clicked.y)
                await this.bot.utils.wait(this.bot.utils.randomDelay(300, 800))
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Click element error: ${errMsg(error)}`)
        }
    }

    /**
     * Move mouse to random positions on the page (desktop only).
     * Simulates natural mouse wandering.
     */
    private async moveMouseRandomly(page: Page): Promise<void> {
        try {
            const viewport = page.viewportSize()
            if (!viewport) return

            const moves = this.bot.utils.randomNumber(2, 5)
            for (let i = 0; i < moves; i++) {
                const x = Math.floor(Math.random() * viewport.width)
                const y = Math.floor(Math.random() * viewport.height)
                await page.mouse.move(x, y, { steps: this.bot.utils.randomNumber(8, 20) })
                await this.bot.utils.wait(this.bot.utils.randomDelay(100, 400))
            }
        } catch (error) {
            this.bot.logger.debug(false, 'STAR-SEARCH', `Mouse move error: ${errMsg(error)}`)
        }
    }

    /**
     * Simulate reading: scroll to a position, pause for a while, maybe scroll a bit more.
     */
    private async simulateReading(page: Page, isMobile: boolean): Promise<void> {
        try {
            // Scroll to a random position
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const scrollPos = Math.floor(Math.random() * (totalHeight - viewportHeight) * 0.8)
            await page.evaluate((pos: number) => window.scrollTo({ left: 0, top: pos, behavior: 'smooth' }), scrollPos)

            // "Read" for 2-6 seconds
            await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 6000))

            // Small scroll adjustment (like adjusting reading position)
            const adjustScroll = Math.floor(Math.random() * 150 - 75)
            await page.evaluate(
                (amount: number) => window.scrollBy({ left: 0, top: amount, behavior: 'smooth' }),
                adjustScroll
            )
            await this.bot.utils.wait(this.bot.utils.randomDelay(500, 1500))
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Reading sim error: ${errMsg(error)}`)
        }
    }

    /**
     * Visit a random search result and perform fake actions inside.
     * Replaces the old clickRandomLink - more comprehensive.
     */
    private async visitRandomResult(page: Page, isMobile: boolean): Promise<void> {
        try {
            const searchPageUrl = page.url()

            // Collect all result links
            const links = await page.evaluate(() => {
                const resultLinks = document.querySelectorAll('#b_results .b_algo h2 a')
                return Array.from(resultLinks)
                    .filter(a => {
                        const href = (a as HTMLAnchorElement).href
                        return (
                            href &&
                            !href.includes('bing.com') &&
                            !href.includes('microsoft.com') &&
                            !href.includes('wikipedia.org/wiki/Main')
                        )
                    })
                    .map((a, idx) => ({
                        href: (a as HTMLAnchorElement).href,
                        text: a.textContent?.trim().substring(0, 80) ?? '',
                        index: idx
                    }))
            })

            if (links.length === 0) return

            // Pick a random result (not always the first one)
            const chosen = links[Math.floor(Math.random() * Math.min(links.length, 8))]
            if (!chosen) return

            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Visiting: "${chosen.text}"`)

            // Scroll to the link first (natural behavior)
            await page.evaluate((idx: number) => {
                const els = document.querySelectorAll('#b_results .b_algo h2 a')
                const el = els[idx] as HTMLElement | undefined
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, chosen.index)
            await this.bot.utils.wait(this.bot.utils.randomDelay(500, 1200))

            // Click the link
            await page.evaluate((href: string) => {
                const link = document.querySelector(`a[href="${CSS.escape(href)}"]`) as HTMLElement | null
                if (link) link.click()
            }, chosen.href)

            await this.bot.utils.wait(3000)

            // Get the page we landed on
            let visitPage: Page = page
            if (!isMobile) {
                visitPage = await this.bot.browser.utils.getLatestTab(page)
            }

            if (visitPage !== page || isMobile) {
                await visitPage.waitForLoadState('domcontentloaded').catch(() => {})
                await this.bot.utils.wait(this.bot.utils.randomDelay(1500, 3000))

                // Perform 2-4 fake actions inside the visited page
                const visitActions = this.bot.utils.randomNumber(2, 4)
                for (let i = 0; i < visitActions; i++) {
                    await this.performFakeActions(visitPage, isMobile)
                    await this.bot.utils.wait(this.bot.utils.randomDelay(800, 2000))
                }

                // Stay on the page for a bit (like reading)
                await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
            }

            // Return to search results
            if (isMobile) {
                await page.goto(searchPageUrl)
            } else {
                const currentTab = await this.bot.browser.utils.getLatestTab(page)
                if (currentTab !== page) {
                    await currentTab.close().catch(() => {})
                }
            }

            await this.bot.utils.wait(this.bot.utils.randomDelay(1000, 2500))
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Visit result error: ${errMsg(error)}`)
            // Ensure we're back on search page
            if (!isMobile) {
                const tab = await this.bot.browser.utils.getLatestTab(page).catch(() => page)
                if (tab !== page) await tab.close().catch(() => {})
            }
        }
    }
}

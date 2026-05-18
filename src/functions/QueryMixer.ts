interface TaggedQuery {
    query: string
    category: string
}

export class QueryMixer {
    static interleave(buckets: Map<string, string[]>): string[] {
        const tagged: TaggedQuery[] = []

        for (const [category, queries] of buckets) {
            for (const query of queries) {
                tagged.push({ query, category })
            }
        }

        // Fisher-Yates shuffle
        for (let i = tagged.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            const temp = tagged[i]!
            tagged[i] = tagged[j]!
            tagged[j] = temp
        }

        // Anti-adjacency pass: no more than 2 consecutive same-category
        for (let i = 2; i < tagged.length; i++) {
            if (tagged[i]!.category === tagged[i - 1]!.category && tagged[i]!.category === tagged[i - 2]!.category) {
                let swapped = false
                for (let j = i + 1; j < Math.min(i + 10, tagged.length); j++) {
                    if (tagged[j]!.category !== tagged[i]!.category) {
                        const tmp = tagged[i]!
                        tagged[i] = tagged[j]!
                        tagged[j] = tmp
                        swapped = true
                        break
                    }
                }
                if (!swapped) {
                    for (let j = 0; j < i - 2; j++) {
                        if (tagged[j]!.category !== tagged[i]!.category &&
                            (j === 0 || tagged[j - 1]!.category !== tagged[i]!.category)) {
                            const tmp = tagged[i]!
                            tagged[i] = tagged[j]!
                            tagged[j] = tmp
                            break
                        }
                    }
                }
            }
        }

        return tagged.map(t => t.query)
    }
}

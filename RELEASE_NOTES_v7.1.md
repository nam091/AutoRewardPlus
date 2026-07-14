# AutoRewardPlus v7.1

## Reliability and performance

- Reuse the direct Axios client and its retry policy instead of allocating a new client for every direct request.
- Honor AI retry, retry-delay, and cache-TTL settings at runtime.
- Return the parsed Zod configuration so defaults such as Modern UI missions and point claiming are actually applied.

## Configuration safety

- Validate Google Sheets and all AI fallback-provider options exposed by `config.example.json`.
- Reject invalid URLs, durations, delay ranges, cluster counts, and enabled proxy settings before a run starts.
- Remove unsupported star-search options and the embedded API key-shaped value from the example configuration.

## Quality gates

- Add an ESLint 9 flat configuration and repeatable `lint`, `test`, and `check` commands.
- Add regression tests for config defaults, integrations, invalid ranges, account validation, duration parsing, chunking, and secret-free example configuration.
- Upgrade vulnerable dependencies; `npm audit` reports zero known vulnerabilities at release time.

The dashboard is intentionally unchanged in this release.

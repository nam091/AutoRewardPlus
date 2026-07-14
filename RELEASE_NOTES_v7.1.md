# AutoRewardPlus v7.1

## Reliability and performance

- Reuse the direct Axios client and its retry policy instead of allocating a new client for every direct request.
- Honor AI retry, retry-delay, and cache-TTL settings at runtime.
- Return the parsed Zod configuration so defaults such as Modern UI missions and point claiming are actually applied.

## Configuration safety

- Validate Google Sheets and all AI fallback-provider options exposed by `config.example.json`.
- Reject invalid URLs, durations, delay ranges, cluster counts, and configured proxy endpoints before a run starts while preserving legacy empty proxy settings.
- Remove unsupported star-search options and the embedded API key-shaped value from the example configuration.

## Quality gates

- Add an ESLint 9 flat configuration and repeatable `lint`, `test`, and `check` commands.
- Add regression tests for config defaults, integrations, invalid ranges, account validation, duration parsing, chunking, and secret-free example configuration.
- Upgrade vulnerable dependencies; `npm audit` reports zero known vulnerabilities at release time.

The dashboard is intentionally unchanged in this release.

## Seeded behavior and fingerprint consistency

- Replace per-read Canvas randomness and conflicting CPU/RAM/WebGL overrides with a stable account/device seed.
- Use Playwright Core with the Chromium binary managed by Patchright so pre-navigation fingerprint scripts are
  actually executed; Patchright 1.57-1.61 custom init scripts were verified not to run in this environment.
- Choose result behavior by weight and select among visible organic results instead of always clicking the first.
- Add exact-locator hover, bounded long-session breaks, deterministic account start offsets, and hashed telemetry.
- Honor HTTP `Retry-After` for rate limiting and temporary throttling.
- Add deterministic policy tests and a real Chromium smoke test for mobile fingerprint values, stable Canvas reads,
  `webdriver`, and browser-context cleanup.

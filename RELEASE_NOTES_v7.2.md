# AutoRewardPlus v7.2

## Modern UI tasks that never ran

Verified against `rewards.bing.com` on 2026-07-26. Three defects each caused tasks to be silently skipped
rather than to fail, so runs reported success while collecting nothing.

- **Daily set clicked nothing at all.** Point values render as a bare `10` on `/dashboard`; `+N` appears
  nowhere on that page. Requiring the `+` left every card with no parsed value, and the "earnable" filter then
  discarded all of them. Both forms are now accepted, and daily set cards no longer need a parsed point value
  to be treated as earnable.
- **Keep earning resolved an empty section.** Several elements share the id `moreactivities` and the heading
  "Keep earning"; the first is a placeholder with no cards and a later one holds them. Taking the first match
  found zero cards. Every candidate is now examined and the one with cards is used.
- **The section info popover was clicked instead of the expand control.** A section contains both an
  `About <section>` popover button carrying `aria-expanded="false"` and the real disclosure trigger with
  `slot="trigger"`. Matching the generic attribute selector first opened a tooltip and left the section
  collapsed.

## Clicking the wrong task

- Cards and mission sub-tasks were located by their position in a filtered list. Completing one sub-task
  removed it from that list and shifted every later index, so the loop clicked the wrong row and skipped the
  last one. Elements are now matched by `href` or text identity, with the index only as a fallback.
- The mission fallback path clicked `cards[mission.index]` against a differently filtered collection, which
  could open an unrelated card. It now reports a miss and captures diagnostics instead of guessing.

## Selector resilience

- All selectors, section ids, heading aliases, and localized text markers moved to
  `src/functions/ModernUISelectors.ts` as ordered fallback chains.
- Sections resolve by non-localized `id` first (`dailyset`, `moreactivities`, `quests`, `levelup`), falling
  back to heading text matched against per-language aliases, so a non-English account is handled.
- Sections render skeleton placeholders while loading, sometimes for well over ten seconds. Workers wait for
  real content instead of a fixed delay.
- A failed selector writes the page HTML, a screenshot, and the attempted selectors to `diagnostics/modern-ui/`.
- New `npm run audit-selectors -- <email>` reports, per section, which candidates exist and how many elements
  each selector resolves to.

## Reporting accuracy

- `pcProgress` and `mobileProgress` are read from the live counters instead of the hardcoded `90/90` and
  `60/60`, which previously reported a completed run even for a failed account.
- The CLI dashboard table showed placeholder data, including `Math.random()` as the point total. It now reads
  recorded run state.

## Reliability

- Accounts failing on transient infrastructure errors are retried up to three times with increasing backoff.
  Credential, lockout, and configuration failures are not retried.
- With `clusters > 1`, workers forward state changes to the primary over IPC and only the primary writes
  `db.json`, which is written atomically. Concurrent clusters previously lost updates by overwriting each
  other.
- `HumanizeEngine` now draws from the seeded source used by the rest of the project; mouse paths, typing
  rhythm, and dwell times were previously unseeded despite the documented behavior profile.
- A missing execution context throws instead of fabricating an empty account, and failures that were
  swallowed silently (browser cleanup, invalid log-filter patterns) are now reported.

## Secrets

- `src/dashboard/db.json` is no longer tracked; it contained account emails. Note that prior commits still
  hold that history.
- `.dockerignore` excludes `accounts.json`, `config.json`, `db.json`, `service-account.json`, and `.env`. The
  builder stage runs `COPY . .`, so credentials were previously baked into that layer.

## Tests

Coverage for the modern UI scraping went from none to 16 cases running against real Chromium with fixtures
reproducing the live markup, including regressions for each defect above. Total suite: 31 cases.

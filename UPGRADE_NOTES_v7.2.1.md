# AutoRewardPlus v7.2.1 Upgrade Notes

This snapshot keeps the Modern UI workers from v7.2 and adds operational patterns selected from Microsoft-Rewards-Script v4.

## Added

- `ProcessManager` with start, stop, restart, duplicate-run protection, graceful shutdown, escalation, structured status, bounded logs, error history and run history.
- Dashboard endpoints for status, logs, errors, run history, diagnostics inventory and session inventory.
- Dashboard bearer-token or `X-API-Key` authentication when `DASHBOARD_API_TOKEN` is set.
- Localhost-only dashboard default. Remote binding requires `DASHBOARD_API_TOKEN`.
- Optional `DASHBOARD_ALLOWED_ORIGIN` and explicit `DASHBOARD_ALLOW_CONFIG_WRITE=1` gate for config writes.
- Schema-validated, backed-up and atomic config writes with secret redaction on read.
- Account-scoped session inventory and deletion, disabled while a run is active.
- TLS certificate verification remains enabled by default. `proxy.ignoreCertificateErrors` is an explicit opt-in and only applies when a proxy is configured.
- Root-only Chromium sandbox flags, rather than disabling the sandbox for every runtime.
- Compose now builds the checked-out source instead of pulling an unrelated upstream image.
- Offline tests for process lifecycle and dashboard authentication.

## Dashboard environment

```env
DASHBOARD_HOST=127.0.0.1
DASHBOARD_API_TOKEN=
DASHBOARD_ALLOWED_ORIGIN=
DASHBOARD_ALLOW_CONFIG_WRITE=0
```

For a remote dashboard, use a long random token, set `DASHBOARD_HOST=0.0.0.0`, restrict `DASHBOARD_ALLOWED_ORIGIN`, and put the service behind a TLS reverse proxy or private network. Do not expose an unauthenticated dashboard.

## Validation performed

- TypeScript build: passed.
- Full Node test suite: **35 passed, 0 failed**.
- Browser smoke test with local HTTP fixture: passed.
- Prettier check for changed files: passed.
- No live Microsoft Rewards login or account credentials were used.

## Deliberate non-changes

Modern UI selectors, mission identity matching, skeleton loading handling, localized headings and card verification remain from v7.2. Experimental API Search and Edge Browsing were not enabled by default because they depend on changing Rewards endpoints and require separate credit/compatibility validation.

## Security note

The project automates Microsoft Rewards and may expose an account to suspension or other platform action. Use only accounts and environments for which you have authorization. Keep credentials in local ignored files or environment variables and never commit them.

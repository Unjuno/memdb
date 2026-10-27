# MemDB 0.1.0 verification and release notes

## Scope

This release completes the English-only application and its repeatable test/deployment path. It does not represent an observed Cloudflare production deployment. Credentials, account-specific configuration and provider budget controls remain owner-managed.

## Verified source behavior

CI run https://github.com/Unjuno/memdb/actions/runs/40584733865 tested commit `d8d95204a5ff73686c4c79278fb7640f73054d61`:

| Check | Result | Boundary |
| --- | --- | --- |
| Core, SQL, HTTP, quota, reliability, security and deployment preflight | 49 passed | Node SQLite; not remote D1 |
| MCP protocol transport | 8 passed | Actual SDK; 5 legacy tests and 3 modern wire-client tests |
| Worker/D1 HTTP and MCP smoke | 17 passed | Disposable local Wrangler/D1 |
| Chromium network E2E | Successful job running 5 tests | Real local HTTPS; self-signed loopback certificate |
| TypeScript build and Worker bundle | Passed | Not a live deployment |

Core CI used Node 22.23.3, npm 10.9.9, TypeScript 5.8.3 and MCP server/core 2.3.1. The browser job is pinned to Ubuntu 24.04 with Python 3.12 and Playwright 1.57.0 because the pinned Playwright version failed to install on Ubuntu 26.04. No throughput or latency claim is made.

The Chromium tests navigate normally, load scripts/styles, preview, save, reload, preserve a conflicted draft, use a Unicode path, read raw Markdown, and enforce CSP/origin checks. There is no intercepted fetch or HTML injection. Only loopback certificates can bypass verification in the test harness. Modern MCP tests use protocol 2026-07-28 metadata and direct tool calls without initialize/session; older 2025-11-25 support remains tested. This is not a claim about every third-party MCP host.

## Dependency repair

The old lock reported three affected packages: undici (high), miniflare and wrangler (moderate via undici). A non-forced npm repair updated the development toolchain, including undici 7.30.1 and Wrangler 4.154.0. The production MCP/Zod dependencies did not change.

Candidate verification: https://github.com/Unjuno/memdb/actions/runs/40584721894

The candidate passed `npm ci`, the 49+8 tests, the Worker bundle and an audit reporting zero known vulnerabilities. The downloaded `verified-dependency-repair` artifact, ID `12771001301`, has SHA-256 `07453a9be9c9d663b740e4dfb2513a4439375f5728383e1dc107667f002054c4`, verified against GitHub metadata. JSON whitespace alone was compacted; the committed lock blob is `4f7abe9b82e9dd837d578753c8b8bac47ee7728f`. Final CI reruns all jobs against this lock before merge. An audit is a point-in-time known-advisory check, not proof of absence of vulnerabilities.

## Review and corrections

Review was by the implementer, not an independent reviewer. A fail-first regression showed sibling-subdomain `Sec-Fetch-Site: same-site` reads could increase deletion counters. Those requests now fail with 403 without counting a read; same-origin and metadata-free bot access remain supported. Deployment now validates the exact configuration used for both D1 migrations and the Worker deploy, rather than checking a different default file. Browser harness viewport setup was checked against the real Playwright API and corrected before the successful network run.

No secrets, provider tokens or real deployment identifiers are committed. No automatic production deploy runs on push or merge. The manual deployment workflow requires main, explicit acknowledgments, configuration validation and a token available only to the deployment step.

## Remaining boundaries

Remote Cloudflare D1 transactions/failure recovery, public-certificate HTTPS, production quotas/billing and distributed abuse/load have not been tested here. No independent security audit has occurred. Anonymous rewrites, coordinated reads that trigger deletion and exhausted shared limits remain inherent risks. No retention, privacy or recovery guarantee is made. Markdown remains a safe basic subset, not complete CommonMark/GFM. The source-license status is intentionally unchanged.

See [shipping instructions](ship.md), [release checklist](release-checklist.md) and the [archived verification evidence](verification-history.md).

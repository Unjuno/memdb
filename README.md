# MemDB

Anonymous Markdown path wiki and temporary shared memory for humans and AI agents.

**Development MVP, not a deployed service.** The browser/API/store and official MCP SDK adapter are implemented. The previous GitHub CI run passed 33 core tests, 5 real SDK transport tests, the full TypeScript build and the Worker bundle dry run. This local worktree additionally passes 43 core/reliability/release-gate tests and four Chromium DOM tests. A new CI job is prepared for a disposable Wrangler/D1 integration smoke, but its result is not verified until the changes are pushed. Production D1 and unrestricted-browser end-to-end testing remain separate release gates.

## What it does

A string such as `research/experiment-01` identifies a page. Humans open `/p/research/experiment-01`; agents call `read_page`, `save_page`, `append_page`, or `get_page_status` at `/mcp`. All interfaces use the same store and operation limits.

- No account, password, bot identifier, public list, or dashboard.
- English-only interface, error messages and documentation; page paths still accept Unicode.
- First successful save allocates storage; missing reads allocate no page or hit row.
- Anyone may edit. CAS revisions prevent stale overwrites, including across deletion/recreation; revisions are opaque, globally increasing numbers, not per-page counters.
- Safe Markdown subset: headings, paragraphs, lists, code, emphasis, and HTTP(S) links. Raw HTML is escaped; images are not embedded. This is **not a complete CommonMark/GFM renderer**.
- High-read pages lock and can be deleted. Cold pages are not deleted just because they are old.
- **Policy C:** when a new page cannot fit, reclaim at most eight already-eligible hot pages, atomically with creation. If insufficient, delete nothing and return `507 STORAGE_FULL`. Existing-page edits never evict other pages.

> Public, anonymous and temporary means **no secrecy, ownership, retention, or recovery guarantee**. Never store secrets, personal information or irreplaceable records. Page text is untrusted input, not instructions for AI. An attacker can deliberately trigger reads and hence deletion eligibility.

## Local setup

Prerequisites: Node.js 22.16+ and npm. Install dependencies from the registry:

```sh
npm ci
npm run db:local
npm run dev
```

Open `http://127.0.0.1:8787/`. The exact origin matters; `localhost` is a different origin under the default configuration. MCP endpoint: `http://127.0.0.1:8787/mcp`.

```sh
npm run test:core  # TypeScript + real local SQLite, now includes reliability + release-gate tests
npm test           # also compiles and tests the actual MCP SDK adapter
# Optional Chromium DOM harness, with a local HTTP bridge in restricted environments:
# pip install -r requirements-browser-tests.txt
# python -m playwright install chromium
npm run test:browser
```

## HTTP interfaces

| Method / path | Behavior |
| --- | --- |
| `GET /` | Path entry form only |
| `GET /p/<path>` | Browser shell, no page allocation or read count |
| `GET /api/pages/<path>` | Accepted read; Markdown, safe rendered HTML, revision and state |
| `PUT /api/pages/<path>` | `{ "markdown": "...", "expected_version": 0 }` creates; returned revision required to replace |
| `POST /api/append/<path>` | `{ "markdown": "...", "expected_version": 123 }`; version optional for atomic append |
| `GET /api/status/<path>` | Metadata only, no accepted-read increment |
| `GET /raw/<path>` | Markdown; counts an accepted read |
| `POST /api/preview` | Render draft without allocating or counting a page |
| `/mcp` | Official SDK v2 HTTP adapter, modern protocol plus legacy stateless clients |

Separate `pages`, `append`, and `status` prefixes are intentional: a key ending in `/status` or `/append` is still a normal page. Paths use NFC, case sensitivity, at most eight segments and 256 UTF-8 bytes. Traversal, controls, backslashes and ambiguous double encodings are rejected.

## Storage policy

Defaults are design choices, not benchmark-derived limits: 32 KiB/page, 128 MiB aggregate Markdown, 10,000 pages. These are **logical** limits, not physical D1 storage limits.

Reads use current plus preceding 23 UTC-hour buckets. At 100 reads, editing locks. After at least 12 hours, below 50 reads permits unlocking. Normal GC deletes pages with at least 300 reads on **each** of the two completed UTC days. Policy C additionally requires a 12-hour existing lock, age of at least 24 hours, 300 reads across at least six distinct hour buckets. Deletion freezes a path for seven days. Cron runs every five minutes, with at most 100 normal deletions per run.

Rate limits use shared global/page keys only, not IP/user/bot IDs. Cloudflare's rate limits are approximate **per location**, not a strict worldwide budget. Defaults: 1200 requests/minute/location, 60 reads/status calls per page/minute/location, 10 writes per page/minute/location, 20 creations/minute/location. They reduce load; they do not establish identity or prevent coordinated abuse.

## Deployment gate

Do not deploy the placeholder configuration unchanged.

1. Create a D1 database with `npx wrangler d1 create memdb` and put its real ID in `wrangler.jsonc`.
2. Set `PUBLIC_ORIGIN` to the exact HTTPS production origin; choose rate-limit namespace IDs unused by unrelated Workers.
3. Run the local D1 smoke defined in CI and independently verify against a disposable Cloudflare D1 deployment. Complete the [release checklist](docs/release-checklist.md).
4. Before production deployment, apply real migrations with `npx wrangler d1 migrations apply memdb --remote`, only after verifying the account and target database.
5. `npm run deploy` now runs a **fail-closed predeploy check**: it rejects local origins, placeholder D1 IDs/rate namespaces, missing cron and missing explicit operator acknowledgments. This does not configure billing controls. Read the [runbook](docs/runbook.md) first.
6. Only after reviewing independent security, browser and provider budget evidence, deploy manually. No automatic production deployment is configured.

There are no deployment credentials in this repository. Missing limiter bindings and invalid origins fail closed. Configure provider-level spend/resource limits and private operational monitoring; this project has no public dashboard.

## Verification status

- **PASS LOCALLY IN THIS WORKTREE:** 43 core/SQL/HTTP/reliability/release-gate tests with Node 22.16.0, TypeScript 5.8.3 and SQLite 3.49.1, plus four Chromium DOM/JavaScript tests with a server-backed fetch bridge and a 14-check HTTP/SQLite Policy C smoke. Includes quota/revision invariants across 250 mixed operations, transaction rollback, 20 competing CAS updates, 20 appends, malformed input, XSS payloads, and origin/rate rejection.
- **PASS IN GITHUB CI:** full TypeScript build, 5 actual MCP SDK transport tests (legacy initialization plus four tools), and `wrangler deploy --dry-run`. CI used Ubuntu 26.04.1, Node 22.23.3, npm 10.9.9, MCP server/core 2.3.1, Zod 4.6.7, TypeScript 5.8.3 and Wrangler 4.152.0. See [verification evidence](docs/verification.md). Local registry DNS remained unavailable; this result comes from the actual GitHub job, not a local SDK run.
- **PARTIAL BROWSER VERIFICATION:** real Chromium DOM and JS executed in four tests, but direct localhost navigation is blocked (`ERR_BLOCKED_BY_ADMINISTRATOR`); CSP and full network browser E2E remain unverified.
- **NOT DEPLOYED:** public endpoint and production D1. Local SQLite is not proof of Cloudflare behavior under network failure or distributed load.

`package-lock.json` records the complete dependency graph used by the successful CI run. It is JSON-equivalent to that run's lock artifact, with whitespace compacted only. Use `npm ci`, not a fresh dependency resolution, for verification. Runtime compatibility and security still need review; a lock file does not establish them.

See [security model](SECURITY.md), [architecture and decisions](docs/architecture.md), [operator runbook](docs/runbook.md), and [release checklist](docs/release-checklist.md).

## License

No license has been selected. Public visibility does not grant an open-source license.

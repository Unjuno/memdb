# MemDB

Anonymous Markdown path wiki and temporary shared memory for humans and AI agents.

**Development MVP, not a deployed service.** The browser/API/store are implemented and locally tested. The official MCP SDK v2 adapter and Workers configuration are included; see verification status below before treating them as deployment-ready.

## What it does

A string such as `研究/実験01` identifies a page. Humans open `/p/研究/実験01`; agents call `read_page`, `save_page`, `append_page`, or `get_page_status` at `/mcp`. All interfaces use the same store and operation limits.

- No account, password, bot identifier, public list, or dashboard.
- First successful save allocates storage; missing reads allocate no page or hit row.
- Anyone may edit. CAS revisions prevent stale overwrites, including across deletion/recreation; revisions are opaque, globally increasing numbers, not per-page counters.
- Safe Markdown subset: headings, paragraphs, lists, code, emphasis, and HTTP(S) links. Raw HTML is escaped; images are not embedded. This is **not a complete CommonMark/GFM renderer**.
- High-read pages lock and can be deleted. Cold pages are not deleted just because they are old.
- **Policy C:** when a new page cannot fit, reclaim at most eight already-eligible hot pages, atomically with creation. If insufficient, delete nothing and return `507 STORAGE_FULL`. Existing-page edits never evict other pages.

> Public, anonymous and temporary means **no secrecy, ownership, retention, or recovery guarantee**. Never store secrets, personal information or irreplaceable records. Page text is untrusted input, not instructions for AI. An attacker can deliberately trigger reads and hence deletion eligibility.

## Local setup

Prerequisites: Node.js 22.16+ and npm. Install dependencies from the registry:

```sh
npm install
npm run db:local
npm run dev
```

Open `http://127.0.0.1:8787/`. The exact origin matters; `localhost` is a different origin under the default configuration. MCP endpoint: `http://127.0.0.1:8787/mcp`.

```sh
npm run test:core  # TypeScript + real local SQLite, no external runtime dependencies
npm test          # also compiles and tests the actual MCP SDK adapter
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
3. Run `npx wrangler d1 migrations apply memdb --remote`, then `npm test` and `npx wrangler deploy --dry-run`.
4. Only after reviewing the tests, security model and provider budget, run `npm run deploy`. No automatic production deployment is configured.

There are no deployment credentials in this repository. Missing limiter bindings and invalid origins fail closed. Configure provider-level spend/resource limits and private operational monitoring; this project has no public dashboard.

## Verification status

- **PASS:** 32 local core/SQL/HTTP/render tests with Node 22.16.0, TypeScript 5.8.3 and SQLite 3.49.1. Includes real transaction rollback, 20 competing CAS updates, 20 appends, freeze and recreation, malformed input, XSS payloads, and origin/rate rejection.
- **NOT YET VERIFIED:** actual MCP SDK install/build/transport and Wrangler/D1 runtime. Local registry DNS is unavailable; GitHub CI is configured to exercise these, but a workflow definition is not a passing run.
- **NOT YET VERIFIED:** real-browser end-to-end test; this environment blocked localhost browser navigation administratively.
- **NOT DEPLOYED:** public endpoint and production D1. Local SQLite is not proof of Cloudflare behavior under network failure or distributed load.

Dependency ranges remain until a verified `package-lock.json` is committed. CI preserves its resolved lock as an artifact. This is an explicit release blocker, not a reproducible production build yet.

See [security model](SECURITY.md) and [architecture and decisions](docs/architecture.md).

## License

No license has been selected. Public visibility does not grant an open-source license.

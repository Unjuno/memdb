# Architecture and implementation decisions

## Approved goal

A shared Markdown page per string path, anonymously read/written by humans and AI, without accounts, bot IDs, dashboard or public key listing. Existing content is not automatically permanent: high-read pages can disappear, while age alone does not delete a quiet page.

## Human UI: one fixed URL

The only human editor URL is `/`. The user enters an arbitrary page key, presses **Open**, and the JavaScript app retrieves the Markdown using the existing REST API, displays a preview or editor on the same page, and switches keys without navigation or URL fragments. The old `/p/<path>` route returns a 302 redirect to `/`. No page directory, login, dashboard or URL-based page selector is exposed. Unsaved drafts require confirmation before switching. This is a presentation-only change: REST and MCP retain the same normalized key semantics and quota policy.

## Components

`src/http.ts` enforces origin and bounded bodies, serves the browser shell and routes HTTP. `src/mcp.ts` uses the official SDK v2 factory; each request gets a fresh server. Both call `src/tools.ts` for the same limits and `src/store.ts` for the same D1 operations. Browser JavaScript never auto-saves or auto-polls; failed saves retain the draft. `src/markdown.ts` emits only a documented small, escaped subset.

`migrations/0001_initial.sql` is the approved quota/hit/freeze schema. `0002_revision_clock.sql` adds a persistent revision sequence. Without it, deletion and recreation reset version to 1 and let an old editor overwrite the new generation (ABA bug). Revisions may skip numbers; clients must send the returned value rather than increment it themselves. Fresh installation must apply both migrations. Downgrading to the old reference writer is unsupported.

The Sites entry point `src/sites.ts` reuses the same HTTP, MCP, Markdown and storage code. Sites does not provide this Worker with Cloudflare-specific rate-limit bindings or cron triggers. The adapter uses atomic D1 upserts for fixed-window rate limits, hashes limiter keys, and claims a persisted maintenance lease no more than once per five minutes. Housekeeping remains bounded by the existing 100-page GC batch. Sites migrates the same schema through Drizzle-compatible D1 migrations. Its 8,000,000,000-byte logical content cap reserves 20% below the documented 10 GB per-Site database ceiling for indexes, hit buckets, tombstones and SQLite overhead. Physical overhead is not reported by the Sites database inspection API, so this reserve is an estimate.

## Policy C

On creation, preflight computes both byte and page-count shortages and selects at most eight eligible hot victims. If insufficient, return STORAGE_FULL without writes. A D1 transactional batch rechecks each victim and present quota pressure, deletes only when still necessary, and inserts the new page. Triggers enforce quota and freeze deleted paths. Any failed statement rolls the batch back, including hit deletion and tombstones. A quota race permits at most two attempts. Existing updates never invoke reclamation.

Normal GC evaluates the two completed UTC days independently, deletes at most 100 pages per run, adjusts locks, removes old hit buckets, and clears expired tombstones. The Cloudflare schedule is five minutes; Sites runs the same work on the first request after its persisted five-minute lease expires. Store time is trusted server time, never a tool argument. Byte counts use UTF-8, timestamps use Unix seconds, hit/page counts are integers; logical byte accounting does not measure physical storage.

## Decisions replacing ambiguous draft details

- `/api/status/<path>` and `/api/append/<path>` avoid reserving a user's trailing path segment.
- No IP or bot identifiers are stored. Shared page/global rate keys fit the user's anonymity requirement. This is not a per-user fairness or strict worldwide budget mechanism.
- Markdown is explicitly a safe subset, not full CommonMark/GFM. Tables, embedded images, raw HTML and nested-block fidelity are deferred.
- MCP reads have side effects; its tool annotations must not call them read-only.
- No public deploy, license grant or paid infrastructure provisioning is implied by the repository commit.

## Verification

Local tests use Node's real SQLite wrapped in the D1 prepare/batch shape. This validates the SQL and transaction intent, not provider runtime limits or behavior. A fail-first regression reproduced the cross-generation overwrite before the revision sequence fixed it. The local HTTP tests cover the actual router, not a mocked router. Real SDK and Workers verification must come from an actual passing run; no stub typings or fake SDK are used to claim success.

## Primary implementation references

- D1 transactional batch: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Rate limit locality and approximation: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- SDK web-standard serving: https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard
- SDK protocol migration and handler: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28

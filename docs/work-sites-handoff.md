# MEMDB — ChatGPT Work / Sites deployment handoff

## Objective

Deploy **MEMDB** using ChatGPT Work and the user's ChatGPT Sites capability, **not an independently provisioned Cloudflare account**, if Sites hosting is available for the user's account.

Source: `https://github.com/Unjuno/memdb` on a working branch based on `main`.

## Non-negotiable product behavior

- Human browser: one homepage URL `/`. A page key is entered into the **Page key** field; **Open** loads and edits Markdown in-place without `/p/<key>`, fragments, router navigation, or a dashboard.
- AI/agents: MCP `read_page`, `save_page`, `append_page`, `get_page_status`. Agent keys and human keys share one namespace and database. The REST endpoints are an internal integration contract.
- Public anonymous reading/writing: no accounts, passwords, user/bot identifiers, page index, localization features or public administration endpoint.
- English application text and product name **MEMDB**; support Unicode in keys/content.
- Policy C: hot-page lock and eligible high-read reclamation in the same transaction as new-page save. If safe recovery is insufficient, reject the new save with no deletions. Preserve quiet pages and frozen-path behavior.
- Optimistic concurrency prevents stale writes; browser draft remains available after conflicts.

## Required adaptation

Sites supports Workers, D1 bindings and a Sites-hosted MCP server. The Sites adapter bundles the existing TypeScript application into a Worker, replaces edge limiters with atomic D1 fixed-window counters, and replaces cron with a persisted five-minute request-triggered maintenance lease. The documented per-Site D1 maximum is 10 GB. MEMDB reserves 20% and sets an 8 GB logical content limit plus 244,140 pages; this reserve is estimated because the database inspection API exposes table names but not physical byte usage. Account-wide storage limits remain plan-dependent.

The application keeps the same page schema, Policy C invariants, HTTP/MCP behavior and tests. A deployed Site has an 8 GB logical content ceiling under the documented 10 GB physical maximum; the remaining allowance is reserved for database metadata and indexes. Plan-specific account quotas and exact physical usage still require the owner's Sites settings because the database inspection connector does not expose byte usage.

## Verification and release

See [`sites-verification-2026-10-28.md`](sites-verification-2026-10-28.md) for the observed results. A private version was deployed, the D1 schema and 8 GB logical quota were confirmed, and the Sites-generated ChatGPT MCP plugin successfully saved and read a Unicode-keyed page. The Site access setting is now `public` and its deployment succeeded at `https://memdb-unjuno-test.unjuno.chatgpt.site`.

The clean browser still displayed a Sites sign-in page after public deployment. Public anonymous UI behavior is therefore unresolved; do not claim the release is fully available to unauthenticated visitors. The ChatGPT plugin was exercised, but direct external MCP client interoperability, live browser edits, mobile layout, public HTTPS security headers and physical D1 usage remain unverified.

## Upstream references

- `README.md`: behavior, API and constraints.
- `docs/architecture.md`: storage model and Policy C transaction invariants.
- `docs/ship.md`: existing Cloudflare-specific workflow; reference only, not the chosen hosting target.
- `tests/core.test.mjs`, `tests/browser_network.py`, `tests/mcp-modern.test.mjs`: baseline regression coverage.

Do not claim production deployment or external MCP connectivity without observed end-to-end evidence.

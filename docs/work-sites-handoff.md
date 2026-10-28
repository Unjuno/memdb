# MEMDB — ChatGPT Work / Sites deployment handoff

## Objective

Deploy **MEMDB** using ChatGPT Work and the user's ChatGPT Sites capability, **not an independently provisioned Cloudflare account**, if Sites hosting is available for the user's account.

Source: `https://github.com/Unjuno/memdb` on the `main` branch, after PR #3 is merged.

## Non-negotiable product behavior

- Human browser: one homepage URL `/`. A page key is entered into the **Page key** field; **Open** loads and edits Markdown in-place without `/p/<key>`, fragments, router navigation, or a dashboard.
- AI/agents: MCP `read_page`, `save_page`, `append_page`, `get_page_status`. Agent keys and human keys share one namespace and database. The REST endpoints are an internal integration contract.
- Public anonymous reading/writing: no accounts, passwords, user/bot identifiers, page index, localization features or public administration endpoint.
- English application text and product name **MEMDB**; support Unicode in keys/content.
- Policy C: hot-page lock and eligible high-read reclamation in the same transaction as new-page save. If safe recovery is insufficient, reject the new save with no deletions. Preserve quiet pages and frozen-path behavior.
- Optimistic concurrency prevents stale writes; browser draft remains available after conflicts.

## Required adaptation

The current implementation is a Cloudflare Workers TypeScript application. Storage is D1-shaped SQLite, edge rate-limit bindings are Cloudflare-specific, and maintenance uses scheduled Worker triggers. **Do not assume these APIs exist in ChatGPT Sites or that a direct source upload is sufficient.** Work must inspect the actual Sites runtime, database APIs, permissions, background jobs and MCP exposure before changing or deploying code.

If Sites supports a compatible persistent database, port only the platform interfaces while retaining the page schema, limit invariants, HTTP/MCP behavior and tests. If scheduled maintenance is unsupported, implement a verified bounded alternative and demonstrate it does not create unbounded cost/latency. Do not silently weaken capacity or abuse controls. Check actual quotas and billable usage; the application's default **128 MiB logical quota** does not automatically become a 10 GB quota just because hosting offers more storage.

## Verification and release

1. Inspect the Sites entitlement and actual persistent storage, public HTTP, MCP and rate-limit capabilities. If any are unavailable, report the blocker; do not invent a deployment URL.
2. Build a private test site, migrate/initialize its data store, then run creation, edit, preview, conflict, second-key switching and reopening from `/`. Assert the human browser URL remains unchanged.
3. Exercise the same keys using MCP from an authorized client; verify rate-limit and lock behavior, quota rollback, no page creation on mere view of a missing key, and Unicode encoding.
4. Test XSS/CSP/cross-site protections and browser UI on real HTTPS. Compare policy outcomes against the upstream test suite and document any platform differences.
5. Check the actual hosting spend/usage limits and record what the platform can and cannot enforce. Never publish secrets. Public anonymous write and deletion behaviors must be confirmed before release.
6. Publish only after verification. Report the **observed** site URL, MCP connection details (including whether external clients are supported), test results, and outstanding risks.

## Upstream references

- `README.md`: behavior, API and constraints.
- `docs/architecture.md`: storage model and Policy C transaction invariants.
- `docs/ship.md`: existing Cloudflare-specific workflow; reference only, not the chosen hosting target.
- `tests/core.test.mjs`, `tests/browser_network.py`, `tests/mcp-modern.test.mjs`: baseline regression coverage.

Do not claim production deployment or external MCP connectivity without observed end-to-end evidence.

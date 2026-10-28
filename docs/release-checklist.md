# Release checklist

## Implemented

- [x] English-only single-page editor, inline key switching, preview, save, and unsaved-draft protection.
- [x] Anonymous REST API and four MCP tools sharing one D1 store.
- [x] Policy C quota checks, transactional hot-page reclamation, low-read retention, write locks and seven-day tombstones.
- [x] Cross-generation revision tokens and stale-write rejection.
- [x] Safe Markdown subset, CSP, same-origin checks, bounded inputs and database-backed Sites rate limits.
- [x] Sites Worker bundle, D1 binding, MCP capability, request-triggered bounded maintenance and Drizzle migrations.
- [x] Sites logical quota set to 8,000,000,000 bytes and 244,140 pages under the documented 10 GB per-Site database ceiling.
- [x] `npm test`: 50 core plus 10 MCP/Sites-runtime tests passed on Node 24.22.1.
- [x] Private Sites deployment succeeded; live D1 schema, quota row and ChatGPT MCP save/read were observed.
- [x] Site access state changed to public and a public deployment succeeded.

## Still required before claiming the requested public release is verified

- [x] Anonymous public access is now observed. Browser-created Markdown survived reload, and connected MEMDB MCP read/append changes were confirmed in the browser (follow-up verification on 2026-10-28).
- [ ] Finish full public-HTTPS UX regression: key switching, drafts/conflicts, Unicode and mobile layout. Anonymous save/reopen and MCP writeback were already observed; the remaining flows need direct public-host testing.
- [ ] Verify mobile layout and application security headers on the public origin.
- [ ] Test the MCP URL from an external AI client. ChatGPT's Sites-generated plugin works; external transport compatibility remains unverified.
- [ ] Inspect physical D1 usage and account-specific remaining storage from Sites settings; the available database connector does not report physical bytes.

## Environment limits observed

- Wrangler local Worker startup failed with `uv_interface_addresses returned Unknown system error 1`.
- Playwright was installed, but Chromium could not be downloaded because the package mirror returned `GatewayExceptionResponse`; no local Chromium executable was available.
- The live 8 GB exhaustion case was not run against persistent data. Policy C refusal, reclaim and rollback passed against local SQLite fixtures.

See [Sites verification](sites-verification-2026-10-28.md) for observed deployment, storage, MCP, cost and limitation details. The Cloudflare-only workflow in `docs/ship.md` was not used.

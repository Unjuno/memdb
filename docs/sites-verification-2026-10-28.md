# MEMDB Sites verification — 2026-10-28

## Deployment

- Site: <https://memdb-unjuno-test.unjuno.chatgpt.site>
- Site audience setting: `public` (confirmed by Sites access state).
- Latest deployment: succeeded at the URL above.
- Runtime: Sites Worker with the D1 binding `DB`; no separate Cloudflare account was used.
- MCP: the Sites-generated ChatGPT plugin exposed `read_page`, `save_page`, `append_page`, and `get_page_status` in this conversation.

## Follow-up public cross-interface verification (2026-10-28)

The initial clean browser sign-in gate recorded below was **not the final public-access state**. Subsequently, an independent anonymous browser session reached the live MEMDB homepage and created one new test page, saved 123 bytes and reopened it from the same fixed homepage URL. The stored marker was still present after a full browser reload.

From a connected MEMDB MCP integration, `get_page_status` returned version 2 for that test key, `read_page` returned the browser-created Markdown and `append_page` with an explicit expected revision advanced the page to version 3 (156 bytes). A separate anonymous-browser inspection then showed the MCP-appended marker in both preview and editing text, with version 3 and 156 B displayed. No other page keys were accessed or modified by this cross-interface test.

Anonymous GET `/mcp` responded HTTP 401; this does **not** demonstrate failure of authenticated or POST-based MCP clients. The connected ChatGPT MEMDB plugin is verified, but external MCP client interoperability still requires its own authentication-aware test.

This follow-up validates real anonymous browser writing and connected MCP read/write exchange, not 8 GB capacity exhaustion, distributed rate limits, mobile UX or a third-party security audit.

## Database and storage

- Sites documentation states a maximum of 10 GB per Site database. Account-wide usage and plan limits still apply.
- The live `usage_quota` row reports `max_content_bytes = 8,000,000,000`, `max_pages = 244,140`, and one verification page using 118 logical bytes.
- The 8 GB logical cap leaves a 20% allowance below 10 GB for SQLite indexes, hit buckets, tombstones and metadata. It is an engineering reserve, not a measured physical-size bound.
- Sites database inspection lists bindings, tables and bounded table rows; it does not expose physical bytes used or a plan-specific remaining-quota figure. No 10 GB capacity-fill test was run.

## Passed checks

- `npm test`: 50 core tests plus 10 MCP/Sites-runtime tests passed under Node 24.22.1. This covers Unicode keys, revision conflicts, Policy C rollback and refusal, safe Markdown rendering, CSP/origin rules, the D1 limiter, and the Sites capacity migrations.
- `npm run build:site`: produced a bundled Sites Worker; Sites accepted and deployed the archive, and applied the D1 migration that sets the 8 GB quota.
- Private deployment MCP round trip: the ChatGPT Sites plugin saved and then read Markdown at a Unicode key. D1 table inspection confirmed the row and configured quota.
- The Site returned a successful production deployment status with `has_mcp = true`.
- Sites documentation confirms that Sites supports D1-backed data and hosting an MCP server. Its documented D1 ceiling is 10 GB per Site.

## Unverified or blocked checks

- After the access mode was set to `public` and the saved version was deployed, the clean CUA browser still displayed the Sites “sign in required” gate. This conflicts with the published Sites guidance that public Sites are available without ChatGPT sign-in. Therefore anonymous web UI access, HTTPS application headers, and the requested public browser flows are not verified. No login was completed or credential entered.
- The ChatGPT-hosted plugin was exercised. A direct connection from an external AI client's own MCP transport was not tested; the `mcp_url` and `oauth_resource` are available from Sites, but this run did not establish external-client interoperability.
- The environment's Wrangler local Worker failed to start with `uv_interface_addresses returned Unknown system error 1`. Chromium download through Playwright failed because the package mirror returned `GatewayExceptionResponse`; no local browser binary was present. Consequently the local Wrangler/D1 smoke, real HTTPS Chromium suite, and mobile viewport suite were not run in this environment.
- Policy C capacity and concurrency cases passed in the local SQLite regression suite. No live capacity-exhaustion fixture was run against the persistent Site database.

## Cost and operating limits

OpenAI's Sites help says Site hosting usage (including traffic and storage) is separate from Codex build/edit usage. Hosting charges are currently waived for Enterprise workspaces; Plus and Pro accounts remain subject to shared usage and storage limits. The account-specific remaining quota and a per-request or per-GB price were not exposed during this deployment. See the OpenAI Help Center's [Sites usage and storage limits](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites).

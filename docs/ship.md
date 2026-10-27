# Shipping MemDB 0.1.0

MemDB is a small anonymous Markdown service, not durable storage. All UI and developer-facing copy are English. Unicode page keys and content are still accepted. No login, bot identifier, public index or dashboard is required.

## What is ready

The source contains browser editing and rendering, REST, modern and legacy MCP paths, database-enforced quota accounting, atomic Policy C reclamation, freeze periods and bounded maintenance. The release adds real HTTPS browser CI, modern wire-client regression tests, stricter sibling-origin protection and a configuration-checked deployment pipeline.

A passing source build is not proof that a Cloudflare service is running. The `Deploy MemDB` workflow is manual-only. Neither a merge nor a push deploys to production. The repository does not contain credentials or a real production database ID.

## One-time owner setup

Use a Cloudflare account you control. Check the plan and resource quotas before enabling public writes. A budget acknowledgment is not a provider-enforced spending cap. Do not upgrade the plan or enable automatic payment without making that decision yourself.

Create a D1 database named `memdb` using the Cloudflare dashboard or the installed CLI:

```sh
npm ci
npx wrangler login
npx wrangler d1 create memdb
```

Record the returned database ID. If a database named `memdb` already exists, inspect and reuse the intended database rather than overwriting or deleting it. Never apply `tests/fixtures/policy-c.sql` to this database.

In the GitHub repository's **production environment**, configure:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Account-scoped Workers deployment and D1 edit token |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| Variable | `MEMDB_DATABASE_ID` | The actual `memdb` D1 UUID |
| Variable | `MEMDB_PUBLIC_ORIGIN` | `https://memdb.<your-workers-subdomain>.workers.dev` |
| Variable | `MEMDB_RATE_NAMESPACE_BASE` | First of four unused numeric limiter namespaces in your account |

Do not paste the API token into chat or commit it. Assign minimum token permissions needed to deploy this Worker and migrate this D1 database. Add a required environment reviewer where the repository plan supports it. The default generator targets `workers.dev`; custom domains require separately reviewed routing configuration.

## Deploy

After the latest main-branch CI succeeds, open **Actions -> Deploy MemDB -> Run workflow**, choose `main`, and confirm both public-write and budget choices. The workflow validates settings, runs tests, builds, applies non-destructive migrations, deploys and runs four read-only HTTPS/MCP probes. It stops on a missing setting, failed migration or failed command.

The application URLs are your configured origin plus `/`, `/p/<path>`, `/raw/<path>` and `/mcp`. A successful deploy prints the actual Worker URL. Do not substitute the example URL for an observed deployment URL.

To deploy from a Linux/Node.js 22 workstation instead, set the same variables and these explicit acknowledgments:

```sh
export MEMDB_APPROVE_PUBLIC_DEPLOY=I_ACCEPT_PUBLIC_ANONYMOUS_WRITES
export MEMDB_OPERATOR_BUDGET_CONFIRMED=1
npm run configure:production
npm run deploy
npm run verify:remote
```

`wrangler.production.json` is ignored by Git. `npm run deploy` validates the exact file passed to both migration and deployment. Set `MEMDB_CONFIG` to choose a reviewed alternative; command-line overrides are intentionally rejected. Authentication can come from Wrangler login or a narrowly scoped API token.

## Verification boundaries

`browser-https` uses real Chromium network navigation and Wrangler/D1 over local HTTPS, with certificate verification bypassed only for loopback self-signed certificates. It does not mock `fetch`. This proves network routing, JS/CSS loading, CSP, editor persistence, conflicts and Unicode paths in that local runtime. It is not a cloud load test.

Modern MCP tests are direct 2026-07-28 JSON-RPC wire clients against the actual pinned SDK, with per-request metadata and no initialization/session. Legacy tests retain the 2025-11-25 exchange. Compatibility with every third-party host is not implied.

For a disposable remote staging service you own, run `MEMDB_BASE_URL=https://... python tests/browser_network.py` with Playwright installed. This creates four small test pages and must not be used against an unrelated service or a production store near capacity; Policy C applies to ordinary test writes as well.

No independent penetration test has been performed. Anonymous content modification and deliberate read-driven deletion are accepted product risks, not security guarantees. The source's existing license status is unchanged; a source license decision is separate from running your own service.

## Operations and rollback

Inspect private Cloudflare error, request and D1 storage metrics. Logical Markdown quotas do not measure physical database/index size or all billable work. Stop public traffic through Cloudflare if costs or errors exceed the owner's chosen limits; there is deliberately no public operator API.

For an application regression, roll back to the previous known-good Worker version through Cloudflare. Do not reverse database migrations or delete tables automatically. A Worker rollback does not restore deleted content. See `docs/runbook.md` for storage and incident procedures.

## Primary references

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/d1/get-started/
- https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions
- https://blog.modelcontextprotocol.io/posts/2026-07-28/

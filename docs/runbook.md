# Operator runbook (English-only; not a public dashboard)

MEMDB is an anonymous, **publicly writable and non-durable** Markdown wiki. Anyone who learns a path can edit it. Read traffic drives lock/eviction eligibility; an attacker can intentionally trigger deletion. It is not suitable for private information, essential records, or guaranteed retention. Keep the project on a test-only origin until the release checklist is satisfied.

## Preconditions

1. Review the [architecture](architecture.md), [security model](../SECURITY.md) and [verification status](verification.md).
2. Review the Cloudflare account plan, request/CPU quotas, D1 read/write pricing and billing alerts. Configure an operator-approved spending budget **in Cloudflare**. `MEMDB_OPERATOR_BUDGET_CONFIRMED=1` is an operator acknowledgment, not an automated cost cap.
3. Create a dedicated D1 database; set its real UUID under `d1_databases` in `wrangler.jsonc`.
4. Set `PUBLIC_ORIGIN` to the exact intended **HTTPS** origin, without a trailing slash. Select namespace IDs for the four rate limiters that are not in use by any other Worker; the example IDs are intentionally refused by the deploy gate.
5. Confirm SQL migrations `0001_initial.sql` and `0002_revision_clock.sql` are applied in order. Do not apply `tests/fixtures/policy-c.sql` to any persistent or production database.
6. Obtain an independent code and security review, in particular for unauthorized deletion, rate limiter locality, transaction semantics, and Worker/D1 operational limits.
7. Check a disposable deployment with real browser navigation and a real MCP client before public production use. CI local smoke and an SDK test are necessary but not sufficient.

## Verification and local integration

```sh
npm ci
npm test
npm run db:local
npx wrangler d1 execute memdb --local --file=tests/fixtures/policy-c.sql
npx wrangler dev --ip 127.0.0.1 --port 8787
# In a second terminal:
MEMDB_SMOKE_ORIGIN=http://127.0.0.1:8787 npm run test:worker
```

The Worker smoke script **refuses non-local target addresses** and creates/deletes deterministic test content only inside the disposable local D1 database. Do not run the fixture with `--remote`. The `tests/browser_e2e.py` harness exercises the real Chrome DOM and server-backed fetch but does *not* exercise browser network navigation/CSP in this environment; browser access to localhost is blocked by the hosted execution policy. Run complete browser E2E testing separately against an authorized staging URL.

## Production release gate

`npm run deploy` automatically invokes `predeploy`, which calls `scripts/check-release.mjs`. The default local configuration is intentionally rejected. `npx wrangler deploy` called directly **bypasses** this npm gate; do not bypass the release checklist.

Once a dedicated D1 has been created, configuration and budgets have been reviewed and a staging deployment has passed:

```sh
# Do not copy the following without actually satisfying both prerequisites.
MEMDB_APPROVE_PUBLIC_DEPLOY=I_ACCEPT_PUBLIC_ANONYMOUS_WRITES \
MEMDB_OPERATOR_BUDGET_CONFIRMED=1 npm run check:release

npx wrangler d1 migrations apply memdb --remote
MEMDB_APPROVE_PUBLIC_DEPLOY=I_ACCEPT_PUBLIC_ANONYMOUS_WRITES \
MEMDB_OPERATOR_BUDGET_CONFIRMED=1 npm run deploy
```

The preflight does **not** create billing limits, databases or credentials. The manual `--remote` migration command can modify an existing database; verify the account and database target before running it. This runbook does not authorize remote deployment or paid resource creation.

## Private monitoring and budget controls

Use Cloudflare's account-side D1 analytics and Workers request/error metrics; no public dashboard or bot/user identity is required. In the D1 query console or an authenticated admin session, inspect usage:

```sql
SELECT used_pages, max_pages, used_content_bytes, max_content_bytes
FROM usage_quota WHERE id=1;
SELECT state, COUNT(*) AS pages FROM pages GROUP BY state;
SELECT COUNT(*) AS active_tombstones FROM tombstones
WHERE blocked_until_s > CAST(strftime('%s','now') AS INTEGER);
SELECT COUNT(*) AS hit_buckets FROM page_hits;
```

Track physical D1 storage separately: logical quota **does not** include indexes, tombstones, WAL, or page-hit rows. Cloudflare documents a maximum D1 database size of **500 MB on the Workers Free plan and 10 GB on Workers Paid** (as of April 21, 2026; confirm the current service terms). Do not assume the application quota protects physical storage. Workers rate limit bindings are location-scoped, approximate and eventually consistent, **not** global billing enforcement.

Alerts and stop criteria should include: D1 size approaching plan limits, unexpected write volume, repeated failures of scheduled maintenance, rising HTTP `429`/`507`/`503`, and unexpected numbers of locked or frozen pages. If the service is being abused, disable public routes at Cloudflare before attempting data cleanup. Never silently delete low-read pages to force new allocations.

## Incident and recovery

- Data loss is permitted by the product policy. High-read pages are intentionally deleted. Warn clients to export anything they care about.
- Do not roll back schema `0002_revision_clock.sql` or reset `revision_clock`; that may reintroduce stale-revision overwrites.
- If an update fails or the quota is full, do not force-delete cold pages. Investigate page counts, physical D1 size and maintenance behavior first.
- If the deployment must be rolled back, use Cloudflare's version/rollback control after checking that the database schema remains compatible. Database Time Travel capabilities depend on the provider plan and are not an application retention guarantee.

## Release acceptance criteria

A public release is eligible only when all of these are independently evidenced: `npm test` green; Worker+local D1 integration green; real D1 environment verified; Chromium navigation and actual editing through HTTPS tested; MCP client verified; security review closed; provider cost alert/budget configured; public-data disclaimer understood; source license choice explicitly decided; no placeholder configuration; and operator approval documented.

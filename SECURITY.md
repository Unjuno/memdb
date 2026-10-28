# Security model

MEMDB is intentionally anonymous, world-readable and world-writable temporary storage. It is not a private knowledge store. Anyone who reaches a path can change its content; accepted reads can induce locks and deletion. No identity system or anti-abuse mechanism makes that safe for irreplaceable data.

## Implemented boundaries

- Bound UTF-8 bodies, paths, page bytes and counts; parameterized SQL only.
- Origin/Host checks before MCP/HTTP dispatch, same-origin browser access, no permissive CORS.
- Required provider rate-limit bindings; rejection occurs before counting page reads.
- Escaped Markdown subset; no raw HTML or embedded images. Restrictive CSP and no-store/nosniff/referrer headers.
- CAS revisions from a persistent global sequence; no revision reuse on path recreation.
- Atomic D1 batches for Policy C. Revalidate deletion eligibility and quota pressure in the transaction; quota triggers remain authoritative.
- MCP marks read_page as side-effecting/destructive: it changes the access counter and can make data eligible for deletion. Page text is explicitly untrusted.

## Limitations and pre-release blockers

Cloudflare rate limits are approximate and location-local. Anonymous distributed users can exhaust shared budgets or deliberately induce deletion. Logical Markdown quota excludes indexes, hit buckets, tombstones and physical database overhead. GC requires a functioning schedule. Deletion is irreversible within the application; provider backups have separate retention semantics.

The full TypeScript build, five actual SDK transport tests and Worker bundle dry run passed GitHub CI; the successful dependency graph is committed. Production Workers/D1 behavior and real-browser end-to-end checks still require deployment-environment evidence before production. A self-review is not an independent security audit. Configure private security reporting and provider-level budget controls before a public launch. Do not include credentials or personal information in public issues.

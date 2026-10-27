# Release checklist

Source readiness and live deployment are separate states. See `docs/ship.md` for the exact operator setup and `docs/release-0.1.0.md` for evidence.

## Implemented and tested

- [x] English-only browser Markdown view, edit, preview and save; Unicode paths.
- [x] Anonymous REST and four MCP tools sharing the same rules.
- [x] Policy C quotas, atomic reclaim/insert, low-read retention, locks and frozen paths.
- [x] Global revision tokens and conflicting-draft preservation.
- [x] Same-site and cross-origin request rejection; safe renderer, CSP and input bounds.
- [x] 49 core tests and 8 actual SDK transport tests, including modern MCP without initialize.
- [x] 17 live HTTP/MCP checks through local Wrangler/D1.
- [x] Direct Chromium HTTPS navigation, editing, conflict, Unicode and CSP/origin tests.
- [x] Audited dependency repair and reproducible lockfile.
- [x] Exact-config migration/deploy command and manual-only production workflow.
- [x] English setup, operations, rollback and security guidance.

## Owner-controlled deployment

- [ ] Configure a real D1 database and account-scoped token; keep all tokens out of chat and source control.
- [ ] Set the four production environment variables in `docs/ship.md`.
- [ ] Check the actual plan, provider spending controls and private operational monitoring.
- [ ] Validate remote D1 and public HTTPS on an authorized staging instance. Do not run capacity fixtures on production.
- [ ] Run Deploy MemDB on a passing main commit and inspect the returned live URL and read-only probes.
- [ ] Verify recovery and physical database usage with the expected workload before relying on public operation.

## Deliberate limits

An independent security review has not been performed. Source availability is not a license grant, and the owner has not selected a reuse license. Neither prevents local development, but neither should be misrepresented as resolved. No accounts, public index, dashboard, localization or retention guarantee are added.

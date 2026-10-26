# MemDB MVP release checklist

This checklist applies to the **unmerged development pull request**. It is not a claim that a production service is running. Source, UI and documentation remain English-only; Unicode page paths remain supported.

## Completed and verified

- [x] Anonymous path-keyed Markdown, browser editor, preview and raw/API endpoints; no accounts or dashboard.
- [x] MCP `read_page`, `save_page`, `append_page`, `get_page_status` adapter (existing branch; previously verified with real SDK in GitHub CI).
- [x] Transactional Policy C and read-driven lock/deletion, with low-read records retained (SQLite tests).
- [x] Fail-first regression for invalid Unicode preview input; now validated with the same content rules as saves.
- [x] Seeded 250-operation invariant test with quota and revision assertions.
- [x] Chromium DOM+JS test with server-backed transport bridge: four scenarios, no direct browser navigation.
- [x] Local SQLite-backed 14-step HTTP policy smoke using deterministic fixture.
- [x] CI executed a disposable Wrangler Worker/D1 smoke with **17 HTTP/MCP checks passing**, alongside 43 core tests and 5 actual MCP SDK tests.
- [x] Fail-closed `npm run deploy` guard and operator runbook. Provider budget approval is a human acknowledgment only.
- [x] Hardening changes pushed to the existing `feat/mvp` PR, verified on GitHub Actions: https://github.com/Unjuno/memdb/actions/runs/40323368922

## Remaining before public deployment

- [ ] Validate behavior on an actual Cloudflare D1 account and run failure/rollback/load checks; local SQLite and Miniflare are not substitutes.
- [ ] Perform unrestricted HTTPS browser navigation, CSP, and cross-origin tests on a disposable staging service.
- [ ] Test against a modern 2026-07-28 MCP client (legacy 2025-11-25 already verified).
- [ ] Independent code/security review: unauthenticated edits, traffic-induced deletion, bypass paths, resource exhaustion.
- [ ] Set a provider-enforced spending alert/limit, confirm rate namespace separation, and confirm physical D1 usage headroom.
- [ ] Create the real D1 database ID, assign an exact HTTPS `PUBLIC_ORIGIN`, and apply migrations to the intended account.
- [ ] Decide whether to grant an open-source license (public visibility alone is not a license).
- [ ] Obtain explicit approval for public deployment, merge `feat/mvp` into `main`, and run a final post-deploy smoke in an authorized staging/production environment.

## Hard stop conditions

Do **not** deploy if any secret is checked into the repository, if `PUBLIC_ORIGIN` remains localhost, if D1 UUID or limiter namespaces are placeholders, if core CI/integration checks are red, if billing is unbounded, or if a destructive failure mode has not been reviewed. No manual override of the Policy C requirement is permitted just to make new pages fit.

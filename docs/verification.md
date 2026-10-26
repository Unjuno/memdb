# Verification evidence

## Latest English UI verification

- Run: https://github.com/Unjuno/memdb/actions/runs/39981309894
- Tested commit: `978a1a43d101102640ae53892b015818f0554808`
- Observed result: GitHub Actions completed successfully with 33 core tests (including the English-only browser UI and feedback regression), 5 actual MCP SDK tests, the complete TypeScript build and Worker bundle dry run. Both suites reported zero failures.
- This confirms the English interface change compiles and passes the automated tests, not that the service has been deployed or browser-tested in production.

## Observed CI run

- Run: https://github.com/Unjuno/memdb/actions/runs/39971890916
- Job: https://github.com/Unjuno/memdb/actions/runs/39971890916/job/120476443106
- Source commit: `c6d83a7cf6fb5346da2d454895a7049e71f925b0`
- Source tree: `aaa569c6f5838a1def50d73bc5c052f5d4f799c7` (matches the locally tested 22-file tree).
- Observed result: completed/success. Actual job log confirms 32 core tests and 5 MCP tests, zero failures, plus successful full TypeScript build and Worker bundle dry run.
- Environment: GitHub-hosted Ubuntu 26.04.1 x64; Node 22.23.3; npm 10.9.9; TypeScript 5.8.3; MCP server/core 2.3.1; Zod 4.6.7; Wrangler 4.152.0.
- This is functional verification, not a throughput/latency benchmark. Local async contention tests are not distributed load tests.

## Additional local verification (2026-10-26)

- Node.js 22.16.0 + global TypeScript 5.8.3: `npm run test:core` yielded **43/43 PASS** (previous 33 plus additional security, quota, state and release-gate tests).
- Playwright 1.57.0 with system Chromium: `npm run test:browser` yielded **4/4 PASS**. Hosted Chromium refuses direct localhost navigation; production HTML and client JavaScript were evaluated in Chromium while `fetch` was bridged to the actual local HTTP handler and SQLite D1-shaped adapter. This is DOM/UI integration, not end-to-end browser transport/CSP validation.
- Seeded HTTP/SQLite Policy C smoke: `MEMDB_TEST_FIXTURE=policy-c` with `MEMDB_SKIP_MCP_SMOKE=1`, **14 checks PASS**. This uses the production router and real SQLite, **not** Cloudflare D1.
- `npm run check:release` correctly returns a nonzero exit code on checked-in placeholder configuration; deliberate release refusal.
- `tests/fixtures/policy-c.sql` and the Wrangler+D1 CI job were executed successfully on GitHub Actions (see the verified run below). Local package registry access remains blocked.
- `npm run build` and MCP SDK integration were not rerun in the local container because package downloads are blocked. Both completed successfully on the pushed GitHub commit.

## Wrangler local D1 CI verification (2026-10-26)

- Run: https://github.com/Unjuno/memdb/actions/runs/40323368922
- Tested commit: `a81ca150b51ec002250a91cc5d40dc8385dc16ff`
- `core`: 43 core/reliability/release-gate tests passed, 5 real MCP SDK transport tests passed; TypeScript build and Worker `--dry-run` completed successfully.
- `worker-local-d1`: migrated a disposable Wrangler local D1 instance, seeded the deterministic Policy C fixture, launched the Worker, and passed **17 HTTP/MCP smoke checks** including a full/eviction/rejection scenario.
- Both jobs completed successfully (zero test failures). This is local Wrangler/Miniflare D1 verification, **not remote Cloudflare account D1**, real browser HTTPS networking, or a load test.

## Dependency provenance

The run produced artifact `dependency-lock`, ID `12510110452`.
Its downloaded ZIP SHA-256 is `c7635a92c1ceffd1a1159badf5d89fdc97f0fca1d56ee710924e8d208fe84050`, matching the job log.
The committed lock retains every field and package entry; only JSON whitespace was compacted. The resulting Git blob is `3a575eb1d4400dd453c17f649f7be0c9bd09f6b9`.
Subsequent CI uses `npm ci` to verify this committed dependency graph.

## Additional local evidence

32 core tests passed with Node 22.16.0, TypeScript 5.8.3 and SQLite 3.49.1. Browser JavaScript syntax passed. The earlier Python reference suite also passed 14 tests; it is historical evidence, not the shipped TypeScript implementation.
A fail-first regression reproduced stale overwrites after page deletion/recreation, then passed after the persistent global revision sequence was added.
The upload contents were checked by Git object hashes; source bytes are not reconstructed from an untested summary.

## Remaining gates and review limits

- No public service or production D1 was provisioned or deployed. A dry run only builds the Worker; it does not validate D1 network/transaction behavior or cost under load.
- Real-browser testing was attempted but localhost navigation was administratively blocked (`ERR_BLOCKED_BY_ADMINISTRATOR`). It is not counted as a pass.
- MCP tests currently exercise the legacy 2025-11-25 stateless exchange. The SDK's modern protocol path is included but lacks a dedicated modern-client compatibility test.
- Review was by the implementation author, not an independent reviewer or security auditor.
- The Markdown renderer is a safe basic subset, not full CommonMark/GFM. Embedded images and tables are not implemented.
- CI reports a Node-runtime deprecation warning for the v4 Actions; the runner forced them onto Node 24 and this run passed. Updating/pinning the Actions is deferred maintenance, not evidence of a failed application test.
- Anonymous coordinated access can trigger deletion or exhaust shared limits. Logical quotas exclude physical database/index/tombstone overhead; provider limits and budgets require separate setup.

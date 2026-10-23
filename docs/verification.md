# Verification evidence

## Observed CI run

- Run: https://github.com/Unjuno/memdb/actions/runs/39971890916
- Job: https://github.com/Unjuno/memdb/actions/runs/39971890916/job/120476443106
- Source commit: `c6d83a7cf6fb5346da2d454895a7049e71f925b0`
- Source tree: `aaa569c6f5838a1def50d73bc5c052f5d4f799c7` (matches the locally tested 22-file tree).
- Observed result: completed/success. Actual job log confirms 32 core tests and 5 MCP tests, zero failures, plus successful full TypeScript build and Worker bundle dry run.
- Environment: GitHub-hosted Ubuntu 26.04.1 x64; Node 22.23.3; npm 10.9.9; TypeScript 5.8.3; MCP server/core 2.3.1; Zod 4.6.7; Wrangler 4.152.0.
- This is functional verification, not a throughput/latency benchmark. Local async contention tests are not distributed load tests.

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

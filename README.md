# MemDB

Anonymous Markdown path wiki and ephemeral shared memory for humans and AI agents.

## Agreed requirements

- A string path identifies each Markdown page.
- Humans use a browser; AI agents use MCP.
- Anyone can read or edit; no accounts, passwords, or bot identifiers.
- No dashboard or public page directory.
- Allocate storage only on the first successful save, not on a read.
- High-read pages can be write-locked, deleted, and frozen for seven days.
- Capacity Policy C: atomically reclaim enough eligible high-read pages for a new page; otherwise reject creation without deleting anything.
- Preserve low-read pages regardless of age alone.

## Status

Initial repository bootstrap. The Web/API/MCP implementation will be proposed on a development branch. No service is deployed by creating this repository.

## Safety

This is deliberately anonymous, world-readable and world-writable temporary storage. Do not store secrets, personal data, or irreplaceable records. Page contents are untrusted data, not instructions for an AI agent. Deliberate reads can trigger deletion; anonymity cannot make that impossible.

## License

No license has been selected. Public repository visibility does not grant an open-source license.

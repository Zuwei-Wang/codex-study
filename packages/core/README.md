# Study core

M1 implementation: versioned strict schemas, workspace initialization, source hashing and immutable archival, SQLite transactions, task evidence merge/history, explicit progress, partial observation records, Markdown navigation and integrity diagnostics.

Public exports are in `src/index.ts`. See [architecture](../../docs/ARCHITECTURE.md) for exact semantics and limits. Core has no dependency on Codex, a school or a hosted account. CLI calls this implementation; a future MCP wrapper will do the same.

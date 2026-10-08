# Study core

M1/M2 implementation: strict schemas, workspace initialization and explicit migration, immutable material archives, SQLite transactions, task evidence/history, explicit progress, partial observations, bounded text/PDF reading, validated note citations and revisions, Markdown navigation and integrity diagnostics.

Public exports are in `src/index.ts`. See [architecture](../../docs/ARCHITECTURE.md) for semantics and limits. Core has no dependency on a Codex account, school or hosted service; CLI and MCP call this implementation. AI teaching behavior is guided by Skills and is not deterministic core behavior.

# Behavioral verification

`npm test` compiles and runs the Node test runner against synthetic fixtures. `node scripts/ci.mjs` is the complete standard verification, including formatting, type checks, a real Codex installation/MCP/upgrade acceptance workflow, source guard, dependency audit and demo.

Tests exercise record validation, two language/time-zone profiles, identity boundaries, byte retention and deduplication, task conflicts/history, progress preservation, partial/failed observations, navigation links/escaping, corruption and symlink refusal, CLI behavior, concurrent importers and actual process death around commit. Temporary workspaces live under ignored `tmp/tests` and are cleaned after each test.

M2 tests also cover PDF/Markdown text extraction, invalid or unsupported documents, exact citation validation, note revisions and conflicting edits, explicit schema migration, and real MCP client calls. `scripts/verify-codex.mjs` installs a relocated package through pinned Codex CLI using fresh child configuration, invokes study tools, then verifies a plugin upgrade preserves records and settings.

M3 tests cover calendar recurrence/DST/cancellation and stale feeds, atomic scoped scans, opt-in daily claims, interruption/cancellation and real child-process execution with a synthetic adapter. The Codex acceptance test also exercises ICS, scans and a disabled schedule.

M4 tests cover minimal projection, real loopback HTTP/client flows, account isolation, recipient verification/expiry, opt-out, zones, cancellation, stale revisions, restart persistence, stable retry bodies and keys, provider credential/sender binding across restarts, legacy-ledger refusal, and provider response validation. `reminders:demo` is explicitly synthetic and part of the shared CI command contract.

Model-generated teaching quality, desktop UI behavior, live teaching coverage, real unattended browser execution and delivery are not tested by CI. A limited manual browser compatibility check is documented separately. See [verification](../docs/VERIFICATION.md).

Learning-preference tests cover unknown/partial/skipped/cleared states, strict validation, durable storage, unchanged retries, stale writes from separate clients, clear/resave revision identity, preservation through imports and explicit schema-1/2/3 migration, and exclusion from reminder projections. CLI, stdio MCP and both Codex package acceptance paths save/read preferences and retain them across plugin upgrades. Skill-guided recommendations still need human evaluation.

# Behavioral verification

`npm test` compiles and runs the Node test runner against synthetic fixtures. `node scripts/ci.mjs` is the complete standard verification, including formatting, type checks, source guard, dependency audit and demo.

Tests exercise record validation, two language/time-zone profiles, identity boundaries, byte retention and deduplication, task conflicts/history, progress preservation, partial/failed observations, navigation links/escaping, corruption and symlink refusal, CLI behavior, concurrent importers and actual process death around commit. Temporary workspaces live under ignored `tmp/tests` and are cleaned after each test.

Browser access, Codex installation, live teaching coverage, scheduling and delivery are not tested or claimed. See [verification](../docs/VERIFICATION.md).

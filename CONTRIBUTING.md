# Contributing

Use the pinned Node/npm toolchain, install with `npm ci --ignore-scripts`, and read [AGENTS.md](AGENTS.md), [architecture](docs/ARCHITECTURE.md) and [roadmap](docs/ROADMAP.md).

Keep deterministic operations in core and adapters thin. Use synthetic fixtures only. Add behavior tests for changes to records, import semantics, recovery and progress. Do not create passing placeholders for integrations that do not exist.

Run `npm run format`, then `node scripts/ci.mjs`. For shared CI command changes, update `scripts/ci-commands.json`, its consistency test and verification documentation together. A pull request should state the concrete behavior change, relevant evidence and limitations. Do not commit generated workspaces or private records.

Hosted checks on the exact candidate commit are the normal merge basis. See [verification rules](docs/VERIFICATION.md) for the narrow fallback conditions. No production service is deployed by this repository.

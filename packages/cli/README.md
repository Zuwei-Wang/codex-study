# Local CLI

Run `npm run build`, then `npm run study -- --help` from the repository root. Implemented commands: `init`, `course`, `import`, `task`, `progress`, `attempt`, `snapshot`, `nav`, `doctor`.

The wrapper validates command-line options and delegates domain operations to core. Each command uses `--workspace PATH`; writes stay under `PATH/.study`, except recoverable initialization staging directories in `PATH`. All source JSON is treated as data. See the root README for a runnable walkthrough. No npm package or globally installed command is published.

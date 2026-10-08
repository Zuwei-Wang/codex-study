# Local daily runner

The foreground runner claims explicitly enabled daily scopes through core, invokes the user's configured Codex CLI and accepts completion only from the linked applied scan. It installs no system service and copies no credentials. Browser capability must be available to that CLI session; desktop browser access alone is insufficient.

Run `npm run schedule -- --workspace PATH --once` for a due-time check, or omit `--once` to keep the process running. Private logs and persistent run claims live in the user's workspace. See [platform checks and scheduling](../../docs/PLATFORM_CHECKS.md) for DST, cancellation, recovery and actual-verification boundaries.

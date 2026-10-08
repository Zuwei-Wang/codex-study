# Local MCP tools

The stdio server exposes 21 typed operations over the same core as the CLI: capabilities, initialize, upgrade, course put, import, task put, progress mark, record attempt, snapshot, material read, note save, note history, navigation, doctor, calendar import, scan prepare/record/apply/get and schedule configure/finish.

Run `npm run build` then launch `node dist/packages/mcp/src/index.js` through an MCP client. Do not wrap the protocol process in an npm command that prints banners to stdout. Absolute workspace paths are required; paths inside the installed plugin are refused. No credentials, TCP listener, browser automation or notification service is included.

Input validation and storage semantics live in core. Errors use MCP `isError`, source text is explicitly untrusted, and read operations never mark student progress. See [installation](../../docs/INSTALLATION.md) and [architecture](../../docs/ARCHITECTURE.md).

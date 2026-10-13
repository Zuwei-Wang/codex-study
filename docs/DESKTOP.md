# Codex desktop setup

[简体中文](DESKTOP.zh-CN.md)

The desktop package contains the same local core, 22 MCP tools and eight Skills. Setup currently requires a terminal; daily use is through desktop conversations. It does not install a separate graphical application or enable mail or scheduling.

## Install on this computer

Use macOS/Linux, Git, Node **24.21.0** and npm **11.12.1**. The desktop backend has been checked on macOS; Linux desktop UI and Windows remain unqualified. Select Node with your version manager before running these commands from the repository:

```sh
npm ci --ignore-scripts
npm run plugin:build:desktop -- build/desktop-v0.4.0-dev.2
npx --no-install codex plugin marketplace add "$PWD/build/desktop-v0.4.0-dev.2"
npx --no-install codex plugin add codex-study@codex-study-local --json
```

These commands register the marketplace and install the plugin in your normal Codex configuration, which local desktop and CLI clients share. Preserve any existing configuration. Keep both the marketplace directory and selected Node installation available. An existing output directory is refused; use a new directory for a new build. A marketplace name conflict needs review rather than deleting other configuration.

The desktop build binds the generated MCP command to the absolute Node executable used for packaging, so it does not depend on the GUI inheriting your shell's PATH. It uses the supported `.codex-plugin/plugin.json` compatibility entry point. Absolute machine paths exist only in the generated package. Build on each recipient's own computer; do not share this generated package between machines. Moving/removing Node requires rebuilding and reinstalling.

## Check in the desktop app

1. Finish active work, then restart the desktop app. In **Plugins**, choose the **Codex Study (local)** marketplace and confirm **Codex Study** is installed and enabled. This is a local source, not a public directory listing.
2. Open a local Codex conversation. Ask: “Use Codex Study. Call `study_capabilities` and tell me which readers are available. Do not substitute a shell command if the MCP tool is missing.” A missing tool or startup error is an incomplete installation, even when Skills are visible.
3. Run setup with an absolute learning folder outside the source checkout and plugin installation. Provide language, time zone, academic year and course choices. Start with the repository's fictional DEMO101 course and original fixture, not private school data.
4. Ask to import `examples/demo-workspace/fixtures/v1/intro.md` by its absolute path, read section 2 and save a cited note. Open the returned Markdown file, then ask for `study_doctor`. Check the actual tool calls and results; a model's claim alone is not acceptance.

Record app/version, OS, exact source revision, discovery, tool results and any errors in the [pilot feedback template](pilot-feedback-template.md). Model explanation quality still requires human review.

## Evidence and troubleshooting

On 2026-10-13, the macOS desktop app **26.1007.30912 (20156)** supplied backend **0.162.0-alpha.17.2**. Its executable passed the isolated app-server acceptance workflow with the desktop package: installation, eight Skills, 22 tools, setup/import/read/cited notes/progress, and upgrade preservation. The test runs without Node on its PATH. A portable-root package exposed Skills but omitted the bundled stdio service in this backend; the compatibility package exposed both. The portable CLI build remains available.

This is a test of the shipped backend executable, not a completed test of the running desktop interface. Automated control of that app was unavailable; restart, visible plugin discovery and an actual desktop conversation still need user confirmation. No model turn or independent learner result is claimed.

- Skills but no tools: use the desktop build, confirm the generated `.mcp.json` command still exists, restart and inspect the startup error. Do not install the unbuilt source template.
- Runtime moved: select Node 24, build into a new directory and reinstall. Do not change system-wide PATH or unrelated servers to repair this plugin.
- Remote/cloud conversation: local installation does not deploy the plugin or learning data to another host.
- Removal: uninstall **Codex Study** from Plugins. Keep your separate learning folder. Removing a marketplace registration is distinct from uninstalling the plugin.

Official references: [local plugin packaging and marketplaces](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually), [shared desktop/CLI MCP configuration](https://learn.chatgpt.com/docs/extend/mcp). See [installation and upgrades](INSTALLATION.md) and [verification boundaries](VERIFICATION.md).

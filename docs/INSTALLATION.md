# Local plugin installation

## Supported path

Use Node 24.21.0/npm 11.12.1 on macOS or Linux and install locked dependencies as shown in the root README. The test client is the pinned `@openai/codex` CLI 0.144.4. Other Codex clients and the desktop plugin UI have not been acceptance-tested here.

```sh
npm run plugin:build -- build/marketplace-v0.2.0
npx --no-install codex plugin marketplace add "$PWD/build/marketplace-v0.2.0"
npx --no-install codex plugin add codex-study@codex-study-local --json
```

The first command refuses to overwrite an existing output directory. The next two commands deliberately register/install the plugin in the invoking user's Codex configuration. Keep the build directory available as the registered marketplace source. Start a fresh Codex session after installation, with the supported Node executable on PATH.

The generated marketplace includes compiled core/MCP code, six Skills, production dependencies with their licenses, MIT project license and the source lockfile. Installation copies the plugin into Codex's cache; source checkout relocation does not break that installed copy. Dependencies may include platform-specific binaries, so build for each target OS/architecture. Neither startup nor packaging installs packages or runs dependency lifecycle scripts. Dependency installation is the explicit earlier `npm ci` step.

Do not install `plugins/codex-study/` directly: it is a source template without compiled code or dependencies. No package is published to npm or the public plugin directory by this build.

## Use through Codex

1. Invoke the setup Skill, supplying an absolute learning workspace path outside the repository/plugin, language, time zone, academic year and courses. `study_capabilities`, `study_initialize`, `study_course_put` and `study_doctor` handle setup.
2. Provide an explicit local file path and stable source identity. The material-update Skill calls `study_import` and preserves previous bytes and user progress.
3. Select a source version and ask the slide-learning Skill to explain a page/section. It calls `study_read_material`; PDF text, Markdown and TXT are supported. Visual-only material remains a gap.
4. Ask to save notes. `study_note_save` checks exact hashes, ranges and quotes, and writes an immutable Markdown revision. Open the returned path or ask for `study_navigation`.

The names are `codex-study:study-setup`, `codex-study:study-update-materials`, `codex-study:study-prepare-class`, `codex-study:study-learn-slides`, `codex-study:study-self-test` and `codex-study:study-weekly-review`. Codex may display tool names with its own MCP namespace prefix. Successful tool operation is not proof of the model's teaching quality or the student's completion.

## Upgrade and data preservation

Learning records are separate from plugin files and Codex configuration. Never store a workspace inside the installed plugin or edit its cached implementation to keep personal settings. Plugin refresh may replace that cache. Keep personal files in the learning workspace and client overrides in the client configuration.

For a later project version, build into a new, versioned directory, register that local marketplace path, then install `codex-study@codex-study-local` again. Confirm the reported version and installed path; start a new session and check `study_snapshot` and `study_doctor`. A registration conflict or unsupported client is an error to resolve, not permission to erase an existing configuration. The automated acceptance test exercises a newer plugin version from the same registered marketplace directory and verifies records, personal files and configuration are unchanged; changing a marketplace's registered path is not covered by that upgrade test.

M1 databases require an explicit, separate operation:

```sh
npm run study -- upgrade --workspace "$HOME/codex-study-demo"
```

Close other workspace clients and keep a full user-managed backup first. Migration transactionally adds schema-2 note tables. Existing configuration, sources, archived bytes, task conflicts and progress are retained. Old M1 clients cannot open schema 2; no downgrade is implemented. Plugin installation alone never performs this migration.

## Diagnostics and direct MCP use

If Skills appear but tools do not, check the MCP startup error, Node version and that you installed a built package. The MCP configurations deliberately use `cwd: "."` relative to the installed plugin root and `scripts/start.mjs` as the argument. Codex 0.144.4 does not expand a plugin-root variable embedded in MCP arguments; that layout was verified by actual installation and calls, not inferred from hook-variable documentation.

The launcher reports an actionable error on unsupported Node or missing runtime files. `study_capabilities` reports readers and missing integrations; `study_doctor` inspects data integrity. No diagnostics repair/delete data automatically.

For a client that accepts ordinary stdio MCP configuration, build the repository, then set the server command to an absolute supported Node executable and the argument to the absolute `dist/packages/mcp/src/index.js`. This exposes the same 14 tools; Skills still need the client to load them separately. Standard output is reserved for MCP. No TCP listener or authentication credential is required for the local process.

## Acceptance test

```sh
npm run build
node scripts/verify-codex.mjs
```

This creates a fresh ignored `.cache/codex-acceptance-*/` directory and passes its private configuration path only to child Codex processes. It does not read/copy your normal Codex credentials or configuration. It builds and relocates a package, installs it through the actual CLI, uses Codex app-server to discover Skills and call MCP tools, then installs a newer synthetic test version and compares records/configuration. Evidence, responses and process logs remain in that directory. No model turn is made. Codex itself may refresh its public plugin catalog; the study server makes no school-service or notification calls.

The portable/compatibility manifest layouts follow the [OpenAI plugin packaging documentation](https://developers.openai.com/plugins/build/plugins). Local marketplaces are separate from public directory submission.

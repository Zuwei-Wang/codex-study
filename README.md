# Codex Study

[![CI](https://github.com/Zuwei-Wang/codex-study/actions/workflows/ci.yml/badge.svg)](https://github.com/Zuwei-Wang/codex-study/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English | [简体中文](README.zh-CN.md)

**A local-first Codex study plugin: versioned materials, cited notes and explicit learning progress.**

Study through Codex conversations and six focused Skills. A shared TypeScript core, CLI and local MCP server keep course records, original files, evidence and progress in a workspace you choose. There is no separate graphical app; generated Markdown navigation and notes are readable outside Codex too.

## Status

**M1 and M2 are implemented as a developer preview under MIT.** Build and install the local plugin from source. It is not published to a plugin directory or npm, and has no hosted service.

| Available now                                                          | Planned, not implemented                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Configurable workspace, English/Chinese navigation and IANA time zones | School-platform checks and ICS import                  |
| SHA-256 archives, retained versions, task evidence and date conflicts  | Scheduled checks and hosted reminders                  |
| Explicit progress, SQLite transactions and integrity diagnostics       | OCR, visual slide interpretation and PPTX/DOCX readers |
| Markdown/TXT sections and PDF text with original page numbers          | Managed backups/restores and wider platform support    |
| Versioned notes with validated source hashes, locations and quotes     | Pilot evaluation of AI teaching quality                |
| 14 MCP tools, six Skills, local plugin installation and upgrade checks | Public plugin-directory distribution                   |

The core and CLI do not call AI models. When Codex uses the reader, selected material text enters that Codex session; local storage does not mean offline AI inference. No school account is needed for the synthetic demo.

## Try the synthetic demo

Supported baseline: **Node.js 24.21.0, npm 11.12.1**, macOS or Linux on a local filesystem. Windows and network/synchronized filesystems are not yet supported. Select the pinned Node version with your version manager before running:

```sh
git clone https://github.com/Zuwei-Wang/codex-study.git
cd codex-study
npm install --global npm@11.12.1
npm ci --ignore-scripts
npm run demo -- "$HOME/codex-study-demo"
```

The demo imports an original fictional Markdown deck twice, retains two changed versions, records explicit progress, preserves conflicting dates, reads one section and saves a cited note with a practice question. Output includes `versions: 2`, `officialDeadlineState: "conflict"`, `recordedProgress: ["read"]`, `citedNote`, `navigation` and `doctor.ok: true`. Repeating the demo does not duplicate versions, notes or progress. Verification timestamps reflect the actual import time.

For a workspace created by M1, run the explicit `upgrade` command below before rerunning the demo.

## Install the local Codex plugin

With dependencies installed and the supported Node runtime selected:

```sh
npm run plugin:build -- build/marketplace-v0.2.0
npx --no-install codex plugin marketplace add "$PWD/build/marketplace-v0.2.0"
npx --no-install codex plugin add codex-study@codex-study-local --json
```

The build packages compiled code and production dependencies for the **current OS/architecture**. It refuses an existing output directory. Keep your learning workspace outside the repository and plugin installation. These commands use the pinned Codex CLI **0.144.4** and install into your normal Codex configuration; automated tests instead use a fresh isolated configuration. Restart Codex/open a new chat with Node 24 available on its PATH.

Ask Codex, for example:

> Use the Codex Study setup skill. Create my study workspace at [an absolute folder outside this repository], in English, time zone Europe/London, academic year 2030/31. Add DEMO101, Imaginary Systems, using the manual adapter.

Then supply the absolute path to `examples/demo-workspace/fixtures/v1/intro.md`, ask to import it as `lecture-intro`, and use the slide-learning skill to explain section 2 and save cited notes. The model supplies typed tool inputs; you do not need to hand-edit JSON.

Skills: setup, material updates, class preparation, slide learning, self-test and weekly review. Class preparation uses your confirmed session details; M2 has no automatic timetable or school-site checks. See [installation, upgrades and troubleshooting](docs/INSTALLATION.md) for the tested boundaries and manual MCP fallback.

## Manual CLI workflow

After `npm run build`, run from the repository root:

```sh
npm run study -- init --workspace "$HOME/codex-study-demo" --config examples/demo-workspace/config.json
npm run study -- course --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/course.json
npm run study -- import --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/source.json --file examples/demo-workspace/fixtures/v1/intro.md
npm run study -- task --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/task.json
npm run study -- progress --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/progress.json
npm run study -- nav --workspace "$HOME/codex-study-demo"
npm run study -- doctor --workspace "$HOME/codex-study-demo"
```

`snapshot` exports records; `read` reads an exact archived version; `note` saves a cited note with optimistic concurrency. `attempt` records caller-supplied partial/failed evidence and does not check a platform. See [input examples](examples/demo-workspace/README.md).

To explicitly migrate a closed M1 workspace to database schema 2:

```sh
npm run study -- upgrade --workspace "$HOME/codex-study-demo"
```

Migration adds note tables transactionally and preserves configuration, archives, records and progress. The old M1 client cannot read schema 2. There is no downgrade; keep a full workspace backup before migration. Installing/updating the plugin never migrates learning data automatically.

## How your data is handled

- **Storage:** `.study/records.sqlite` holds records; `objects/` preserves originals; `notes/` and `navigation/` hold immutable Markdown snapshots. Real workspaces belong outside this repository.
- **Identity:** use course ID plus source ID, never filenames alone. Format/kind changes need distinct identities. Supported archive extensions: PDF, PPTX, Markdown, TXT and DOCX; maximum 100 MiB per file.
- **Reading:** imports copy bytes without parsing. Explicit reads verify hashes first, return at most 20 pages/sections and 32,000 characters per unit, and flag empty/truncated units. PDF extraction covers text only, not diagrams, layout or OCR. PPTX/DOCX remain archive-only.
- **Notes:** citations bind to exact versions, real page/section ranges and matching quotes. This validates traceability, not explanation correctness or live lecture coverage. Revisions survive source updates; conflicting edits and modified generated files are not overwritten.
- **Dates and progress:** official dates, personal plans and feedback remain separate; conflicts and unknown times stay visible. Opened, read, drafted, uploaded, submitted and graded are explicit distinct records. Reading or saving a note never marks student progress.
- **Recovery:** files become durable before SQLite references them. Interrupted writes can be retried. `doctor` reports corrupt/missing archives or notes and unreferenced residues without deleting anything.

The repository contains only original synthetic fixtures, never real school records, browser state or private calendars. Source text is untrusted data, not authority to execute commands or take external actions.

## Development and verification

```sh
node scripts/ci.mjs
```

This shared local/hosted entry point runs locked installation, formatting, TypeScript checks, behavior tests, a real Codex CLI plugin install/MCP workflow/upgrade test, the public-source guard, dependency audit and the synthetic demo. Logs and commit/tool metadata stay in ignored `.cache/verification/`; Codex acceptance evidence stays in `.cache/codex-acceptance-*/`.

Hosted CI targets Ubuntu and macOS. Local success is not GitHub required-check success. The Codex test makes no model turn and does not evaluate teaching quality or the desktop UI. See [verification and hosted-CI fallback rules](docs/VERIFICATION.md).

## Project layout

```text
packages/core/             records, validation, SQLite, reading, notes, navigation
packages/cli/              thin command-line caller of core
packages/mcp/              14 local tools calling the same core
plugins/codex-study/       plugin templates, launcher and six learning Skills
adapters/                  planned platform and calendar adapters
examples/demo-workspace/   original synthetic fixtures and runnable demo
tests/                     behavioral, CLI, MCP, recovery and contract tests
scripts/                   verification, plugin packaging and publication guard
docs/                      installation, architecture, roadmap and boundaries
```

[Roadmap](docs/ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Public-source boundary](docs/OPEN_SOURCE_BOUNDARY.md) · [MIT license](LICENSE)

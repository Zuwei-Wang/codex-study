# Codex Study

[![CI](https://github.com/Zuwei-Wang/codex-study/actions/workflows/ci.yml/badge.svg)](https://github.com/Zuwei-Wang/codex-study/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Local-first study records, material versioning and evidence-aware task navigation.**

面向 Codex 的本地学习工作流。先可靠保存课程、课件版本、任务来源和个人进度，再逐步接入课前准备、课件学习、自测与复习。

## Status / 当前状态

**M1 is implemented as a local core and CLI.** This repository is an early developer preview under the MIT license, not an installable Codex plugin or a hosted application.

| Available now                                                       | Planned, not implemented                          |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| Configurable workspace, English/Chinese navigation, IANA time zones | Codex MCP server and learning Skills              |
| Manual imports with SHA-256 deduplication and retained revisions    | School-platform checks and ICS import             |
| Source identities, course records, task evidence and date conflicts | PDF/PPTX parsing, AI tutoring and note generation |
| Explicit learning progress that survives imports                    | Scheduled checks and hosted reminders             |
| SQLite transactions, crash recovery, integrity diagnostics          | Managed backups/restores and independent UI       |

不需要学校账号即可运行演示。当前 CLI 不调用 AI、不访问学校网站、不发送通知；未来的 Codex 集成也不意味着 AI 推理完全离线。

## Try the synthetic demo

Supported baseline: **Node.js 24.21.0, npm 11.12.1**, macOS or Linux on a local filesystem. Windows and network/synchronized filesystems are not yet supported. Use your Node version manager with `.node-version`, then install the pinned npm if needed.

```sh
git clone https://github.com/Zuwei-Wang/codex-study.git
cd codex-study
npm install --global npm@11.12.1
npm ci --ignore-scripts
npm run demo -- "$HOME/codex-study-demo"
```

The demo creates a synthetic workspace at the path you choose. It imports a Markdown slide deck, repeats the import, imports a changed file with the same name, preserves two versions, records reading progress and retains two conflicting official dates. Its JSON output includes the generated navigation file path.

Expected key results:

```json
{
  "synthetic": true,
  "repeated": { "changed": false, "version": 1 },
  "versions": 2,
  "officialDeadlineState": "conflict",
  "recordedProgress": ["read"],
  "doctor": { "ok": true, "issues": [], "recoverableFiles": [] }
}
```

This is an abbreviated expected projection; real output also includes hashes and paths. Running the demo again reuses the two versions. Verification timestamps reflect the actual import time. All demo content is original and fictional.

## Manual CLI workflow

After `npm run build`, these commands work from the repository root:

```sh
npm run study -- init --workspace "$HOME/codex-study-demo" --config examples/demo-workspace/config.json
npm run study -- course --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/course.json
npm run study -- import --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/source.json --file examples/demo-workspace/fixtures/v1/intro.md
npm run study -- task --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/task.json
npm run study -- progress --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/progress.json
npm run study -- nav --workspace "$HOME/codex-study-demo"
npm run study -- doctor --workspace "$HOME/codex-study-demo"
```

`snapshot` exports the complete records as JSON. `attempt` records an explicitly supplied partial/failed observation for an existing source; it does not perform a platform check. See [the example walkthrough](examples/demo-workspace/README.md) and [data semantics](docs/ARCHITECTURE.md).

## How your data is handled

- **Local workspace:** `.study/records.sqlite` holds records; `.study/objects/` holds original file bytes; `.study/navigation/` holds immutable generated Markdown snapshots. Real workspaces belong outside this code repository.
- **Identity:** a source is identified by course ID and source ID, never by filename alone. A format or material-kind change requires another identity. Byte-identical objects can share physical storage while retaining separate provenance records.
- **Evidence:** current and historic versions retain hashes, names, observation times and source references. Imports copy bytes without executing or parsing documents. Supported archive extensions: PDF, PPTX, Markdown, TXT and DOCX; limit 100 MiB per file.
- **Dates:** official deadlines, personal plans and feedback dates are separate assertions. Unknown and date-only values stay imprecise. Conflicting official assertions remain visible; no date is silently chosen.
- **Progress:** opened, read, drafted, uploaded, submitted and graded are independent explicit records. Importing a file or marking it uploaded never marks it submitted.
- **Recovery:** archives become durable before SQLite references them. After an interrupted import, rerun it. `doctor` reports corrupt/missing archives and leftover unreferenced files without deleting anything. Generated navigation never overwrites edited files.

The repository contains no real school material, accounts, browser state, private calendar URLs or personal learning records. There is no cloud dependency in M1.

## Development and verification

```sh
node scripts/ci.mjs
```

This is the shared local/hosted verification entry point. It runs locked dependency installation, formatting, strict TypeScript checks, behavioral tests, the public-source guard, dependency audit and the synthetic demo. Full logs and tool/commit metadata are written to ignored `.cache/verification/` files.

Hosted CI runs on Ubuntu and macOS. Local success is not GitHub required-check success. [Verification and hosted-CI fallback rules](docs/VERIFICATION.md) explain the narrow allowed fallback and evidence requirements.

## Project layout

```text
packages/core/             typed records, validation, SQLite storage, navigation
packages/cli/              thin command-line caller of core
packages/mcp/              planned local MCP integration
plugins/codex-study/       planned plugin and learning Skills
adapters/                  planned platform and calendar adapters
examples/demo-workspace/   original synthetic fixtures and runnable demo
tests/                     behavioral, CLI, crash-recovery and CI-contract tests
scripts/                   shared verification and publication guard
docs/                      design, roadmap, verification and source boundaries
```

[Roadmap](docs/ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Public-source boundary](docs/OPEN_SOURCE_BOUNDARY.md) · [MIT license](LICENSE)

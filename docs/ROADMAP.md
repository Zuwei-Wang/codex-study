# Development roadmap

Status: M1–M3 are implemented as developer previews. M4 has an unqualified service candidate; M5 pilot results remain pending. MIT licensing, public-source review, documentation and standard CI have been brought forward. AI teaching quality and desktop UI behavior still require pilot evaluation.

## M1 — A working synthetic local workflow (implemented)

- Define versioned records for courses, sources, tasks and workspace configuration.
- Support configurable workspace location, language, academic year and time zone.
- Review validation, hashing, source comparison and recoverable storage requirements; implement independently without importing private project source. See docs/ARCHITECTURE.md.
- Initialize a synthetic workspace, import a slide file, re-import it without duplication, and retain both versions when its bytes change.
- Generate human-readable material and task navigation from authoritative records.

Acceptance: synthetic profiles with different paths and time zones work; a repeated run is stable; interrupted writes are recoverable; conflicting deadlines and user progress survive imports.

## M2 — Codex integration (implemented developer preview)

- Expose tested core operations through CLI and 14 local MCP tools.
- Read Markdown/TXT sections and original PDF text pages with explicit visual/OCR limitations.
- Save immutable cited note revisions, validate exact source locations and quotes, and refuse conflicting edits.
- Package setup, course updates, class preparation, slide-based learning, self-test and weekly review Skills.
- Add installation and capability diagnostics, and test installation on a clean user configuration.
- Keep user workspace data outside the installed plugin and preserve it across plugin upgrades.

Acceptance evidence: the actual pinned Codex CLI installs a relocated package in a fresh configuration, discovers all six Skills, calls setup/import/read/note/task/progress tools, and refreshes to a newer synthetic version without changing records or configuration. Notes validate traceable references and label published-material coverage. This verifies client integration; no model turn or real learner trial has been evaluated.

## M3 — Verified course-platform checks (implemented developer preview)

- Start with manual files and supported ICS imports.
- Implement and verify a Minerva/Blackboard Ultra browser workflow using the user's own authorized session.
- Save observations as candidates; validate and apply complete snapshots through core operations.
- Add opt-in daily scheduling after the manual workflow works.

Acceptance evidence: synthetic tests detect new/changed files and dates, prove unchanged results and preserve records on incomplete/failed checks. The real Codex client invokes ICS/scan tools; a limited authenticated Minerva check verified directory traversal, PDF preview and download bytes outside this repository. The opt-in foreground scheduler is tested with real child processes and synthetic observations. Actual unattended CLI/browser operation remains a per-installation qualification, not an established service. See [tested scope](PLATFORM_CHECKS.md).

## M4 — Optional hosted reminders (implementation candidate; real qualification pending)

- Publish a minimal, versioned sync contract and a synthetic preview/mock.
- Implement the separately maintained hosted service with verified recipients, user isolation, configurable time zones, opt-out and cancellation.
- Handle rescheduling, stale snapshots, retries and persistent notification deduplication.

Acceptance: users cannot access each other's data; obsolete reminders are suppressed; local learning remains usable without this service; real delivery is verified separately from API acceptance.

Implementation evidence: strict projection/preview, separate single-process HTTP/SQLite service, recipient verification, isolated accounts, opt-out, revision cancellation, stale suppression, bounded retries, persistent deduplication, a synthetic demo and an implemented Resend API adapter. An isolated HTTPS test deployment has also passed synthetic worker, isolation, cancellation, opt-out and restart checks. Real-recipient qualification remains in progress; see [deployment evidence](M4_QUALIFICATION.md). See [runbook](../services/reminders/README.md).

## M5 — Public release and pilot

- Choose a license and audit the complete release contents and imported code attribution.
- Add documented standard CI, synthetic examples, installation instructions, contribution guidance and supported-platform limitations.
- Record a demonstration using only original synthetic material.
- Pilot with a small group and record actual results before expanding platform support. The owner will arrange 2–3 testers; actual results are still pending.

Acceptance: another person can install the released version, run the documented demo without a school account, and distinguish implemented, experimental and planned functionality.

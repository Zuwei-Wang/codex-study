# Development roadmap

Status: M1 is implemented as a developer preview. M2–M5 remain planned, except that MIT licensing, public-source review, documentation and standard CI have been brought forward for the public M1 showcase.

## M1 — A working synthetic local workflow (implemented)

- Define versioned records for courses, sources, tasks and workspace configuration.
- Support configurable workspace location, language, academic year and time zone.
- Review validation, hashing, source comparison and recoverable storage requirements; implement independently without importing private project source. See docs/ARCHITECTURE.md.
- Initialize a synthetic workspace, import a slide file, re-import it without duplication, and retain both versions when its bytes change.
- Generate human-readable material and task navigation from authoritative records.

Acceptance: synthetic profiles with different paths and time zones work; a repeated run is stable; interrupted writes are recoverable; conflicting deadlines and user progress survive imports.

## M2 — Codex integration

- Expose tested core operations through CLI and local MCP wrappers.
- Package setup, course updates, class preparation, slide-based learning and weekly review Skills.
- Add installation and capability diagnostics, and test installation on a clean user configuration.
- Keep user workspace data outside the installed plugin and preserve it across plugin upgrades.

Acceptance: a new user can complete setup and a slide-learning workflow through Codex without manually editing data files. Notes contain traceable references and do not claim unobserved class attendance or coverage.

## M3 — Verified course-platform checks

- Start with manual files and supported ICS imports.
- Implement and verify a Minerva/Blackboard Ultra browser workflow using the user's own authorized session.
- Save observations as candidates; validate and apply complete snapshots through core operations.
- Add opt-in daily scheduling after the manual workflow works.

Acceptance: detect a new slide file, a changed same-name file, and a changed deadline; unchanged runs are quiet; expired login/MFA and partial coverage are explicit; failure does not erase prior evidence.

## M4 — Optional hosted reminders

- Publish a minimal, versioned sync contract and a synthetic preview/mock.
- Implement the separately maintained hosted service with verified recipients, user isolation, configurable time zones, opt-out and cancellation.
- Handle rescheduling, stale snapshots, retries and persistent notification deduplication.

Acceptance: users cannot access each other's data; obsolete reminders are suppressed; local learning remains usable without this service; real delivery is verified separately from API acceptance.

## M5 — Public release and pilot

- Choose a license and audit the complete release contents and imported code attribution.
- Add documented standard CI, synthetic examples, installation instructions, contribution guidance and supported-platform limitations.
- Record a demonstration using only original synthetic material.
- Pilot with a small group and record actual results before expanding platform support.

Acceptance: another person can install the released version, run the documented demo without a school account, and distinguish implemented, experimental and planned functionality.

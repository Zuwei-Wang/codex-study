# Calendar imports, platform observations and daily checks

## Calendar import

M3 accepts a **user-selected local ICS export**, not a private subscription URL. No calendar attachment, alarm, URL or script is executed. Raw bytes are preserved under `.study/calendars/`, with feed attempts and historical snapshots in SQLite.

```sh
npm run study -- calendar --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/calendar.json
```

The example is original synthetic data. Each import names a stable feed ID, a window of at most 366 days and explicit UID-to-course mappings. Unmapped events stay unmapped. Date-only values remain date-only with exclusive ends. Floating times require an explicit `floatingTimeZone`; they are not silently interpreted in the machine's zone.

Supported: UTC, IANA TZID and embedded VTIMEZONE, daily/weekly/monthly/yearly RRULEs, date/time RDATE/EXDATE, single-instance exceptions, sequence-based revisions and explicit cancellation tombstones. Recurrence IDs preserve identity when an occurrence moves. Missing entries remain visible as `missing`; they never become cancellations automatically. Stale sequences and conflicting duplicate revisions cannot replace newer evidence. Failed parses preserve previous sessions and verification time; partial imports retain a separate last-verified hash/time and full historical snapshots.

Limits: 5 MiB input, 3,000 VEVENTs, 20,000 recurrence iterations, 10-second parsing worker timeout and 128 MiB JavaScript heap. RANGE exceptions, sub-daily recurrences and period-valued RDATE are rejected explicitly. Ambiguous/nonexistent IANA wall times are rejected when no explicit VTIMEZONE supplies the offset. These are supported-format boundaries, not evidence that a rejected timetable is empty.

## Browser observations

Configure a course with `adapter: "blackboard-ultra"` and its canonical HTTPS `coursePage` without credentials/query tokens. The `study-check-courses` Skill guides navigation through the user's authorized browser; this package supplies no browser driver, password manager or authenticated scraping connection.

Core separates preparation, candidate records and application:

1. `study_scan_prepare` saves the exact course/surface scope and a baseline.
2. Inspect the live platform and download requested files to the private workspace. Record stable identities, actual observation times, file hashes and task evidence using `study_scan_record`.
3. `study_scan_apply` validates the candidate, unchanged baseline and exact bytes. A complete scope applies files and tasks in one transaction. Partial/failed scopes retain the prior authoritative records and actual verification times. Candidates remain inspectable with `study_scan_get`.

CLI equivalents are `scan-prepare`, `scan-record` and `scan-apply`, each with `--workspace` and `--input`. Inputs are strict schemas exported from core. Every file includes its observed `surface`; task candidates are `{ task, surface }`. Core rejects candidates outside the prepared course/surface scope. CLI exit code 2 means a recorded partial/failed result, not a successful complete check. Original file copies can remain as recoverable residues after an aborted transaction; `doctor` lists them without deletion. Unchanged complete scans report `changed: false`; source-byte verification times change only for files actually imported.

Explicit reasons include expired session, required MFA, unavailable browser capability, incomplete coverage and unverified download. A content listing does not verify current file bytes. Empty calendars, missing assessment portals and “No due date” do not mean no work. Progress is always separate.

## Opt-in daily scheduling

A schedule contains an exact scope, local wall time, IANA zone, explicit opt-in and a successful **manual** scan ID for the same scope. Save it through `study_schedule_configure` or `schedule-configure`; existing edits require the current schedule revision. No schedule is created/enabled by installation.

The runner is a foreground process:

```sh
npm run schedule -- --workspace "$HOME/codex-study-demo" --once
npm run schedule -- --workspace "$HOME/codex-study-demo"
```

It only claims enabled plans when due. Use `--codex /absolute/path/to/codex` if necessary. Codex must already be configured with this plugin and an authorized browser connection. Desktop-only browser tools are not automatically available to CLI runs. No OS service, system cron, desktop automation or cloud scheduler is installed by these commands.

Daily time follows the selected zone. DST gaps move forward; overlaps choose the earlier occurrence. A persistent `(schedule ID, local date)` claim prevents duplicate execution after restart and across concurrent runners. Catch-up is limited to two hours; missed windows are not backfilled. The process and machine must remain awake. Reconfiguration or disabling blocks a linked candidate from applying. A running claim left by interruption is deliberately not retried automatically: inspect its private log, then use `study_schedule_finish` with a concrete failure reason if recovery is needed.

Each execution invokes Codex with a fixed scoped prompt and records private process logs under `.study/runs/`. Completion requires a matching, newly applied scan linked to that run, not merely process exit zero. Authentication/browser failure remains failed or partial. This is a local check runner, not an email service; real unattended operation is only established after the user's configured environment completes a scheduled run.

## Verification scope

Automated tests cover DST, all-day/floating values, recurrence exceptions, moved/cancelled occurrences, missing/stale feeds, malformed input, changed files/deadlines, unchanged runs, progress retention, atomic rollback, candidate conflicts, opt-in, persistent scheduling claims, cancellation and actual child-process execution using an explicitly synthetic adapter. The pinned Codex CLI test invokes calendar/scan/configuration tools after real plugin installation; its schedule stays disabled.

On 2026-10-08 a manual compatibility check through an existing authenticated Minerva Chrome session confirmed course-folder expansion, terminal content markers, embedded PDF preview and the original download action. The browser download event timed out, but a new local PDF outside the repository was independently verified by its timestamp, header and SHA-256. No real course IDs, document bytes, private observations or browser credentials were added to this repository. This limited live check is not a full course audit or an unattended-run qualification.

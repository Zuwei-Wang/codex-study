---
name: study-schedule
description: Configure, inspect or disable an explicitly requested daily Codex Study course check after a successful manual run, while keeping configured, running and verified states distinct.
---

Resolve the user's exact courses, surfaces, IANA time zone and daily local time. Do not enable a schedule from a general request to set up study tools. Use `study_snapshot` to find a completed manual scan of the same scope; if absent, use the course-check Skill manually first. An expired browser session or missing browser capability must be resolved before claiming a working setup.

Call `study_schedule_configure` with `optIn: true` and `enabled: true` only when the user requested that scope and cadence. Supply the manual scan ID and null expected revision for a new schedule, or the current revision for an edit. To disable, preserve the other settings and set enabled/optIn to false. Disabling/reconfiguring prevents a linked in-flight scan from applying and prevents later claims. Inspect the returned record.

The local scheduler is a foreground process; saving configuration does not start it. It invokes the user's configured Codex CLI, which must have this plugin and an authorized browser connection. Desktop-only browser tools do not automatically appear in CLI sessions. Use the installed package's `runtime/packages/scheduler/src/index.js` (or the source checkout's `npm run schedule -- --workspace PATH`) only when the user authorizes starting the runner. Do not install system services or create another automation implicitly.

A manual runner check uses `--once`; outside the due window it does no work. Daily wall time follows the configured zone, with a two-hour catch-up window and one persistent claim per local date. Spring gaps move forward; fall overlaps use the earlier instant. A missed window is not backfilled. The machine and runner must be awake. Interrupted running claims require inspection and explicit failure recording with `study_schedule_finish`, not a blind retry.

Use the actual `scheduleRuns` result and its linked applied scan to report success, partial coverage or failure. A configured schedule, a started process or process exit zero is not proof of a successful unattended check. Keep unchanged complete checks quiet and surface meaningful changes, failures or required user action. Scheduling does not enable email notifications or hosted reminders.

# Small-group pilot

[简体中文](PILOT.zh-CN.md)

The owner will arrange 2–3 participants. No participant has yet been recorded as installed, tested or successful. Use participant aliases, not names/student IDs. First test only original synthetic material; do not attach private learning data, account tokens or browser screenshots to public issues.

## Tested baseline

Use public developer-preview commit **386d8babc6d55119aaac4bb998eb1a303cc348de** (M3, version 0.3.0). Its exact commit passed both [Ubuntu and macOS hosted CI](https://github.com/Zuwei-Wang/codex-study/actions/runs/37852125088). The later M4 reminder preview has passed a one-recipient live trial, but is not required for this local-workflow pilot. If you choose a later revision, record that exact SHA and verify its hosted CI separately.

Required: macOS/Linux, Node 24.21.0, npm 11.12.1, and a Codex environment supporting the tested CLI/plugin version 0.144.4. The synthetic demo needs no school account or mail service. Codex model use may require the participant's normal account; the project does not supply one. Windows is not qualified.

```sh
git clone https://github.com/Zuwei-Wang/codex-study.git
cd codex-study
git checkout 386d8babc6d55119aaac4bb998eb1a303cc348de
# Select Node 24.21.0 using your version manager.
npm install --global npm@11.12.1
npm ci --ignore-scripts
npm run demo -- "$HOME/codex-study-pilot"
npm run plugin:build -- build/pilot-v0.3.0
npx --no-install codex plugin marketplace add "$PWD/build/pilot-v0.3.0"
npx --no-install codex plugin add codex-study@codex-study-local --json
```

The plugin commands change the participant's normal Codex configuration. Restart Codex/open a new chat after installation, with Node 24 on its PATH. Preserve any existing plugin configuration; use [installation troubleshooting](INSTALLATION.md) if a conflicting registration exists. Keep the learning workspace outside the source checkout and installed plugin. Do not use `init` to replace an existing workspace with different settings.

## Trial tasks (about 30–45 minutes)

1. Run the synthetic demo twice. Confirm two material versions, conflict status, one recorded `read` stage, cited note and `doctor.ok: true`; a repeat should not duplicate records.
2. Ask Codex to inspect capabilities and read section 2 of the imported synthetic source. Ask for an explanation, one self-test question and a cited note. Open the returned note and verify its quote and section against the original. Record whether explanation quality helps you learn.
3. Explicitly mark one synthetic task `drafted`. Re-import the original material. Check that progress remains and nothing says submitted/graded. Confirm that simply reading did not mark completion.
4. Import the synthetic ICS example using a private copied input file whose `file` points to the checkout's original fixture. It deliberately describes 2030 dates. Confirm three occurrences, the London DST offset change and explicit course mapping. Do not interpret the fictional dates as your timetable.
5. Ask for a scoped course check without granting a school/browser connection. Record an honest capability-unavailable result; do not treat an empty response as a successful audit. Browser/live school testing is optional and requires your authorized session; real records stay private.
6. Inspect the weekly-review workflow and task/date conflicts. Report anything that obscures missing evidence, confuses published slides with live coverage or changes progress unexpectedly.

Scheduling, live browser checks and real reminders each need their own environment-specific qualification. Installation, a configured schedule or the synthetic mail demo does not prove any of them works unattended or delivers to a person. Do not enable real reminders merely to complete this pilot.

## Recorded synthetic demonstration

[Terminal recording](demo.cast) captures three successful commands from a clean archive of the pinned M3 commit: locked dependency installation, the synthetic demo and its repeated run. The asciinema v2 file contains actual process output; only local machine paths are replaced with labeled placeholders. Its header records commit and tree SHA. It has no real school material or AI conversation. Replay with an asciinema-compatible viewer.

## Feedback and acceptance

Use [the feedback template](pilot-feedback-template.md). Record exact commit, OS/runtime/client versions, which tasks were actually attempted, actual outcomes, useful anonymized error text and reproduction steps. Keep “not attempted”, “blocked” and “failed” distinct. A participant may stop at any time; the owner should collect feedback privately and only add a sanitized summary with the participant's consent.

M5 can pass only after another person installs the chosen version, runs the documented synthetic demo and can distinguish available, experimental and planned capabilities. Two or three testers are the intended small-group sample, not an existing result. Fix observed failures, re-run relevant checks and record follow-up outcomes before expanding supported platforms. AI teaching quality needs human review; automated citation checks are not sufficient.

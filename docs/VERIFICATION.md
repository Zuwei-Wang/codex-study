# Verification and hosted-CI fallback

## Standard verification

Use the exact Node/npm versions in `.node-version` and `.npm-version`. The authoritative ordered commands are in `scripts/ci-commands.json`; both GitHub Actions and local validation execute them through:

```sh
node scripts/ci.mjs
```

The commands install from the lockfile, run formatting/type checks, compile and run all tests, execute `node scripts/verify-codex.mjs` against pinned Codex CLI 0.144.4, scan publishable files, audit dependencies, and run the synthetic demo. The `tests/ci-contract.test.ts` check ties the workflow, pins and shared runner to this contract. Any required-command change must update this contract, documentation and consistency test together.

`.cache/verification/<timestamp>/evidence.json` records commit SHA, tree SHA, workspace state before/after, lockfile hash, Node/npm versions, OS/architecture, every command and exit code, full log paths and semantic limitations. Files are local and ignored. Hosted results are independently visible in the authenticated Actions run.

The tests include two profiles/time zones, stable identity, changed and unchanged imports, retained exact bytes, current-version reversions, date conflicts, personal-plan/progress preservation, localization, strict validation, corrupted objects, symlink refusal, concurrent writers, a real CLI walkthrough, and child processes killed before/after database commit. SIGKILL is not proof of hardware power-loss durability. The tests use only original synthetic data. M2 adds exact-version reads, real PDF page extraction (including blank and invalid documents), quote/location validation, preserved note history, conflicting edits, explicit M1 migration and a real stdio MCP client workflow.

The required Codex acceptance command builds and relocates a complete plugin, installs it in isolated child-process configuration, discovers all eight Skills and 21 tools, performs a learning-record workflow through Codex app-server, and installs a newer synthetic version while preserving records, a user file and configuration. JSON evidence and logs are retained in `.cache/codex-acceptance-*/`. The acceptance command also exercises ICS import, complete scan application and disabled schedule configuration. Scheduler tests invoke a real child process with explicitly synthetic observations. No model turn, teaching-quality evaluation, desktop UI interaction, school login or reminder delivery is tested by CI. A separate limited live browser compatibility check is documented in PLATFORM_CHECKS.md. Client catalog traffic may occur; no personal credentials are supplied.

## Narrow fallback eligibility

GitHub-hosted Actions is the default merge basis. Local fallback is eligible only when an applicable hosted job **did not start** because of exhausted quota, billing/budget blocking, a GitHub platform incident, or hosted-runner creation/scheduling/provisioning failure. Record the exact run URL and authenticated error evidence alongside the local report.

A job that started and reported a test, build, lint, security or configuration failure must be fixed and rerun. Local validation cannot override that failure.

In a clean checkout of the exact PR commit, with no production credentials:

```sh
node scripts/ci.mjs --fallback --reason quota
```

Other allowed reason values: `billing`, `platform-incident`, `runner-provisioning`. The argument records a claim; it does not establish eligibility. Include all generated logs and `evidence.json`, plus the hosted-job evidence and any platform differences. The script refuses a dirty fallback checkout and mismatched Node/npm versions. Inspect workspace state again before relying on evidence.

Any change to the candidate commit/tree, toolchain, lockfile or workspace invalidates previous evidence. Incomplete commands, missing logs or missing applicable checks are not a merge basis. A maintainer must explicitly decide whether to merge after reviewing complete evidence; the script cannot authorize a merge or create GitHub statuses. Never describe local success as `Required Checks=success`.

Fallback cannot authorize production deployments, releases, database migrations, credentialed uploads or other production changes. Production must remain on its previously authenticated commit if a change is merged while hosted CI is unavailable. Once hosted CI recovers, rerun it on the default branch's exact current commit and wait for authenticated required checks before any deployment or release.

Never weaken, remove or skip required checks or provide production credentials to make verification pass.

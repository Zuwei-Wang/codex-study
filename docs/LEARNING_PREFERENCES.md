# Learning preferences

[简体中文](LEARNING_PREFERENCES.zh-CN.md)

Setup offers four optional questions: usual planning rhythm, self-study versus class-led learning, manageable session length, and preferred level of support. Users can answer some, skip all, and change or clear choices later. No response is not an explicit skip. Existing answers or a recorded skip are not asked again automatically.

These are changeable, self-reported preferences, not personality labels, learning-ability scores or a validated teaching diagnosis. The model must not infer them from late tasks, grades, missing progress or source documents. Current user instructions take priority.

| Choice                                           | Suggested response                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Regular steps (`steady`)                         | Regular study blocks                                                 |
| Concentrated near a deadline (`deadline-driven`) | A small first action and optional earlier personal milestones        |
| Depends on the task (`flexible`)                 | Adjustable blocks                                                    |
| Self-study (`self-study`)                        | Bounded reading, worked example, practice and review                 |
| Mainly classes (`lecture-led`)                   | Preview questions and post-class review, without assuming attendance |
| Mixture (`mixed`)                                | Combine preview, learning and practice                               |
| Session length                                   | An explicit 10–180 minutes; otherwise unknown                        |
| Support                                          | Small steps/checkpoints, light overview, or help only on request     |

The setup, preparation, slide-learning, self-test and review Skills use these choices to guide suggestions. This is implemented workflow guidance, not measured improvement in teaching quality. Preferences do not change official dates or learning progress and never enable notifications or scheduled runs. A checkpoint suggestion is not a running reminder.

## Storage and editing

Preferences live only in the local workspace SQLite database and are included in private snapshots. They are excluded from the minimal hosted reminder projection and do not enter the optional mail service. A model reading the snapshot receives the preferences in the current Codex conversation. Do not attach real preference records or workspace exports to public issues.

- `study_preferences_get` returns a record and deterministic planning guidance. A null record means no answers yet.
- `study_preferences_save` accepts `expectedRevision` and `preferences`. Use only user-provided choices with `status: provided`, omitting unanswered fields. `{ "status": "skipped" }` records an explicit skip. `preferences: null` clears choices and allows onboarding again.
- Read the latest revision before editing. Identical retries are unchanged; stale different edits fail instead of replacing another update. Clearing and resaving does not reuse an earlier revision.
- Only the current record is retained; there is no preference biography or history.

CLI equivalents:

```sh
npm run study -- preferences --workspace /absolute/learning-workspace
npm run study -- preferences-save --workspace /absolute/learning-workspace --input /absolute/private/preferences.json
```

[The example input](../examples/demo-workspace/preferences.json) is synthetic, not a default to assign to users. Its null expected revision applies only to a new record.

## Existing workspaces

Version 0.5.0-dev.1 uses database schema 4. Schema 1–3 workspaces need an explicit upgrade with clients closed and a full workspace backup:

```sh
npm run study -- upgrade --workspace /absolute/learning-workspace
```

This transaction adds preference storage (and any earlier missing schema tables), retaining configuration, materials, citations, task evidence, progress, calendars and schedules. Existing users start with unknown preferences. Installing or updating the plugin does not authorize or perform this upgrade. Old clients cannot read schema 4; no downgrade is provided.

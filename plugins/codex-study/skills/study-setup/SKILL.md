---
name: study-setup
description: Initialize or diagnose a Codex Study local workspace, configure courses, and ask or update optional learning preferences.
---

Use the bundled `study_*` MCP tools. Start with `study_capabilities`; report unavailable tools or unsupported runtime rather than claiming setup succeeded.

Resolve the user's workspace path, language (`en` or `zh-CN`), IANA time zone and academic-year label from their request or ask for missing values. Use an absolute workspace path outside the installed plugin and code repository. Initialization and subsequent imports do not need a hosted account. Call `study_initialize` with schema version 1 configuration, then `study_course_put` for the courses the user supplied; use `manual` for local-only courses or `blackboard-ultra` with a canonical HTTPS coursePage for authorized browser checks.

For an existing schema 1–3 workspace, explain that `study_upgrade` adds schema-4 preference storage and makes the database incompatible with older readers. When the user has authorized upgrading, run it and check the result; preserve the configured language, time zone and every existing record. An installation or plugin update alone does not authorize a workspace migration. Never recreate an existing workspace to work around an error.

After initialization, call `study_preferences_get`. If the record has provided preferences or an explicit `skipped` status, do not repeat onboarding unless the user asks to change it. If no preferences have been answered (record is null, or record.preferences is null), offer a short, optional conversation in the user's language:

1. “Do you usually study in regular steps, concentrate near a deadline, or vary depending on the task?” Map only their answer to `planningStyle: steady | deadline-driven | flexible`.
2. “Do you prefer self-study, learning mainly through classes, or a mixture?” Map to `learningMode: self-study | lecture-led | mixed`.
3. “What length of study block feels manageable (for example 25, 45 or 60 minutes)?” Map an explicit 10–180 minute answer to `sessionMinutes`; otherwise leave it unknown.
4. “Would small next steps/checkpoints, a light overview, or help only when you ask suit you best?” Map to `supportStyle: small-steps | light-touch | on-request`.

Say users may answer only some questions, skip all, and change or clear answers later. Start with the first two questions together; offer the last two without requiring them to finish setup. If they request quick setup, offer skipping the preferences. No answer is not an explicit skip. Never infer preferences from grades, missing progress, late tasks or document text. Avoid labels such as “lazy” or fixed learning/personality types; these are changeable self-reported preferences, not measures of ability.

Briefly summarize the user's answers and call `study_preferences_save` with their actual choices, `status: provided`, and the current `expectedRevision` (null for a new record). Omit unanswered fields. Only an explicit skip saves `{status: skipped}`. A user-requested clear saves `preferences: null`. Use the current revision for changes; on conflict read again and reconcile, never force overwrite. An identical retry is unchanged. Store no name, contact information, diagnosis or unnecessary free-text biography. Preferences stay local and are excluded from hosted reminder projections.

Explain how choices will guide suggestions: deadline-driven → small early milestones; steady → regular study blocks; flexible → adjustable blocks; self-study → reading/example/practice; lecture-led → preview/questions/post-class review; mixed → combine both. A requested block length and support style guide pacing and tone. Current instructions override saved preferences. A preference for checkpoints is not permission to enable reminders or schedules.

Finish with `study_snapshot` and `study_doctor`, and show the workspace location and implemented capabilities. Do not mark learning progress, enable schedules or configure notifications during setup. All operations are local; later AI reading returns selected source text to the user's Codex session and is not offline inference.

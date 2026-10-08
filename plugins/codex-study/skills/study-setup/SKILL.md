---
name: study-setup
description: Initialize or diagnose a Codex Study local workspace and configure courses when the user is setting up their study workflow.
---

Use the bundled `study_*` MCP tools. Start with `study_capabilities`; report unavailable tools or unsupported runtime rather than claiming setup succeeded.

Resolve the user's workspace path, language (`en` or `zh-CN`), IANA time zone and academic-year label from their request or ask for missing values. Use an absolute workspace path outside the installed plugin and code repository. Initialization and subsequent imports do not need a hosted account. Call `study_initialize` with schema version 1 configuration, then `study_course_put` for the courses the user supplied; use `manual` for local-only courses or `blackboard-ultra` with a canonical HTTPS coursePage for authorized browser checks.

For an existing M1/M2 workspace, explain that `study_upgrade` adds schema-3 records and makes the database incompatible with older readers. When the user has authorized upgrading, run it and check the result; preserve the configured language, time zone and every existing record. An installation or plugin update alone does not authorize a workspace migration. Never recreate an existing workspace to work around an error.

Finish with `study_snapshot` and `study_doctor`, and show the workspace location and implemented capabilities. Do not mark learning progress, enable schedules or configure notifications during setup. All operations are local; later AI reading returns selected source text to the user's Codex session and is not offline inference.

---
name: study-self-test
description: Create a practice self-test or give feedback on the learner's answers using a selected Codex Study material version.
---

Resolve the target course and material with `study_snapshot` and read the relevant ranges with `study_read_material`. Questions must be grounded in readable, cited pages/sections. Clearly label generated examples and practice questions; do not treat a generated answer as the lecturer's wording. Unread visual content and unsupported formats remain gaps.

Match the scope and difficulty the user requested. Unless they ask for an answer key, present the practice questions first and wait for their answers before explaining mistakes. Distinguish practice feedback from official assessment grades. Do not complete assessed work, invent answers attributed to the user, or mark an official task as graded.

Save only when requested using `study_note_save` with `self-test` sections and verified source quotes. User answers/reflections must come from the user. Preserve note revisions and use `published-material` coverage by default. Only call `study_progress_mark` for an explicit user-reported stage.

# Synthetic demo workspace

All materials here are original, fictional fixtures under the repository's MIT license. `fixtures/v1/intro.md` and `fixtures/v2/intro.md` are Markdown slide decks with the same filename and different content. There is no genuine school data.

From the repository root with the pinned toolchain:

```sh
npm ci --ignore-scripts
npm run demo -- "$HOME/codex-study-demo"
```

The demo validates unchanged-import deduplication, two retained versions, official-date conflicts, persistent explicit reading progress and archive integrity. Repeating it does not create additional versions/tasks/progress records. It prints the actual navigation path; open that Markdown file to browse both versions and the task evidence.

To change language/time zone, copy `config.json` to a private location, choose `zh-CN` or `en` and a valid IANA zone, then initialize a **different** workspace. Reinitialization does not silently overwrite existing configuration. Workspace paths can contain spaces and Unicode.

Use `npm run study -- --help` for all commands. The example inputs cover courses, material sources, tasks, progress and partial observations. `task.json` deliberately contains conflicting official dates, a personal plan and an unknown feedback date. A date without a time remains date-only.

For an explicit partial observation after importing the source:

```sh
npm run study -- attempt --workspace "$HOME/codex-study-demo" --course DEMO101 --source lecture-intro --input examples/demo-workspace/attempt.json
npm run study -- snapshot --workspace "$HOME/codex-study-demo"
npm run study -- nav --workspace "$HOME/codex-study-demo"
```

The prior verified files and verification timestamp remain available; the new partial attempt is separately recorded. This is synthetic input, not an implemented platform check.

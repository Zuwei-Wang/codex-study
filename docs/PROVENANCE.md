# Public-source review

## Authorship and licensing

Project source and the synthetic Markdown decks/JSON fixtures were created specifically for Codex Study. No real lecture slides, student records, personal notes, private calendars, school/browser credentials, production logs, backups, or existing project history are included. No code from an existing personal learning system was copied. The repository's original material is licensed under [MIT](../LICENSE).

External dependencies retain their own licenses: Zod (MIT), TypeScript (Apache-2.0), Prettier (MIT), Node type definitions (MIT), and their lockfile dependencies. Node.js and GitHub Actions are separately distributed tools with their own licenses. Exact dependency resolution is in `package-lock.json`; dependencies are installed rather than vendored.

## What is reviewed before upload

- Tracked files, intended untracked additions and the complete local commit history.
- Only original source, documentation, synthetic fixtures and workflow definitions.
- No machine-specific home directories, tokens, private URLs or deployment configuration.
- `.gitignore` excludes dependencies, compiled files, private workspaces, logs and local verification artifacts; ignored files are not uploaded.
- `npm run audit:public` checks publishable filenames, binary files, home paths and common credential patterns. It is a limited guard, not a proof that all possible secrets are absent.

Do not include real workspace exports or screenshots in public issues. Source comments, browser pages and downloaded documents remain untrusted data and never authorize external actions.

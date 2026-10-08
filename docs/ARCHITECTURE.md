# Architecture and M1 decisions

## Runtime and boundaries

M1 uses TypeScript, Node.js's built-in `node:sqlite`, Zod runtime validation, and the local filesystem. Tool versions and dependencies are pinned in `.node-version`, `.npm-version`, `package.json` and `package-lock.json`. There is no native npm database addon and no runtime package installation hook.

`packages/core` owns validation, identity, hashing, merge rules, transactions and navigation. `packages/cli` only parses arguments, passes inputs to core, and serializes results. A future MCP wrapper will call the same operations. No separate web frontend is planned for M1.

The existing scaffold and its evidence-preservation requirements were reviewed before implementation. No existing personal-project source, deployment configuration, databases or history was imported. Validation, hashing, comparisons and recovery were implemented afresh using standard runtime facilities, keeping the first public release reviewable. Dependency provenance is recorded in [PROVENANCE.md](PROVENANCE.md).

## Schema version 1

The workspace has a SQLite application ID and schema version; unknown versions are refused. Configuration, courses, sources, task snapshots and exported records also carry `schemaVersion: 1`. There are no migrations yet.

| Record                  | Identity and semantics                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace configuration | Language (`en` / `zh-CN`), IANA time zone, academic-year label; location is the CLI argument and can change when the whole closed workspace moves |
| Course                  | Explicit ID and title, with `manual` as the only implemented adapter                                                                              |
| Source                  | `(courseId, id)` plus stable kind/format; reference text is provenance, not permission to execute anything                                        |
| Material version        | `(courseId, sourceId, sha256)`; per-source version number, original name, byte count, import instant and source evidence                          |
| Task                    | `(courseId, id)`, stable source identity, title, typed deadline assertions                                                                        |
| Deadline assertion      | ID, kind (`official`, `personal`, `feedback`), precision (`unknown`, `date`, `instant`) and evidence                                              |
| Task revision           | Content hash, full historical task snapshot and first observation time                                                                            |
| Progress                | Explicit entity/ID/stage, first recorded instant and user-supplied evidence; repeated same stage is idempotent                                    |
| Observation attempt     | Partial/failed status, scope, detail and timestamp; previous verified source and timestamp are unchanged                                          |

Input schemas are strict. Unsupported fields and versions, invalid dates, path-like IDs, unknown course/source references, duplicate deadline IDs and kind/format changes fail before metadata commits.

## Merge and date rules

Importing identical bytes retains the version and returns `changed: false` if metadata is also identical. A successful recheck updates verification timestamps; it does not create another version. Returning to an earlier hash reuses that version while changing the current pointer. Distinct sources never merge by filename. The filename extension is an archival distinction, not a validated MIME type.

Task updates merge deadline assertions by ID; omitted assertions survive, including personal plans and conflicting official evidence. Updating an assertion with the same ID replaces that active assertion and retains the previous task revision. This is a manual explicit update, not automatic conflict resolution. M1 does not implement assertion deletion or resolution commands. Empty input means no new date information, not removal of previous evidence. Missing tasks are never deleted. Personal progress lives separately and is never overwritten by imports.

Official date state is `unknown` when no known official date exists or an official assertion is explicitly unknown. It is `conflict` when known official assertions disagree, and otherwise `known`. Equivalent offset timestamps compare as the same instant. Mixed date-only and exact-time assertions are conservatively treated as conflicting; no missing time is invented. Personal and feedback dates do not resolve official conflicts. Source time strings remain in exports; navigation formats exact instants in the workspace time zone and labels date-only values.

## Writes, concurrency and interruption

Initialization builds a complete staging directory and atomically renames it to `.study`. An existing workspace is reused only if the requested configuration matches; unrelated files are not overwritten. Interrupted initialization may leave a `.study-init-*` directory; retry initialization and inspect the residue separately.

SQLite uses full synchronous transactions, foreign keys, a busy timeout and the default rollback journal on a local filesystem. Writers use `BEGIN IMMEDIATE`. Readers export a consistent transaction snapshot.

An imported regular file is read without following its final symlink, bounded at 100 MiB, then hashed. The archive is written exclusively to a temporary file, flushed, published with a non-overwriting hard link and the directory flushed. Existing bytes must match exactly. Only then is the SQLite version committed. A crash before commit can leave an unreferenced archive, which a repeated import verifies and reuses. A crash after commit leaves a complete version. Existing managed directory/file symlinks are refused; this is not a security boundary against a malicious process with access to the same user account.

`doctor` runs SQLite integrity/foreign-key checks, checks current-version pointers, verifies every referenced archive hash and size, and lists unreferenced archives/staging residues. It does not delete files. Missing or corrupt referenced data requires restoring from a user-managed backup or reimporting a missing file from a verified original; a corrupt existing file is never silently replaced.

Navigation is an immutable content-addressed Markdown snapshot. Repeated generation of the same records returns the same path. Actual new verification times can create a new navigation snapshot. Old snapshots are retained. An edited snapshot at the expected path causes a refusal rather than overwrite. Notes should be kept separately. There is no mutable `current.md` pointer in M1.

## Explicit limits

- macOS/Linux local filesystems only. Network filesystems, Windows, hardware power-loss behavior and hostile concurrent filesystem modifications are not verified.
- No automatic backups/restores, encryption, multi-user access control, schema upgrades or storage garbage collection yet. OS account permissions protect local files; users control full-workspace backups while tools are closed.
- No PDF/PPTX parsing, class-session model, ICS adapter, AI notes, browser access, MCP server, schedulers, notifications or production deployment.
- The CLI returns paths and record data to its caller. Real workspace exports and logs remain private and must not be attached to public issues.

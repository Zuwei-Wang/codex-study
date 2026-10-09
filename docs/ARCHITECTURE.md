# Architecture and M1–M3 decisions

## Runtime and boundaries

The core uses TypeScript, Node.js's built-in `node:sqlite`, Zod runtime validation, and the local filesystem. Tool versions and dependencies are pinned in `.node-version`, `.npm-version`, `package.json` and `package-lock.json`. There is no native npm database addon and no runtime package installation hook.

`packages/core` owns validation, identity, hashing, merge rules, transactions and navigation. `packages/cli` only parses arguments, passes inputs to core, and serializes results. `packages/mcp` exposes the same operations using the official MCP TypeScript SDK. Plugin Skills guide model behavior; they are not a substitute for deterministic validation. There is no separate web frontend.

The existing scaffold and its evidence-preservation requirements were reviewed before implementation. No existing personal-project source, deployment configuration, databases or history was imported. Validation, hashing, comparisons and recovery were implemented afresh using standard runtime facilities, keeping the first public release reviewable. Dependency provenance is recorded in [PROVENANCE.md](PROVENANCE.md).

## Database schema 3 and versioned records

The workspace has a SQLite application ID and schema version; unknown versions are refused. Configuration, courses, sources, task snapshots and exported records also carry `schemaVersion: 1`. M3 adds calendar, scan and scheduling tables to M2 notes with an explicit transactional schema-1/2-to-3 migration. Normal opens refuse schema 1/2 until the caller requests `upgrade`/`study_upgrade`; configuration and existing records are not rewritten. Older clients cannot read schema 3. Record/configuration schema versions remain 1; snapshots add optional notes, calendars, sessions, scans, schedules and scheduleRuns collections.

| Record                  | Identity and semantics                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace configuration | Language (`en` / `zh-CN`), IANA time zone, academic-year label; location is the CLI argument and can change when the whole closed workspace moves |
| Course                  | Explicit ID and title, with `manual` or `blackboard-ultra` observation workflows and an optional canonical course-page URL                        |
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

Task updates merge deadline assertions by ID; omitted assertions survive, including personal plans and conflicting official evidence. Updating an assertion with the same ID replaces that active assertion and retains the previous task revision. This is a manual explicit update, not automatic conflict resolution. The product does not implement assertion deletion or resolution commands. Empty input means no new date information, not removal of previous evidence. Missing tasks are never deleted. Personal progress lives separately and is never overwritten by imports.

Official date state is `unknown` when no known official date exists or an official assertion is explicitly unknown. It is `conflict` when known official assertions disagree, and otherwise `known`. Equivalent offset timestamps compare as the same instant. Mixed date-only and exact-time assertions are conservatively treated as conflicting; no missing time is invented. Personal and feedback dates do not resolve official conflicts. Source time strings remain in exports; navigation formats exact instants in the workspace time zone and labels date-only values.

## Writes, concurrency and interruption

Initialization builds a complete staging directory and atomically renames it to `.study`. An existing workspace is reused only if the requested configuration matches; unrelated files are not overwritten. Interrupted initialization may leave a `.study-init-*` directory; retry initialization and inspect the residue separately.

SQLite uses full synchronous transactions, foreign keys, a busy timeout and the default rollback journal on a local filesystem. Writers use `BEGIN IMMEDIATE`. Readers export a consistent transaction snapshot.

An imported regular file is read without following its final symlink, bounded at 100 MiB, then hashed. The archive is written exclusively to a temporary file, flushed, published with a non-overwriting hard link and the directory flushed. Existing bytes must match exactly. Only then is the SQLite version committed. A crash before commit can leave an unreferenced archive, which a repeated import verifies and reuses. A crash after commit leaves a complete version. Existing managed directory/file symlinks are refused; this is not a security boundary against a malicious process with access to the same user account.

`doctor` runs SQLite integrity/foreign-key checks, checks current-version pointers, verifies every referenced archive hash and size, and lists unreferenced archives/staging residues. It does not delete files. Missing or corrupt referenced data requires restoring from a user-managed backup or reimporting a missing file from a verified original; a corrupt existing file is never silently replaced.

Navigation is an immutable content-addressed Markdown snapshot. Repeated generation of the same records returns the same path. Actual new verification times can create a new navigation snapshot. Old snapshots are retained. An edited snapshot at the expected path causes a refusal rather than overwrite. Notes are managed separately under `.study/notes`. There is no mutable `current.md` pointer.

## Reading and note revisions

`readMaterial` requires the exact course/source/hash and verifies archived bytes before parsing. Markdown horizontal separators outside fences/frontmatter and TXT form-feed characters define sections; these are never reported as PDF pages or teaching weeks. PDF.js extracts text by original page number in a worker with a 30-second timeout and a 256 MiB JavaScript heap limit; this is resource bounding, not an operating-system sandbox or a total native-memory limit. Reads accept at most 20 units and return at most 32,000 characters per unit. PDFs above 2,000 pages are refused. Empty/truncated text is partial; unsupported formats return an explicit unsupported result. A complete result means the requested text range was extracted, not that every page, diagram or lecture was covered. No OCR or visual understanding is claimed.

Notes separate material, explanation, practice and user reflections. Every material section needs an exact-version citation with a page/section range and quote. The saver validates ranges and whitespace-normalized quote presence; it does not verify semantic entailment, teaching quality or user-reported live coverage. Source content remains untrusted. Coverage defaults in Skills to published material; user-confirmed session coverage carries the user's explicit report.

Note revisions are hashes of normalized typed note JSON, with immutable rendered Markdown and its file hash. Source updates never retarget old citations. A new save requires null expected revision; an edit requires the current revision. Identical content is idempotent. Files become durable before a transaction updates the note head, old revisions remain accessible, and user-edited generated files cause a refusal. `doctor` also checks all historical note file hashes and lists unreferenced note residues. Reading and saving notes never change progress.

## Timetables, observations and scheduling

ICS bytes are immutable archives. Parsing happens in a bounded worker using ical.js; Temporal resolves explicit IANA wall times. Feed history retains every attempt, last verified snapshot and cancellation tombstones, including cancellation received before the event. Older or same-sequence active revisions cannot resurrect a cancellation. UID plus original recurrence time defines occurrence identity; missing occurrences remain uncertain. No remote subscription is fetched. See [format limits](PLATFORM_CHECKS.md).

A scan captures its declared courses/surfaces and a baseline of authoritative metadata. Observation candidates carry scope, timestamps, reasons, file hashes and task evidence. Apply requires the reviewed revision and unchanged baseline; nested SQLite savepoints make complete file/task application atomic. Partial/failed scopes preserve authoritative records and verification times. Recoverable file residues can outlive a rolled-back transaction.

Schedules require explicit opt-in and a successful manual scan of the same scope. Daily wall time is resolved in the selected IANA zone; persistent local-date claims prevent duplicate runs. The foreground runner invokes configured Codex as a child process and only accepts a matching applied scan. Disabling/reconfiguring a schedule blocks its linked candidate. This does not install an OS service or establish unattended browser availability.

## Plugin lifecycle

The build copies production dependency closure and compiled core/MCP code into an OS/architecture-specific package. The stdio launcher sets its installation root; tools reject learning workspaces inside it, including paths resolving there through existing symlinks. Portable and compatibility manifests share the same eight Skills and MCP launcher. A plugin-relative `cwd` keeps the installation relocatable. User configuration, credentials and learning workspaces are not part of the plugin package. Tests install/update the package through actual Codex CLI in fresh child configuration without copying user credentials.

## Optional reminders (developer preview)

The local preview uses explicit selections and a minimal strict versioned projection. It makes no network request. A separate client performs an explicitly requested sync to a configured HTTPS service. Service code under `services/reminders` is excluded from plugin packaging; its private account registry, hashed bearer credentials, recipient verification and persistent SQLite outbox live in an independently operated directory. The service is single-process, bound to loopback for a TLS reverse proxy, and has a synthetic provider by default. Unknown outcomes are never inferred to be delivered. See [the contract](REMINDERS.md) and [runbook](../services/reminders/README.md). An isolated HTTPS deployment passed synthetic smoke checks and a live trial with one consenting recipient, including provider delivery, personal receipt, opt-out and clean restart persistence. See [deployment evidence and limits](M4_QUALIFICATION.md).

## Explicit limits

- macOS/Linux local filesystems only. Network filesystems, Windows, hardware power-loss behavior and hostile concurrent filesystem modifications are not verified.
- No automatic backups/restores, encryption, multi-user access control, automatic migrations or storage garbage collection yet. OS account permissions protect local files; users control full-workspace backups while tools are closed.
- No PPTX/DOCX reading, OCR, diagram/layout interpretation, built-in browser driver or qualified production deployment. The optional reminder service has local and deployed synthetic tests plus one-recipient live qualification; wider operating conditions remain unqualified. Calendar-to-course mapping is explicit; material-to-session mapping is not inferred.
- The CLI returns paths and record data to its caller. Real workspace exports and logs remain private and must not be attached to public issues.

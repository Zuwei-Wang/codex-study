import {
  scheduleSchema,
  dueDate,
  equalScope,
  type Schedule,
  type ScheduleRun,
} from "./scheduling.js";
import { randomUUID } from "node:crypto";
import {
  calendarImportSchema,
  extractCalendar,
  type CalendarFeed,
  type CalendarSession,
} from "./calendar.js";
import {
  scanScopeSchema,
  scanRecordSchema,
  type ScanCandidate,
  type ScanScope,
} from "./observations.js";
import { DatabaseSync } from "node:sqlite";
import { basename, extname, join, resolve } from "node:path";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
} from "node:fs";
import { z } from "zod";
import {
  attemptSchema,
  configSchema,
  courseSchema,
  idSchema,
  instantSchema,
  progressSchema,
  sourceSchema,
  taskSchema,
  type Config,
  type Course,
  type Source,
  type Task,
} from "./schema.js";
import {
  directory,
  readRegular,
  sha256,
  syncDirectory,
  writeImmutable,
} from "./storage.js";
import { renderNavigation } from "./navigation.js";
import {
  materialReadSchema,
  noteSaveSchema,
  renderNote,
  type NoteRecord,
  type Reading,
} from "./learning.js";
import { extractMaterial } from "./reader.js";

const APP_ID = 1129534549;
const schema = `
  PRAGMA application_id = ${APP_ID};
  PRAGMA user_version = 1;
  CREATE TABLE config (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
  CREATE TABLE courses (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE sources (
    course_id TEXT NOT NULL REFERENCES courses(id), id TEXT NOT NULL, data TEXT NOT NULL,
    format TEXT NOT NULL, current_hash TEXT NOT NULL,
    last_verified TEXT NOT NULL, last_attempted TEXT NOT NULL,
    status TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY(course_id,id)
  );
  CREATE TABLE versions (
    course_id TEXT NOT NULL, source_id TEXT NOT NULL, version INTEGER NOT NULL,
    hash TEXT NOT NULL, format TEXT NOT NULL, filename TEXT NOT NULL, bytes INTEGER NOT NULL,
    imported_at TEXT NOT NULL, evidence TEXT NOT NULL,
    PRIMARY KEY(course_id,source_id,hash), UNIQUE(course_id,source_id,version),
    FOREIGN KEY(course_id,source_id) REFERENCES sources(course_id,id)
  );
  CREATE TABLE tasks (
    course_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY(course_id,id), FOREIGN KEY(course_id) REFERENCES courses(id)
  );
  CREATE TABLE task_revisions (
    course_id TEXT NOT NULL, task_id TEXT NOT NULL, hash TEXT NOT NULL,
    data TEXT NOT NULL, observed_at TEXT NOT NULL,
    PRIMARY KEY(course_id,task_id,hash),
    FOREIGN KEY(course_id,task_id) REFERENCES tasks(course_id,id)
  );
  CREATE TABLE progress (
    entity TEXT NOT NULL, course_id TEXT NOT NULL REFERENCES courses(id), id TEXT NOT NULL,
    stage TEXT NOT NULL, at TEXT NOT NULL, evidence TEXT NOT NULL,
    PRIMARY KEY(entity,course_id,id,stage)
  );
  CREATE TABLE attempts (
    sequence INTEGER PRIMARY KEY, course_id TEXT NOT NULL, source_id TEXT NOT NULL,
    at TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL,
    FOREIGN KEY(course_id,source_id) REFERENCES sources(course_id,id)
  );
`;
type Row = Record<string, string | number | bigint | null | Uint8Array>;
const learningSchema = `
  CREATE TABLE note_revisions (
    course_id TEXT NOT NULL REFERENCES courses(id), id TEXT NOT NULL,
    revision TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(course_id,id,revision)
  );
  CREATE TABLE note_heads (
    course_id TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY(course_id,id), FOREIGN KEY(course_id,id,revision) REFERENCES note_revisions(course_id,id,revision)
  );
  PRAGMA user_version = 2;
`;
const workflowSchema = `
  CREATE TABLE calendar_feeds (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE calendar_sessions (feed_id TEXT NOT NULL REFERENCES calendar_feeds(id), id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(feed_id,id));
  CREATE TABLE calendar_imports (sequence INTEGER PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES calendar_feeds(id), data TEXT NOT NULL);
  CREATE TABLE scan_runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE schedules (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE schedule_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id), local_date TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(schedule_id,local_date));
  PRAGMA user_version = 3;
`;
export type Checkpoint = "object-durable" | "before-commit" | "after-commit";
export interface WorkspaceOptions {
  migrate?: boolean;
  now?: () => string;
  /** Fault injection for tests; never exposed through CLI input. */
  checkpoint?: (point: Checkpoint) => void;
}
export interface MaterialVersion {
  version: number;
  hash: string;
  format: string;
  filename: string;
  bytes: number;
  importedAt: string;
  evidence: Source;
}
export interface Material {
  source: Source;
  currentHash: string;
  lastVerifiedAt: string;
  lastAttemptedAt: string;
  status: string;
  detail: string;
  versions: MaterialVersion[];
}
export interface ProgressRecord {
  schemaVersion: 1;
  entity: "source" | "task";
  courseId: string;
  id: string;
  stage: z.infer<typeof progressSchema>;
  at: string;
  evidence: string;
}
export interface Snapshot {
  schemaVersion: 1;
  config: Config;
  courses: Course[];
  materials: Material[];
  tasks: Task[];
  progress: ProgressRecord[];
  notes?: NoteRecord[];
  calendars?: CalendarFeed[];
  sessions?: CalendarSession[];
  scans?: ScanCandidate[];
  schedules?: Schedule[];
  scheduleRuns?: ScheduleRun[];
  taskHistory: { task: Task; observedAt: string; hash: string }[];
  attempts: {
    courseId: string;
    sourceId: string;
    at: string;
    status: string;
    detail: string;
  }[];
}

export class Workspace {
  readonly root: string;
  readonly storage: string;
  private db: DatabaseSync;
  private options: WorkspaceOptions;
  private transactionDepth = 0;

  static initialize(path: string, input: unknown): Workspace {
    const config = configSchema.parse(input);
    const root = resolve(path);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    directory(root);
    const storage = join(root, ".study");
    if (existsSync(storage)) {
      const workspace = new Workspace(root);
      if (
        JSON.stringify(workspace.snapshot().config) !== JSON.stringify(config)
      ) {
        workspace.close();
        throw new Error(
          "Workspace already initialized with different configuration",
        );
      }
      return workspace;
    }
    // Only the final rename makes a fully initialized workspace visible.
    const staging = mkdtempSync(join(root, ".study-init-"));
    directory(join(staging, "objects"));
    directory(join(staging, "navigation"));
    const db = new DatabaseSync(join(staging, "records.sqlite"));
    try {
      db.exec("PRAGMA synchronous=FULL; BEGIN IMMEDIATE;");
      db.exec(schema + learningSchema + workflowSchema);
      db.prepare("INSERT INTO config VALUES(1,?)").run(JSON.stringify(config));
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    syncDirectory(staging);
    // A concurrent initializer leaves a nonempty target; rename refuses to replace it.
    renameSync(staging, storage);
    syncDirectory(root);
    return new Workspace(root);
  }

  constructor(path: string, options: WorkspaceOptions = {}) {
    this.root = realpathSync(path);
    this.storage = join(this.root, ".study");
    for (const dir of [
      this.storage,
      join(this.storage, "objects"),
      join(this.storage, "navigation"),
    ]) {
      if (!existsSync(dir)) throw new Error("Not an initialized workspace");
      directory(dir);
    }
    const dbPath = join(this.storage, "records.sqlite");
    if (!lstatSync(dbPath).isFile() || lstatSync(dbPath).isSymbolicLink())
      throw new Error("Invalid database file");
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      const sidecar = dbPath + suffix;
      if (existsSync(sidecar) && lstatSync(sidecar).isSymbolicLink())
        throw new Error("Unsafe SQLite sidecar");
    }
    this.db = new DatabaseSync(dbPath);
    this.options = options;
    try {
      this.db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;",
      );
      const app = this.db.prepare("PRAGMA application_id").get() as Row;
      const version = this.db.prepare("PRAGMA user_version").get() as Row;
      if (
        app.application_id !== APP_ID ||
        ![1, 2, 3].includes(Number(version.user_version))
      )
        throw new Error("Unsupported workspace database or schema version");
      if (Number(version.user_version) < 3) {
        if (!options.migrate)
          throw new Error(
            `Workspace schema ${version.user_version} requires an explicit upgrade before M3 use`,
          );
        this.transaction(() => {
          if (version.user_version === 1) this.db.exec(learningSchema);
          this.db.exec(workflowSchema);
        });
      }
      configSchema.parse(
        JSON.parse(
          String(
            this.db.prepare("SELECT data FROM config WHERE id=1").get()?.data,
          ),
        ),
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  async readMaterial(input: unknown): Promise<Reading> {
    const request = materialReadSchema.parse(input);
    const version = this.db
      .prepare(
        "SELECT * FROM versions WHERE course_id=? AND source_id=? AND hash=?",
      )
      .get(request.courseId, request.sourceId, request.hash);
    if (!version)
      throw new Error(
        "Unknown material version; inspect the workspace snapshot for its exact hash",
      );
    const bytes = readRegular(
      join(this.storage, "objects", `${request.hash}.${version.format}`),
    );
    if (sha256(bytes) !== request.hash)
      throw new Error("Archive hash mismatch; reading refused");
    const extracted = await extractMaterial(
      bytes,
      String(version.format),
      request.start,
      request.count,
    );
    if (!extracted)
      return {
        schemaVersion: 1,
        courseId: request.courseId,
        sourceId: request.sourceId,
        hash: request.hash,
        unit: "section",
        total: 0,
        parts: [],
        status: "unsupported",
        untrusted: true,
        warnings: [
          `${version.format} is archived but has no M2 reader. Supply an explicit PDF/text export as a distinct source; do not infer its contents.`,
        ],
      };
    const partial = extracted.parts.some(
      (part) => part.truncated || !part.text.trim(),
    );
    return {
      schemaVersion: 1,
      courseId: request.courseId,
      sourceId: request.sourceId,
      hash: request.hash,
      ...extracted,
      status: partial ? "partial" : "complete",
      untrusted: true,
      warnings: [
        ...extracted.warnings,
        ...(partial
          ? [
              "One or more requested units have no extractable text or were truncated. Unseen content remains unknown.",
            ]
          : []),
      ],
    };
  }

  async saveNote(
    input: unknown,
  ): Promise<{ changed: boolean; record: NoteRecord; path: string }> {
    const { note, expectedRevision } = noteSaveSchema.parse(input);
    this.requireCourse(note.courseId);
    const formats = new Map<string, string>();
    // Validate each quoted location against immutable bytes, not model-supplied page counts.
    for (const section of note.sections)
      for (const citation of section.citations) {
        const reading = await this.readMaterial({
          courseId: note.courseId,
          sourceId: citation.sourceId,
          hash: citation.hash,
          start: citation.start,
          count: citation.end - citation.start + 1,
        });
        if (
          reading.status === "unsupported" ||
          reading.unit !== citation.unit ||
          reading.parts.at(-1)?.number !== citation.end
        )
          throw new Error(
            "Citation location is not supported or outside the material",
          );
        const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
        if (
          !normalize(reading.parts.map((p) => p.text).join("\n")).includes(
            normalize(citation.quote),
          )
        )
          throw new Error(
            "Citation quote was not found in the requested material units",
          );
        const row = this.db
          .prepare(
            "SELECT format FROM versions WHERE course_id=? AND source_id=? AND hash=?",
          )
          .get(note.courseId, citation.sourceId, citation.hash)!;
        formats.set(
          `${citation.sourceId}:${citation.hash}`,
          String(row.format),
        );
      }
    const revision = sha256(JSON.stringify(note));
    const relativePath = `notes/${revision}.md`;
    const bytes = Buffer.from(renderNote(note, formats));
    return this.transaction(() => {
      const head = this.db
        .prepare("SELECT revision FROM note_heads WHERE course_id=? AND id=?")
        .get(note.courseId, note.id);
      if (
        head?.revision !== revision &&
        (head?.revision ?? null) !== expectedRevision
      )
        throw new Error(
          "Note revision conflict; read the current note before editing",
        );
      directory(join(this.storage, "notes"));
      syncDirectory(this.storage);
      writeImmutable(join(this.storage, relativePath), bytes);
      const existing = this.db
        .prepare(
          "SELECT data FROM note_revisions WHERE course_id=? AND id=? AND revision=?",
        )
        .get(note.courseId, note.id, revision);
      const record: NoteRecord = existing
        ? JSON.parse(String(existing.data))
        : {
            schemaVersion: 1,
            note,
            revision,
            relativePath,
            createdAt: this.now(),
            fileHash: sha256(bytes),
          };
      this.db
        .prepare("INSERT OR IGNORE INTO note_revisions VALUES(?,?,?,?)")
        .run(note.courseId, note.id, revision, JSON.stringify(record));
      this.db
        .prepare(
          "INSERT INTO note_heads VALUES(?,?,?) ON CONFLICT(course_id,id) DO UPDATE SET revision=excluded.revision",
        )
        .run(note.courseId, note.id, revision);
      return {
        changed: head?.revision !== revision,
        record,
        path: join(this.storage, relativePath),
      };
    });
  }

  noteHistory(courseId: string, id: string): NoteRecord[] {
    idSchema.parse(courseId);
    idSchema.parse(id);
    return this.db
      .prepare(
        "SELECT data FROM note_revisions WHERE course_id=? AND id=? ORDER BY rowid",
      )
      .all(courseId, id)
      .map((r) => JSON.parse(String(r.data)) as NoteRecord);
  }
  private workflowRows<T>(
    table:
      | "calendar_feeds"
      | "calendar_sessions"
      | "calendar_imports"
      | "scan_runs"
      | "schedules"
      | "schedule_runs",
    clause = "",
    args: string[] = [],
  ): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ${clause}`)
      .all(...args)
      .map((r) => JSON.parse(String(r.data)) as T);
  }

  async importCalendar(input: unknown): Promise<{
    feed: CalendarFeed;
    changed: boolean;
    sessions: CalendarSession[];
  }> {
    const request = calendarImportSchema.parse(input);
    for (const mapping of request.mappings)
      this.requireCourse(mapping.courseId);
    const previous = this.workflowRows<CalendarFeed>(
      "calendar_feeds",
      "WHERE id=?",
      [request.feedId],
    )[0];
    const priorSessions = this.workflowRows<CalendarSession>(
      "calendar_sessions",
      "WHERE feed_id=? ORDER BY id",
      [request.feedId],
    );
    const baseline = JSON.stringify([previous, priorSessions]);
    const now = this.now();
    let sourceHash: string | null = null;
    let extracted: Awaited<ReturnType<typeof extractCalendar>> | undefined;
    let error: string | undefined;
    try {
      const bytes = readRegular(request.file, 5 * 1024 * 1024);
      sourceHash = sha256(bytes);
      directory(join(this.storage, "calendars"));
      syncDirectory(this.storage);
      writeImmutable(
        join(this.storage, "calendars", `${sourceHash}.ics`),
        bytes,
      );
      extracted = await extractCalendar(bytes, request);
    } catch (failure) {
      error =
        failure instanceof Error ? failure.message : "Calendar import failed";
    }
    return this.transaction(() => {
      const current = this.workflowRows<CalendarFeed>(
        "calendar_feeds",
        "WHERE id=?",
        [request.feedId],
      )[0];
      const currentSessions = this.workflowRows<CalendarSession>(
        "calendar_sessions",
        "WHERE feed_id=? ORDER BY id",
        [request.feedId],
      );
      if (JSON.stringify([current, currentSessions]) !== baseline)
        throw new Error(
          "Calendar changed during import; retry with a fresh snapshot",
        );
      const feed: CalendarFeed = {
        id: request.feedId,
        title: request.title,
        status: error ? "failed" : "complete",
        lastAttemptedAt: now,
        lastVerifiedAt: previous?.lastVerifiedAt ?? null,
        lastVerifiedHash: previous?.lastVerifiedHash ?? null,
        sourceHash: previous?.sourceHash ?? null,
        window: request.window,
        issues: error ? [error] : [],
        cancellations: [...(previous?.cancellations ?? [])],
      };
      const sessions = new Map(priorSessions.map((s) => [s.id, s]));
      let changed = false;
      if (extracted) {
        const seen = new Set<string>();
        for (const cancellation of extracted.cancellations) {
          const index = feed.cancellations.findIndex(
            (c) =>
              c.uid === cancellation.uid &&
              c.recurrenceId === cancellation.recurrenceId,
          );
          const prior = feed.cancellations[index];
          if (prior && prior.sequence > cancellation.sequence) {
            feed.issues.push(
              `Stale cancellation retained for ${cancellation.uid}`,
            );
            continue;
          }
          if (!prior || prior.sequence < cancellation.sequence) {
            changed = true;
            if (index < 0) feed.cancellations.push(cancellation);
            else feed.cancellations[index] = cancellation;
          }
        }
        const signature = (s: CalendarSession) => {
          const { lastObservedAt: _time, sourceHash: _hash, ...record } = s;
          return JSON.stringify(record);
        };
        for (const item of extracted.occurrences) {
          seen.add(item.id);
          const prior = sessions.get(item.id);
          const cancelled = feed.cancellations.some(
            (c) =>
              c.uid === item.uid &&
              (c.recurrenceId === null ||
                c.recurrenceId === item.recurrenceId) &&
              c.sequence >= item.sequence,
          );
          if (cancelled && item.status !== "cancelled") {
            if (
              !extracted.cancellations.some(
                (c) =>
                  c.uid === item.uid &&
                  (c.recurrenceId === null ||
                    c.recurrenceId === item.recurrenceId) &&
                  c.sequence >= item.sequence,
              )
            )
              feed.issues.push(`Cancelled revision suppressed for ${item.uid}`);
            continue;
          }
          if (prior && prior.sequence > item.sequence) {
            feed.issues.push(`Stale sequence retained for ${item.uid}`);
            continue;
          }
          const session: CalendarSession = {
            ...item,
            feedId: request.feedId,
            courseId:
              request.mappings.find((m) => m.uid === item.uid)?.courseId ??
              prior?.courseId ??
              null,
            sourceHash: sourceHash!,
            lastObservedAt: now,
          };
          if (!prior || signature(prior) !== signature(session)) changed = true;
          sessions.set(session.id, session);
        }
        for (const cancellation of extracted.cancellations)
          for (const session of sessions.values()) {
            if (
              session.uid !== cancellation.uid ||
              (cancellation.recurrenceId !== null &&
                session.recurrenceId !== cancellation.recurrenceId)
            )
              continue;
            seen.add(session.id);
            if (session.sequence > cancellation.sequence) {
              feed.issues.push(
                `Stale cancellation retained for ${session.uid}`,
              );
              continue;
            }
            changed ||= session.status !== "cancelled";
            sessions.set(session.id, {
              ...session,
              sequence: cancellation.sequence,
              status: "cancelled",
              sourceHash: sourceHash!,
              lastObservedAt: now,
            });
          }
        for (const session of sessions.values()) {
          const inWindow =
            session.start.precision === "instant"
              ? Date.parse(session.start.at) >=
                  Date.parse(request.window.start) &&
                Date.parse(session.start.at) < Date.parse(request.window.end)
              : session.start.precision === "date" &&
                session.start.date >= request.window.start.slice(0, 10) &&
                session.start.date < request.window.end.slice(0, 10);
          if (
            !inWindow ||
            seen.has(session.id) ||
            session.status === "cancelled"
          )
            continue;
          feed.issues.push(
            `Missing from feed; verify before cancelling: ${session.uid}`,
          );
          changed ||= session.status !== "missing";
          sessions.set(session.id, { ...session, status: "missing" });
        }
        feed.sourceHash = sourceHash;
        if (feed.issues.length) feed.status = "partial";
        else {
          feed.lastVerifiedAt = now;
          feed.lastVerifiedHash = sourceHash;
        }
      }
      this.db
        .prepare(
          "INSERT INTO calendar_feeds VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(request.feedId, JSON.stringify(feed));
      this.db
        .prepare("INSERT INTO calendar_imports(feed_id,data) VALUES(?,?)")
        .run(
          request.feedId,
          JSON.stringify({
            at: now,
            status: feed.status,
            sourceHash,
            window: request.window,
            feed,
            sessions: [...sessions.values()],
          }),
        );
      for (const session of sessions.values())
        this.db
          .prepare(
            "INSERT INTO calendar_sessions VALUES(?,?,?) ON CONFLICT(feed_id,id) DO UPDATE SET data=excluded.data",
          )
          .run(request.feedId, session.id, JSON.stringify(session));
      return {
        feed,
        changed,
        sessions: [...sessions.values()].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      };
    });
  }

  private scanBaseline(scope: ScanScope): string {
    const records = scope.courseIds
      .slice()
      .sort()
      .map((id) => ({
        id,
        course: this.db.prepare("SELECT * FROM courses WHERE id=?").get(id),
        sources: this.db
          .prepare("SELECT * FROM sources WHERE course_id=? ORDER BY id")
          .all(id),
        tasks: this.db
          .prepare("SELECT * FROM tasks WHERE course_id=? ORDER BY id")
          .all(id),
      }));
    return sha256(JSON.stringify(records));
  }
  prepareScan(input: unknown, runId?: string): ScanCandidate {
    const scope = scanScopeSchema.parse(input);
    for (const id of scope.courseIds) this.requireCourse(id);
    return this.transaction(() => {
      if (runId) {
        idSchema.parse(runId);
        const run = this.workflowRows<ScheduleRun>(
          "schedule_runs",
          "WHERE id=?",
          [runId],
        )[0];
        if (!run || run.state !== "running" || !equalScope(scope, run.scope))
          throw new Error("Scan does not match an active scheduled run");
      }
      const id = randomUUID();
      const value = {
        id,
        scope,
        ...(runId ? { runId } : {}),
        createdAt: this.now(),
        baseline: this.scanBaseline(scope),
        state: "prepared" as const,
        observations: [],
        files: [],
        tasks: [],
      };
      const record: ScanCandidate = {
        ...value,
        revision: sha256(JSON.stringify(value)),
      };
      this.db
        .prepare("INSERT INTO scan_runs VALUES(?,?)")
        .run(id, JSON.stringify(record));
      return record;
    });
  }
  getScan(id: string): ScanCandidate {
    idSchema.parse(id);
    const value = this.workflowRows<ScanCandidate>("scan_runs", "WHERE id=?", [
      id,
    ])[0];
    if (!value) throw new Error("Unknown scan");
    return value;
  }
  recordScan(input: unknown): ScanCandidate {
    const request = scanRecordSchema.parse(input);
    return this.transaction(() => {
      const record = this.getScan(request.id);
      if (
        record.state === "applied" ||
        record.revision !== request.expectedRevision
      )
        throw new Error("Scan revision conflict");
      const unique = new Set<string>();
      for (const observation of request.observations) {
        const key = `${observation.courseId}:${observation.surface}`;
        if (
          !record.scope.courseIds.includes(observation.courseId) ||
          !record.scope.surfaces.includes(observation.surface)
        )
          throw new Error("Observation is outside the agreed scan scope");
        if (unique.has(key)) throw new Error("Duplicate scan observation");
        unique.add(key);
        if (
          Date.parse(observation.observedAt) < Date.parse(record.createdAt) ||
          Date.parse(observation.observedAt) > Date.parse(this.now()) + 60000
        )
          throw new Error("Observation time is outside this scan");
      }
      const fileIds = new Set<string>();
      const taskIds = new Set<string>();
      for (const file of request.files) {
        if (
          !record.scope.courseIds.includes(file.source.courseId) ||
          !record.scope.surfaces.includes(file.surface)
        )
          throw new Error("File is outside scan scope");
        const key = `${file.source.courseId}:${file.source.id}`;
        if (fileIds.has(key)) throw new Error("Duplicate source candidate");
        fileIds.add(key);
        if (sha256(readRegular(file.file)) !== file.expectedHash)
          throw new Error("Candidate download hash differs");
      }
      for (const { task, surface } of request.tasks) {
        if (
          !record.scope.courseIds.includes(task.courseId) ||
          !record.scope.surfaces.includes(surface)
        )
          throw new Error("Task is outside scan scope");
        const key = `${task.courseId}:${task.id}`;
        if (taskIds.has(key)) throw new Error("Duplicate task candidate");
        taskIds.add(key);
      }
      const value = {
        ...record,
        state: "candidate" as const,
        observations: request.observations,
        files: request.files,
        tasks: request.tasks,
      };
      const { revision: _old, ...content } = value;
      value.revision = sha256(JSON.stringify(content));
      this.db
        .prepare("UPDATE scan_runs SET data=? WHERE id=?")
        .run(JSON.stringify(value), value.id);
      return value;
    });
  }
  applyScan(input: unknown): ScanCandidate {
    const request = z
      .strictObject({
        id: idSchema,
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(input);
    return this.transaction(() => {
      const record = this.getScan(request.id);
      if (record.revision !== request.expectedRevision)
        throw new Error("Scan revision conflict");
      if (record.state === "applied") return record;
      if (record.runId) {
        const run = this.workflowRows<ScheduleRun>(
          "schedule_runs",
          "WHERE id=?",
          [record.runId],
        )[0]!;
        const schedule = this.workflowRows<Schedule>(
          "schedules",
          "WHERE id=?",
          [run.scheduleId],
        )[0]!;
        if (
          run.state !== "running" ||
          !schedule.enabled ||
          run.scheduleRevision !== schedule.revision
        )
          throw new Error("Scheduled scan was cancelled or reconfigured");
      }
      if (record.state !== "candidate")
        throw new Error("Record observations before applying a scan");
      if (this.scanBaseline(record.scope) !== record.baseline)
        throw new Error(
          "Workspace changed since scan preparation; prepare a new scan",
        );
      const complete = record.scope.courseIds.every((id) =>
        record.scope.surfaces.every((surface) =>
          record.observations.some(
            (o) =>
              o.courseId === id &&
              o.surface === surface &&
              o.status === "complete",
          ),
        ),
      );
      const failed =
        record.observations.length > 0 &&
        record.observations.every((o) => o.status === "failed");
      const result: NonNullable<ScanCandidate["result"]> = {
        status: complete ? "complete" : failed ? "failed" : "partial",
        changed: false,
        filesChanged: 0,
        tasksChanged: 0,
        appliedAt: this.now(),
      };
      if (complete) {
        for (const file of record.files) {
          if (sha256(readRegular(file.file)) !== file.expectedHash)
            throw new Error("Candidate file changed before apply; re-observe");
          const imported = this.importMaterial({
            source: file.source,
            file: file.file,
          });
          if (imported.hash !== file.expectedHash)
            throw new Error("Candidate file changed while applying");
          if (imported.changed) result.filesChanged++;
        }
        for (const { task } of record.tasks) {
          const before = this.db
            .prepare("SELECT data FROM tasks WHERE course_id=? AND id=?")
            .get(task.courseId, task.id)?.data;
          this.putTask(task);
          if (
            before !==
            this.db
              .prepare("SELECT data FROM tasks WHERE course_id=? AND id=?")
              .get(task.courseId, task.id)?.data
          )
            result.tasksChanged++;
        }
        result.changed = result.filesChanged > 0 || result.tasksChanged > 0;
      }
      // Partial/failed observations remain attached to the scan; authoritative records and verification times stay intact.
      const applied: ScanCandidate = { ...record, state: "applied", result };
      this.db
        .prepare("UPDATE scan_runs SET data=? WHERE id=?")
        .run(JSON.stringify(applied), record.id);
      return applied;
    });
  }

  configureSchedule(input: unknown): Schedule {
    const request = z
      .strictObject({
        schedule: scheduleSchema,
        expectedRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
      })
      .parse(input);
    return this.transaction(() => {
      const previous = this.workflowRows<Schedule>("schedules", "WHERE id=?", [
        request.schedule.id,
      ])[0];
      if ((previous?.revision ?? null) !== request.expectedRevision)
        throw new Error("Schedule revision conflict");
      const scan = this.getScan(request.schedule.manualScanId);
      if (
        scan.runId ||
        scan.state !== "applied" ||
        scan.result?.status !== "complete" ||
        !equalScope(scan.scope, request.schedule.scope)
      )
        throw new Error(
          "Scheduling requires a successful manual scan of the exact scope",
        );
      if (
        this.workflowRows<ScheduleRun>("schedule_runs").some(
          (r) => r.scanId === scan.id,
        )
      )
        throw new Error(
          "Use a manually completed scan before enabling a schedule",
        );
      const revision = sha256(JSON.stringify(request.schedule));
      const value: Schedule = {
        ...request.schedule,
        revision,
        updatedAt:
          previous?.revision === revision ? previous.updatedAt : this.now(),
      };
      this.db
        .prepare(
          "INSERT INTO schedules VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(value.id, JSON.stringify(value));
      return value;
    });
  }
  claimSchedule(id: string): ScheduleRun | null {
    idSchema.parse(id);
    return this.transaction(() => {
      const schedule = this.workflowRows<Schedule>("schedules", "WHERE id=?", [
        id,
      ])[0];
      if (!schedule) throw new Error("Unknown schedule");
      if (!schedule.enabled || !schedule.optIn) return null;
      const now = this.now();
      const localDate = dueDate(schedule, now);
      if (!localDate) return null;
      const runs = this.workflowRows<ScheduleRun>(
        "schedule_runs",
        "WHERE schedule_id=?",
        [id],
      );
      // An interrupted execution is not implicitly retried; its effect may be unknown.
      if (runs.some((r) => r.localDate === localDate || r.state === "running"))
        return null;
      const run: ScheduleRun = {
        id: randomUUID(),
        scheduleId: id,
        scheduleRevision: schedule.revision,
        localDate,
        scope: schedule.scope,
        startedAt: now,
        state: "running",
      };
      this.db
        .prepare("INSERT INTO schedule_runs VALUES(?,?,?,?)")
        .run(run.id, id, localDate, JSON.stringify(run));
      return run;
    });
  }
  finishSchedule(input: unknown): ScheduleRun {
    const request = z
      .strictObject({
        id: idSchema,
        scanId: idSchema.optional(),
        failure: z.string().trim().min(1).max(2000).optional(),
      })
      .refine(
        (v) => Boolean(v.scanId) !== Boolean(v.failure),
        "Supply either an actual scan ID or a failure reason",
      )
      .parse(input);
    return this.transaction(() => {
      const run = this.workflowRows<ScheduleRun>(
        "schedule_runs",
        "WHERE id=?",
        [request.id],
      )[0];
      if (!run) throw new Error("Unknown scheduled run");
      if (run.state !== "running") return run;
      const schedule = this.workflowRows<Schedule>("schedules", "WHERE id=?", [
        run.scheduleId,
      ])[0]!;
      let state: ScheduleRun["state"];
      if (request.scanId) {
        const scan = this.getScan(request.scanId);
        if (
          scan.runId !== run.id ||
          scan.state !== "applied" ||
          !scan.result ||
          !equalScope(scan.scope, run.scope) ||
          Date.parse(scan.createdAt) < Date.parse(run.startedAt)
        )
          throw new Error(
            "Scheduled result requires an applied scan from this run and exact scope",
          );
        if (
          this.workflowRows<ScheduleRun>("schedule_runs").some(
            (r) => r.scanId === scan.id,
          )
        )
          throw new Error("Scan already belongs to another scheduled run");
        state = scan.result.status;
      } else state = "failed";
      if (!schedule.enabled || schedule.revision !== run.scheduleRevision)
        state = "cancelled";
      const result: ScheduleRun = {
        ...run,
        state,
        finishedAt: this.now(),
        ...(request.scanId
          ? { scanId: request.scanId }
          : { detail: request.failure! }),
      };
      this.db
        .prepare("UPDATE schedule_runs SET data=? WHERE id=?")
        .run(JSON.stringify(result), run.id);
      return result;
    });
  }

  private now(): string {
    return instantSchema.parse(
      this.options.now?.() ?? new Date().toISOString(),
    );
  }
  private transaction<T>(fn: () => T): T {
    const depth = this.transactionDepth;
    const savepoint = `study_${depth}`;
    this.db.exec(depth ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.transactionDepth++;
    try {
      const result = fn();
      this.db.exec(depth ? `RELEASE ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      this.db.exec(
        depth ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK",
      );
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  private requireCourse(id: string): void {
    idSchema.parse(id);
    if (!this.db.prepare("SELECT 1 FROM courses WHERE id=?").get(id))
      throw new Error(`Unknown course: ${id}`);
  }
  private requireSource(course: string, id: string): Row {
    idSchema.parse(course);
    idSchema.parse(id);
    const row = this.db
      .prepare("SELECT * FROM sources WHERE course_id=? AND id=?")
      .get(course, id);
    if (!row) throw new Error(`Unknown source: ${id}`);
    return row;
  }
  putCourse(input: unknown): { changed: boolean } {
    const course = courseSchema.parse(input);
    return this.transaction(() => {
      const data = JSON.stringify(course);
      const old = this.db
        .prepare("SELECT data FROM courses WHERE id=?")
        .get(course.id);
      if (old?.data === data) return { changed: false };
      this.db
        .prepare(
          "INSERT INTO courses VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(course.id, data);
      return { changed: true };
    });
  }

  importMaterial(input: { source: unknown; file: string }): {
    changed: boolean;
    version: number;
    hash: string;
  } {
    const source = sourceSchema.parse(input.source);
    const format = extname(input.file).slice(1).toLowerCase();
    if (!["pdf", "pptx", "md", "txt", "docx"].includes(format))
      throw new Error(
        "Supported files: pdf, pptx, md, txt, docx (opaque archival; no parsing)",
      );
    const bytes = readRegular(input.file);
    const hash = sha256(bytes);
    const at = this.now();
    const result = this.transaction(() => {
      this.requireCourse(source.courseId);
      const old = this.db
        .prepare("SELECT * FROM sources WHERE course_id=? AND id=?")
        .get(source.courseId, source.id);
      if (
        old &&
        (old.format !== format ||
          sourceSchema.parse(JSON.parse(String(old.data))).kind !== source.kind)
      )
        throw new Error(
          "Source format/kind changed: use a distinct source identity",
        );
      const object = join(this.storage, "objects", `${hash}.${format}`);
      writeImmutable(object, bytes);
      this.options.checkpoint?.("object-durable");
      const data = JSON.stringify(source);
      const versionRow = this.db
        .prepare(
          "SELECT version FROM versions WHERE course_id=? AND source_id=? AND hash=?",
        )
        .get(source.courseId, source.id, hash);
      const changed = old?.current_hash !== hash || old?.data !== data;
      this.db
        .prepare(
          `INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(course_id,id) DO UPDATE SET data=excluded.data, current_hash=excluded.current_hash,
        last_verified=excluded.last_verified,last_attempted=excluded.last_attempted,status=excluded.status,detail=excluded.detail`,
        )
        .run(
          source.courseId,
          source.id,
          data,
          format,
          hash,
          at,
          at,
          "verified",
          "Manual file import; no platform coverage claimed",
        );
      let version = Number(versionRow?.version);
      if (!versionRow) {
        version = Number(
          this.db
            .prepare(
              "SELECT COALESCE(MAX(version),0)+1 AS next FROM versions WHERE course_id=? AND source_id=?",
            )
            .get(source.courseId, source.id)?.next,
        );
        this.db
          .prepare("INSERT INTO versions VALUES(?,?,?,?,?,?,?,?,?)")
          .run(
            source.courseId,
            source.id,
            version,
            hash,
            format,
            basename(input.file),
            bytes.length,
            at,
            data,
          );
      }
      this.options.checkpoint?.("before-commit");
      return { changed, version, hash };
    });
    this.options.checkpoint?.("after-commit");
    return result;
  }

  recordAttempt(courseId: string, sourceId: string, input: unknown): void {
    const attempt = attemptSchema.parse(input);
    const at = this.now();
    this.transaction(() => {
      this.requireSource(courseId, sourceId);
      this.db
        .prepare(
          "UPDATE sources SET last_attempted=?,status=?,detail=? WHERE course_id=? AND id=?",
        )
        .run(at, attempt.status, attempt.detail, courseId, sourceId);
      this.db
        .prepare(
          "INSERT INTO attempts(course_id,source_id,at,status,detail) VALUES(?,?,?,?,?)",
        )
        .run(courseId, sourceId, at, attempt.status, attempt.detail);
    });
  }

  putTask(input: unknown): { changed: boolean } {
    const incoming = taskSchema.parse(input);
    return this.transaction(() => {
      this.requireSource(incoming.courseId, incoming.sourceId);
      const old = this.db
        .prepare("SELECT data FROM tasks WHERE course_id=? AND id=?")
        .get(incoming.courseId, incoming.id);
      const previous = old
        ? taskSchema.parse(JSON.parse(String(old.data)))
        : undefined;
      if (previous && previous.sourceId !== incoming.sourceId)
        throw new Error("Task source changed: use a distinct task identity");
      // Partial task updates cannot erase another source's evidence or a personal plan.
      const deadlines = new Map(
        previous?.deadlines.map((d) => [d.id, d]) ?? [],
      );
      for (const deadline of incoming.deadlines) {
        if (
          deadlines.has(deadline.id) &&
          deadlines.get(deadline.id)!.kind !== deadline.kind
        )
          throw new Error(
            "Deadline kind changed: use a distinct deadline identity",
          );
        deadlines.set(deadline.id, deadline);
      }
      const task = taskSchema.parse({
        ...incoming,
        deadlines: [...deadlines.values()].sort((a, b) =>
          a.id.localeCompare(b.id, "en"),
        ),
      });
      const data = JSON.stringify(task);
      if (old?.data === data) return { changed: false };
      this.db
        .prepare(
          "INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(course_id,id) DO UPDATE SET data=excluded.data",
        )
        .run(task.courseId, task.id, data);
      this.db
        .prepare("INSERT OR IGNORE INTO task_revisions VALUES(?,?,?,?,?)")
        .run(task.courseId, task.id, sha256(data), data, this.now());
      return { changed: true };
    });
  }

  markProgress(input: unknown): { changed: boolean } {
    const record = z
      .strictObject({
        entity: z.enum(["source", "task"]),
        courseId: idSchema,
        id: idSchema,
        stage: progressSchema,
        evidence: z.string().trim().min(1).max(2000),
      })
      .parse(input);
    return this.transaction(() => {
      const table = record.entity === "source" ? "sources" : "tasks";
      if (
        !this.db
          .prepare(`SELECT 1 FROM ${table} WHERE course_id=? AND id=?`)
          .get(record.courseId, record.id)
      )
        throw new Error("Unknown progress target");
      const result = this.db
        .prepare("INSERT OR IGNORE INTO progress VALUES(?,?,?,?,?,?)")
        .run(
          record.entity,
          record.courseId,
          record.id,
          record.stage,
          this.now(),
          record.evidence,
        );
      return { changed: Number(result.changes) === 1 };
    });
  }

  snapshot(): Snapshot {
    // All reads see the same committed revision, including under another CLI writer.
    this.db.exec("BEGIN");
    try {
      const result: Snapshot = {
        schemaVersion: 1,
        config: configSchema.parse(
          JSON.parse(
            String(this.db.prepare("SELECT data FROM config").get()?.data),
          ),
        ),
        courses: this.db
          .prepare("SELECT data FROM courses ORDER BY id")
          .all()
          .map((r) => courseSchema.parse(JSON.parse(String(r.data)))),
        materials: this.db
          .prepare("SELECT * FROM sources ORDER BY course_id,id")
          .all()
          .map((r) => ({
            source: sourceSchema.parse(JSON.parse(String(r.data))),
            currentHash: String(r.current_hash),
            lastVerifiedAt: String(r.last_verified),
            lastAttemptedAt: String(r.last_attempted),
            status: String(r.status),
            detail: String(r.detail),
            versions: this.db
              .prepare(
                "SELECT * FROM versions WHERE course_id=? AND source_id=? ORDER BY version",
              )
              .all(r.course_id!, r.id!)
              .map((v) => ({
                version: Number(v.version),
                hash: String(v.hash),
                format: String(v.format),
                filename: String(v.filename),
                bytes: Number(v.bytes),
                importedAt: String(v.imported_at),
                evidence: sourceSchema.parse(JSON.parse(String(v.evidence))),
              })),
          })),
        tasks: this.db
          .prepare("SELECT data FROM tasks ORDER BY course_id,id")
          .all()
          .map((r) => taskSchema.parse(JSON.parse(String(r.data)))),
        taskHistory: this.db
          .prepare(
            "SELECT * FROM task_revisions ORDER BY course_id,task_id,observed_at,hash",
          )
          .all()
          .map((r) => ({
            task: taskSchema.parse(JSON.parse(String(r.data))),
            hash: String(r.hash),
            observedAt: String(r.observed_at),
          })),
        progress: this.db
          .prepare(
            "SELECT * FROM progress ORDER BY entity,course_id,id,at,stage",
          )
          .all()
          .map((r) => ({
            schemaVersion: 1,
            entity: r.entity as "source" | "task",
            courseId: String(r.course_id),
            id: String(r.id),
            stage: progressSchema.parse(r.stage),
            at: String(r.at),
            evidence: String(r.evidence),
          })),
        schedules: this.workflowRows<Schedule>("schedules", "ORDER BY id"),
        scheduleRuns: this.workflowRows<ScheduleRun>(
          "schedule_runs",
          "ORDER BY rowid",
        ),
        calendars: this.db
          .prepare("SELECT data FROM calendar_feeds ORDER BY id")
          .all()
          .map((r) => JSON.parse(String(r.data)) as CalendarFeed),
        sessions: this.db
          .prepare("SELECT data FROM calendar_sessions ORDER BY feed_id,id")
          .all()
          .map((r) => JSON.parse(String(r.data)) as CalendarSession),
        scans: this.db
          .prepare("SELECT data FROM scan_runs ORDER BY rowid")
          .all()
          .map((r) => JSON.parse(String(r.data)) as ScanCandidate),
        notes: this.db
          .prepare(
            "SELECT r.data FROM note_heads h JOIN note_revisions r USING(course_id,id,revision) ORDER BY h.course_id,h.id",
          )
          .all()
          .map((r) => JSON.parse(String(r.data)) as NoteRecord),
        attempts: this.db
          .prepare("SELECT * FROM attempts ORDER BY sequence")
          .all()
          .map((r) => ({
            courseId: String(r.course_id),
            sourceId: String(r.source_id),
            at: String(r.at),
            status: String(r.status),
            detail: String(r.detail),
          })),
      };
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  navigation(): string {
    const bytes = Buffer.from(renderNavigation(this.snapshot()));
    const path = join(this.storage, "navigation", `${sha256(bytes)}.md`);
    writeImmutable(path, bytes);
    return path;
  }

  doctor(): { ok: boolean; issues: string[]; recoverableFiles: string[] } {
    const issues: string[] = [];
    const check = this.db.prepare("PRAGMA quick_check").all();
    if (check.some((r) => r.quick_check !== "ok"))
      issues.push("SQLite quick_check failed");
    if (this.db.prepare("PRAGMA foreign_key_check").all().length)
      issues.push("Foreign key check failed");
    const snapshot = this.snapshot();
    const expected = new Set<string>();
    for (const material of snapshot.materials) {
      if (!material.versions.some((v) => v.hash === material.currentHash))
        issues.push(`Missing current version: ${material.source.id}`);
      for (const version of material.versions) {
        const name = `${version.hash}.${version.format}`;
        expected.add(name);
        try {
          const bytes = readRegular(join(this.storage, "objects", name));
          if (sha256(bytes) !== version.hash || bytes.length !== version.bytes)
            issues.push(`Corrupt object: ${name}`);
        } catch {
          issues.push(`Missing or unreadable object: ${name}`);
        }
      }
    }
    const recoverableFiles = readdirSync(join(this.storage, "objects"))
      .filter((name) => !expected.has(name))
      .map((name) => `objects/${name}`);
    const noteFiles = new Set<string>();
    for (const row of this.db
      .prepare("SELECT data FROM note_revisions")
      .all()) {
      const note = JSON.parse(String(row.data)) as NoteRecord;
      noteFiles.add(note.relativePath);
      try {
        if (
          sha256(readRegular(join(this.storage, note.relativePath))) !==
          note.fileHash
        )
          issues.push(`Corrupt note: ${note.note.id}`);
      } catch {
        issues.push(`Missing or unreadable note: ${note.note.id}`);
      }
    }
    if (existsSync(join(this.storage, "notes"))) {
      directory(join(this.storage, "notes"));
      recoverableFiles.push(
        ...readdirSync(join(this.storage, "notes"))
          .map((name) => `notes/${name}`)
          .filter((name) => !noteFiles.has(name)),
      );
    }
    const calendarFiles = new Set<string>();
    for (const record of this.workflowRows<{ sourceHash: string | null }>(
      "calendar_imports",
    )) {
      if (!record.sourceHash) continue;
      const name = `calendars/${record.sourceHash}.ics`;
      calendarFiles.add(name);
      try {
        if (sha256(readRegular(join(this.storage, name))) !== record.sourceHash)
          issues.push(`Corrupt calendar: ${record.sourceHash}`);
      } catch {
        issues.push(`Missing or unreadable calendar: ${record.sourceHash}`);
      }
    }
    if (existsSync(join(this.storage, "calendars"))) {
      directory(join(this.storage, "calendars"));
      recoverableFiles.push(
        ...readdirSync(join(this.storage, "calendars"))
          .map((name) => `calendars/${name}`)
          .filter((name) => !calendarFiles.has(name)),
      );
    }
    recoverableFiles.push(
      ...readdirSync(join(this.storage, "navigation"))
        .filter((name) => name.startsWith(".pending-"))
        .map((name) => `navigation/${name}`),
    );
    recoverableFiles.push(
      ...readdirSync(this.root).filter((name) =>
        name.startsWith(".study-init-"),
      ),
    );
    return { ok: issues.length === 0, issues, recoverableFiles };
  }
}

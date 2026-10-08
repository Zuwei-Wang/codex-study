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
      db.exec(schema + learningSchema);
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
        ![1, 2].includes(Number(version.user_version))
      )
        throw new Error("Unsupported workspace database or schema version");
      if (version.user_version === 1) {
        if (!options.migrate)
          throw new Error(
            "Workspace schema 1 requires an explicit upgrade before M2 use",
          );
        this.transaction(() => this.db.exec(learningSchema));
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
    this.db.close();
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
  private now(): string {
    return instantSchema.parse(
      this.options.now?.() ?? new Date().toISOString(),
    );
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
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

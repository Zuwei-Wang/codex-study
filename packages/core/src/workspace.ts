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
export type Checkpoint = "object-durable" | "before-commit" | "after-commit";
export interface WorkspaceOptions {
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
      db.exec(schema);
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
      if (app.application_id !== APP_ID || version.user_version !== 1)
        throw new Error("Unsupported workspace database or schema version");
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

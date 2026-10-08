import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  Workspace,
  officialDateState,
  renderNavigation,
  type Task,
} from "../packages/core/src/index.js";
import { config, course, setup, source, task, temp } from "./helpers.js";

test("two profiles and paths initialize idempotently without changing unrelated files", (t) => {
  for (const [language, timeZone] of [
    ["en", "Europe/London"],
    ["zh-CN", "Asia/Shanghai"],
  ] as const) {
    const { path, workspace } = setup(t, { ...config, language, timeZone });
    const note = join(path, "personal-note.md");
    writeFileSync(note, "mine");
    const reopened = Workspace.initialize(path, {
      ...config,
      language,
      timeZone,
    });
    assert.deepEqual(reopened.snapshot().config, {
      ...config,
      language,
      timeZone,
    });
    reopened.close();
    assert.throws(
      () =>
        Workspace.initialize(path, { ...config, academicYear: "different" }),
      /different configuration/,
    );
    assert.equal(readFileSync(note, "utf8"), "mine");
    assert.equal(workspace.snapshot().courses.length, 1);
  }
});

test("strict validation rejects invalid time zones, schema versions and path-like IDs before writes", (t) => {
  const root = join(temp(t), "not-created");
  assert.throws(() =>
    Workspace.initialize(root, { ...config, timeZone: "Mars/Olympus" }),
  );
  assert.equal(existsSync(root), false);
  assert.throws(() =>
    Workspace.initialize(root, { ...config, schemaVersion: 2 }),
  );
  const { workspace } = setup(t);
  assert.throws(() => workspace.putCourse({ ...course, id: "../escape" }));
  assert.throws(() => workspace.putCourse({ ...course, unexpected: true }));
  assert.equal(workspace.snapshot().courses.length, 1);
});

test("unchanged imports deduplicate, changed same-name files retain bytes, and reversions reuse versions", (t) => {
  const { workspace, file, path } = setup(t);
  const original = readFileSync(file);
  const first = workspace.importMaterial({ source, file });
  assert.equal(first.version, 1);
  assert.equal(workspace.importMaterial({ source, file }).changed, false);
  writeFileSync(file, "# Changed synthetic slides");
  const second = workspace.importMaterial({ source, file });
  assert.equal(second.version, 2);
  assert.notEqual(second.hash, first.hash);
  writeFileSync(file, original);
  assert.equal(workspace.importMaterial({ source, file }).version, 1);
  const snap = workspace.snapshot();
  assert.equal(snap.materials[0]!.versions.length, 2);
  assert.equal(snap.materials[0]!.currentHash, first.hash);
  assert.deepEqual(
    readFileSync(join(path, ".study/objects", `${first.hash}.md`)),
    original,
  );
  assert.equal(readdirSync(join(path, ".study/objects")).length, 2);
  assert.equal(workspace.doctor().ok, true);
});

test("source identity does not merge equal names, different courses, kinds or formats", (t) => {
  const { workspace, file, tempRoot } = setup(t);
  workspace.importMaterial({ source, file });
  workspace.importMaterial({ source: { ...source, id: "other-source" }, file });
  workspace.putCourse({ ...course, id: "DEMO202" });
  workspace.importMaterial({
    source: { ...source, courseId: "DEMO202" },
    file,
  });
  assert.throws(
    () =>
      workspace.importMaterial({
        source: { ...source, kind: "personal" },
        file,
      }),
    /distinct source/,
  );
  const pdf = join(tempRoot, "slides.pdf");
  writeFileSync(pdf, "Opaque synthetic PDF fixture bytes");
  assert.throws(
    () => workspace.importMaterial({ source, file: pdf }),
    /distinct source/,
  );
  workspace.importMaterial({
    source: { ...source, id: "slides-pdf" },
    file: pdf,
  });
  assert.equal(workspace.snapshot().materials.length, 4);
});

test("task imports preserve explicit progress, conflicting evidence, historical dates and other tasks", (t) => {
  const { workspace, file } = setup(t);
  workspace.importMaterial({ source, file });
  workspace.putTask(task);
  workspace.putTask({ ...task, id: "another-task" });
  workspace.markProgress({
    entity: "task",
    courseId: task.courseId,
    id: task.id,
    stage: "uploaded",
    evidence: "Synthetic user report",
  });
  assert.equal(workspace.putTask(task).changed, false);
  const changed: Task = {
    ...task,
    deadlines: [
      ...task.deadlines,
      {
        id: "portal",
        kind: "official",
        value: { precision: "date", date: "2030-11-11" },
        evidence: "Synthetic portal",
      },
      {
        id: "plan",
        kind: "personal",
        value: { precision: "date", date: "2030-11-09" },
        evidence: "User plan",
      },
      {
        id: "feedback",
        kind: "feedback",
        value: { precision: "unknown" },
        evidence: "Unspecified",
      },
    ],
  };
  workspace.putTask(changed);
  assert.equal(officialDateState(changed), "conflict");
  assert.deepEqual(
    workspace.snapshot().progress.map((p) => p.stage),
    ["uploaded"],
  );
  assert.equal(workspace.snapshot().tasks.length, 2);
  workspace.putTask({ ...task, deadlines: [] });
  const snap = workspace.snapshot();
  assert.equal(snap.taskHistory.filter((r) => r.task.id === task.id).length, 2);
  assert.equal(
    officialDateState(snap.tasks.find((x) => x.id === task.id)!),
    "conflict",
  );
  assert.equal(snap.tasks.find((x) => x.id === task.id)!.deadlines.length, 4);
  assert.deepEqual(
    snap.progress.map((p) => p.stage),
    ["uploaded"],
  );
  assert.throws(() =>
    workspace.putTask({
      ...task,
      deadlines: [task.deadlines[0], task.deadlines[0]],
    }),
  );
});

test("progress states are distinct, explicit and idempotent for tasks and materials", (t) => {
  const { workspace, file } = setup(t);
  workspace.importMaterial({ source, file });
  workspace.putTask(task);
  for (const stage of [
    "opened",
    "read",
    "drafted",
    "uploaded",
    "submitted",
    "graded",
  ]) {
    const input = {
      entity: "task",
      courseId: task.courseId,
      id: task.id,
      stage,
      evidence: "Synthetic explicit report",
    };
    assert.equal(workspace.markProgress(input).changed, true);
    assert.equal(workspace.markProgress(input).changed, false);
  }
  workspace.markProgress({
    entity: "source",
    courseId: source.courseId,
    id: source.id,
    stage: "opened",
    evidence: "Synthetic explicit report",
  });
  assert.equal(workspace.snapshot().progress.length, 7);
  assert.throws(() =>
    workspace.markProgress({
      entity: "task",
      courseId: task.courseId,
      id: "missing",
      stage: "read",
      evidence: "report",
    }),
  );
});

test("failed and partial observations retain the actual verified time and snapshot", (t) => {
  const { path, workspace, file } = setup(t);
  workspace.importMaterial({ source, file });
  const before = workspace.snapshot().materials[0]!;
  const later = new Workspace(path, { now: () => "2031-01-01T00:00:00Z" });
  for (const status of ["partial", "failed"])
    later.recordAttempt(source.courseId, source.id, {
      status,
      detail: "Synthetic unavailable source",
    });
  const after = later.snapshot().materials[0]!;
  assert.equal(after.lastVerifiedAt, before.lastVerifiedAt);
  assert.equal(after.lastAttemptedAt, "2031-01-01T00:00:00Z");
  assert.equal(after.currentHash, before.currentHash);
  assert.deepEqual(after.versions, before.versions);
  assert.equal(later.snapshot().attempts.length, 2);
  later.close();
  assert.throws(() =>
    workspace.importMaterial({ source, file: join(path, "missing.md") }),
  );
  assert.equal(
    workspace.snapshot().materials[0]!.currentHash,
    before.currentHash,
  );
});

test("navigation is deterministic, localized, links actual versions and protects user edits", (t) => {
  const { workspace, file } = setup(t, {
    ...config,
    language: "zh-CN",
    timeZone: "Asia/Shanghai",
  });
  workspace.importMaterial({
    source: { ...source, title: "<script> [click](javascript:bad)" },
    file,
  });
  workspace.putTask({
    ...task,
    deadlines: [
      {
        id: "time",
        kind: "official",
        value: { precision: "instant", at: "2030-11-10T16:00:00Z" },
        evidence: "Synthetic time",
      },
    ],
  });
  const path = workspace.navigation();
  assert.equal(workspace.navigation(), path);
  const content = readFileSync(path, "utf8");
  assert.match(content, /学习导航/);
  assert.match(content, /Asia\/Shanghai/);
  assert.match(content, /2030年11月11日 00:00/);
  assert.doesNotMatch(content, /<script>/);
  assert.match(content, /&lt;script&gt;/);
  const link = content.match(/\]\((\.\.\/objects\/[^)]+)\)/)![1]!;
  assert.equal(existsSync(join(path, "..", link)), true);
  writeFileSync(path, "user edit");
  assert.throws(() => workspace.navigation(), /refusing overwrite/);
  assert.equal(readFileSync(path, "utf8"), "user edit");
});

test("unknown and date-only values never invent times; equal instants are not conflicts", () => {
  assert.equal(officialDateState({ ...task, deadlines: [] }), "unknown");
  assert.equal(officialDateState(task), "known");
  const dates: Task = {
    ...task,
    deadlines: [
      {
        id: "a",
        kind: "official",
        value: { precision: "instant", at: "2030-11-10T12:00:00Z" },
        evidence: "a",
      },
      {
        id: "b",
        kind: "official",
        value: { precision: "instant", at: "2030-11-10T13:00:00+01:00" },
        evidence: "b",
      },
    ],
  };
  assert.equal(officialDateState(dates), "known");
  const text = renderNavigation({
    schemaVersion: 1,
    config,
    courses: [course as never],
    tasks: [task],
    materials: [],
    progress: [],
    taskHistory: [],
    attempts: [],
  });
  assert.match(text, /date only; no time supplied/);
  assert.doesNotMatch(text, /00:00/);
});

test("corrupt archives and symlinks are rejected without overwriting or following them", (t) => {
  const { workspace, path, file, tempRoot } = setup(t);
  const imported = workspace.importMaterial({ source, file });
  const object = join(path, ".study/objects", `${imported.hash}.md`);
  writeFileSync(object, "tampered");
  assert.equal(workspace.doctor().ok, false);
  assert.throws(
    () => workspace.importMaterial({ source, file }),
    /refusing overwrite/,
  );
  assert.equal(readFileSync(object, "utf8"), "tampered");
  const link = join(tempRoot, "linked.md");
  symlinkSync(file, link);
  assert.throws(() => workspace.importMaterial({ source, file: link }));
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import { Workspace, previewReminders } from "../packages/core/src/index.js";
import { setup, source, task, config } from "./helpers.js";

test("optional preferences persist across reopening and imports without altering records or reminder projections", (t) => {
  const { workspace, path, file } = setup(t);
  workspace.importMaterial({ source, file });
  workspace.putTask(task);
  workspace.markProgress({
    entity: "source",
    courseId: source.courseId,
    id: source.id,
    stage: "read",
    evidence: "Synthetic user report",
  });
  const before = workspace.snapshot();
  assert.deepEqual(workspace.learningPreferences(), {
    record: null,
    guidance: null,
  });
  const selection = {
    streamId: "6c1b64e5-8771-46c4-9a7b-c7a8f4d71601",
    revision: 1,
    leadMinutes: 60,
    selections: [],
  };
  const projection = previewReminders(
    before,
    selection,
    "2030-10-01T10:00:00Z",
  );
  const request = {
    expectedRevision: null,
    preferences: {
      status: "provided",
      planningStyle: "deadline-driven",
      learningMode: "self-study",
      sessionMinutes: 25,
      supportStyle: "small-steps",
    },
  };
  const saved = workspace.saveLearningPreferences(request);
  assert.equal(saved.changed, true);
  assert.deepEqual(workspace.learningPreferences().guidance, {
    planning: "small-milestones",
    lessonOrder: "read-practice-review",
    sessionMinutes: 25,
    supportStyle: "small-steps",
  });
  assert.equal(workspace.saveLearningPreferences(request).changed, false);
  const after = workspace.snapshot();
  assert.deepEqual({ ...after, learningPreferences: null }, before);
  assert.deepEqual(
    previewReminders(after, selection, "2030-10-01T10:00:00Z"),
    projection,
  );
  workspace.importMaterial({ source, file });
  assert.deepEqual(workspace.learningPreferences().record, saved.record);
  workspace.close();
  const reopened = new Workspace(path);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.learningPreferences().record, saved.record);
  const reused = Workspace.initialize(path, config);
  reused.close();
  assert.equal(reopened.doctor().ok, true);
});

test("partial answers, explicit skip and clear stay distinct; invalid input cannot replace preferences", (t) => {
  const { workspace } = setup(t);
  const first = workspace.saveLearningPreferences({
    expectedRevision: null,
    preferences: { status: "provided", learningMode: "mixed" },
  });
  assert.deepEqual(workspace.learningPreferences().guidance, {
    lessonOrder: "preview-learn-practice",
  });
  for (const preferences of [
    { status: "provided" },
    { status: "provided", planningStyle: undefined },
    { status: "provided", planningStyle: "lazy" },
    { status: "provided", sessionMinutes: 0 },
    { status: "provided", remindersEnabled: true },
    { status: "skipped", learningMode: "lecture-led" },
  ])
    assert.throws(() =>
      workspace.saveLearningPreferences({
        expectedRevision: first.record.revision,
        preferences,
      }),
    );
  assert.deepEqual(workspace.learningPreferences().record, first.record);
  const skipped = workspace.saveLearningPreferences({
    expectedRevision: first.record.revision,
    preferences: { status: "skipped" },
  });
  assert.equal(skipped.record.preferences?.status, "skipped");
  assert.equal(workspace.learningPreferences().guidance, null);
  const cleared = workspace.saveLearningPreferences({
    expectedRevision: skipped.record.revision,
    preferences: null,
  });
  assert.equal(cleared.record.preferences, null);
  assert.equal(workspace.learningPreferences().guidance, null);
});

test("two writers refuse stale edits and a clear/resave cannot reuse an earlier revision", (t) => {
  const { workspace, path } = setup(t);
  const other = new Workspace(path);
  t.after(() => other.close());
  const initial = workspace.saveLearningPreferences({
    expectedRevision: null,
    preferences: { status: "provided", planningStyle: "steady" },
  });
  const next = other.saveLearningPreferences({
    expectedRevision: initial.record.revision,
    preferences: { status: "provided", planningStyle: "flexible" },
  });
  assert.throws(
    () =>
      workspace.saveLearningPreferences({
        expectedRevision: initial.record.revision,
        preferences: { status: "skipped" },
      }),
    /revision conflict/,
  );
  assert.deepEqual(workspace.learningPreferences().record, next.record);
  const cleared = other.saveLearningPreferences({
    expectedRevision: next.record.revision,
    preferences: null,
  });
  const resaved = workspace.saveLearningPreferences({
    expectedRevision: cleared.record.revision,
    preferences: initial.record.preferences,
  });
  assert.notEqual(resaved.record.revision, initial.record.revision);
  assert.throws(
    () =>
      other.saveLearningPreferences({
        expectedRevision: initial.record.revision,
        preferences: null,
      }),
    /revision conflict/,
  );
});

test("schema 3 upgrade is explicit and preserves all prior records without inventing preferences", (t) => {
  const { workspace, path, file } = setup(t);
  workspace.importMaterial({ source, file });
  workspace.putTask(task);
  const before = workspace.snapshot();
  workspace.close();
  const db = new DatabaseSync(join(path, ".study/records.sqlite"));
  db.exec("DROP TABLE learning_preferences; PRAGMA user_version=3;");
  db.close();
  assert.throws(() => new Workspace(path), /explicit upgrade/);
  const untouched = new DatabaseSync(join(path, ".study/records.sqlite"));
  assert.equal(untouched.prepare("PRAGMA user_version").get()!.user_version, 3);
  untouched.close();
  const upgraded = new Workspace(path, { migrate: true });
  t.after(() => upgraded.close());
  assert.deepEqual(upgraded.snapshot(), before);
  assert.equal(upgraded.learningPreferences().record, null);
  assert.equal(upgraded.doctor().ok, true);
});

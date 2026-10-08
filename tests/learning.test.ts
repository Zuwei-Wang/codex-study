import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Workspace } from "../packages/core/src/index.js";
import { markdownSections } from "../packages/core/src/reader.js";
import { setup, source, task } from "./helpers.js";
import { syntheticPdf } from "./synthetic-pdf.js";

import { sampleNote } from "./learning-fixture.js";

test("readers retain immutable versions, correct section boundaries and explicit capability limits", async (t) => {
  const { workspace, file, tempRoot } = setup(t);
  const { hash } = workspace.importMaterial({ source, file });
  const reading = {
    courseId: source.courseId,
    sourceId: source.id,
    hash,
    start: 2,
    count: 1,
  };
  assert.match(
    (await workspace.readMaterial(reading)).parts[0]!.text,
    /Version one/,
  );
  writeFileSync(file, "A replacement");
  workspace.importMaterial({ source, file });
  assert.match(
    (await workspace.readMaterial(reading)).parts[0]!.text,
    /Version one/,
  );
  assert.equal(workspace.snapshot().progress.length, 0);
  await assert.rejects(
    workspace.readMaterial({ ...reading, start: 100 }),
    /outside/,
  );
  assert.equal(
    markdownSections(
      "---\ntitle: Example\n---\n# Heading\n```\n---\n```\n---\nNext",
    ).length,
    2,
  );
  const pptx = join(tempRoot, "opaque.pptx");
  writeFileSync(pptx, "Synthetic opaque bytes; not an actual presentation");
  const other = workspace.importMaterial({
    source: { ...source, id: "pptx" },
    file: pptx,
  });
  assert.equal(
    (
      await workspace.readMaterial({
        ...reading,
        sourceId: "pptx",
        hash: other.hash,
        start: 1,
      })
    ).status,
    "unsupported",
  );
  const text = join(tempRoot, "long.txt");
  writeFileSync(text, "x".repeat(33000));
  const long = workspace.importMaterial({
    source: { ...source, id: "long" },
    file: text,
  });
  assert.equal(
    (
      await workspace.readMaterial({
        ...reading,
        sourceId: "long",
        hash: long.hash,
        start: 1,
      })
    ).status,
    "partial",
  );
});

test("PDF extraction returns original page numbers, flags empty text and refuses invalid PDFs", async (t) => {
  const { workspace, tempRoot } = setup(t);
  const file = join(tempRoot, "original.pdf");
  writeFileSync(
    file,
    syntheticPdf(["Synthetic first page", "", "Synthetic third page"]),
  );
  const { hash } = workspace.importMaterial({ source, file });
  const input = {
    courseId: source.courseId,
    sourceId: source.id,
    hash,
    start: 1,
    count: 3,
  };
  const result = await workspace.readMaterial(input);
  assert.equal(result.unit, "page");
  assert.equal(result.total, 3);
  assert.equal(result.status, "partial");
  assert.deepEqual(
    result.parts.map((p) => p.number),
    [1, 2, 3],
  );
  assert.match(result.parts[2]!.text, /Synthetic third page/);
  assert.equal(result.parts[1]!.text, "");
  const note = sampleNote(hash);
  note.sections[0]!.citations[0] = {
    sourceId: source.id,
    hash,
    unit: "page",
    start: 3,
    end: 3,
    quote: "Synthetic third page",
  };
  const saved = await workspace.saveNote({ note, expectedRevision: null });
  assert.match(readFileSync(saved.path, "utf8"), /#page=3/);
  writeFileSync(file, "malformed synthetic PDF");
  const bad = workspace.importMaterial({ source, file });
  await assert.rejects(workspace.readMaterial({ ...input, hash: bad.hash }));
});

test("notes validate exact quotes and locators, retain revisions/progress and reject lost updates", async (t) => {
  const { workspace, file } = setup(t);
  const { hash } = workspace.importMaterial({ source, file });
  workspace.putTask(task);
  workspace.markProgress({
    entity: "task",
    courseId: task.courseId,
    id: task.id,
    stage: "uploaded",
    evidence: "Synthetic learner report",
  });
  const note = sampleNote(hash);
  const first = await workspace.saveNote({ note, expectedRevision: null });
  assert.equal(
    (await workspace.saveNote({ note, expectedRevision: null })).changed,
    false,
  );
  const bad = structuredClone(note);
  bad.sections[0]!.citations[0]!.quote = "Not present in this material";
  await assert.rejects(
    workspace.saveNote({ note: bad, expectedRevision: first.record.revision }),
    /quote/,
  );
  bad.sections[0]!.citations[0] = {
    ...note.sections[0]!.citations[0]!,
    unit: "page",
  };
  await assert.rejects(
    workspace.saveNote({ note: bad, expectedRevision: first.record.revision }),
    /location/,
  );
  const revised = { ...note, title: "Updated synthetic lesson" };
  await assert.rejects(
    workspace.saveNote({ note: revised, expectedRevision: null }),
    /revision conflict/,
  );
  const second = await workspace.saveNote({
    note: revised,
    expectedRevision: first.record.revision,
  });
  assert.notEqual(second.record.revision, first.record.revision);
  assert.equal(workspace.noteHistory(note.courseId, note.id).length, 2);
  assert.deepEqual(
    workspace.snapshot().progress.map((p) => p.stage),
    ["uploaded"],
  );
  assert.equal(
    workspace.snapshot().notes?.[0]?.revision,
    second.record.revision,
  );
  assert.match(
    readFileSync(workspace.navigation(), "utf8"),
    /Updated synthetic lesson/,
  );
  assert.equal(workspace.doctor().ok, true);
  writeFileSync(second.path, "user edit");
  await assert.rejects(
    workspace.saveNote({
      note: revised,
      expectedRevision: second.record.revision,
    }),
    /refusing overwrite/,
  );
  assert.equal(readFileSync(second.path, "utf8"), "user edit");
  assert.equal(workspace.doctor().ok, false);
});

test("M1 migration is explicit and preserves settings, source bytes, task conflicts and progress", (t) => {
  const { workspace, file, path } = setup(t);
  const { hash } = workspace.importMaterial({ source, file });
  workspace.putTask(task);
  workspace.markProgress({
    entity: "source",
    courseId: source.courseId,
    id: source.id,
    stage: "read",
    evidence: "Synthetic report",
  });
  const before = workspace.snapshot();
  const db = new DatabaseSync(join(path, ".study/records.sqlite"));
  db.exec(
    "DROP TABLE note_heads; DROP TABLE note_revisions; PRAGMA user_version=1;",
  );
  db.close();
  assert.throws(() => new Workspace(path), /explicit upgrade/);
  const upgraded = new Workspace(path, { migrate: true });
  assert.deepEqual(upgraded.snapshot(), before);
  assert.equal(upgraded.snapshot().materials[0]!.currentHash, hash);
  assert.equal(upgraded.doctor().ok, true);
  upgraded.close();
});

test("concurrent different note edits preserve one winner and refuse the stale revision", async (t) => {
  const { workspace, file } = setup(t);
  const { hash } = workspace.importMaterial({ source, file });
  const note = sampleNote(hash);
  const original = await workspace.saveNote({ note, expectedRevision: null });
  const edits = await Promise.allSettled(
    ["First edit", "Second edit"].map((title) =>
      workspace.saveNote({
        note: { ...note, title },
        expectedRevision: original.record.revision,
      }),
    ),
  );
  assert.equal(edits.filter((e) => e.status === "fulfilled").length, 1);
  const failure = edits.find((e) => e.status === "rejected");
  assert.match(String(failure?.reason), /revision conflict/);
  assert.equal(workspace.noteHistory(note.courseId, note.id).length, 2);
  assert.equal(workspace.doctor().ok, true);
});

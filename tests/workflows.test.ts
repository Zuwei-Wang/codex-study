import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setup, source, task } from "./helpers.js";
import { sha256 } from "../packages/core/src/storage.js";
import type { ScanCandidate } from "../packages/core/src/observations.js";

const calendar = (events: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Codex Study//Synthetic//EN\r\n${events}\r\nEND:VCALENDAR\r\n`;
const event = (lines: string) =>
  `BEGIN:VEVENT\r\n${lines.replaceAll("\n", "\r\n")}\r\nEND:VEVENT`;
const window = { start: "2030-10-01T00:00:00Z", end: "2030-11-10T00:00:00Z" };
const lecture = event(
  "UID:synthetic-weekly\nDTSTART;TZID=Europe/London:20301022T090000\nDTEND;TZID=Europe/London:20301022T100000\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Synthetic class\nLOCATION:Room A\nSEQUENCE:1",
);

test("ICS retains stable identities across DST, moved/cancelled occurrences and explicit mappings", async (t) => {
  const { workspace, tempRoot } = setup(t);
  const file = join(tempRoot, "synthetic.ics");
  writeFileSync(file, calendar(lecture));
  const input = {
    file,
    feedId: "timetable",
    title: "Synthetic timetable",
    window,
    mappings: [{ uid: "synthetic-weekly", courseId: "DEMO101" }],
  };
  const first = await workspace.importCalendar(input);
  assert.equal(first.feed.status, "complete");
  assert.equal(first.sessions.length, 3);
  assert.deepEqual(
    first.sessions
      .map((s) => s.start)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [
      { precision: "instant", at: "2030-10-22T08:00:00.000Z" },
      { precision: "instant", at: "2030-10-29T09:00:00.000Z" },
      { precision: "instant", at: "2030-11-05T09:00:00.000Z" },
    ],
  );
  assert.ok(first.sessions.every((s) => s.courseId === "DEMO101"));
  assert.equal((await workspace.importCalendar(input)).changed, false);
  const moved = event(
    "UID:synthetic-weekly\nRECURRENCE-ID;TZID=Europe/London:20301029T090000\nDTSTART;TZID=Europe/London:20301030T110000\nDTEND;TZID=Europe/London:20301030T120000\nSUMMARY:Moved synthetic class\nLOCATION:Room B\nSEQUENCE:2",
  );
  const cancelled = event(
    "UID:synthetic-weekly\nRECURRENCE-ID;TZID=Europe/London:20301105T090000\nSTATUS:CANCELLED\nSEQUENCE:2",
  );
  writeFileSync(file, calendar([lecture, moved, cancelled].join("\r\n")));
  const second = await workspace.importCalendar(input);
  assert.equal(second.feed.status, "complete");
  assert.equal(second.sessions.length, 3);
  assert.deepEqual(
    second.sessions.map((s) => s.id),
    first.sessions.map((s) => s.id),
  );
  assert.equal(
    second.sessions.find((s) => s.title === "Moved synthetic class")?.location,
    "Room B",
  );
  assert.equal(
    second.sessions.filter((s) => s.status === "cancelled").length,
    1,
  );
  assert.equal(workspace.doctor().ok, true);
});

test("ICS partial/malformed/stale imports retain prior verified data; absence never means cancellation", async (t) => {
  const { workspace, tempRoot } = setup(t);
  const file = join(tempRoot, "feed.ics");
  const input = {
    file,
    feedId: "feed",
    title: "Synthetic",
    window,
    mappings: [],
  };
  writeFileSync(file, calendar(lecture));
  const first = await workspace.importCalendar(input);
  writeFileSync(file, calendar(""));
  const missing = await workspace.importCalendar(input);
  assert.equal(missing.feed.status, "partial");
  assert.ok(missing.sessions.every((s) => s.status === "missing"));
  assert.equal(missing.feed.lastVerifiedAt, first.feed.lastVerifiedAt);
  assert.equal(missing.feed.lastVerifiedHash, first.feed.sourceHash);
  writeFileSync(file, "Not a calendar");
  const failed = await workspace.importCalendar(input);
  assert.equal(failed.feed.status, "failed");
  assert.deepEqual(failed.sessions, missing.sessions);
  assert.equal(failed.feed.lastVerifiedAt, first.feed.lastVerifiedAt);
  writeFileSync(file, calendar(lecture.replace("SEQUENCE:1", "SEQUENCE:0")));
  const stale = await workspace.importCalendar(input);
  assert.equal(stale.feed.status, "partial");
  assert.deepEqual(stale.sessions, missing.sessions);
  writeFileSync(
    file,
    calendar(event("UID:synthetic-weekly\nSTATUS:CANCELLED\nSEQUENCE:3")),
  );
  const cancelled = await workspace.importCalendar(input);
  assert.equal(cancelled.feed.status, "complete");
  assert.ok(cancelled.sessions.every((s) => s.status === "cancelled"));
  assert.equal(workspace.snapshot().tasks.length, 0);
  assert.equal(workspace.doctor().ok, true);
});

test("ICS date-only and floating values remain explicit; unsupported and conflicting input fails without replacement", async (t) => {
  const { workspace, tempRoot } = setup(t);
  const file = join(tempRoot, "feed.ics");
  const input = {
    file,
    feedId: "feed",
    title: "Synthetic",
    window,
    mappings: [],
  };
  writeFileSync(
    file,
    calendar(
      event(
        "UID:all-day\nDTSTART;VALUE=DATE:20301020\nDTEND;VALUE=DATE:20301022\nSUMMARY:Synthetic all-day",
      ),
    ),
  );
  const first = await workspace.importCalendar(input);
  assert.equal(first.feed.status, "complete");
  assert.deepEqual(first.sessions[0]?.start, {
    precision: "date",
    date: "2030-10-20",
  });
  writeFileSync(
    file,
    calendar(
      event("UID:floating\nDTSTART:20301020T090000\nDTEND:20301020T100000"),
    ),
  );
  assert.equal((await workspace.importCalendar(input)).feed.status, "failed");
  const floating = await workspace.importCalendar({
    ...input,
    floatingTimeZone: "Asia/Shanghai",
  });
  assert.deepEqual(floating.sessions.find((s) => s.uid === "floating")?.start, {
    precision: "instant",
    at: "2030-10-20T01:00:00.000Z",
  });
  writeFileSync(
    file,
    calendar(lecture.replace("FREQ=WEEKLY", "FREQ=SECONDLY")),
  );
  assert.equal((await workspace.importCalendar(input)).feed.status, "failed");
  writeFileSync(
    file,
    calendar(lecture + "\r\n" + lecture.replace("Room A", "Room B")),
  );
  assert.equal((await workspace.importCalendar(input)).feed.status, "failed");
});

const observations = (
  scan: ScanCandidate,
  status: "complete" | "partial" | "failed" = "complete",
) =>
  scan.scope.courseIds.flatMap((courseId) =>
    scan.scope.surfaces.map((surface) => ({
      courseId,
      surface,
      status,
      reason:
        status === "complete"
          ? ("observed" as const)
          : ("session-expired" as const),
      observedAt: new Date().toISOString(),
      evidence:
        "Original synthetic browser observation; no real platform data.",
    })),
  );
const scope = {
  adapter: "blackboard-ultra",
  courseIds: ["DEMO101"],
  surfaces: ["content", "assessments"],
};

test("scan candidates apply atomically, detect actual changes, stay quiet when unchanged and preserve progress", (t) => {
  const { workspace, file } = setup(t);
  const hash = sha256("# Synthetic slides\n\n---\n\nVersion one\n");
  const prepared = workspace.prepareScan(scope);
  const recorded = workspace.recordScan({
    id: prepared.id,
    expectedRevision: prepared.revision,
    observations: observations(prepared),
    files: [{ source, surface: "content", file, expectedHash: hash }],
    tasks: [{ task, surface: "assessments" }],
  });
  const applied = workspace.applyScan({
    id: recorded.id,
    expectedRevision: recorded.revision,
  });
  assert.deepEqual(
    applied.result && {
      status: applied.result.status,
      changed: applied.result.changed,
      files: applied.result.filesChanged,
      tasks: applied.result.tasksChanged,
    },
    { status: "complete", changed: true, files: 1, tasks: 1 },
  );
  assert.deepEqual(
    workspace.applyScan({
      id: recorded.id,
      expectedRevision: recorded.revision,
    }),
    applied,
  );
  workspace.markProgress({
    entity: "source",
    courseId: source.courseId,
    id: source.id,
    stage: "read",
    evidence: "Synthetic learner report",
  });
  const again = workspace.prepareScan(scope);
  const unchanged = workspace.recordScan({
    id: again.id,
    expectedRevision: again.revision,
    observations: observations(again),
    files: [{ source, surface: "content", file, expectedHash: hash }],
    tasks: [{ task, surface: "assessments" }],
  });
  assert.equal(
    workspace.applyScan({
      id: unchanged.id,
      expectedRevision: unchanged.revision,
    }).result?.changed,
    false,
  );
  writeFileSync(file, "Changed synthetic same-name slide");
  const next = workspace.prepareScan(scope);
  const changed = workspace.recordScan({
    id: next.id,
    expectedRevision: next.revision,
    observations: observations(next),
    files: [
      {
        source,
        surface: "content",
        file,
        expectedHash: sha256("Changed synthetic same-name slide"),
      },
    ],
    tasks: [
      {
        surface: "assessments",
        task: {
          ...task,
          deadlines: [
            ...task.deadlines,
            {
              ...task.deadlines[0],
              id: "calendar",
              value: { precision: "date", date: "2030-11-12" },
            },
          ],
        },
      },
    ],
  });
  const final = workspace.applyScan({
    id: changed.id,
    expectedRevision: changed.revision,
  });
  assert.equal(final.result?.filesChanged, 1);
  assert.equal(final.result?.tasksChanged, 1);
  assert.equal(workspace.snapshot().materials[0]?.versions.length, 2);
  assert.equal(workspace.snapshot().progress[0]?.stage, "read");
  assert.equal(workspace.snapshot().tasks[0]?.deadlines.length, 2);
  assert.equal(workspace.doctor().ok, true);
});

test("failed/partial scans retain authoritative records and actual verification time; stale/tampered candidates cannot apply", (t) => {
  const { workspace, file } = setup(t);
  const imported = workspace.importMaterial({ source, file });
  workspace.putTask(task);
  const before = workspace.snapshot();
  for (const status of ["partial", "failed"] as const) {
    const prepared = workspace.prepareScan(scope);
    const recorded = workspace.recordScan({
      id: prepared.id,
      expectedRevision: prepared.revision,
      observations: observations(prepared, status),
      files: [],
      tasks: [],
    });
    assert.equal(
      workspace.applyScan({
        id: recorded.id,
        expectedRevision: recorded.revision,
      }).result?.status,
      status,
    );
    assert.deepEqual(workspace.snapshot().materials, before.materials);
    assert.deepEqual(workspace.snapshot().tasks, before.tasks);
  }
  const prepared = workspace.prepareScan(scope);
  const recorded = workspace.recordScan({
    id: prepared.id,
    expectedRevision: prepared.revision,
    observations: observations(prepared),
    files: [{ source, surface: "content", file, expectedHash: imported.hash }],
    tasks: [],
  });
  writeFileSync(file, "Tampered after review");
  assert.throws(
    () =>
      workspace.applyScan({
        id: recorded.id,
        expectedRevision: recorded.revision,
      }),
    /changed before apply/,
  );
  assert.deepEqual(workspace.snapshot().materials, before.materials);
  workspace.putCourse({ ...before.courses[0], title: "Explicit user edit" });
  assert.throws(
    () =>
      workspace.applyScan({
        id: recorded.id,
        expectedRevision: recorded.revision,
      }),
    /Workspace changed/,
  );
});

test("scan failure after an imported candidate rolls back all metadata and preserves a recoverable archive", (t) => {
  const { workspace, file } = setup(t);
  const prepared = workspace.prepareScan(scope);
  const recorded = workspace.recordScan({
    id: prepared.id,
    expectedRevision: prepared.revision,
    observations: observations(prepared),
    files: [
      {
        source,
        surface: "content",
        file,
        expectedHash: sha256("# Synthetic slides\n\n---\n\nVersion one\n"),
      },
    ],
    tasks: [{ task: { ...task, sourceId: "unknown" }, surface: "assessments" }],
  });
  assert.throws(
    () =>
      workspace.applyScan({
        id: recorded.id,
        expectedRevision: recorded.revision,
      }),
    /Unknown source/,
  );
  assert.equal(workspace.snapshot().materials.length, 0);
  assert.equal(workspace.snapshot().tasks.length, 0);
  assert.equal(workspace.getScan(recorded.id).state, "candidate");
  assert.ok(workspace.doctor().recoverableFiles.length > 0);
});

test("cancellation received before an event persists across restart and suppresses older or same-sequence reappearances", async (t) => {
  const { workspace, tempRoot, path } = setup(t);
  const file = join(tempRoot, "cancellation.ics");
  const input = {
    file,
    feedId: "cancel-first",
    title: "Synthetic",
    window,
    mappings: [],
  };
  writeFileSync(
    file,
    calendar(event("UID:synthetic-weekly\nSTATUS:CANCELLED\nSEQUENCE:3")),
  );
  const cancellation = await workspace.importCalendar(input);
  assert.equal(cancellation.sessions.length, 0);
  assert.equal(cancellation.feed.cancellations.length, 1);
  workspace.close();
  const { Workspace } = await import("../packages/core/src/index.js");
  const reopened = new Workspace(path);
  t.after(() => reopened.close());
  for (const sequence of [1, 3]) {
    writeFileSync(
      file,
      calendar(lecture.replace("SEQUENCE:1", `SEQUENCE:${sequence}`)),
    );
    const stale = await reopened.importCalendar(input);
    assert.equal(stale.sessions.length, 0);
    assert.equal(stale.feed.status, "partial");
    assert.equal(stale.feed.lastVerifiedAt, cancellation.feed.lastVerifiedAt);
  }
  writeFileSync(file, calendar(lecture.replace("SEQUENCE:1", "SEQUENCE:4")));
  const newer = await reopened.importCalendar(input);
  assert.equal(newer.feed.status, "complete");
  assert.equal(newer.sessions.length, 3);
  writeFileSync(
    file,
    calendar(
      event(
        "UID:synthetic-weekly\nRECURRENCE-ID;TZID=Europe/London:20301029T090000\nSEQUENCE:5",
      ),
    ).replace("VERSION:2.0", "VERSION:2.0\r\nMETHOD:CANCEL"),
  );
  const singleCancel = await reopened.importCalendar(input);
  assert.equal(
    singleCancel.sessions.filter((s) => s.status === "cancelled").length,
    1,
  );
  assert.equal(reopened.doctor().ok, true);
});

test("scans reject candidate files and tasks from surfaces outside the agreed scope", (t) => {
  const { workspace, file } = setup(t);
  const scan = workspace.prepareScan({ ...scope, surfaces: ["calendar"] });
  const base = {
    id: scan.id,
    expectedRevision: scan.revision,
    observations: observations(scan),
    files: [],
    tasks: [],
  };
  assert.throws(
    () =>
      workspace.recordScan({
        ...base,
        tasks: [{ task, surface: "assessments" }],
      }),
    /outside scan scope/,
  );
  assert.throws(
    () =>
      workspace.recordScan({
        ...base,
        files: [
          {
            source,
            surface: "content",
            file,
            expectedHash: sha256("# Synthetic slides\n\n---\n\nVersion one\n"),
          },
        ],
      }),
    /outside scan scope/,
  );
  assert.equal(workspace.getScan(scan.id).state, "prepared");
});

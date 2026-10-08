import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, chmodSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Workspace,
  dueDate,
  type Schedule,
} from "../packages/core/src/index.js";
import { setup } from "./helpers.js";
import { executeRun } from "../packages/scheduler/src/runner.js";

const scope = {
  adapter: "manual" as const,
  courseIds: ["DEMO101"],
  surfaces: ["content" as const],
};
function complete(workspace: Workspace, runId?: string) {
  const scan = workspace.prepareScan(scope, runId);
  const candidate = workspace.recordScan({
    id: scan.id,
    expectedRevision: scan.revision,
    files: [],
    tasks: [],
    observations: [
      {
        courseId: "DEMO101",
        surface: "content",
        status: "complete",
        reason: "observed",
        observedAt: new Date().toISOString(),
        evidence: "Original synthetic fixture fully inspected",
      },
    ],
  });
  return workspace.applyScan({
    id: candidate.id,
    expectedRevision: candidate.revision,
  });
}
function configure(workspace: Workspace) {
  const manual = complete(workspace);
  const now = new Date();
  return workspace.configureSchedule({
    expectedRevision: null,
    schedule: {
      id: "daily",
      scope,
      enabled: true,
      optIn: true,
      manualScanId: manual.id,
      timeZone: "UTC",
      localTime: now.toISOString().slice(11, 16),
    },
  });
}

test("daily scheduling requires opt-in and manual proof; claims persist, exact run evidence is required and cancellation prevents apply", (t) => {
  const { workspace, path } = setup(t);
  const manual = complete(workspace);
  const plan = {
    id: "daily",
    scope,
    enabled: true,
    optIn: false,
    manualScanId: manual.id,
    timeZone: "UTC",
    localTime: new Date().toISOString().slice(11, 16),
  };
  assert.throws(
    () =>
      workspace.configureSchedule({ schedule: plan, expectedRevision: null }),
    /opt-in/,
  );
  const configured = workspace.configureSchedule({
    schedule: { ...plan, optIn: true },
    expectedRevision: null,
  });
  const run = workspace.claimSchedule("daily");
  assert.ok(run);
  const secondConnection = new Workspace(path);
  assert.equal(secondConnection.claimSchedule("daily"), null);
  secondConnection.close();
  assert.throws(
    () => workspace.finishSchedule({ id: run.id, scanId: manual.id }),
    /this run/,
  );
  const candidate = workspace.prepareScan(scope, run.id);
  const recorded = workspace.recordScan({
    id: candidate.id,
    expectedRevision: candidate.revision,
    observations: [
      {
        courseId: "DEMO101",
        surface: "content",
        status: "complete",
        reason: "observed",
        observedAt: new Date().toISOString(),
        evidence: "Synthetic",
      },
    ],
    files: [],
    tasks: [],
  });
  workspace.configureSchedule({
    schedule: { ...plan, enabled: false, optIn: false },
    expectedRevision: configured.revision,
  });
  assert.throws(
    () =>
      workspace.applyScan({
        id: recorded.id,
        expectedRevision: recorded.revision,
      }),
    /cancelled/,
  );
  assert.equal(
    workspace.finishSchedule({
      id: run.id,
      failure: "Disabled by user during run",
    }).state,
    "cancelled",
  );
  assert.equal(workspace.claimSchedule("daily"), null);
});

test("daily wall time follows DST, has a bounded catch-up window, and chooses one overlap occurrence", () => {
  const plan: Schedule = {
    id: "daily",
    scope,
    enabled: true,
    optIn: true,
    manualScanId: "synthetic",
    timeZone: "Europe/London",
    localTime: "01:30",
    revision: "synthetic",
    updatedAt: "2030-01-01T00:00:00Z",
  };
  assert.equal(dueDate(plan, "2030-03-31T00:40:00Z"), null);
  assert.equal(dueDate(plan, "2030-03-31T01:31:00Z"), "2030-03-31");
  assert.equal(dueDate(plan, "2030-03-31T04:31:00Z"), null);
  assert.equal(dueDate(plan, "2030-10-27T00:31:00Z"), "2030-10-27");
  assert.equal(dueDate(plan, "2030-10-27T01:31:00Z"), "2030-10-27");
});

test("scheduler executes a real child process, verifies its linked scan and keeps process logs private", async (t) => {
  const { workspace, path, tempRoot } = setup(t);
  configure(workspace);
  const run = workspace.claimSchedule("daily");
  assert.ok(run);
  const script = join(tempRoot, "synthetic-codex");
  const module = pathToFileURL(resolve("dist/packages/core/src/index.js")).href;
  writeFileSync(
    script,
    `#!${process.execPath}\n(async () => {
    const { Workspace } = await import(${JSON.stringify(module)});
    const fs = await import('node:fs');
    const args = process.argv.slice(2); const root = args[args.indexOf('--cd') + 1];
    const w = new Workspace(root); const scan = w.prepareScan(${JSON.stringify(scope)}, ${JSON.stringify(run.id)});
    const c = w.recordScan({ id:scan.id, expectedRevision:scan.revision, files:[], tasks:[], observations:[{courseId:'DEMO101',surface:'content',status:'complete',reason:'observed',observedAt:new Date().toISOString(),evidence:'Synthetic browser fixture; no real school check'}] });
    w.applyScan({id:c.id,expectedRevision:c.revision}); w.close();
    fs.writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify({scanId:c.id}));
    console.log('Synthetic adapter executed');
  })().catch(e=>{console.error(e);process.exitCode=1});\n`,
  );
  chmodSync(script, 0o700);
  const result = await executeRun(path, run, script);
  assert.equal(result.state, "complete");
  assert.equal(workspace.claimSchedule("daily"), null);
  assert.match(
    readFileSync(
      join(workspace.storage, "runs", run.id, "process.log"),
      "utf8",
    ),
    /Synthetic adapter/,
  );
  assert.equal(workspace.snapshot().progress.length, 0);
});

test("successful process exit without an actual applied scan is a failed scheduled check", async (t) => {
  const { workspace, path, tempRoot } = setup(t);
  configure(workspace);
  const run = workspace.claimSchedule("daily");
  assert.ok(run);
  const script = join(tempRoot, "empty-codex");
  writeFileSync(script, `#!${process.execPath}\nprocess.exit(0);\n`);
  chmodSync(script, 0o700);
  assert.equal((await executeRun(path, run, script)).state, "failed");
  assert.equal(workspace.snapshot().scheduleRuns?.[0]?.state, "failed");
});

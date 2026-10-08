#!/usr/bin/env node
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { resolve } from "node:path";
import { Workspace } from "../../core/src/index.js";
import { executeRun } from "./runner.js";

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    once: { type: "boolean" },
    codex: { type: "string" },
  },
  strict: true,
});
if (!values.workspace)
  throw new Error(
    "Usage: scheduler --workspace PATH [--once] [--codex ABSOLUTE_EXECUTABLE]",
  );
const root = resolve(values.workspace);
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
do {
  const workspace = new Workspace(root);
  const ids = workspace.snapshot().schedules?.map((s) => s.id) ?? [];
  workspace.close();
  for (const id of ids) {
    if (stopping) break;
    const w = new Workspace(root);
    let run;
    try {
      run = w.claimSchedule(id);
    } finally {
      w.close();
    }
    if (run)
      console.log(JSON.stringify(await executeRun(root, run, values.codex)));
  }
  if (!values.once && !stopping) await setTimeout(30000);
} while (!values.once && !stopping);

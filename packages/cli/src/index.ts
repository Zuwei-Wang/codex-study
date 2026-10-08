#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readRegular } from "../../core/src/storage.js";
import { Workspace } from "../../core/src/index.js";

const usage = `Codex Study — local study workflow

study init --workspace PATH --config config.json
study course --workspace PATH --input course.json
study import --workspace PATH --input source.json --file slides.md
study task --workspace PATH --input task.json
study progress --workspace PATH --input progress.json
study attempt --workspace PATH --course COURSE_ID --source SOURCE_ID --input attempt.json
study snapshot --workspace PATH
study nav --workspace PATH
study doctor --workspace PATH
study upgrade --workspace PATH
study calendar --workspace PATH --input calendar.json
study scan-prepare --workspace PATH --input scope.json
study scan-record --workspace PATH --input observations.json
study scan-apply --workspace PATH --input scan.json
study schedule-configure --workspace PATH --input schedule.json
study schedule-finish --workspace PATH --input run-result.json
study read --workspace PATH --input reading.json
study note --workspace PATH --input note.json

All writes stay in PATH/.study. JSON inputs are validated; see examples/demo-workspace.
Browser observations require an authorized client connection. Daily scheduling is opt-in; notifications are not implemented.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      workspace: { type: "string" },
      config: { type: "string" },
      input: { type: "string" },
      file: { type: "string" },
      course: { type: "string" },
      source: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(usage);
    return;
  }
  if (positionals.length !== 1) throw new Error("Expected one command");
  const command = positionals[0]!;
  const allowed: Record<string, string[]> = {
    init: ["workspace", "config"],
    course: ["workspace", "input"],
    import: ["workspace", "input", "file"],
    task: ["workspace", "input"],
    progress: ["workspace", "input"],
    attempt: ["workspace", "course", "source", "input"],
    snapshot: ["workspace"],
    nav: ["workspace"],
    doctor: ["workspace"],
    upgrade: ["workspace"],
    calendar: ["workspace", "input"],
    "scan-prepare": ["workspace", "input"],
    "scan-record": ["workspace", "input"],
    "scan-apply": ["workspace", "input"],
    "schedule-configure": ["workspace", "input"],
    "schedule-finish": ["workspace", "input"],
    read: ["workspace", "input"],
    note: ["workspace", "input"],
  };
  if (!allowed[command]) throw new Error(`Unknown command: ${command}`);
  for (const key of Object.keys(values))
    if (!allowed[command]!.includes(key))
      throw new Error(`Unexpected option for ${command}: --${key}`);
  const required = (key: keyof typeof values): string => {
    const value = values[key];
    if (typeof value !== "string" || !value.length)
      throw new Error(`Missing --${key}`);
    return value;
  };
  for (const key of allowed[command]!) required(key as keyof typeof values);
  const json = (key: "input" | "config"): unknown =>
    JSON.parse(readRegular(required(key), 1024 * 1024).toString("utf8"));
  const workspace =
    command === "init"
      ? Workspace.initialize(required("workspace"), json("config"))
      : new Workspace(required("workspace"), {
          migrate: command === "upgrade",
        });
  try {
    let result: unknown;
    switch (command) {
      case "init":
        result = { root: workspace.root, workspaceSchema: 3 };
        break;
      case "course":
        result = workspace.putCourse(json("input"));
        break;
      case "import":
        result = workspace.importMaterial({
          source: json("input"),
          file: required("file"),
        });
        break;
      case "task":
        result = workspace.putTask(json("input"));
        break;
      case "progress":
        result = workspace.markProgress(json("input"));
        break;
      case "attempt":
        workspace.recordAttempt(
          required("course"),
          required("source"),
          json("input"),
        );
        result = { recorded: true };
        break;
      case "snapshot":
        result = workspace.snapshot();
        break;
      case "upgrade":
        result = { workspaceSchema: 3, integrity: workspace.doctor() };
        break;
      case "calendar":
        result = await workspace.importCalendar(json("input"));
        if ((result as { feed: { status: string } }).feed.status !== "complete")
          process.exitCode = 2;
        break;
      case "scan-prepare":
        result = workspace.prepareScan(json("input"));
        break;
      case "scan-record":
        result = workspace.recordScan(json("input"));
        break;
      case "scan-apply":
        result = workspace.applyScan(json("input"));
        if (
          (result as { result: { status: string } }).result.status !==
          "complete"
        )
          process.exitCode = 2;
        break;
      case "schedule-configure":
        result = workspace.configureSchedule(json("input"));
        break;
      case "schedule-finish":
        result = workspace.finishSchedule(json("input"));
        break;
      case "read":
        result = await workspace.readMaterial(json("input"));
        break;
      case "note":
        result = await workspace.saveNote(json("input"));
        break;
      case "nav":
        result = { path: workspace.navigation() };
        break;
      case "doctor": {
        const report = workspace.doctor();
        result = report;
        if (!report.ok) process.exitCode = 1;
        break;
      }
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    workspace.close();
  }
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

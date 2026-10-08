import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { temp } from "./helpers.js";

test("CLI completes documented synthetic workflow and reports misuse with nonzero exit codes", (t) => {
  const path = join(temp(t), "with spaces and 中文");
  const fixture = (name: string) => resolve("examples/demo-workspace", name);
  const run = (command: string, options: string[] = [], code = 0) => {
    const result = spawnSync(
      process.execPath,
      [
        resolve("dist/packages/cli/src/index.js"),
        command,
        "--workspace",
        path,
        ...options,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, code, result.stderr);
    return code === 0
      ? (JSON.parse(result.stdout) as Record<string, unknown>)
      : result.stderr;
  };
  run("init", ["--config", fixture("config.json")]);
  run("course", ["--input", fixture("course.json")]);
  run("import", [
    "--input",
    fixture("source.json"),
    "--file",
    fixture("fixtures/v1/intro.md"),
  ]);
  assert.equal(
    (
      run("import", [
        "--input",
        fixture("source.json"),
        "--file",
        fixture("fixtures/v1/intro.md"),
      ]) as Record<string, unknown>
    ).changed,
    false,
  );
  run("task", ["--input", fixture("task.json")]);
  run("progress", ["--input", fixture("progress.json")]);
  run("import", [
    "--input",
    fixture("source.json"),
    "--file",
    fixture("fixtures/v2/intro.md"),
  ]);
  run("attempt", [
    "--course",
    "DEMO101",
    "--source",
    "lecture-intro",
    "--input",
    fixture("attempt.json"),
  ]);
  assert.equal((run("doctor") as Record<string, unknown>).ok, true);
  assert.equal(
    existsSync(String((run("nav") as Record<string, unknown>).path)),
    true,
  );
  run("snapshot");
  run("task", [], 1);
  run("snapshot", ["--file", "unused.md"], 1);
  run("nonsense", [], 1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Workspace, officialDateState } from "../../packages/core/src/index.js";

const root = process.argv[2];
if (!root)
  throw new Error(
    "Usage: npm run demo -- /absolute/path/to/synthetic-workspace",
  );
const fixture = (path: string): string =>
  resolve("examples/demo-workspace", path);
const json = (path: string): unknown =>
  JSON.parse(readFileSync(fixture(path), "utf8"));
const workspace = Workspace.initialize(root, json("config.json"));
try {
  workspace.putCourse(json("course.json"));
  const source = json("source.json");
  const first = workspace.importMaterial({
    source,
    file: fixture("fixtures/v1/intro.md"),
  });
  const repeated = workspace.importMaterial({
    source,
    file: fixture("fixtures/v1/intro.md"),
  });
  assert.equal(repeated.changed, false);
  workspace.putTask(json("task.json"));
  workspace.markProgress(json("progress.json"));
  const updated = workspace.importMaterial({
    source,
    file: fixture("fixtures/v2/intro.md"),
  });
  workspace.putTask(json("task.json"));
  const snapshot = workspace.snapshot();
  assert.equal(snapshot.materials[0]?.versions.length, 2);
  assert.equal(snapshot.progress.length, 1);
  assert.equal(officialDateState(snapshot.tasks[0]!), "conflict");
  assert.equal(workspace.doctor().ok, true);
  console.log(
    JSON.stringify(
      {
        synthetic: true,
        root: workspace.root,
        first,
        repeated,
        updated,
        versions: snapshot.materials[0]?.versions.length,
        officialDeadlineState: "conflict",
        recordedProgress: snapshot.progress.map((p) => p.stage),
        navigation: workspace.navigation(),
        doctor: workspace.doctor(),
      },
      null,
      2,
    ),
  );
} finally {
  workspace.close();
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { setup, source } from "./helpers.js";

for (const point of ["object-durable", "before-commit", "after-commit"]) {
  test(`process death at ${point} recovers without missing files or duplicate versions`, (t) => {
    const { workspace, path, file } = setup(t);
    workspace.importMaterial({ source, file });
    writeFileSync(file, "# Changed synthetic revision");
    const killed = spawnSync(
      process.execPath,
      [resolve("dist/tests/crash-worker.js"), path, file, point],
      { encoding: "utf8" },
    );
    assert.equal(killed.signal, "SIGKILL", killed.stderr);
    const snapshot = workspace.snapshot();
    assert.equal(
      snapshot.materials[0]!.versions.length,
      point === "after-commit" ? 2 : 1,
    );
    assert.equal(workspace.doctor().ok, true);
    if (point !== "after-commit")
      assert.equal(workspace.doctor().recoverableFiles.length, 1);
    workspace.importMaterial({ source, file });
    workspace.importMaterial({ source, file });
    assert.equal(workspace.snapshot().materials[0]!.versions.length, 2);
    assert.deepEqual(workspace.doctor(), {
      ok: true,
      issues: [],
      recoverableFiles: [],
    });
  });
}

test("concurrent independent importers converge to a single source version", async (t) => {
  const { workspace, path, file } = setup(t);
  const run = () =>
    new Promise<void>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [
        resolve("dist/tests/crash-worker.js"),
        path,
        file,
        "no-crash",
      ]);
      let error = "";
      child.stderr.on("data", (chunk: Buffer) => {
        error += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolvePromise() : reject(new Error(error)),
      );
    });
  await Promise.all([run(), run(), run()]);
  assert.equal(workspace.snapshot().materials[0]!.versions.length, 1);
  assert.equal(workspace.doctor().ok, true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("hosted and fallback verification share the complete command contract and pinned tools", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const runner = readFileSync("scripts/ci.mjs", "utf8");
  const spec = JSON.parse(readFileSync("scripts/ci-commands.json", "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(workflow, /run: node scripts\/ci\.mjs/);
  assert.match(workflow, /node-version-file: \.node-version/);
  assert.match(workflow, /cat \.npm-version/);
  assert.match(runner, /scripts\/ci-commands\.json/);
  assert.match(runner, /Fallback requires a clean exact-commit checkout/);
  assert.deepEqual(spec, [
    { command: "npm", args: ["ci", "--ignore-scripts"] },
    { command: "npm", args: ["run", "format:check"] },
    { command: "npm", args: ["run", "typecheck"] },
    { command: "npm", args: ["run", "build"] },
    { command: "node", args: ["--test", "dist/tests/*.test.js"] },
    { command: "node", args: ["scripts/verify-codex.mjs"] },
    { command: "npm", args: ["run", "audit:public"] },
    { command: "npm", args: ["audit", "--audit-level=high"] },
    {
      command: "node",
      args: ["dist/examples/demo-workspace/demo.js", "tmp/ci-demo"],
    },
    { command: "node", args: ["dist/examples/demo-workspace/reminders.js"] },
  ]);
  for (const check of ["format:check", "typecheck", "test", "audit:public"])
    assert.ok(
      pkg.scripts.check.includes(
        `npm ${check === "test" ? "test" : `run ${check}`}`,
      ),
    );
  assert.ok(pkg.scripts.check.includes("npm audit --audit-level=high"));
  assert.equal(
    pkg.packageManager,
    `npm@${readFileSync(".npm-version", "utf8").trim()}`,
  );
});

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { Workspace } from "../dist/packages/core/src/index.js";

mkdirSync(".cache", { recursive: true });
const root = mkdtempSync(resolve(".cache/codex-acceptance-"));
const codexTestHome = join(root, "codex-config");
const project = join(root, "project");
mkdirSync(codexTestHome);
mkdirSync(project);
const env = {
  PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
  CODEX_HOME: codexTestHome,
};
// The child uses a dedicated Codex configuration directory. Parent config, credentials and skills are never copied.
const codex = resolve("node_modules/.bin/codex");
const run = (args) =>
  execFileSync(codex, args, {
    cwd: project,
    env,
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  });
const version = run(["--version"]).trim();
assert.equal(version, "codex-cli 0.144.4");
writeFileSync(
  join(codexTestHome, "config.toml"),
  'model_reasoning_effort = "low"\n',
);
const built = join(root, "built");
execFileSync(process.execPath, ["scripts/build-plugin.mjs", built], {
  encoding: "utf8",
});
const marketplace = join(root, "relocated-marketplace");
renameSync(built, marketplace);
run(["plugin", "marketplace", "add", marketplace]);
const install = JSON.parse(
  run(["plugin", "add", "codex-study@codex-study-local", "--json"]),
);
writeFileSync(join(root, "install.json"), JSON.stringify(install, null, 2));

let sessionNumber = 0;
async function appSession() {
  const sessionLogs = join(root, `session-${++sessionNumber}`);
  mkdirSync(sessionLogs);
  const processHandle = spawn(codex, ["app-server", "--stdio"], {
    cwd: project,
    env,
  });
  const pending = new Map();
  let sequence = 0;
  let stderr = "";
  let events = "";
  let transcript = "";
  processHandle.stderr.on("data", (data) => {
    stderr += data;
  });
  const exited = new Promise((done) => processHandle.once("close", done));
  const lines = createInterface({ input: processHandle.stdout });
  lines.on("line", (line) => {
    transcript += line + "\n";
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!("id" in value)) events += line + "\n";
    if (pending.has(value.id)) {
      const job = pending.get(value.id);
      pending.delete(value.id);
      clearTimeout(job.timer);
      if (value.error) job.reject(new Error(JSON.stringify(value.error)));
      else job.resolve(value.result);
    }
  });
  const request = (method, params) =>
    new Promise((resolveResult, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, 45000);
      pending.set(id, { resolve: resolveResult, reject, timer });
      processHandle.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  const close = async () => {
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error("Codex session closed"));
    }
    pending.clear();
    lines.close();
    processHandle.stdin.end();
    const killTimer = setTimeout(() => processHandle.kill("SIGKILL"), 3000);
    processHandle.kill();
    await exited;
    clearTimeout(killTimer);
    writeFileSync(join(sessionLogs, "app-server.log"), stderr);
    writeFileSync(join(sessionLogs, "events.jsonl"), events);
    writeFileSync(join(sessionLogs, "responses.jsonl"), transcript);
  };
  try {
    await request("initialize", {
      clientInfo: { name: "codex-study-acceptance", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    });
    processHandle.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const skills = await request("skills/list", {
      cwds: [project],
      forceReload: true,
    });
    writeFileSync(
      join(sessionLogs, "skills.json"),
      JSON.stringify(skills, null, 2),
    );
    const thread = await request("thread/start", {
      cwd: project,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "workspace-write",
    });
    const threadId = thread.thread.id;
    let servers;
    for (let attempt = 0; attempt < 30; attempt++) {
      servers = await request("mcpServerStatus/list", { threadId });
      if (servers.data?.some((s) => Object.keys(s.tools ?? {}).length)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
    writeFileSync(
      join(sessionLogs, "servers.json"),
      JSON.stringify(servers, null, 2),
    );
    const entries = servers.data ?? [];
    const server = entries.find((s) =>
      Object.values(s.tools ?? {}).some(
        (tool) => tool.name === "study_initialize",
      ),
    );
    assert.ok(
      server,
      `Codex did not discover study tools: ${JSON.stringify(servers)}`,
    );
    assert.equal(Object.keys(server.tools).length, 14);
    for (const name of [
      "study-setup",
      "study-update-materials",
      "study-prepare-class",
      "study-learn-slides",
      "study-self-test",
      "study-weekly-review",
    ]) {
      assert.ok(
        JSON.stringify(skills).includes(`"name":"codex-study:${name}"`),
        `Codex did not discover skill ${name}`,
      );
    }
    const call = async (tool, args) => {
      const result = await request("mcpServer/tool/call", {
        threadId,
        server: server.name,
        tool,
        arguments: args,
      });
      const payload = result.result ?? result;
      assert.notEqual(payload.isError, true, JSON.stringify(payload));
      assert.ok(payload.content, JSON.stringify(result));
      return JSON.parse(payload.content.find((c) => c.type === "text").text);
    };
    return { call, close, toolCount: Object.keys(server.tools).length };
  } catch (error) {
    await close();
    throw error;
  }
}

const workspacePath = join(project, "learning-data");
const json = (file) =>
  JSON.parse(readFileSync(`examples/demo-workspace/${file}`, "utf8"));
let session = await appSession();
try {
  await session.call("study_capabilities", {});
  await session.call("study_initialize", {
    workspace: workspacePath,
    config: json("config.json"),
  });
  await session.call("study_course_put", {
    workspace: workspacePath,
    course: json("course.json"),
  });
  const imported = await session.call("study_import", {
    workspace: workspacePath,
    source: json("source.json"),
    file: resolve("examples/demo-workspace/fixtures/v1/intro.md"),
  });
  const reading = await session.call("study_read_material", {
    workspace: workspacePath,
    reading: {
      courseId: "DEMO101",
      sourceId: "lecture-intro",
      hash: imported.hash,
      start: 2,
      count: 1,
    },
  });
  assert.match(reading.parts[0].text, /A label is not an identity/);
  await session.call("study_note_save", {
    workspace: workspacePath,
    expectedRevision: null,
    note: {
      schemaVersion: 1,
      courseId: "DEMO101",
      id: "identity",
      title: "Synthetic identity lesson",
      coverage: { basis: "published-material" },
      sections: [
        {
          kind: "material",
          body: "The synthetic slides distinguish a label from a stable identity.",
          citations: [
            {
              sourceId: "lecture-intro",
              hash: imported.hash,
              unit: "section",
              start: 2,
              end: 2,
              quote: "A label is not an identity.",
            },
          ],
        },
      ],
    },
  });
  await session.call("study_task_put", {
    workspace: workspacePath,
    task: json("task.json"),
  });
  await session.call("study_progress_mark", {
    workspace: workspacePath,
    progress: json("progress.json"),
  });
  assert.equal(
    (await session.call("study_doctor", { workspace: workspacePath })).ok,
    true,
  );
} finally {
  await session.close();
}
const beforeWorkspace = new Workspace(workspacePath);
const before = beforeWorkspace.snapshot();
beforeWorkspace.close();
writeFileSync(
  join(project, "personal-note.md"),
  "Synthetic user-owned note: preserve exactly.",
);
const configBefore = readFileSync(join(codexTestHome, "config.toml"), "utf8");

// Replace the installed copy from a newer package, keeping workspace data outside its lifecycle.
for (const file of ["plugin.json", ".codex-plugin/plugin.json"]) {
  const path = join(marketplace, "plugins/codex-study", file);
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.version = "0.2.1-test";
  writeFileSync(path, JSON.stringify(value));
}
const upgrade = JSON.parse(
  run(["plugin", "add", "codex-study@codex-study-local", "--json"]),
);
assert.equal(upgrade.version, "0.2.1-test");
assert.notEqual(upgrade.installedPath, install.installedPath);
writeFileSync(join(root, "upgrade.json"), JSON.stringify(upgrade, null, 2));
assert.equal(
  readFileSync(join(codexTestHome, "config.toml"), "utf8"),
  configBefore,
);
session = await appSession();
try {
  const after = await session.call("study_snapshot", {
    workspace: workspacePath,
  });
  assert.deepEqual(after, before);
  assert.equal(
    readFileSync(join(project, "personal-note.md"), "utf8"),
    "Synthetic user-owned note: preserve exactly.",
  );
  assert.equal(
    (await session.call("study_doctor", { workspace: workspacePath })).ok,
    true,
  );
} finally {
  await session.close();
}
const evidence = {
  schemaVersion: 1,
  codex: version,
  passed: true,
  assertions: [
    "relocated self-contained package",
    "real Codex plugin install",
    "six skills and fourteen tools discovered",
    "real Codex MCP calls for setup/import/read/cited note/task/progress",
    "plugin refresh preserves records and local config",
  ],
  limits: [
    "No model turn or AI teaching quality evaluated; notes use original synthetic text.",
    "No production credentials, browser sessions, schedules or notification services used.",
  ],
};
writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify(
    { ...evidence, evidence: join(root, "evidence.json") },
    null,
    2,
  ),
);

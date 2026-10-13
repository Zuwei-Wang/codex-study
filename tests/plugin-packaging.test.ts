import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { config, temp } from "./helpers.js";

test("desktop package works without Node on PATH and refuses to overwrite an existing package", async (t) => {
  const root = temp(t);
  const output = join(root, "marketplace with spaces");
  const args = ["scripts/build-plugin.mjs", "--desktop", output];
  const built = JSON.parse(
    execFileSync(process.execPath, args, { encoding: "utf8" }),
  );
  const portable = JSON.parse(
    readFileSync(join(built.plugin, "mcp.json"), "utf8"),
  );
  const legacy = JSON.parse(
    readFileSync(join(built.plugin, ".mcp.json"), "utf8"),
  );
  assert.equal(built.mode, "desktop-local");
  assert.equal(existsSync(join(built.plugin, "plugin.json")), false);
  const compatibility = JSON.parse(
    readFileSync(join(built.plugin, ".codex-plugin/plugin.json"), "utf8"),
  );
  assert.equal(compatibility.mcpServers, "./.mcp.json");
  assert.equal(
    portable.mcpServers.study.command,
    realpathSync(process.execPath),
  );
  assert.equal(
    legacy.mcpServers.study.command,
    portable.mcpServers.study.command,
  );
  const original = readFileSync(join(built.plugin, "mcp.json"));
  const repeat = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /output already exists/);
  assert.deepEqual(readFileSync(join(built.plugin, "mcp.json")), original);
  // The public template must remain portable and contain no builder's local path.
  assert.equal(
    JSON.parse(readFileSync("plugins/codex-study/mcp.json", "utf8")).mcpServers
      .study.command,
    "node",
  );

  const server = portable.mcpServers.study;
  const client = new Client({
    name: "desktop-launch-regression",
    version: "1",
  });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: resolve(built.plugin, server.cwd),
    env: { PATH: join(root, "no-node-on-path") },
    stderr: "pipe",
  });
  t.after(async () => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 22);
  const workspace = join(root, "learning workspace");
  const initialized = await client.callTool({
    name: "study_initialize",
    arguments: { workspace, config },
  });
  assert.notEqual(initialized.isError, true, JSON.stringify(initialized));
  const checked = await client.callTool({
    name: "study_doctor",
    arguments: { workspace },
  });
  assert.notEqual(checked.isError, true);
  const content = checked.content as { type: string; text: string }[];
  assert.equal(JSON.parse(content[0]!.text).ok, true);
});

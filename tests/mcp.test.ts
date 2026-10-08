import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { config, course, source, temp } from "./helpers.js";
import { sampleNote } from "./learning-fixture.js";

test("real stdio MCP handshake, typed tools, reading, citations and errors work end to end", async (t) => {
  const root = temp(t),
    path = join(root, "learner"),
    install = join(root, "installed");
  mkdirSync(install);
  const client = new Client({
    name: "synthetic-study-client",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/packages/mcp/src/index.js")],
    env: { ...process.env, CODEX_STUDY_INSTALL_ROOT: install },
    stderr: "pipe",
  });
  await client.connect(transport);
  t.after(async () => {
    await client.close();
  });
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 14);
  assert.equal(
    tools.tools.find((x) => x.name === "study_read_material")?.annotations
      ?.readOnlyHint,
    true,
  );
  assert.equal(
    tools.tools.find((x) => x.name === "study_note_save")?.annotations
      ?.readOnlyHint,
    false,
  );
  async function call(
    name: string,
    args: Record<string, unknown>,
    error = false,
  ) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError === true, error, JSON.stringify(result));
    const content = result.content as { type: string; text: string }[];
    return error ? content[0]!.text : JSON.parse(content[0]!.text);
  }
  await call("study_initialize", { workspace: install, config }, true);
  await call("study_initialize", { workspace: path, config });
  await call("study_course_put", { workspace: path, course });
  const file = join(root, "slides.md");
  writeFileSync(file, "# Synthetic slides\n---\nVersion one");
  const imported = await call("study_import", {
    workspace: path,
    source,
    file,
  });
  const reading = await call("study_read_material", {
    workspace: path,
    reading: {
      courseId: source.courseId,
      sourceId: source.id,
      hash: imported.hash,
      start: 2,
      count: 1,
    },
  });
  assert.equal(reading.parts[0].text.trim(), "Version one");
  const saved = await call("study_note_save", {
    workspace: path,
    note: sampleNote(imported.hash),
    expectedRevision: null,
  });
  assert.ok(saved.record.revision);
  const snapshot = await call("study_snapshot", { workspace: path });
  assert.equal(snapshot.notes.length, 1);
  assert.equal(snapshot.progress.length, 0);
  await call(
    "study_course_put",
    { workspace: path, course: { ...course, id: "../escape" } },
    true,
  );
  assert.equal((await call("study_doctor", { workspace: path })).ok, true);
});

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
const commit = execFileSync(
  "git",
  ["rev-parse", "386d8babc6d55119aaac4bb998eb1a303cc348de^{commit}"],
  { encoding: "utf8" },
).trim();
const tree = execFileSync("git", ["rev-parse", `${commit}^{tree}`], {
  encoding: "utf8",
}).trim();
const output = resolve(process.argv[2] ?? "docs/demo.cast");
if (existsSync(output))
  throw new Error(
    "Choose a new recording path; existing recordings are preserved",
  );
mkdirSync(".cache", { recursive: true });
const root = mkdtempSync(resolve(".cache/demo-recording-")),
  source = join(root, "source"),
  workspace = join(root, "synthetic-workspace");
mkdirSync(source);
const archive = execFileSync("git", ["archive", commit]);
execFileSync("tar", ["-x", "-C", source], { input: archive });
const started = performance.now();
const frames = [];
const write = (value) =>
  frames.push([
    Number(((performance.now() - started) / 1000).toFixed(3)),
    "o",
    value
      .replaceAll(workspace, "[SYNTHETIC_WORKSPACE]")
      .replaceAll(source, "[CLEAN_SOURCE]")
      .replaceAll(root, "[RECORDING_DIRECTORY]")
      .replaceAll(resolve("."), "[PROJECT_CHECKOUT]")
      .replaceAll("\n", "\r\n"),
  ]);
async function run(command, args, display) {
  write(`$ ${display}\n`);
  await new Promise((resolveExit, reject) => {
    const child = spawn(command, args, {
      cwd: source,
      env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
    });
    child.stdout.on("data", (data) => write(data.toString()));
    child.stderr.on("data", (data) => write(data.toString()));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolveExit()
        : reject(new Error(`Recorded command failed: ${code}`)),
    );
  });
}
await run("npm", ["ci", "--ignore-scripts"], "npm ci --ignore-scripts");
await run(
  "npm",
  ["run", "demo", "--", workspace],
  'npm run demo -- "[SYNTHETIC_WORKSPACE]"',
);
await run(
  "node",
  ["dist/examples/demo-workspace/demo.js", workspace],
  'node dist/examples/demo-workspace/demo.js "[SYNTHETIC_WORKSPACE]"',
);
const header = {
  version: 2,
  width: 120,
  height: 40,
  timestamp: Math.floor(Date.now() / 1000),
  title: "Codex Study M3 synthetic local demo",
  env: { TERM: "xterm-256color" },
  sourceCommit: commit,
  sourceTree: tree,
  synthetic: true,
  pathRedaction:
    "Only machine-specific paths replaced; remaining output captured from actual successful commands.",
};
writeFileSync(
  output,
  [header, ...frames].map((row) => JSON.stringify(row)).join("\n") + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    recording: output,
    sourceCommit: commit,
    sourceTree: tree,
    frames: frames.length,
    commands: 3,
    allExitCodes: 0,
  }),
);

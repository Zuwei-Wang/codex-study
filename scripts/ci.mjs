import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { platform, release, arch } from "node:os";

const command = (name, args) =>
  execFileSync(name, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const fallback = process.argv.includes("--fallback");
const reasons = [
  "quota",
  "billing",
  "platform-incident",
  "runner-provisioning",
];
const reasonIndex = process.argv.indexOf("--reason");
const reason = reasonIndex < 0 ? null : process.argv[reasonIndex + 1];
if (fallback && !reasons.includes(reason))
  throw new Error(
    "Fallback requires --reason quota|billing|platform-incident|runner-provisioning and independent hosted-job evidence",
  );
const expectedNode = readFileSync(".node-version", "utf8").trim();
const expectedNpm = readFileSync(".npm-version", "utf8").trim();
const npm = command("npm", ["--version"]);
if (process.versions.node !== expectedNode || npm !== expectedNpm)
  throw new Error(`Use Node ${expectedNode} and npm ${expectedNpm}`);
const status = command("git", [
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
]);
if (fallback && status)
  throw new Error("Fallback requires a clean exact-commit checkout");
const safeGit = (args) => {
  try {
    return command("git", args);
  } catch {
    return null;
  }
};
const startedAt = new Date().toISOString();
const output = resolve(".cache/verification", startedAt.replaceAll(":", "-"));
mkdirSync(output, { recursive: true });
const report = {
  schemaVersion: 1,
  mode: fallback ? "fallback" : "standard",
  reason,
  startedAt,
  commit: safeGit(["rev-parse", "HEAD"]),
  tree: safeGit(["rev-parse", "HEAD^{tree}"]),
  workspaceBefore: status,
  node: process.version,
  npm,
  platform: { os: platform(), release: release(), arch: arch() },
  lockSha256: createHash("sha256")
    .update(readFileSync("package-lock.json"))
    .digest("hex"),
  limitations: [
    "Only this OS, architecture and local filesystem were exercised.",
    "SIGKILL tests are not hardware power-loss tests; no network filesystem or Windows support is claimed.",
    "No browser, school platform, Codex installation or real notification delivery is tested.",
    "Local evidence is not GitHub required-check success and grants no merge, deployment or publication authority.",
  ],
  commands: [],
};
const save = () =>
  writeFileSync(
    join(output, "evidence.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
save();
const commands = JSON.parse(readFileSync("scripts/ci-commands.json", "utf8"));
for (const [index, spec] of commands.entries()) {
  const logPath = join(output, `${index + 1}.log`);
  const log = createWriteStream(logPath);
  console.log(`Running: ${spec.command} ${spec.args.join(" ")}`);
  const result = await new Promise((resolveResult) => {
    const child = spawn(spec.command, spec.args, { env: process.env });
    child.stdout.on("data", (data) => {
      log.write(data);
      process.stdout.write(data);
    });
    child.stderr.on("data", (data) => {
      log.write(data);
      process.stderr.write(data);
    });
    child.on("error", (error) => log.write(String(error)));
    child.on("close", (exitCode, signal) =>
      log.end(() => resolveResult({ exitCode, signal })),
    );
  });
  report.commands.push({ ...spec, ...result, log: logPath });
  save();
  if (result.exitCode !== 0) {
    process.exitCode = 1;
    break;
  }
}
report.workspaceAfter = command("git", [
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
]);
report.commitAfter = safeGit(["rev-parse", "HEAD"]);
report.treeAfter = safeGit(["rev-parse", "HEAD^{tree}"]);
report.nodeAfter = command("node", ["--version"]);
report.npmAfter = command("npm", ["--version"]);
report.lockSha256After = createHash("sha256")
  .update(readFileSync("package-lock.json"))
  .digest("hex");
report.installedTools = Object.fromEntries(
  ["typescript", "prettier", "zod", "@types/node"].map((name) => {
    try {
      return [
        name,
        JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"))
          .version,
      ];
    } catch {
      return [name, null];
    }
  }),
);
report.finishedAt = new Date().toISOString();
report.complete =
  report.commands.length === commands.length &&
  report.commands.every((c) => c.exitCode === 0) &&
  report.workspaceBefore === report.workspaceAfter &&
  report.commit === report.commitAfter &&
  report.tree === report.treeAfter &&
  report.node === report.nodeAfter &&
  report.npm === report.npmAfter &&
  report.lockSha256 === report.lockSha256After;
if (fallback && (!report.commit || !report.tree || report.workspaceAfter))
  report.complete = false;
if (!report.complete) process.exitCode = 1;
save();
console.log(`Verification evidence: ${join(output, "evidence.json")}`);

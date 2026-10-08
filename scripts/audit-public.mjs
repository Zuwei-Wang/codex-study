import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

// A narrow automated guard complements human review; it does not prove absence of all secrets.
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
];
const forbiddenPath =
  /(^|\/)(\.env(?:\..*)?|\.study|private|data|workspaces?|backups|node_modules|dist)(\/|$)|\.(?:sqlite(?:-journal|-wal|-shm)?|pem|key|p12|log)$/i;
const patterns = [
  /\/(?:Users|home)\/[a-zA-Z0-9_-]+\//,
  /gh[pousr]_[a-zA-Z0-9]{30,}/,
  /github_pat_[a-zA-Z0-9_]{40,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /\bsk-[a-zA-Z0-9]{32,}/,
];
const issues = [];
for (const file of files) {
  if (forbiddenPath.test(file) || /(?:browser|storage)-state\.json$/.test(file))
    issues.push(`${file}: forbidden publish path`);
  const stat = lstatSync(file);
  if (!stat.isFile()) {
    issues.push(`${file}: not a regular file`);
    continue;
  }
  const bytes = readFileSync(file);
  if (bytes.includes(0)) {
    issues.push(`${file}: binary file requires explicit review policy`);
    continue;
  }
  const content = bytes.toString("utf8");
  for (const pattern of patterns)
    if (pattern.test(content))
      issues.push(`${file}: possible private content (${pattern.source})`);
}
if (issues.length) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Public-source guard passed for ${files.length} files. Human provenance review is still required.`,
  );

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";

const output = resolve(process.argv[2] ?? "build/marketplace");
if (existsSync(output))
  throw new Error(
    "Plugin output already exists. Choose a new directory so previous packages and local changes are preserved.",
  );
const plugin = join(output, "plugins/codex-study");
if (!existsSync("dist/packages/mcp/src/index.js"))
  throw new Error("Run npm run build first");
mkdirSync(plugin, { recursive: true });
cpSync("plugins/codex-study", plugin, { recursive: true });
cpSync("dist/packages", join(plugin, "runtime/packages"), { recursive: true });
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(
  join(plugin, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      type: "module",
      private: true,
      license: pkg.license,
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ) + "\n",
);
cpSync("LICENSE", join(plugin, "LICENSE"));
cpSync("package-lock.json", join(plugin, "source-package-lock.json"));
// Copy the installed production dependency closure, including licenses and optional platform binaries.
// No lifecycle scripts or network requests run during packaging or plugin startup.
const rootModules = resolve("node_modules");
const paths = execFileSync(
  "npm",
  ["ls", "--omit=dev", "--all", "--parseable"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
for (const path of [...new Set(paths)]
  .filter((p) => p.startsWith(rootModules + "/"))
  .sort((a, b) => a.length - b.length)) {
  const destination = join(plugin, "node_modules", relative(rootModules, path));
  if (existsSync(destination)) continue;
  mkdirSync(join(destination, ".."), { recursive: true });
  cpSync(path, destination, { recursive: true });
}
mkdirSync(join(output, ".agents/plugins"), { recursive: true });
writeFileSync(
  join(output, ".agents/plugins/marketplace.json"),
  JSON.stringify(
    {
      name: "codex-study-local",
      interface: { displayName: "Codex Study (local)" },
      plugins: [
        {
          name: "codex-study",
          source: { source: "local", path: "./plugins/codex-study" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      marketplace: output,
      plugin,
      version: pkg.version,
      runtime:
        "Node.js 24.21+ in the Node 24 line; package is built for this OS/architecture",
    },
    null,
    2,
  ),
);

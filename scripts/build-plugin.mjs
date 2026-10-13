import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";

const args = process.argv.slice(2);
const desktop = args.includes("--desktop");
const positional = args.filter((arg) => arg !== "--desktop");
if (positional.length > 1 || positional.some((arg) => arg.startsWith("--")))
  throw new Error("Usage: node scripts/build-plugin.mjs [--desktop] [output]");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 21)
  throw new Error("Build with Node.js 24.21 or later in the Node 24 line.");
const output = resolve(
  positional[0] ??
    (desktop ? "build/desktop-marketplace" : "build/marketplace"),
);
if (existsSync(output))
  throw new Error(
    "Plugin output already exists. Choose a new directory so previous packages and local changes are preserved.",
  );
const plugin = join(output, "plugins/codex-study");
if (!existsSync("dist/packages/mcp/src/index.js"))
  throw new Error("Run npm run build first");
mkdirSync(plugin, { recursive: true });
cpSync("plugins/codex-study", plugin, { recursive: true });
// GUI launches need not inherit a terminal's version-manager PATH. Bind only the
// generated, machine-local package; portable source templates remain unchanged.
const nodeExecutable = desktop ? realpathSync(process.execPath) : "node";
if (desktop) {
  // The tested desktop backend discovers Skills but omits bundled stdio MCP
  // servers with the portable root manifest. Its supported compatibility
  // manifest discovers both. Remove only the freshly copied root manifest.
  unlinkSync(join(plugin, "plugin.json"));
  for (const name of ["mcp.json", ".mcp.json"]) {
    const file = join(plugin, name);
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.mcpServers.study.command = nodeExecutable;
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  }
}
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
      mode: desktop ? "desktop-local" : "portable",
      nodeExecutable,
      ...(desktop
        ? {
            limits:
              "Machine-local package: retain this Node installation and marketplace directory. Rebuild on another machine or after moving Node. Desktop UI acceptance is separate.",
          }
        : {}),
      runtime:
        "Node.js 24.21+ in the Node 24 line; package is built for this OS/architecture",
    },
    null,
    2,
  ),
);

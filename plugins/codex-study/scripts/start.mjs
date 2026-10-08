import { fileURLToPath } from "node:url";
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 21) {
  console.error(
    "Codex Study requires Node.js 24.21 or later in the Node 24 line. Select the documented runtime and restart Codex.",
  );
  process.exit(1);
}
process.env.CODEX_STUDY_INSTALL_ROOT = fileURLToPath(
  new URL("..", import.meta.url),
);
try {
  await import("../runtime/packages/mcp/src/index.js");
} catch (error) {
  console.error(
    "Codex Study could not start. Rebuild the plugin package with npm run plugin:build; do not install the source template directly.",
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

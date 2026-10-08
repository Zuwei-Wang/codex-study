import { Workspace, type Checkpoint } from "../packages/core/src/index.js";
import { source } from "./helpers.js";
const [path, file, point] = process.argv.slice(2);
const workspace = new Workspace(path!, {
  checkpoint: (current) => {
    if (current === (point as Checkpoint)) process.kill(process.pid, "SIGKILL");
  },
});
try {
  workspace.importMaterial({ source, file: file! });
} finally {
  workspace.close();
}

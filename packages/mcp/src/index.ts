#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createStudyServer } from "./server.js";

const installationRoot =
  process.env.CODEX_STUDY_INSTALL_ROOT ??
  fileURLToPath(new URL("../../../..", import.meta.url));
serveStdio(() => createStudyServer(installationRoot));

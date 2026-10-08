#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isAbsolute, relative, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { ReminderService } from "./service.js";
import { MockMailProvider, ResendProvider } from "./provider.js";
import { reminderHttpServer } from "./http.js";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    directory: { type: "string" },
    origin: { type: "string" },
    provider: { type: "string", default: "synthetic" },
    port: { type: "string", default: "8788" },
  },
});
if (
  !["serve", "provision"].includes(positionals[0] ?? "") ||
  positionals.length !== 1 ||
  !values.directory ||
  !isAbsolute(values.directory) ||
  !values.origin
)
  throw new Error(
    "Usage: reminders serve|provision --directory ABSOLUTE_PRIVATE_DIRECTORY --origin HTTPS_ORIGIN [--provider synthetic|resend] [--port 8788]",
  );
if (!["synthetic", "resend"].includes(values.provider!))
  throw new Error("Unknown mail provider");
// Live storage must be outside this checkout; operators own a separate database and credentials.
if (values.provider === "resend") {
  const candidate = resolve(values.directory),
    rel = relative(realpathSync(process.cwd()), candidate);
  if (!rel.startsWith("..") && !isAbsolute(rel))
    throw new Error(
      "Live reminder data must be outside the current source checkout",
    );
  if (process.env.STUDY_REMINDER_LIVE !== "1")
    throw new Error(
      "Explicit STUDY_REMINDER_LIVE=1 is required for the real mail adapter",
    );
}
const provider =
  values.provider === "resend"
    ? new ResendProvider(
        process.env.RESEND_API_KEY ?? "",
        process.env.STUDY_REMINDER_FROM ?? "",
      )
    : new MockMailProvider();
const service = new ReminderService(values.directory, provider, values.origin);
if (positionals[0] === "provision") {
  try {
    console.log(JSON.stringify(service.provision()));
  } finally {
    service.close();
  }
} else {
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    service.close();
    throw new Error("Invalid port");
  }
  const server = reminderHttpServer(service);
  const timer = setInterval(() => {
    void service
      .tick()
      .catch(() =>
        console.error(
          "Reminder worker failed; inspect private service storage",
        ),
      );
  }, 15000);
  server.listen(port, "127.0.0.1", () =>
    console.log(
      JSON.stringify({
        listening: `127.0.0.1:${port}`,
        providerMode: provider.mode,
      }),
    ),
  );
  const shutdown = () => {
    clearInterval(timer);
    server.close(() => {
      void service.exclusive(() => service.close());
    });
  };
  server.on("error", () => {
    clearInterval(timer);
    service.close();
    process.exitCode = 1;
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

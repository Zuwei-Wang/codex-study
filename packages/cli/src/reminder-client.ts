#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readRegular } from "../../core/src/storage.js";
import { reminderProjectionSchema } from "../../core/src/reminders.js";
const { values } = parseArgs({
  options: {
    endpoint: { type: "string" },
    "token-file": { type: "string" },
    operation: { type: "string" },
    input: { type: "string" },
    synthetic: { type: "boolean" },
  },
});
const operations: Record<string, [string, string]> = {
  state: ["GET", "/v1/state"],
  recipient: ["PUT", "/v1/recipient"],
  verify: ["POST", "/v1/recipient/verify"],
  preferences: ["PUT", "/v1/preferences"],
  sync: ["POST", "/v1/sync"],
  receipt: ["POST", "/v1/receipt"],
};
const operation = operations[values.operation ?? ""];
if (!operation || !values.endpoint || !values["token-file"])
  throw new Error(
    "Use --endpoint ORIGIN --token-file PRIVATE_FILE --operation state|recipient|verify|preferences|sync|receipt [--input JSON] [--synthetic]",
  );
const endpoint = new URL(values.endpoint);
if (
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash ||
  endpoint.pathname !== "/" ||
  (endpoint.protocol !== "https:" &&
    !(
      values.synthetic &&
      endpoint.protocol === "http:" &&
      endpoint.hostname === "127.0.0.1"
    ))
)
  throw new Error("Use HTTPS, or explicitly synthetic loopback HTTP");
const token = readRegular(values["token-file"], 1024).toString("utf8").trim();
if (!/^[a-f0-9]{64}$/.test(token))
  throw new Error("Invalid account token file");
const input: unknown = values.input
  ? JSON.parse(readRegular(values.input, 128 * 1024).toString("utf8"))
  : undefined;
if (operation[0] !== "GET" && input === undefined)
  throw new Error("This operation requires --input");
if (values.operation === "sync") reminderProjectionSchema.parse(input);
const response = await fetch(new URL(operation[1], endpoint), {
  method: operation[0],
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  redirect: "error",
  signal: AbortSignal.timeout(20000),
});
console.log(await response.text());
if (!response.ok) process.exitCode = 1;

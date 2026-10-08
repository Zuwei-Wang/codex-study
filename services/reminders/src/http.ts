import { createServer, type IncomingMessage } from "node:http";
import { ZodError } from "zod";
import { ReminderService, ServiceError } from "./service.js";
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new ServiceError(415, "Use application/json");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > 128 * 1024)
      throw new ServiceError(413, "Request exceeds limit");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ServiceError(400, "Invalid JSON");
  }
}
export function reminderHttpServer(service: ReminderService) {
  const requests = new Map<string, { at: number; count: number }>();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    try {
      const now = Date.now();
      for (const [key, value] of requests)
        if (now - value.at > 60000) requests.delete(key);
      const key = request.socket.remoteAddress ?? "unknown";
      const rate = requests.get(key) ?? { at: now, count: 0 };
      rate.count++;
      requests.set(key, rate);
      if (rate.count > 120 || requests.size > 1000)
        throw new ServiceError(429, "Request limit reached");
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (/^\/unsubscribe\/[a-f0-9]{64}$/.test(path)) {
        if (request.method === "GET") {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(
            '<!doctype html><meta name="viewport" content="width=device-width"><title>Stop study reminders</title><h1>Stop study reminders</h1><form method="post"><button type="submit">Turn off all reminders</button></form>',
          );
          return;
        }
        if (request.method !== "POST")
          throw new ServiceError(405, "Use POST to unsubscribe");
        await service.exclusive(() =>
          service.unsubscribe(path.slice("/unsubscribe/".length)),
        );
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("Reminders are disabled.");
        return;
      }
      const id = service.authenticate(
        (request.headers.authorization ?? "").replace(/^Bearer /, ""),
      );
      const input = request.method === "GET" ? undefined : await body(request);
      const result = await service.exclusive(() => {
        switch (`${request.method} ${path}`) {
          case "GET /v1/state":
            return service.state(id);
          case "PUT /v1/recipient":
            return service.requestRecipient(id, input);
          case "POST /v1/recipient/verify":
            return service.verifyRecipient(id, input);
          case "PUT /v1/preferences":
            return service.preferences(id, input);
          case "POST /v1/sync":
            return service.sync(id, input);
          case "POST /v1/receipt":
            return service.received(id, input);
          default:
            throw new ServiceError(404, "Unknown operation");
        }
      });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode =
        error instanceof ServiceError
          ? error.status
          : error instanceof ZodError
            ? 400
            : 500;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          error:
            error instanceof ServiceError
              ? error.message
              : error instanceof ZodError
                ? "Input does not match the contract"
                : "Service operation failed",
        }),
      );
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  return server;
}

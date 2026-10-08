import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setup, temp, source, task } from "./helpers.js";
import {
  previewReminders,
  reminderProjectionSchema,
  type ReminderProjection,
} from "../packages/core/src/reminders.js";
import { sha256 } from "../packages/core/src/storage.js";
import { ReminderService } from "../services/reminders/src/service.js";
import {
  MockMailProvider,
  ProviderError,
  ResendProvider,
  type Message,
} from "../services/reminders/src/provider.js";
import { reminderHttpServer } from "../services/reminders/src/http.js";

const start = "2030-10-22T08:00:00.000Z";
function fixture(t: TestContext, provider = new MockMailProvider()) {
  mkdirSync("tmp/tests", { recursive: true });
  const root = mkdtempSync(join(process.cwd(), "tmp/tests/reminders-"));
  let now = start;
  const directory = join(root, "reminder-service");
  const service = new ReminderService(
    directory,
    provider,
    "https://reminders.example.test",
    () => now,
  );
  const resources = [service];
  const cleanups: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    for (const resource of resources) resource.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    track: (resource: ReminderService) => resources.push(resource),
    cleanups,
    root,
    directory,
    provider,
    service,
    advance: (minutes: number) => {
      now = new Date(Date.parse(now) + minutes * 60000).toISOString();
    },
    time: () => now,
  };
}
async function enabled(
  f: ReturnType<typeof fixture>,
  email = "learner@example.test",
) {
  const user = f.service.provision();
  f.service.requestRecipient(user.id, { email });
  await f.service.tick();
  const message = [...f.provider.messages.values()].find(
    (m) => m.to === email,
  )!;
  const code = /Verification code: ([a-f0-9]{64})/.exec(message.text)![1];
  f.service.verifyRecipient(user.id, { code });
  f.service.preferences(user.id, { enabled: true, timeZone: "Europe/London" });
  return user;
}
function projection(now = start): ReminderProjection {
  return reminderProjectionSchema.parse({
    schemaVersion: 1,
    streamId: randomUUID(),
    revision: 1,
    generatedAt: now,
    expiresAt: new Date(Date.parse(now) + 86400000).toISOString(),
    timeZone: "Europe/London",
    reminders: [
      {
        id: sha256("synthetic-session"),
        label: "Synthetic study session",
        eventAt: new Date(Date.parse(now) + 3600000).toISOString(),
        sendAt: now,
        verifiedAt: now,
      },
    ],
  });
}

test("minimal preview excludes private records, conflicting/date-only/completed/stale evidence and never uploads", (t) => {
  const { workspace, file } = setup(t);
  workspace.importMaterial({ source, file });
  const now = new Date().toISOString();
  workspace.putTask({
    ...task,
    deadlines: [
      {
        ...task.deadlines[0],
        value: {
          precision: "instant",
          at: new Date(Date.parse(now) + 3600000).toISOString(),
        },
      },
    ],
  });
  const request = {
    streamId: randomUUID(),
    revision: 1,
    leadMinutes: 60,
    selections: [
      {
        kind: "task",
        courseId: task.courseId,
        id: task.id,
        label: "My chosen reminder label",
      },
    ],
  };
  const preview = previewReminders(
    workspace.snapshot(),
    request,
    new Date(Date.parse(now) + 1000).toISOString(),
  );
  assert.equal(preview.uploaded, false);
  assert.equal(preview.projection.reminders.length, 1);
  const serialized = JSON.stringify(preview.projection);
  for (const privateValue of [
    task.courseId,
    source.reference,
    source.title,
    task.title,
    "deadlines",
    "sourceId",
  ])
    assert.ok(!serialized.includes(privateValue));
  assert.throws(() =>
    reminderProjectionSchema.parse({
      ...preview.projection,
      slides: "private",
    }),
  );
  workspace.markProgress({
    entity: "task",
    courseId: task.courseId,
    id: task.id,
    stage: "submitted",
    evidence: "Synthetic explicit user report",
  });
  assert.equal(
    previewReminders(workspace.snapshot(), request).projection.reminders.length,
    0,
  );
  assert.equal(
    previewReminders(
      workspace.snapshot(),
      request,
      new Date(Date.parse(now) + 2 * 86400000).toISOString(),
    ).projection.reminders.length,
    0,
  );
  const snapshot = workspace.snapshot();
  snapshot.progress = [];
  snapshot.tasks[0]!.deadlines.push({
    ...task.deadlines[0]!,
    id: "conflicting",
  });
  assert.match(
    previewReminders(snapshot, request).skipped[0]!.reason,
    /conflicting/,
  );
  snapshot.tasks[0]!.deadlines = task.deadlines;
  assert.match(previewReminders(snapshot, request).skipped[0]!.reason, /exact/);
});

test("verified recipients and explicit opt-in are required; acceptance, delivery and personal receipt remain distinct", async (t) => {
  const f = fixture(t),
    user = f.service.provision();
  assert.throws(() => f.service.sync(user.id, projection()), /Verified/);
  assert.throws(
    () =>
      f.service.preferences(user.id, {
        enabled: true,
        timeZone: "Europe/London",
      }),
    /Verify/,
  );
  const requested = f.service.requestRecipient(user.id, {
    email: "learner@example.test",
  });
  assert.equal(requested.verified, false);
  assert.ok(!JSON.stringify(f.service.state(user.id)).includes("challenge"));
  await f.service.tick();
  const code = /Verification code: ([a-f0-9]{64})/.exec(
    [...f.provider.messages.values()][0]!.text,
  )![1];
  assert.throws(
    () => f.service.verifyRecipient(user.id, { code: "0".repeat(64) }),
    /Invalid/,
  );
  f.service.verifyRecipient(user.id, { code });
  assert.throws(() => f.service.verifyRecipient(user.id, { code }), /Invalid/);
  f.service.preferences(user.id, { enabled: true, timeZone: "Europe/London" });
  const p = projection();
  f.service.sync(user.id, p);
  await f.service.tick();
  let job = f.service
    .state(user.id)
    .notifications.find((j) => j.kind === "reminder")!;
  assert.equal(job.state, "accepted");
  assert.equal(job.deliveredAt, null);
  assert.equal(job.personallyReceivedAt, null);
  await f.service.tick();
  job = f.service
    .state(user.id)
    .notifications.find((j) => j.kind === "reminder")!;
  assert.equal(job.state, "delivered");
  assert.equal(job.personallyReceivedAt, null);
  f.service.received(user.id, { notificationId: job.notificationId });
  assert.equal(
    f.service.state(user.id).notifications.find((j) => j.kind === "reminder")!
      .personallyReceivedAt,
    start,
  );
  assert.equal(f.service.sync(user.id, p).changed, false);
  await f.service.tick();
  assert.equal(f.provider.messages.size, 2);
});

test("newer snapshots cancel/reschedule; stale revisions and expired snapshots cannot revive obsolete reminders", async (t) => {
  const f = fixture(t),
    user = await enabled(f),
    p = projection();
  p.reminders[0]!.sendAt = "2030-10-22T08:30:00.000Z";
  f.service.sync(user.id, p);
  const changed = structuredClone(p);
  changed.revision++;
  changed.reminders[0]!.eventAt = "2030-10-22T10:00:00.000Z";
  changed.reminders[0]!.sendAt = "2030-10-22T09:00:00.000Z";
  f.service.sync(user.id, changed);
  assert.equal(
    f.service
      .state(user.id)
      .notifications.filter((j) => j.state === "suppressed").length,
    1,
  );
  assert.throws(() => f.service.sync(user.id, p), /revision/);
  f.service.sync(user.id, { ...changed, revision: 3, reminders: [] });
  f.advance(90);
  await f.service.tick();
  assert.equal(f.provider.messages.size, 1);
  assert.equal(
    f.service
      .state(user.id)
      .notifications.filter((j) => j.kind === "reminder")
      .every((j) => j.state === "suppressed"),
    true,
  );
  f.advance(24 * 60);
  assert.throws(
    () => f.service.sync(user.id, { ...changed, revision: 4 }),
    /stale/,
  );
});

test("persistent delivery identities survive restart; cancellation and opt-out stop pending work", async (t) => {
  const f = fixture(t),
    user = await enabled(f),
    p = projection();
  f.service.sync(user.id, p);
  f.service.preferences(user.id, { enabled: false, timeZone: "Europe/London" });
  await f.service.tick();
  assert.equal(f.provider.messages.size, 1);
  f.service.preferences(user.id, { enabled: true, timeZone: "Europe/London" });
  f.service.sync(user.id, { ...p, revision: 2 });
  await f.service.tick();
  assert.equal(f.provider.messages.size, 2);
  const before = f.service.state(user.id);
  f.service.close();
  const reopened = new ReminderService(
    f.directory,
    f.provider,
    "https://reminders.example.test",
    f.time,
  );
  f.track(reopened);
  assert.equal(reopened.authenticate(user.token), user.id);
  reopened.sync(user.id, { ...p, revision: 3 });
  await reopened.tick();
  assert.equal(f.provider.messages.size, 2);
  assert.equal(
    reopened.state(user.id).notifications.length,
    before.notifications.length,
  );
  assert.throws(
    () =>
      new ReminderService(
        f.directory,
        f.provider,
        "https://reminders.example.test",
      ),
    /EEXIST/,
  );
});

test("retry keys and exact payloads are stable; ambiguous outcomes stop after the bound", async (t) => {
  class Flaky extends MockMailProvider {
    calls: { key: string; body: Message }[] = [];
    fail = false;
    override async send(message: Message, key: string) {
      this.calls.push({ key, body: structuredClone(message) });
      if (this.fail)
        throw new ProviderError(true, "Synthetic ambiguous provider timeout");
      return super.send(message, key);
    }
  }
  const provider = new Flaky(),
    f = fixture(t, provider),
    user = await enabled(f),
    p = projection();
  provider.fail = true;
  f.service.sync(user.id, p);
  await f.service.tick();
  f.advance(1);
  await f.service.tick();
  assert.deepEqual(provider.calls.at(-1), provider.calls.at(-2));
  provider.fail = false;
  f.advance(2);
  await f.service.tick();
  assert.equal(
    f.service.state(user.id).notifications.find((j) => j.kind === "reminder")!
      .state,
    "accepted",
  );
  // A persisted in-flight attempt left by process death cannot be blindly resent after provider dedup expires.
  f.service.close();
  const db = new DatabaseSync(join(f.directory, "reminders.sqlite"));
  const row = db
    .prepare("SELECT id,data FROM jobs WHERE id=?")
    .get(provider.calls.at(-1)!.key)!;
  const job = JSON.parse(String(row.data));
  job.state = "submitting";
  job.firstAttemptAt = "2030-10-20T08:00:00.000Z";
  job.nextAttemptAt = start;
  db.prepare("UPDATE jobs SET data=? WHERE id=?").run(
    JSON.stringify(job),
    String(row.id),
  );
  db.close();
  const reopened = new ReminderService(
    f.directory,
    provider,
    "https://reminders.example.test",
    f.time,
  );
  f.track(reopened);
  const count = provider.calls.length;
  await reopened.tick();
  assert.equal(provider.calls.length, count);
  assert.equal(
    reopened.state(user.id).notifications.find((j) => j.kind === "reminder")!
      .state,
    "unknown",
  );
});

test("HTTP/client flow enforces user isolation, bounded inputs and safe unsubscribe", async (t) => {
  const f = fixture(t),
    a = await enabled(f, "a@example.test"),
    b = await enabled(f, "b@example.test");
  const server = reminderHttpServer(f.service);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  f.cleanups.push(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const call = (token: string, path: string, method = "GET", input?: unknown) =>
    fetch(endpoint + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  assert.equal((await call("0".repeat(64), "/v1/state")).status, 401);
  const p = projection();
  assert.equal((await call(a.token, "/v1/sync", "POST", p)).status, 200);
  const isolated = (await (await call(b.token, "/v1/state")).json()) as {
    streams: unknown[];
  };
  assert.equal(isolated.streams.length, 0);
  assert.equal(
    (
      await call(b.token, "/v1/preferences", "PUT", {
        enabled: false,
        timeZone: "UTC",
        userId: a.id,
      })
    ).status,
    400,
  );
  await f.service.tick();
  const job = f.service
    .state(a.id)
    .notifications.find((j) => j.kind === "reminder")!;
  assert.equal(
    (
      await call(b.token, "/v1/receipt", "POST", {
        notificationId: job.notificationId,
      })
    ).status,
    404,
  );
  const tokenFile = join(f.root, "test-token");
  writeFileSync(tokenFile, a.token, { mode: 0o600 });
  const child = spawn(process.execPath, [
    "dist/packages/cli/src/reminder-client.js",
    "--endpoint",
    endpoint,
    "--token-file",
    tokenFile,
    "--operation",
    "state",
    "--synthetic",
  ]);
  let output = "";
  child.stdout.on("data", (v) => (output += v));
  let errors = "";
  child.stderr.on("data", (v) => (errors += v));
  const [code] = await once(child, "close");
  assert.equal(code, 0, errors);
  assert.equal(JSON.parse(output).streams.length, 1);
  const unsubscribeUrl = [...f.provider.messages.values()].find(
    (m) => m.unsubscribeUrl,
  )!.unsubscribeUrl!;
  const url = endpoint + new URL(unsubscribeUrl).pathname;
  assert.equal((await fetch(url)).status, 200);
  assert.equal(f.service.state(a.id).enabled, true);
  assert.equal((await fetch(url, { method: "POST" })).status, 200);
  assert.equal(f.service.state(a.id).enabled, false);
  assert.equal(f.service.state(b.id).enabled, true);
});

test("Resend adapter sends only the intended payload and separates acceptance from matching delivery evidence", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return Response.json(
      init?.method === "POST"
        ? { id: "synthetic-provider-id" }
        : {
            id: "synthetic-provider-id",
            to: ["learner@example.test"],
            last_event: "delivered",
          },
    );
  };
  const provider = new ResendProvider(
    "synthetic-key-not-a-credential",
    "sender@example.test",
    transport,
  );
  const id = await provider.send(
    {
      to: "learner@example.test",
      subject: "Synthetic",
      text: "Original synthetic body",
    },
    "stable-key",
  );
  assert.equal(id, "synthetic-provider-id");
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"],
    "stable-key",
  );
  assert.equal(await provider.status(id, "learner@example.test"), "delivered");
  await assert.rejects(provider.status(id, "other@example.test"), /identity/);
  const rejected = new ResendProvider(
    "synthetic",
    "sender@example.test",
    async () => new Response("Private response not exposed", { status: 429 }),
  );
  await assert.rejects(
    rejected.send(
      { to: "learner@example.test", subject: "Synthetic", text: "Synthetic" },
      "key",
    ),
    /HTTP 429/,
  );
});

test("expired verification, changed recipients and stale queues cannot send reminders; timezone changes require matching sync", async (t) => {
  const f = fixture(t),
    pending = f.service.provision();
  f.service.requestRecipient(pending.id, { email: "unverified@example.test" });
  await f.service.tick();
  const code = /Verification code: ([a-f0-9]{64})/.exec(
    [...f.provider.messages.values()][0]!.text,
  )![1];
  f.advance(16);
  assert.throws(
    () => f.service.verifyRecipient(pending.id, { code }),
    /expired/,
  );
  const user = await enabled(f),
    p = projection(f.time());
  p.reminders[0]!.sendAt = new Date(
    Date.parse(f.time()) + 1800000,
  ).toISOString();
  f.service.sync(user.id, p);
  f.service.preferences(user.id, { enabled: true, timeZone: "Asia/Shanghai" });
  assert.throws(
    () => f.service.sync(user.id, { ...p, revision: 2 }),
    /time zone/,
  );
  f.service.sync(user.id, { ...p, revision: 2, timeZone: "Asia/Shanghai" });
  f.advance(30);
  await f.service.tick();
  const reminder = [...f.provider.messages.values()].find((m) =>
    m.subject.startsWith("Study reminder:"),
  )!;
  assert.match(reminder.text, /17:16 \(Asia\/Shanghai\)/);
  const later = projection(f.time());
  later.reminders[0]!.sendAt = new Date(
    Date.parse(f.time()) + 1800000,
  ).toISOString();
  later.timeZone = "Asia/Shanghai";
  f.service.sync(user.id, later);
  f.service.requestRecipient(user.id, { email: "changed@example.test" });
  f.advance(24 * 60);
  const count = f.provider.messages.size;
  await f.service.tick();
  assert.equal(f.provider.messages.size, count);
  assert.equal(f.service.state(user.id).verified, false);
  assert.equal(f.service.state(user.id).enabled, false);
});

test("provider delivery failure disables the account and fresh snapshots cannot bypass opt-out", async (t) => {
  class Bouncing extends MockMailProvider {
    bounce = false;
    override async status(
      _id: string,
      _recipient: string,
    ): Promise<"delivered" | "failed"> {
      return this.bounce ? "failed" : "delivered";
    }
  }
  const provider = new Bouncing(),
    f = fixture(t, provider),
    user = await enabled(f);
  f.service.sync(user.id, projection());
  await f.service.tick();
  provider.bounce = true;
  f.advance(5);
  await f.service.tick();
  assert.equal(f.service.state(user.id).enabled, false);
  assert.throws(
    () => f.service.sync(user.id, projection(f.time())),
    /Verified/,
  );
});

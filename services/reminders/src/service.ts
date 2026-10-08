import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  reminderProjectionSchema,
  type ReminderProjection,
  type Reminder,
} from "../../../packages/core/src/reminders.js";
import { zoneSchema } from "../../../packages/core/src/schema.js";
import { sha256 } from "../../../packages/core/src/storage.js";
import { ProviderError, type MailProvider, type Message } from "./provider.js";

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
interface User {
  id: string;
  email: string | null;
  verified: boolean;
  enabled: boolean;
  timeZone: string;
  recipientVersion: number;
  challengeHash: string | null;
  challengeExpires: string | null;
  requestedAt: string | null;
  unsubscribe: string;
  verifiedAt: string | null;
}
interface Job {
  id: string;
  userId: string;
  kind: "verification" | "reminder";
  streamId: string | null;
  recipientVersion: number;
  reminderId: string | null;
  fingerprint: string | null;
  state:
    | "queued"
    | "submitting"
    | "retry"
    | "accepted"
    | "delivered"
    | "failed"
    | "suppressed"
    | "unknown";
  message: Message;
  dueAt: string;
  expiresAt: string;
  attempts: number;
  firstAttemptAt: string | null;
  nextAttemptAt: string;
  providerId: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  personallyReceivedAt: string | null;
  checkedAt: string | null;
  detail: string | null;
}
const secret = () => randomBytes(32).toString("hex");
const fingerprint = (r: Reminder) =>
  sha256(JSON.stringify([r.id, r.label, r.eventAt, r.sendAt]));
const waiting = (j: Job) => ["queued", "retry", "submitting"].includes(j.state);

/** Single-process service. A separate database, account registry and mail provider; no learning files. */
export class ReminderService {
  private db!: DatabaseSync;
  private lock: string;
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    readonly provider: MailProvider,
    private baseUrl: string,
    private clock = () => new Date().toISOString(),
  ) {
    const url = new URL(baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(provider.mode === "synthetic" && url.hostname === "127.0.0.1"))
    )
      throw new Error(
        "Use a public HTTPS origin, or synthetic loopback origin",
      );
    this.baseUrl = url.origin;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.lock = join(directory, "service.lock");
    const descriptor = openSync(this.lock, "wx", 0o600);
    writeFileSync(descriptor, String(process.pid));
    closeSync(descriptor);
    try {
      const file = join(directory, "reminders.sqlite");
      this.db = new DatabaseSync(file);
      chmodSync(file, 0o600);
      this.db.exec(
        "PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
      );
      const version = this.db.prepare("PRAGMA user_version").get()!
        .user_version;
      const app = this.db.prepare("PRAGMA application_id").get()!
        .application_id;
      if (
        version === 0 &&
        this.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all().length === 0
      )
        this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE users(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
        CREATE TABLE streams(user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id,id));
        CREATE TABLE jobs(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL);
        PRAGMA application_id=1129534029; PRAGMA user_version=1; COMMIT;`);
      else if (version !== 1 || app !== 1129534029)
        throw new Error("Unsupported reminder database");
      const mode = this.db
        .prepare("SELECT value FROM metadata WHERE key='provider'")
        .get()?.value;
      if (mode && mode !== provider.mode)
        throw new Error("Use separate databases for synthetic and real mail");
      this.db
        .prepare("INSERT OR IGNORE INTO metadata VALUES('provider',?)")
        .run(provider.mode);
      const deliveryScope = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(provider.deliveryScope);
      const priorScope = this.db
        .prepare("SELECT value FROM metadata WHERE key='delivery_scope'")
        .get()?.value;
      if (priorScope && priorScope !== deliveryScope)
        throw new Error(
          "Provider configuration changed; preserve the ledger and reconcile prior attempts before migrating credentials or sender",
        );
      if (
        !priorScope &&
        provider.mode === "resend" &&
        this.jobs().some((job) => job.attempts > 0)
      )
        throw new Error(
          "Existing provider attempts have no configuration binding; reconciliation is required before upgrading this ledger",
        );
      this.db
        .prepare("INSERT OR IGNORE INTO metadata VALUES('delivery_scope',?)")
        .run(deliveryScope);
    } catch (error) {
      this.db?.close();
      unlinkSync(this.lock);
      throw error;
    }
  }
  close() {
    if (!this.closed) {
      this.db.close();
      unlinkSync(this.lock);
      this.closed = true;
    }
  }
  exclusive<T>(run: () => T | Promise<T>): Promise<T> {
    const result = this.pending.then(run);
    this.pending = result.catch(() => {});
    return result;
  }
  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  provision() {
    const token = secret(),
      id = randomUUID();
    const user: User = {
      id,
      email: null,
      verified: false,
      enabled: false,
      timeZone: "UTC",
      recipientVersion: 0,
      challengeHash: null,
      challengeExpires: null,
      requestedAt: null,
      unsubscribe: secret(),
      verifiedAt: null,
    };
    this.db
      .prepare("INSERT INTO users VALUES(?,?,?)")
      .run(id, sha256(token), JSON.stringify(user));
    return { id, token };
  }
  authenticate(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new ServiceError(401, "Invalid credentials");
    const row = this.db
      .prepare("SELECT id FROM users WHERE token_hash=?")
      .get(sha256(token));
    if (!row) throw new ServiceError(401, "Invalid credentials");
    return String(row.id);
  }
  private user(id: string): User {
    const row = this.db.prepare("SELECT data FROM users WHERE id=?").get(id);
    if (!row) throw new ServiceError(404, "Unknown account");
    return JSON.parse(String(row.data)) as User;
  }
  private saveUser(user: User) {
    this.db
      .prepare("UPDATE users SET data=? WHERE id=?")
      .run(JSON.stringify(user), user.id);
  }
  private jobs(id?: string): Job[] {
    return (
      id
        ? this.db
            .prepare("SELECT data FROM jobs WHERE user_id=? ORDER BY rowid")
            .all(id)
        : this.db.prepare("SELECT data FROM jobs ORDER BY rowid").all()
    ).map((r) => JSON.parse(String(r.data)) as Job);
  }
  private saveJob(job: Job) {
    this.db
      .prepare(
        "INSERT INTO jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(job.id, job.userId, JSON.stringify(job));
  }
  private stream(userId: string, id: string): ReminderProjection | undefined {
    const row = this.db
      .prepare("SELECT data FROM streams WHERE user_id=? AND id=?")
      .get(userId, id);
    return row
      ? (JSON.parse(String(row.data)) as ReminderProjection)
      : undefined;
  }
  private suppress(userId: string, detail: string) {
    for (const job of this.jobs(userId))
      if (waiting(job)) {
        job.state = job.attempts ? "unknown" : "suppressed";
        job.detail = detail;
        this.saveJob(job);
      }
  }
  private newJob(
    user: User,
    input: Pick<
      Job,
      | "id"
      | "kind"
      | "streamId"
      | "reminderId"
      | "fingerprint"
      | "message"
      | "dueAt"
      | "expiresAt"
    >,
  ): Job {
    return {
      ...input,
      userId: user.id,
      recipientVersion: user.recipientVersion,
      state: "queued",
      attempts: 0,
      firstAttemptAt: null,
      nextAttemptAt: input.dueAt,
      providerId: null,
      acceptedAt: null,
      deliveredAt: null,
      personallyReceivedAt: null,
      checkedAt: null,
      detail: null,
    };
  }
  requestRecipient(id: string, input: unknown) {
    const { email } = z
      .strictObject({
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
      })
      .parse(input);
    return this.transaction(() => {
      const user = this.user(id),
        now = this.clock();
      if (
        user.requestedAt &&
        Date.parse(now) - Date.parse(user.requestedAt) < 60000
      )
        throw new ServiceError(
          429,
          "Wait before requesting another verification",
        );
      if (
        this.jobs(id).filter(
          (j) =>
            j.kind === "verification" &&
            Date.parse(j.dueAt) >= Date.parse(now) - 86400000,
        ).length >= 5
      )
        throw new ServiceError(429, "Daily verification limit reached");
      this.suppress(id, "Recipient changed");
      const code = secret();
      user.email = email;
      user.verified = false;
      user.enabled = false;
      user.verifiedAt = null;
      user.recipientVersion++;
      user.challengeHash = sha256(code);
      user.challengeExpires = new Date(
        Date.parse(now) + 15 * 60000,
      ).toISOString();
      user.requestedAt = now;
      this.saveUser(user);
      const job = this.newJob(user, {
        id: randomUUID(),
        kind: "verification",
        streamId: null,
        reminderId: null,
        fingerprint: null,
        dueAt: now,
        expiresAt: user.challengeExpires,
        message: {
          to: email,
          subject: "Verify your Codex Study reminder address",
          text: `A holder of your Codex Study account requested reminders at this address.\nVerification code: ${code}\nExpires: ${user.challengeExpires}\nEnter this code through your authenticated reminder client. Ignore this message if you did not request it.`,
        },
      });
      this.saveJob(job);
      return {
        state: "queued",
        notificationId: job.id,
        verified: false,
        providerMode: this.provider.mode,
      };
    });
  }
  verifyRecipient(id: string, input: unknown) {
    const { code } = z
      .strictObject({ code: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(input);
    const user = this.user(id);
    if (
      !user.challengeHash ||
      user.challengeHash !== sha256(code) ||
      !user.challengeExpires ||
      Date.parse(user.challengeExpires) <= Date.parse(this.clock())
    )
      throw new ServiceError(400, "Invalid or expired verification");
    user.verified = true;
    user.verifiedAt = this.clock();
    user.challengeHash = null;
    user.challengeExpires = null;
    this.saveUser(user);
    return { verified: true, enabled: false };
  }
  preferences(id: string, input: unknown) {
    const value = z
      .strictObject({ enabled: z.boolean(), timeZone: zoneSchema })
      .parse(input);
    return this.transaction(() => {
      const user = this.user(id);
      if (value.enabled && !user.verified)
        throw new ServiceError(
          409,
          "Verify the recipient before enabling reminders",
        );
      if (user.timeZone !== value.timeZone || !value.enabled)
        this.suppress(
          id,
          "Opted out or time zone changed; sync a new revision to resume",
        );
      Object.assign(user, value);
      this.saveUser(user);
      return { enabled: user.enabled, timeZone: user.timeZone };
    });
  }
  unsubscribe(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new ServiceError(404, "Unknown unsubscribe token");
    const user = this.db
      .prepare("SELECT data FROM users")
      .all()
      .map((r) => JSON.parse(String(r.data)) as User)
      .find((u) => u.unsubscribe === token);
    if (!user) throw new ServiceError(404, "Unknown unsubscribe token");
    return this.preferences(user.id, {
      enabled: false,
      timeZone: user.timeZone,
    });
  }
  sync(id: string, input: unknown) {
    const projection = reminderProjectionSchema.parse(input),
      now = Date.parse(this.clock());
    if (
      Date.parse(projection.generatedAt) > now + 60000 ||
      Date.parse(projection.expiresAt) <= now
    )
      throw new ServiceError(409, "Projection is stale or from the future");
    return this.transaction(() => {
      const user = this.user(id);
      if (!user.verified || !user.enabled)
        throw new ServiceError(
          409,
          "Verified recipient and explicit opt-in required",
        );
      if (user.timeZone !== projection.timeZone)
        throw new ServiceError(
          409,
          "Projection time zone differs from account preferences",
        );
      const prior = this.stream(id, projection.streamId);
      if (
        prior &&
        projection.revision === prior.revision &&
        JSON.stringify(projection) === JSON.stringify(prior)
      )
        return {
          state: "synchronized",
          revision: prior.revision,
          changed: false,
        };
      if (prior && projection.revision <= prior.revision)
        throw new ServiceError(409, "Projection revision conflict");
      if (
        !prior &&
        Number(
          this.db
            .prepare("SELECT COUNT(*) AS n FROM streams WHERE user_id=?")
            .get(id)!.n,
        ) >= 10
      )
        throw new ServiceError(429, "Stream limit reached");
      const known = this.jobs(id);
      if (
        known.filter(
          (j) => j.kind === "reminder" && Date.parse(j.dueAt) >= now - 86400000,
        ).length +
          projection.reminders.length >
        200
      )
        throw new ServiceError(429, "Reminder limit reached");
      this.db
        .prepare(
          "INSERT INTO streams VALUES(?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data",
        )
        .run(id, projection.streamId, JSON.stringify(projection));
      for (const job of known)
        if (job.streamId === projection.streamId && waiting(job)) {
          const current = projection.reminders.find(
            (r) =>
              r.id === job.reminderId && fingerprint(r) === job.fingerprint,
          );
          if (!current) {
            job.state = job.attempts ? "unknown" : "suppressed";
            job.detail = "Cancelled or rescheduled by newer snapshot";
          } else job.expiresAt = projection.expiresAt;
          this.saveJob(job);
        }
      for (const reminder of projection.reminders) {
        const fp = fingerprint(reminder);
        // Stable across snapshot refresh/restart; a timezone/recipient change creates a new delivery identity.
        const key = sha256(
          JSON.stringify([
            id,
            projection.streamId,
            fp,
            user.recipientVersion,
            user.timeZone,
          ]),
        );
        const existing = known.find((j) => j.id === key);
        if (
          existing &&
          !(existing.state === "suppressed" && existing.attempts === 0)
        )
          continue;
        const localTime = new Intl.DateTimeFormat("en-GB", {
          timeZone: user.timeZone,
          dateStyle: "full",
          timeStyle: "short",
        }).format(new Date(reminder.eventAt));
        const unsubscribeUrl = `${this.baseUrl}/unsubscribe/${user.unsubscribe}`;
        const message: Message = {
          to: user.email!,
          subject: `Study reminder: ${reminder.label}`,
          text: `${reminder.label}\nEvent: ${localTime} (${user.timeZone})\nThis reminder is based on a verified snapshot. Check your local workspace for details.\nStop reminders: ${unsubscribeUrl}`,
          unsubscribeUrl,
        };
        const job = this.newJob(user, {
          id: key,
          kind: "reminder",
          streamId: projection.streamId,
          reminderId: reminder.id,
          fingerprint: fp,
          message,
          dueAt: reminder.sendAt,
          expiresAt: projection.expiresAt,
        });
        if (
          Date.parse(reminder.eventAt) <= now ||
          Date.parse(reminder.sendAt) < now - 2 * 3600000
        ) {
          job.state = "suppressed";
          job.detail = "Event passed or reminder catch-up window missed";
        }
        this.saveJob(job);
      }
      return {
        state: "synchronized",
        revision: projection.revision,
        changed: true,
      };
    });
  }
  state(id: string) {
    const user = this.user(id);
    return {
      providerMode: this.provider.mode,
      recipient: user.email,
      verified: user.verified,
      enabled: user.enabled,
      timeZone: user.timeZone,
      streams: this.db
        .prepare("SELECT data FROM streams WHERE user_id=?")
        .all(id)
        .map((r) => JSON.parse(String(r.data)) as ReminderProjection),
      notifications: this.jobs(id).map(
        ({
          id: notificationId,
          kind,
          state,
          dueAt,
          attempts,
          providerId,
          acceptedAt,
          deliveredAt,
          personallyReceivedAt,
          detail,
        }) => ({
          notificationId,
          kind,
          state,
          dueAt,
          attempts,
          providerId,
          acceptedAt,
          deliveredAt,
          personallyReceivedAt,
          detail,
        }),
      ),
    };
  }
  received(id: string, input: unknown) {
    const { notificationId } = z
      .strictObject({ notificationId: z.string().min(1).max(100) })
      .parse(input);
    const job = this.jobs(id).find((j) => j.id === notificationId);
    if (!job) throw new ServiceError(404, "Unknown notification");
    if (!["accepted", "delivered"].includes(job.state))
      throw new ServiceError(409, "Notification was not accepted");
    job.personallyReceivedAt ??= this.clock();
    this.saveJob(job);
    return {
      personallyReceivedAt: job.personallyReceivedAt,
      providerState: job.state,
    };
  }
  private eligible(job: Job, now: number) {
    const user = this.user(job.userId);
    if (
      user.recipientVersion !== job.recipientVersion ||
      Date.parse(job.expiresAt) <= now
    )
      return false;
    if (job.kind === "verification")
      return !user.verified && !!user.challengeHash;
    const stream = job.streamId && this.stream(user.id, job.streamId);
    return (
      now - Date.parse(job.dueAt) <= 2 * 3600000 &&
      user.enabled &&
      user.verified &&
      !!stream &&
      stream.timeZone === user.timeZone &&
      Date.parse(stream.expiresAt) > now &&
      stream.reminders.some(
        (r) =>
          r.id === job.reminderId &&
          fingerprint(r) === job.fingerprint &&
          Date.parse(r.eventAt) > now,
      )
    );
  }
  async tick() {
    return this.exclusive(async () => {
      let sends = 0,
        polls = 0;
      for (const job of this.jobs()) {
        const now = Date.parse(this.clock());
        if (
          ["accepted", "delivered"].includes(job.state) &&
          job.providerId &&
          polls < 20 &&
          (!job.checkedAt || now - Date.parse(job.checkedAt) >= 5 * 60000) &&
          now - Date.parse(job.acceptedAt!) < 7 * 86400000
        ) {
          polls++;
          job.checkedAt = this.clock();
          try {
            const state = await this.provider.status(
              job.providerId,
              job.message.to,
            );
            if (state === "delivered") {
              job.state = state;
              job.deliveredAt ??= this.clock();
            }
            if (state === "failed") {
              job.state = state;
              job.detail =
                "Provider reported delivery failure; reminders disabled";
              const user = this.user(job.userId);
              user.enabled = false;
              user.verified = false;
              this.saveUser(user);
              this.suppress(user.id, "Recipient delivery failure");
            }
          } catch {
            job.detail =
              "Delivery status unavailable; acceptance is not delivery";
          }
          this.saveJob(job);
          continue;
        }
        if (!waiting(job) || sends >= 20 || Date.parse(job.nextAttemptAt) > now)
          continue;
        if (!this.eligible(job, now)) {
          job.state = job.attempts ? "unknown" : "suppressed";
          job.detail =
            "Snapshot expired, event cancelled or account disabled; retries stopped";
          this.saveJob(job);
          continue;
        }
        if (
          job.firstAttemptAt &&
          (now - Date.parse(job.firstAttemptAt) >= 23 * 3600000 ||
            job.attempts >= 5)
        ) {
          job.state = "unknown";
          job.detail =
            "Retry bound reached; inspect provider before any resend";
          this.saveJob(job);
          continue;
        }
        sends++;
        job.state = "submitting";
        job.attempts++;
        job.firstAttemptAt ??= this.clock();
        job.nextAttemptAt = new Date(now + 120000).toISOString();
        this.saveJob(job);
        try {
          job.providerId = await this.provider.send(job.message, job.id);
          job.state = "accepted";
          job.acceptedAt = this.clock();
          job.detail = null;
        } catch (error) {
          job.state =
            error instanceof ProviderError && !error.retryable
              ? "failed"
              : "retry";
          job.detail =
            error instanceof ProviderError
              ? error.message
              : "Provider error; outcome may be unknown";
          job.nextAttemptAt = new Date(
            now + Math.min(3600000, 60000 * 2 ** (job.attempts - 1)),
          ).toISOString();
        }
        this.saveJob(job);
      }
      return {
        providerMode: this.provider.mode,
        attempted: sends,
        polled: polls,
      };
    });
  }
}

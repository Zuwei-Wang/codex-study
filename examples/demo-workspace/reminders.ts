import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ReminderService } from "../../services/reminders/src/service.js";
import { MockMailProvider } from "../../services/reminders/src/provider.js";
import { sha256 } from "../../packages/core/src/storage.js";
mkdirSync("tmp", { recursive: true });
const root = mkdtempSync(resolve("tmp/reminder-demo-"));
const provider = new MockMailProvider();
const now = "2030-10-22T08:00:00.000Z";
const service = new ReminderService(
  root,
  provider,
  "https://reminders.example.test",
  () => now,
);
try {
  const user = service.provision();
  service.requestRecipient(user.id, {
    email: "synthetic-learner@example.test",
  });
  await service.tick();
  const verification = [...provider.messages.values()][0]!;
  const code = /Verification code: ([a-f0-9]{64})/.exec(verification.text)![1];
  service.verifyRecipient(user.id, { code });
  service.preferences(user.id, { enabled: true, timeZone: "Europe/London" });
  const p = {
    schemaVersion: 1,
    streamId: randomUUID(),
    revision: 1,
    generatedAt: now,
    expiresAt: "2030-10-23T08:00:00.000Z",
    timeZone: "Europe/London",
    reminders: [
      {
        id: sha256("synthetic-event"),
        label: "Synthetic class",
        verifiedAt: now,
        eventAt: "2030-10-22T09:00:00.000Z",
        sendAt: now,
      },
    ],
  };
  const synchronized = service.sync(user.id, p);
  await service.tick();
  const accepted = service
    .state(user.id)
    .notifications.find((j) => j.kind === "reminder")!;
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.deliveredAt, null);
  await service.tick();
  const delivered = service
    .state(user.id)
    .notifications.find((j) => j.kind === "reminder")!;
  assert.equal(delivered.state, "delivered");
  assert.equal(delivered.personallyReceivedAt, null);
  assert.equal(service.sync(user.id, p).changed, false);
  await service.tick();
  assert.equal(provider.messages.size, 2);
  console.log(
    JSON.stringify(
      {
        synthetic: true,
        networkCalls: 0,
        verified: true,
        synchronized: synchronized.state,
        accepted: accepted.state,
        delivered: delivered.state,
        personallyReceivedAt: delivered.personallyReceivedAt,
        unchangedSyncDuplicated: false,
        limits:
          "All mail and delivery outcomes are synthetic. No person received an email.",
      },
      null,
      2,
    ),
  );
} finally {
  service.close();
  rmSync(root, { recursive: true, force: true });
}

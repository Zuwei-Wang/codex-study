# Reminder projection contract v1

The optional service receives a small, explicitly selected reminder projection. It never needs slides, notes, personal work, source evidence, school course IDs, browser state, school credentials or private calendar URLs. Local learning works without an account or connection. The contract is enforced by `reminderProjectionSchema` in core and independently at the service boundary.

```json
{
  "schemaVersion": 1,
  "streamId": "6c1b64e5-8771-46c4-9a7b-c7a8f4d71601",
  "revision": 1,
  "generatedAt": "2030-10-22T08:00:00.000Z",
  "expiresAt": "2030-10-23T08:00:00.000Z",
  "timeZone": "Europe/London",
  "reminders": [
    {
      "id": "ca453d2199715fb801b0553bfa5e58e60dbb5f73d38c7e7d705584d88201a6604",
      "label": "Synthetic study session",
      "eventAt": "2030-10-22T09:00:00.000Z",
      "sendAt": "2030-10-22T08:00:00.000Z",
      "verifiedAt": "2030-10-22T08:00:00.000Z"
    }
  ]
}
```

This example is fictional and intentionally expired outside its demonstration date. Generate a fresh preview for a real run. IDs are opaque hashes scoped to a randomly generated workspace stream UUID. Each stream has a monotonically increasing positive integer revision. The entire stream is replaced, so omission explicitly cancels pending reminders previously synchronized in that stream. An empty array cancels the stream's pending reminders. Identical revision/content retries are idempotent; lower or different same revisions conflict. Separate workspaces use separate stream UUIDs.

Only a chosen label (maximum 140 characters), exact event/reminder times, verification instant and display time zone cross the boundary. Labels are supplied explicitly; task titles and locations are not copied automatically. Unknown fields fail validation. There are at most 50 reminders per snapshot and 10 streams per account. Events must be within the next seven days. A projection expires within 24 hours and no later than 24 hours after its oldest included verification. Refresh with fresh observations and a higher revision before expiry; the service does not infer freshness from a received HTTP request.

`previewReminders` reads a consistent local snapshot and returns `state: prepared`, the projection and explicit skip reasons. It requires fresh exact-time, nonconflicting official deadlines or active sessions from a completely verified timetable. Date-only, unknown, stale, incomplete, cancelled and explicitly submitted/graded items are skipped. No arbitrary deadline time is invented. The lead time is chosen explicitly, between 0 and 1,440 minutes. User progress is never changed. Preview skips do not cancel hosted records until the user synchronizes the full replacement.

Local input example:

```json
{
  "streamId": "6c1b64e5-8771-46c4-9a7b-c7a8f4d71601",
  "revision": 1,
  "leadMinutes": 60,
  "selections": [
    {
      "kind": "task",
      "courseId": "DEMO101",
      "id": "reading",
      "label": "Synthetic reading reminder"
    }
  ]
}
```

Use `study reminder-preview --workspace PATH --input selection.json`, or the MCP `study_reminder_preview` tool. A session selection uses `kind: session`, `feedId`, occurrence `id` and `label`. Persist the selected stream ID and last acknowledged revision in your private client configuration; concurrent sync attempts must resolve revision conflicts, never reset a stream to revision 1.

Prepared → synchronized → queued → accepted → delivered → personally received are distinct facts. Opt-out, cancellation and stale snapshots suppress work before submission. Persistent delivery identities prevent repeated unchanged reminders across refreshes and restarts. Failed or ambiguous outcomes are retained, never relabeled as successful delivery. The [service runbook](../services/reminders/README.md) describes retry/recovery behavior and real qualification requirements.

Provider integration follows the official [send API](https://resend.com/docs/api-reference/emails/send-email), [idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys) and [retrieval API](https://resend.com/docs/api-reference/emails/retrieve-email). Mock/injected-transport tests validate our implementation but do not prove a live provider account or delivery works.

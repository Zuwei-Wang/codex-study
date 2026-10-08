import { z } from "zod";
import {
  idSchema,
  instantSchema,
  zoneSchema,
  officialDateState,
} from "./schema.js";
import { sha256 } from "./storage.js";
import type { Snapshot } from "./workspace.js";

export const reminderSchema = z
  .strictObject({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    label: z
      .string()
      .trim()
      .min(1)
      .max(140)
      .refine((s) => !/[\r\n\x00-\x1f]/.test(s)),
    eventAt: instantSchema.transform((value) => new Date(value).toISOString()),
    sendAt: instantSchema.transform((value) => new Date(value).toISOString()),
    verifiedAt: instantSchema.transform((value) =>
      new Date(value).toISOString(),
    ),
  })
  .refine(
    (r) => Date.parse(r.sendAt) <= Date.parse(r.eventAt),
    "Reminder must not follow its event",
  );
/** Full replacement for one stream; intentionally excludes files, URLs, course IDs and source evidence. */
export const reminderProjectionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    streamId: z.uuid(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    generatedAt: instantSchema.transform((value) =>
      new Date(value).toISOString(),
    ),
    expiresAt: instantSchema.transform((value) =>
      new Date(value).toISOString(),
    ),
    timeZone: zoneSchema,
    reminders: z.array(reminderSchema).max(50),
  })
  .superRefine((p, ctx) => {
    const start = Date.parse(p.generatedAt),
      end = Date.parse(p.expiresAt);
    if (end <= start || end > start + 86400000)
      ctx.addIssue({
        code: "custom",
        message: "Projection expires within 24 hours",
      });
    if (new Set(p.reminders.map((r) => r.id)).size !== p.reminders.length)
      ctx.addIssue({ code: "custom", message: "Duplicate reminder ID" });
    for (const r of p.reminders) {
      const verified = Date.parse(r.verifiedAt);
      if (
        verified > start ||
        end > verified + 86400000 ||
        Date.parse(r.eventAt) <= start ||
        Date.parse(r.eventAt) > start + 7 * 86400000
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Reminder requires fresh evidence and a future event within seven days",
        });
    }
  });
export type ReminderProjection = z.infer<typeof reminderProjectionSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
export const reminderPreviewSchema = z.strictObject({
  streamId: z.uuid(),
  revision: z.number().int().positive(),
  leadMinutes: z.number().int().min(0).max(1440),
  selections: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("task"),
          courseId: idSchema,
          id: idSchema,
          label: z.string().trim().min(1).max(140),
        }),
        z.strictObject({
          kind: z.literal("session"),
          feedId: idSchema,
          id: z.string().regex(/^[a-f0-9]{64}$/),
          label: z.string().trim().min(1).max(140),
        }),
      ]),
    )
    .max(50),
});

export function previewReminders(
  snapshot: Snapshot,
  input: unknown,
  now = new Date().toISOString(),
) {
  const request = reminderPreviewSchema.parse(input),
    instant = Date.parse(instantSchema.parse(now));
  const skipped: { selection: number; reason: string }[] = [],
    reminders: Reminder[] = [];
  request.selections.forEach((selection, index) => {
    let eventAt: string | undefined,
      verifiedAt: string | undefined,
      reason: string | undefined;
    if (selection.kind === "task") {
      const task = snapshot.tasks.find(
        (t) => t.courseId === selection.courseId && t.id === selection.id,
      );
      if (!task) reason = "Unknown task";
      else if (
        snapshot.progress.some(
          (p) =>
            p.entity === "task" &&
            p.courseId === task.courseId &&
            p.id === task.id &&
            ["submitted", "graded"].includes(p.stage),
        )
      )
        reason = "Already explicitly submitted or graded";
      else if (officialDateState(task) !== "known")
        reason = "Official deadline unknown or conflicting";
      else {
        if (
          snapshot.materials.find(
            (m) =>
              m.source.courseId === task.courseId &&
              m.source.id === task.sourceId,
          )?.status !== "verified"
        )
          reason = "Task source is unverified";
        const due = task.deadlines.find((d) => d.kind === "official")?.value;
        if (due?.precision === "instant") eventAt = due.at;
        else reason = "No exact official time; no time invented";
        const observations = snapshot.taskHistory
          .filter(
            (h) => h.task.courseId === task.courseId && h.task.id === task.id,
          )
          .map((h) => h.observedAt);
        for (const scan of snapshot.scans ?? [])
          if (
            scan.result?.status === "complete" &&
            scan.tasks.some(
              (c) => c.task.courseId === task.courseId && c.task.id === task.id,
            )
          )
            observations.push(scan.result.appliedAt);
        verifiedAt = observations.sort(
          (a, b) => Date.parse(b) - Date.parse(a),
        )[0];
        const latest = (snapshot.scans ?? [])
          .filter(
            (s) =>
              s.scope.courseIds.includes(task.courseId) &&
              s.scope.surfaces.some((surface) =>
                ["content", "assessments", "announcements"].includes(surface),
              ) &&
              s.result,
          )
          .sort(
            (a, b) =>
              Date.parse(b.result!.appliedAt) - Date.parse(a.result!.appliedAt),
          )[0];
        if (latest && latest.result?.status !== "complete")
          reason = "Latest relevant check is incomplete";
      }
    } else {
      const session = snapshot.sessions?.find(
        (s) => s.feedId === selection.feedId && s.id === selection.id,
      );
      const feed = snapshot.calendars?.find((f) => f.id === selection.feedId);
      if (
        !session ||
        session.status !== "active" ||
        feed?.status !== "complete"
      )
        reason = "Session or timetable is missing, cancelled or unverified";
      else {
        if (session.start.precision === "instant") eventAt = session.start.at;
        else reason = "No exact session time";
        verifiedAt = feed.lastVerifiedAt ?? undefined;
      }
    }
    if (
      !verifiedAt ||
      Date.parse(verifiedAt) > instant ||
      instant - Date.parse(verifiedAt) >= 86400000
    )
      reason ??= "Evidence is stale or unverified";
    if (
      eventAt &&
      (Date.parse(eventAt) <= instant ||
        Date.parse(eventAt) > instant + 7 * 86400000)
    )
      reason ??= "Event is outside the next seven days";
    if (reason || !eventAt || !verifiedAt) {
      skipped.push({ selection: index, reason: reason ?? "Missing evidence" });
      return;
    }
    const identity =
      selection.kind === "task"
        ? ["task", selection.courseId, selection.id]
        : ["session", selection.feedId, selection.id];
    reminders.push(
      reminderSchema.parse({
        id: sha256(JSON.stringify([request.streamId, ...identity])),
        label: selection.label,
        eventAt,
        sendAt: new Date(
          Date.parse(eventAt) - request.leadMinutes * 60000,
        ).toISOString(),
        verifiedAt,
      }),
    );
  });
  const expiresAt = new Date(
    Math.min(
      instant + 86400000,
      ...reminders.map((r) => Date.parse(r.verifiedAt) + 86400000),
    ),
  ).toISOString();
  const projection = reminderProjectionSchema.parse({
    schemaVersion: 1,
    streamId: request.streamId,
    revision: request.revision,
    generatedAt: now,
    expiresAt,
    timeZone: snapshot.config.timeZone,
    reminders,
  });
  return { state: "prepared" as const, projection, skipped, uploaded: false };
}

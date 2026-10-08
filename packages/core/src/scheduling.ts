import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { idSchema, zoneSchema } from "./schema.js";
import { scanScopeSchema, type ScanScope } from "./observations.js";

export const scheduleSchema = z
  .strictObject({
    id: idSchema,
    scope: scanScopeSchema,
    timeZone: zoneSchema,
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    enabled: z.boolean(),
    optIn: z.boolean(),
    manualScanId: idSchema,
  })
  .refine(
    (v) => !v.enabled || v.optIn,
    "Explicit opt-in is required to enable scheduling",
  );
export type Schedule = z.infer<typeof scheduleSchema> & {
  revision: string;
  updatedAt: string;
};
export interface ScheduleRun {
  id: string;
  scheduleId: string;
  scheduleRevision: string;
  localDate: string;
  scope: ScanScope;
  startedAt: string;
  state: "running" | "complete" | "partial" | "failed" | "cancelled";
  finishedAt?: string;
  scanId?: string;
  detail?: string;
}
export const equalScope = (a: ScanScope, b: ScanScope): boolean =>
  a.adapter === b.adapter &&
  JSON.stringify([...a.courseIds].sort()) ===
    JSON.stringify([...b.courseIds].sort()) &&
  JSON.stringify([...a.surfaces].sort()) ===
    JSON.stringify([...b.surfaces].sort());

/** At most one run per local date. A sleeping machine catches up for two hours, not indefinitely. */
export function dueDate(schedule: Schedule, instant: string): string | null {
  const now = Temporal.Instant.from(instant).toZonedDateTimeISO(
    schedule.timeZone,
  );
  const [hour, minute] = schedule.localTime.split(":").map(Number);
  const due = Temporal.ZonedDateTime.from(
    {
      timeZone: schedule.timeZone,
      year: now.year,
      month: now.month,
      day: now.day,
      hour: hour!,
      minute: minute!,
    },
    { disambiguation: "compatible" },
  );
  const elapsed = now.epochMilliseconds - due.epochMilliseconds;
  return elapsed >= 0 && elapsed < 2 * 3600000
    ? now.toPlainDate().toString()
    : null;
}

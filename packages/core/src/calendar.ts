import { z } from "zod";
import { Worker } from "node:worker_threads";
import {
  idSchema,
  instantSchema,
  zoneSchema,
  type DateValue,
} from "./schema.js";

export const calendarWindowSchema = z
  .strictObject({ start: instantSchema, end: instantSchema })
  .refine(
    (v) =>
      Date.parse(v.end) > Date.parse(v.start) &&
      Date.parse(v.end) - Date.parse(v.start) <= 366 * 86400000,
    "Use a nonempty calendar window of at most 366 days",
  );
export const calendarImportSchema = z
  .strictObject({
    feedId: idSchema,
    title: z.string().trim().min(1).max(300),
    file: z.string().min(1),
    window: calendarWindowSchema,
    floatingTimeZone: zoneSchema.optional(),
    mappings: z
      .array(
        z.strictObject({
          uid: z.string().min(1).max(2000),
          courseId: idSchema,
        }),
      )
      .max(1000),
  })
  .refine(
    (v) => new Set(v.mappings.map((m) => m.uid)).size === v.mappings.length,
    "Duplicate calendar mapping",
  );
export type CalendarImport = z.infer<typeof calendarImportSchema>;
export interface CalendarOccurrence {
  id: string;
  uid: string;
  recurrenceId: string | null;
  title: string;
  location: string;
  start: DateValue;
  end: DateValue;
  sequence: number;
  status: "active" | "cancelled";
}
export interface CalendarCancellation {
  uid: string;
  recurrenceId: string | null;
  sequence: number;
}
export interface CalendarExtraction {
  occurrences: CalendarOccurrence[];
  cancellations: CalendarCancellation[];
}
export interface CalendarSession extends Omit<CalendarOccurrence, "status"> {
  feedId: string;
  courseId: string | null;
  sourceHash: string;
  lastObservedAt: string;
  status: "active" | "cancelled" | "missing";
}
export interface CalendarFeed {
  id: string;
  title: string;
  status: "complete" | "partial" | "failed";
  lastAttemptedAt: string;
  lastVerifiedAt: string | null;
  lastVerifiedHash: string | null;
  sourceHash: string | null;
  window: z.infer<typeof calendarWindowSchema>;
  issues: string[];
  cancellations: CalendarCancellation[];
}

export function extractCalendar(
  bytes: Buffer,
  input: CalendarImport,
): Promise<CalendarExtraction> {
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(
      new URL("./calendar-worker.js", import.meta.url),
      {
        workerData: {
          text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          input,
        },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
        stdout: true,
        stderr: true,
      },
    );
    worker.stdout.resume();
    worker.stderr.resume();
    let received = false;
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Calendar parsing exceeded the time limit"));
    }, 10000);
    worker.once(
      "message",
      (message: { result?: CalendarExtraction; error?: string }) => {
        received = true;
        clearTimeout(timer);
        void worker.terminate();
        if (message.result) resolveResult(message.result);
        else reject(new Error(message.error ?? "Invalid calendar"));
      },
    );
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (!received)
        reject(new Error(`Calendar reader exited without a result (${code})`));
    });
  });
}

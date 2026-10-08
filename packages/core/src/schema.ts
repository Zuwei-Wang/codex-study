import { z } from "zod";

export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const text = z.string().trim().min(1).max(2000);
export const zoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Expected an IANA time zone");
export const instantSchema = z.iso.datetime({ offset: true });
export const configSchema = z.strictObject({
  schemaVersion: z.literal(1),
  language: z.enum(["en", "zh-CN"]),
  timeZone: zoneSchema,
  academicYear: text,
});
export const courseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema,
  title: text,
  adapter: z.enum(["manual", "blackboard-ultra"]),
  coursePage: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "Use a canonical HTTPS course page without credentials or query tokens")
    .optional(),
});
export const sourceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  courseId: idSchema,
  id: idSchema,
  title: text,
  reference: text,
  kind: z.enum(["slides", "assignment", "template", "personal", "other"]),
});
export const dateSchema = z.discriminatedUnion("precision", [
  z.strictObject({ precision: z.literal("unknown") }),
  z.strictObject({ precision: z.literal("date"), date: z.iso.date() }),
  z.strictObject({ precision: z.literal("instant"), at: instantSchema }),
]);
export const deadlineSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(["official", "personal", "feedback"]),
  value: dateSchema,
  evidence: text,
});
export const taskSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    courseId: idSchema,
    id: idSchema,
    title: text,
    sourceId: idSchema,
    // Explicit empty arrays mean unknown; they never mean there is no work.
    deadlines: z.array(deadlineSchema).max(100),
  })
  .superRefine((task, ctx) => {
    if (new Set(task.deadlines.map((d) => d.id)).size !== task.deadlines.length)
      ctx.addIssue({ code: "custom", message: "Duplicate deadline identity" });
  });
export const progressSchema = z.enum([
  "opened",
  "read",
  "drafted",
  "uploaded",
  "submitted",
  "graded",
]);
export const attemptSchema = z.strictObject({
  status: z.enum(["partial", "failed"]),
  detail: text,
});
export type Config = z.infer<typeof configSchema>;
export type Course = z.infer<typeof courseSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Task = z.infer<typeof taskSchema>;
export type DateValue = z.infer<typeof dateSchema>;
export type Progress = z.infer<typeof progressSchema>;

export function officialDateState(
  task: Task,
): "unknown" | "known" | "conflict" {
  const official = task.deadlines.filter((d) => d.kind === "official");
  const values = new Set(
    official
      .filter((d) => d.value.precision !== "unknown")
      .map((d) =>
        d.value.precision === "instant"
          ? String(Date.parse(d.value.at))
          : JSON.stringify(d.value),
      ),
  );
  if (values.size > 1) return "conflict";
  if (!values.size || official.some((d) => d.value.precision === "unknown"))
    return "unknown";
  return "known";
}

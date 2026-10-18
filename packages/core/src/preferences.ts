import { z } from "zod";
import { instantSchema } from "./schema.js";

const choices = z.strictObject({
  planningStyle: z.enum(["steady", "deadline-driven", "flexible"]).optional(),
  learningMode: z.enum(["self-study", "lecture-led", "mixed"]).optional(),
  sessionMinutes: z.number().int().min(10).max(180).optional(),
  supportStyle: z.enum(["small-steps", "light-touch", "on-request"]).optional(),
});
export const learningPreferencesSchema = z.discriminatedUnion("status", [
  choices
    .extend({ status: z.literal("provided") })
    .refine(
      (value) =>
        Object.entries(value).some(
          ([key, answer]) => key !== "status" && answer !== undefined,
        ),
      "Provide at least one preference, or explicitly skip",
    ),
  z.strictObject({ status: z.literal("skipped") }),
]);
export const preferencesSaveSchema = z.strictObject({
  expectedRevision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  preferences: learningPreferencesSchema.nullable(),
});
export const preferencesRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: instantSchema,
  preferences: learningPreferencesSchema.nullable(),
});
export type PreferencesRecord = z.infer<typeof preferencesRecordSchema>;

/** Suggestions only: no task, date, progress, schedule or notification writes. */
export function preferenceGuidance(record: PreferencesRecord | null) {
  const p = record?.preferences;
  if (!p || p.status === "skipped") return null;
  return {
    ...(p.planningStyle
      ? {
          planning: {
            steady: "regular-blocks",
            "deadline-driven": "small-milestones",
            flexible: "adjustable-blocks",
          }[p.planningStyle],
        }
      : {}),
    ...(p.learningMode
      ? {
          lessonOrder: {
            "self-study": "read-practice-review",
            "lecture-led": "preview-attend-review",
            mixed: "preview-learn-practice",
          }[p.learningMode],
        }
      : {}),
    ...(p.sessionMinutes ? { sessionMinutes: p.sessionMinutes } : {}),
    ...(p.supportStyle ? { supportStyle: p.supportStyle } : {}),
  };
}

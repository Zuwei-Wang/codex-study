import { z } from "zod";
import { idSchema, instantSchema, sourceSchema, taskSchema } from "./schema.js";
import { hashSchema } from "./learning.js";

const surfaceSchema = z.enum([
  "content",
  "assessments",
  "announcements",
  "calendar",
]);

export const scanScopeSchema = z
  .strictObject({
    adapter: z.enum(["manual", "blackboard-ultra"]),
    courseIds: z.array(idSchema).min(1).max(100),
    surfaces: z.array(surfaceSchema).min(1).max(4),
  })
  .refine(
    (v) =>
      new Set(v.courseIds).size === v.courseIds.length &&
      new Set(v.surfaces).size === v.surfaces.length,
    "Duplicate scan scope",
  );
export type ScanScope = z.infer<typeof scanScopeSchema>;
export const scanObservationSchema = z
  .strictObject({
    courseId: idSchema,
    surface: surfaceSchema,
    status: z.enum(["complete", "partial", "failed"]),
    reason: z.enum([
      "observed",
      "session-expired",
      "mfa-required",
      "capability-unavailable",
      "download-unverified",
      "coverage-incomplete",
      "other",
    ]),
    observedAt: instantSchema,
    evidence: z.string().trim().min(1).max(4000),
  })
  .refine(
    (v) => v.status !== "complete" || v.reason === "observed",
    "Complete observations must have observed evidence",
  );
export const scanRecordSchema = z.strictObject({
  id: idSchema,
  expectedRevision: hashSchema,
  observations: z.array(scanObservationSchema).max(400),
  files: z
    .array(
      z.strictObject({
        source: sourceSchema,
        surface: surfaceSchema,
        file: z.string().min(1),
        expectedHash: hashSchema,
      }),
    )
    .max(1000),
  tasks: z
    .array(z.strictObject({ task: taskSchema, surface: surfaceSchema }))
    .max(1000),
});
export type ScanCandidate = {
  id: string;
  scope: ScanScope;
  createdAt: string;
  baseline: string;
  revision: string;
  runId?: string;
  state: "prepared" | "candidate" | "applied";
  observations: z.infer<typeof scanObservationSchema>[];
  files: z.infer<typeof scanRecordSchema>["files"];
  tasks: z.infer<typeof scanRecordSchema>["tasks"];
  result?: {
    status: "complete" | "partial" | "failed";
    changed: boolean;
    filesChanged: number;
    tasksChanged: number;
    appliedAt: string;
  };
};

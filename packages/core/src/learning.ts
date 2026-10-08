import { z } from "zod";
import { idSchema } from "./schema.js";

export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const materialReadSchema = z.strictObject({
  courseId: idSchema,
  sourceId: idSchema,
  hash: hashSchema,
  start: z.number().int().min(1),
  count: z.number().int().min(1).max(20),
});
export const citationSchema = z
  .strictObject({
    sourceId: idSchema,
    hash: hashSchema,
    unit: z.enum(["page", "section"]),
    start: z.number().int().min(1),
    end: z.number().int().min(1),
    quote: z.string().trim().min(1).max(2000),
  })
  .refine(
    (c) => c.end >= c.start && c.end - c.start < 20,
    "Cite one to twenty units",
  );
export const noteSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    courseId: idSchema,
    id: idSchema,
    title: z.string().trim().min(1).max(300),
    coverage: z.discriminatedUnion("basis", [
      z.strictObject({ basis: z.literal("published-material") }),
      z.strictObject({
        basis: z.literal("user-confirmed-session"),
        evidence: z.string().trim().min(1).max(2000),
      }),
    ]),
    sections: z
      .array(
        z.strictObject({
          kind: z.enum([
            "material",
            "explanation",
            "self-test",
            "user-reflection",
          ]),
          body: z.string().trim().min(1).max(20000),
          citations: z.array(citationSchema).max(10),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((note, ctx) => {
    if (!note.sections.some((s) => s.citations.length))
      ctx.addIssue({
        code: "custom",
        message: "At least one material citation is required",
      });
    for (const section of note.sections)
      if (section.kind === "material" && !section.citations.length)
        ctx.addIssue({
          code: "custom",
          message: "Material sections require citations",
        });
  });
export const noteSaveSchema = z.strictObject({
  note: noteSchema,
  expectedRevision: hashSchema.nullable(),
});
export type StudyNote = z.infer<typeof noteSchema>;
export interface NoteRecord {
  schemaVersion: 1;
  note: StudyNote;
  revision: string;
  createdAt: string;
  relativePath: string;
  fileHash: string;
}
export interface Reading {
  schemaVersion: 1;
  sourceId: string;
  courseId: string;
  hash: string;
  unit: "page" | "section";
  total: number;
  parts: { number: number; text: string; truncated: boolean }[];
  status: "complete" | "partial" | "unsupported";
  warnings: string[];
  untrusted: true;
}

const safe = (value: string) =>
  value.replace(/[\\`*_\[\]<>]/g, "\\$&").replace(/[\r\n]/g, " ");
export function renderNote(
  note: StudyNote,
  formats: Map<string, string>,
): string {
  const lines = [
    `# ${safe(note.title)}`,
    "",
    `Course: ${safe(note.courseId)} · Note: ${safe(note.id)}`,
    "",
    `Coverage: ${note.coverage.basis}`,
    "",
    note.coverage.basis === "published-material"
      ? "Based on published material; live teaching coverage and attendance are not confirmed."
      : `User-supplied session evidence: ${safe(note.coverage.evidence)}`,
    "",
    "Citations validate locations and quoted text, not the correctness of the explanation. PDF citations cover extracted text only; diagrams and layout require visual review.",
    "",
  ];
  for (const [index, section] of note.sections.entries()) {
    lines.push(`## ${index + 1}. ${section.kind}`, "", section.body, "");
    for (const citation of section.citations) {
      const extension = formats.get(`${citation.sourceId}:${citation.hash}`)!;
      const anchor = citation.unit === "page" ? `#page=${citation.start}` : "";
      lines.push(
        `- Source: [${safe(citation.sourceId)} · ${citation.unit} ${citation.start}–${citation.end}](../objects/${citation.hash}.${extension}${anchor}) · SHA-256: \`${citation.hash}\``,
        `  - Quoted evidence: ${safe(citation.quote)}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

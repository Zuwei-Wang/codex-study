import type { StudyNote } from "../packages/core/src/index.js";
import { source } from "./helpers.js";
export function sampleNote(hash: string): StudyNote {
  return {
    schemaVersion: 1,
    courseId: source.courseId,
    id: "lesson",
    title: "Synthetic lesson",
    coverage: { basis: "published-material" },
    sections: [
      {
        kind: "material",
        body: "This version introduces the synthetic example.",
        citations: [
          {
            sourceId: source.id,
            hash,
            unit: "section",
            start: 2,
            end: 2,
            quote: "Version one",
          },
        ],
      },
      {
        kind: "explanation",
        body: "An illustrative explanation, separate from the source.",
        citations: [],
      },
    ],
  };
}

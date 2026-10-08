import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { TestContext } from "node:test";
import {
  Workspace,
  type Config,
  type Source,
  type Task,
} from "../packages/core/src/index.js";

export const config: Config = {
  schemaVersion: 1,
  language: "en",
  timeZone: "Europe/London",
  academicYear: "2030/31",
};
export const source: Source = {
  schemaVersion: 1,
  courseId: "DEMO101",
  id: "slides-1",
  title: "Synthetic slides",
  reference: "Synthetic manual fixture",
  kind: "slides",
};
export const task: Task = {
  schemaVersion: 1,
  courseId: "DEMO101",
  id: "reading",
  title: "Synthetic reading",
  sourceId: "slides-1",
  deadlines: [
    {
      id: "brief",
      kind: "official",
      value: { precision: "date", date: "2030-11-10" },
      evidence: "Synthetic brief",
    },
  ],
};
export const course = {
  schemaVersion: 1,
  id: "DEMO101",
  title: "Synthetic Systems",
  adapter: "manual",
};

export function temp(t: TestContext): string {
  mkdirSync(resolve("tmp/tests"), { recursive: true });
  const root = mkdtempSync(resolve("tmp/tests/case-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
export function setup(t: TestContext, profile: Config = config) {
  const tempRoot = temp(t);
  const path = join(tempRoot, "workspace");
  const file = join(tempRoot, "slides.md");
  writeFileSync(file, "# Synthetic slides\n\n---\n\nVersion one\n");
  const workspace = Workspace.initialize(path, profile);
  workspace.putCourse(course);
  t.after(() => workspace.close());
  return { tempRoot, path, file, workspace };
}

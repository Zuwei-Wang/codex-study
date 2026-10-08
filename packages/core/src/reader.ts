import { Worker } from "node:worker_threads";
import type { Reading } from "./learning.js";

export const READER_LIMIT = 32000;
export interface Extracted {
  unit: "page" | "section";
  total: number;
  parts: Reading["parts"];
  warnings: string[];
}

export function markdownSections(input: string): string[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const sections: string[] = [];
  let current: string[] = [],
    fence = "",
    frontmatter = lines[0]?.trim() === "---";
  for (const [index, line] of lines.entries()) {
    if (frontmatter) {
      current.push(line);
      if (index > 0 && line.trim() === "---") frontmatter = false;
      continue;
    }
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1]!;
      else if (match[1]![0] === fence[0] && match[1]!.length >= fence.length)
        fence = "";
    }
    if (!fence && /^\s*---+\s*$/.test(line)) {
      sections.push(current.join("\n"));
      current = [];
    } else current.push(line);
  }
  sections.push(current.join("\n"));
  return sections;
}

export async function extractMaterial(
  bytes: Buffer,
  format: string,
  start: number,
  count: number,
): Promise<Extracted | null> {
  if (format === "md" || format === "txt") {
    const input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const sections =
      format === "md" ? markdownSections(input) : input.split("\f");
    if (start > sections.length)
      throw new Error("Requested section is outside this material");
    return {
      unit: "section",
      total: sections.length,
      parts: sections.slice(start - 1, start - 1 + count).map((text, i) => ({
        number: start + i,
        text: text.slice(0, READER_LIMIT),
        truncated: text.length > READER_LIMIT,
      })),
      warnings: [
        "Section numbers describe text boundaries, not PDF pages, teaching weeks or confirmed lecture coverage.",
      ],
    };
  }
  if (format !== "pdf") return null;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdf-worker.js", import.meta.url), {
      workerData: {
        bytes: new Uint8Array(bytes),
        start,
        count,
        limit: READER_LIMIT,
      },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
      stdout: true,
      stderr: true,
    });
    // Parser chatter never enters MCP stdout or echoes source content into logs.
    worker.stdout.resume();
    worker.stderr.resume();
    let received = false;
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(
        new Error(
          "PDF extraction timed out; use a smaller document or explicit manual reading",
        ),
      );
    }, 30000);
    worker.once(
      "message",
      (message: { result?: Extracted; error?: string }) => {
        received = true;
        clearTimeout(timer);
        void worker.terminate();
        if (message.result) resolve(message.result);
        else reject(new Error(message.error ?? "PDF extraction failed"));
      },
    );
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (!received)
        reject(new Error(`PDF reader exited without a result (${code})`));
    });
  });
}

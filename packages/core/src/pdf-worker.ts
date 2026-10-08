import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const { bytes, start, count, limit } = workerData as {
  bytes: Uint8Array;
  start: number;
  count: number;
  limit: number;
};
try {
  const loading = getDocument({
    data: bytes,
    verbosity: 0,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    useWorkerFetch: false,
    stopAtErrors: true,
  });
  try {
    const document = await loading.promise;
    if (document.numPages > 2000)
      throw new Error("PDF exceeds the 2000-page reader limit");
    if (start > document.numPages)
      throw new Error("Requested page is outside this PDF");
    const parts = [];
    for (
      let number = start;
      number <= Math.min(document.numPages, start + count - 1);
      number++
    ) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("")
        .trim();
      parts.push({
        number,
        text: text.slice(0, limit),
        truncated: text.length > limit,
      });
      page.cleanup();
    }
    parentPort!.postMessage({
      result: {
        unit: "page",
        total: document.numPages,
        parts,
        warnings: [
          "PDF text extraction only: images, diagrams, layout and reading order are not verified. No OCR is performed.",
        ],
      },
    });
  } finally {
    await loading.destroy();
  }
} catch (error) {
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : "PDF extraction failed",
  });
}

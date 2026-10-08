import { parentPort, workerData } from "node:worker_threads";
import { parseCalendar } from "./calendar-reader.js";
import type { CalendarImport } from "./calendar.js";
const { text, input } = workerData as { text: string; input: CalendarImport };
try {
  parentPort!.postMessage({ result: parseCalendar(text, input) });
} catch (error) {
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : "Invalid calendar",
  });
}

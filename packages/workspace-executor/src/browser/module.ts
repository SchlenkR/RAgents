import type { Browser } from "playwright-core";
import { WorkspaceOperationError } from "../errors.js";
import type { WorkspaceModuleFactory } from "../module.js";
import { BROWSER_OPERATIONS, type BrowserCheck, type BrowserTarget, type BrowserViewport } from "./contract.js";
import { BrowserPages } from "./pages.js";
import { launchChromium } from "./playwright.js";

const BROWSER_TIMEOUT_MS = 15_000;

export interface BrowserModuleOptions {
  /** Startet den Browser eines Runs; ohne Angabe Chrome über playwright-core aus dem Host dieser Maschine. */
  launch?: (runId: string) => Promise<Browser>;
  timeoutMs?: number;
  checkTimeoutMs?: number;
}

const invalid = (message: string): WorkspaceOperationError => new WorkspaceOperationError("browser-input-invalid", message, 400);

const fieldsOf = (input: unknown): Readonly<Record<string, unknown>> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid("Die Eingabe einer Browseroperation ist ein Objekt");
  return input as Readonly<Record<string, unknown>>;
};

const textOf = (input: unknown, key: string): string => {
  const value = fieldsOf(input)[key];
  if (typeof value !== "string") throw invalid(`Die Browseroperation braucht ${key} als Text`);
  return value;
};

const targetOf = (input: unknown): BrowserTarget => {
  const value = fieldsOf(input).target;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("Die Browseroperation braucht ein Ziel");
  return value as BrowserTarget;
};

const viewportOf = (input: unknown): BrowserViewport => {
  const { width, height } = fieldsOf(input);
  if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw invalid("Ein Viewport braucht Breite und Höhe als positive ganze Zahlen");
  }
  return { width, height };
};

/** Der Browser eines Runs auf dieser Maschine: Seite, Aktionen, Prüfungen und Aufnahmen; Evidenz und Ablage hält der Aufrufer. */
export const browserModule = (options: BrowserModuleOptions = {}): WorkspaceModuleFactory => (host) => {
  const timeoutMs = options.timeoutMs ?? BROWSER_TIMEOUT_MS;
  const pages = new BrowserPages({
    launch: options.launch ?? (async (runId) => launchChromium((await host.contextFor(runId)).hostRoot, runId, timeoutMs)),
    timeoutMs,
    checkTimeoutMs: options.checkTimeoutMs ?? Math.min(5_000, timeoutMs),
  });
  return {
    operations: {
      [BROWSER_OPERATIONS.open]: ({ runId, input, signal }) =>
        pages.open(runId, textOf(input, "url"), viewportOf(fieldsOf(input).viewport), signal),
      [BROWSER_OPERATIONS.snapshot]: ({ runId, signal }) => pages.snapshot(runId, signal),
      [BROWSER_OPERATIONS.viewport]: ({ runId, input, signal }) => pages.viewport(runId, viewportOf(input), signal),
      [BROWSER_OPERATIONS.click]: ({ runId, input, signal }) => pages.click(runId, targetOf(input), signal),
      [BROWSER_OPERATIONS.fill]: ({ runId, input, signal }) => pages.fill(runId, targetOf(input), textOf(input, "value"), signal),
      [BROWSER_OPERATIONS.select]: ({ runId, input, signal }) => pages.select(runId, targetOf(input), textOf(input, "label"), signal),
      [BROWSER_OPERATIONS.press]: ({ runId, input, signal }) => pages.press(runId, targetOf(input), textOf(input, "key"), signal),
      [BROWSER_OPERATIONS.check]: ({ runId, input, signal }) => pages.check(runId, fieldsOf(input) as BrowserCheck, signal),
      [BROWSER_OPERATIONS.screenshot]: ({ runId, input, signal }) =>
        pages.screenshot(runId, textOf(input, "id"), fieldsOf(input).fullPage === true, signal),
      [BROWSER_OPERATIONS.state]: async ({ runId }) => pages.state(runId),
      [BROWSER_OPERATIONS.close]: async ({ runId }) => {
        await pages.close(runId);
        return null;
      },
    },
    stopRun: (runId) => pages.close(runId),
    shutdown: () => pages.shutdown(),
  };
};

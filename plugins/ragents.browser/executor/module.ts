import type { Browser } from "playwright-core";
import type { WorkspaceExecutorMachine, WorkspaceModuleFactory } from "@ragents/workspace-executor";
import { BROWSER_OPERATIONS, type BrowserCheck, type BrowserTarget, type BrowserViewport } from "./contract.js";
import { BrowserPages } from "./pages.js";
import { launchChromium } from "./playwright.js";

const BROWSER_TIMEOUT_MS = 15_000;

export interface BrowserModuleOptions {
  /** Starts a run's browser; if omitted, Chrome via playwright-core from this machine's host. */
  launch?: (runId: string) => Promise<Browser>;
  timeoutMs?: number;
  checkTimeoutMs?: number;
}

/** A run's browser on this machine: page, actions, checks and screenshots; the caller holds evidence and storage. */
export const browserModule = (machine: WorkspaceExecutorMachine, options: BrowserModuleOptions = {}): WorkspaceModuleFactory => (host) => {
  const invalid = (message: string): Error => machine.operationError("browser-input-invalid", message, 400);
  const fieldsOf = (input: unknown): Readonly<Record<string, unknown>> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid("The input of a browser operation is an object");
    return input as Readonly<Record<string, unknown>>;
  };
  const textOf = (input: unknown, key: string): string => {
    const value = fieldsOf(input)[key];
    if (typeof value !== "string") throw invalid(`The browser operation needs ${key} as text`);
    return value;
  };
  const targetOf = (input: unknown): BrowserTarget => {
    const value = fieldsOf(input).target;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("The browser operation needs a target");
    return value as BrowserTarget;
  };
  const viewportOf = (input: unknown): BrowserViewport => {
    const { width, height } = fieldsOf(input);
    if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw invalid("A viewport needs width and height as positive integers");
    }
    return { width, height };
  };
  const timeoutMs = options.timeoutMs ?? BROWSER_TIMEOUT_MS;
  const pages = new BrowserPages({
    launch: options.launch ?? (async (runId) => launchChromium(machine, (await host.contextFor(runId)).hostRoot, runId, timeoutMs)),
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

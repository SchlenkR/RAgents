import type { Browser } from "playwright-core";
import type { WorkspaceExecutorMachine, WorkspaceModuleFactory } from "@ragents/workspace-executor";
import { BROWSER_OPERATIONS, type BrowserCheck, type BrowserTarget, type BrowserTyping, type BrowserViewport } from "./contract.js";
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
  const flagOf = (input: unknown, key: string): boolean => {
    const value = fieldsOf(input)[key];
    if (value !== undefined && typeof value !== "boolean") throw invalid(`The browser operation needs ${key} as true or false`);
    return value === true;
  };
  const targetOf = (input: unknown): BrowserTarget => {
    const value = fieldsOf(input).target;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("The browser operation needs a target");
    return value as BrowserTarget;
  };
  const optionalTargetOf = (input: unknown): BrowserTarget | undefined => fieldsOf(input).target === undefined ? undefined : targetOf(input);
  const typingOf = (input: unknown): BrowserTyping => ({ text: textOf(input, "text"), submit: flagOf(input, "submit"), slowly: flagOf(input, "slowly") });
  const valuesOf = (input: unknown): string[] => {
    const value = fieldsOf(input).values;
    if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string")) throw invalid("The browser operation needs values as a non-empty list of texts");
    return value as string[];
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
    launch: options.launch ?? (async (runId) => {
      const context = await host.contextFor(runId);
      return launchChromium(machine, context.hostRoot, runId, timeoutMs, context.browserNetwork === undefined ? undefined : async () => {
        const policy = (await host.contextFor(runId)).browserNetwork;
        if (policy === undefined) throw new Error("The restricted browser has no network policy.");
        return policy;
      }, context.env);
    }),
    contextOptions: async (runId) => (await host.contextFor(runId)).browserNetwork === undefined ? {} : { serviceWorkers: "block" },
    timeoutMs,
    checkTimeoutMs: options.checkTimeoutMs ?? Math.min(5_000, timeoutMs),
  });
  return {
    operations: {
      [BROWSER_OPERATIONS.navigate]: ({ runId, input, signal }) =>
        pages.navigate(runId, textOf(input, "url"), viewportOf(fieldsOf(input).viewport), signal),
      [BROWSER_OPERATIONS.snapshot]: ({ runId, signal }) => pages.snapshot(runId, signal),
      [BROWSER_OPERATIONS.resize]: ({ runId, input, signal }) => pages.resize(runId, viewportOf(input), signal),
      [BROWSER_OPERATIONS.click]: ({ runId, input, signal }) => pages.click(runId, targetOf(input), signal),
      [BROWSER_OPERATIONS.type]: ({ runId, input, signal }) => pages.type(runId, targetOf(input), typingOf(input), signal),
      [BROWSER_OPERATIONS.selectOption]: ({ runId, input, signal }) => pages.selectOption(runId, targetOf(input), valuesOf(input), signal),
      [BROWSER_OPERATIONS.pressKey]: ({ runId, input, signal }) => pages.pressKey(runId, optionalTargetOf(input), textOf(input, "key"), signal),
      [BROWSER_OPERATIONS.check]: ({ runId, input, signal }) => pages.check(runId, fieldsOf(input) as BrowserCheck, signal),
      [BROWSER_OPERATIONS.takeScreenshot]: ({ runId, input, signal }) =>
        pages.takeScreenshot(runId, textOf(input, "id"), flagOf(input, "fullPage"), signal),
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

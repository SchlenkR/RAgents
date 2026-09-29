import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Browser } from "playwright-core";
import type { WorkspaceExecutorMachine } from "@ragents/workspace-executor";
import { BROWSER_EXECUTABLE_VARIABLE } from "./contract.js";

type Playwright = typeof import("playwright-core");

/** playwright-core lives in the node_modules of this machine's host and is loaded only on call, never with the contribution. */
export const hostPlaywright = async (machine: WorkspaceExecutorMachine, hostRoot: string | undefined): Promise<Playwright> => {
  const loaded = await import(pathToFileURL(machine.hostPackageFile(hostRoot, "playwright-core")).href) as { default: Playwright };
  return loaded.default;
};

/** This machine's Chrome: the one from its environment, otherwise the Chromium that provisioning fetches for playwright-core. */
export const browserExecutable = async (playwright: Playwright, environment: NodeJS.ProcessEnv = process.env): Promise<string> => {
  const configured = environment[BROWSER_EXECUTABLE_VARIABLE];
  const candidate = configured ? configured : playwright.chromium.executablePath();
  if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  throw new Error((configured
    ? `${BROWSER_EXECUTABLE_VARIABLE} names ${configured}; there is no executable browser there on this machine. `
    : `There is no executable browser on this machine: ${BROWSER_EXECUTABLE_VARIABLE} is not set and Chromium is missing at ${candidate}. `)
    + "A workspace fetches Chromium with pnpm provision --workspace, a server with pnpm provision <profile>; "
    + `${BROWSER_EXECUTABLE_VARIABLE} names an existing Chrome, on a server in the profile section ragents.browser, `
    + "on a workspace in its environment.");
};

/** Starts Chrome headless with this machine's environment and the run's marker so the process view can attribute it. */
export const launchChromium = async (machine: WorkspaceExecutorMachine, hostRoot: string | undefined, runId: string, timeoutMs: number): Promise<Browser> => {
  const playwright = await hostPlaywright(machine, hostRoot);
  return playwright.chromium.launch({
    executablePath: await browserExecutable(playwright),
    headless: true,
    timeout: timeoutMs,
    env: machine.processEnvironment(runId),
  });
};

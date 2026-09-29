import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Browser } from "playwright-core";
import type { WorkspaceExecutorMachine } from "@ragents/workspace-executor";
import { BROWSER_EXECUTABLE_VARIABLE } from "./contract.js";

type Playwright = typeof import("playwright-core");

/** playwright-core liegt in den node_modules des Hosts dieser Maschine und wird erst im Aufruf geladen, nie mit dem Beitrag. */
export const hostPlaywright = async (machine: WorkspaceExecutorMachine, hostRoot: string | undefined): Promise<Playwright> => {
  const loaded = await import(pathToFileURL(machine.hostPackageFile(hostRoot, "playwright-core")).href) as { default: Playwright };
  return loaded.default;
};

/** Der Chrome dieser Maschine: der aus ihrer Umgebung, sonst das Chromium, das die Provisionierung für playwright-core holt. */
export const browserExecutable = async (playwright: Playwright, environment: NodeJS.ProcessEnv = process.env): Promise<string> => {
  const configured = environment[BROWSER_EXECUTABLE_VARIABLE];
  const candidate = configured ? configured : playwright.chromium.executablePath();
  if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  throw new Error((configured
    ? `${BROWSER_EXECUTABLE_VARIABLE} nennt ${configured}; dort gibt es auf diesem Rechner keinen ausführbaren Browser. `
    : `Auf diesem Rechner gibt es keinen ausführbaren Browser: ${BROWSER_EXECUTABLE_VARIABLE} ist nicht gesetzt und Chromium fehlt unter ${candidate}. `)
    + "Ein Arbeitsplatz holt Chromium mit pnpm provision --workspace, ein Server mit pnpm provision <profil>; "
    + `${BROWSER_EXECUTABLE_VARIABLE} nennt einen vorhandenen Chrome, auf einem Server in der Profilsektion ragents.browser, `
    + "auf einem Arbeitsplatz in seiner Umgebung.");
};

/** Startet Chrome headless mit der Umgebung dieser Maschine und dem Marker des Runs, damit die Prozessanzeige ihn zuordnet. */
export const launchChromium = async (machine: WorkspaceExecutorMachine, hostRoot: string | undefined, runId: string, timeoutMs: number): Promise<Browser> => {
  const playwright = await hostPlaywright(machine, hostRoot);
  return playwright.chromium.launch({
    executablePath: await browserExecutable(playwright),
    headless: true,
    timeout: timeoutMs,
    env: machine.processEnvironment(runId),
  });
};

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import type { Browser } from "playwright-core";
import { RUN_MARKER_ENV } from "../run-marker.js";
import { safeProcessEnvironment } from "../safe-environment.js";
import { BROWSER_EXECUTABLE_VARIABLE } from "./contract.js";

type Playwright = typeof import("playwright-core");

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** playwright-core liegt in den node_modules des Hosts dieser Maschine und wird erst im Aufruf geladen, nie mit dem Executor. */
export const hostPlaywright = (hostRoot: string | undefined): Playwright => {
  if (!hostRoot) {
    throw new Error("Für die Browserprüfung ist auf diesem Rechner kein Host bekannt, aus dem sich playwright-core auflösen "
      + "ließe. Ein Arbeitsplatz bekommt ihn mit der ersten Verbindung zu einem verteilenden Server oder über die "
      + "Einstellung ragents.hostPath");
  }
  const load = createRequire(path.join(hostRoot, "package.json"));
  try {
    return load("playwright-core") as Playwright;
  } catch (cause) {
    throw new Error(`playwright-core liegt nicht im Host ${hostRoot}: ${messageOf(cause)}`);
  }
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
export const launchChromium = async (hostRoot: string | undefined, runId: string, timeoutMs: number): Promise<Browser> => {
  const playwright = hostPlaywright(hostRoot);
  return playwright.chromium.launch({
    executablePath: await browserExecutable(playwright),
    headless: true,
    timeout: timeoutMs,
    env: { ...safeProcessEnvironment(process.env), HOME: homedir(), [RUN_MARKER_ENV]: runId },
  });
};

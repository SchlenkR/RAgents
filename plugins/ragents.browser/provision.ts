import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import {
  hostPackageFolder,
  provisionGap,
  provisionReady,
  type PluginProvision,
} from "@ragents/host/plugin-support/provision.js";
import { BROWSER_EXECUTABLE_VARIABLE } from "./executor/contract.js";

const executable = async (file: string): Promise<boolean> => access(file, constants.X_OK).then(() => true, () => false);

const playwrightCli = (): string => path.join(hostPackageFolder("playwright-core"), "cli.js");

const install = (log: (line: string) => void): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [playwrightCli(), "install", ...(process.platform === "linux" ? ["--with-deps"] : []), "chromium"], { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => log(chunk.toString().trimEnd()));
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`playwright-core install chromium exited with code ${code}`)));
});

// Playwright manages its browser cache itself; the plugin's tool folder stays empty.
export const createBrowserProvision = (): PluginProvision => ({
  check: async () => {
    const configured = process.env[BROWSER_EXECUTABLE_VARIABLE];
    if (configured) {
      return await executable(configured)
        ? provisionReady
        : provisionGap("browser", `${BROWSER_EXECUTABLE_VARIABLE} names ${configured}; there is no executable browser there`, false);
    }
    const bundled = chromium.executablePath();
    return await executable(bundled)
      ? provisionReady
      : provisionGap("chromium", `Chromium is missing at ${bundled}; either set ${BROWSER_EXECUTABLE_VARIABLE} to an existing Chrome `
        + "(on a server in the profile section ragents.browser, on a workspace in its environment) or let "
        + "provisioning download the browser", true);
  },
  apply: async (_target, log) => {
    const state = await createBrowserProvision().check("");
    if (state.kind === "ready") return;
    if (!state.installable) throw new Error(state.instruction);
    log("Downloading Chromium for playwright-core");
    await install(log);
  },
});

export const provision = createBrowserProvision();

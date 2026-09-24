import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { BROWSER_EXECUTABLE_VARIABLE } from "@ragents/workspace-executor";
import {
  hostPackageFolder,
  provisionGap,
  provisionReady,
  type PluginProvision,
} from "@ragents/host/plugin-support/provision.js";

const executable = async (file: string): Promise<boolean> => access(file, constants.X_OK).then(() => true, () => false);

const playwrightCli = (): string => path.join(hostPackageFolder("playwright-core"), "cli.js");

const install = (log: (line: string) => void): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [playwrightCli(), "install", ...(process.platform === "linux" ? ["--with-deps"] : []), "chromium"], { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => log(chunk.toString().trimEnd()));
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`playwright-core install chromium endete mit Code ${code}`)));
});

// Playwright verwaltet seinen Browsercache selbst; der Werkzeugordner des Plugins bleibt leer.
export const createBrowserProvision = (): PluginProvision => ({
  check: async () => {
    const configured = process.env[BROWSER_EXECUTABLE_VARIABLE];
    if (configured) {
      return await executable(configured)
        ? provisionReady
        : provisionGap("browser", `${BROWSER_EXECUTABLE_VARIABLE} nennt ${configured}; dort gibt es keinen ausführbaren Browser`, false);
    }
    const bundled = chromium.executablePath();
    return await executable(bundled)
      ? provisionReady
      : provisionGap("chromium", `Chromium fehlt unter ${bundled}; entweder ${BROWSER_EXECUTABLE_VARIABLE} auf einen vorhandenen Chrome `
        + "setzen (auf einem Server in der Profilsektion ragents.browser, auf einem Arbeitsplatz in seiner Umgebung) oder die "
        + "Provisionierung den Browser laden lassen", true);
  },
  apply: async (_target, log) => {
    const state = await createBrowserProvision().check("");
    if (state.kind === "ready") return;
    if (!state.installable) throw new Error(state.instruction);
    log("Chromium für playwright-core laden");
    await install(log);
  },
});

export const provision = createBrowserProvision();

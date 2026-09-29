import path from "node:path";
import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";
import { createLanguageServerPlugin } from "@ragents/host/plugin-support/language-server/plugin.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { runtimeProviderToken } from "@ragents/host/ragents/host-services.js";
import { askServiceToken } from "@ragents/plugins/ragents.ask/server/contract.js";
import { roslynLanguageServer, ROSLYN_SERVER_VARIABLE } from "../executor.js";
import {
  createSolutionOnStart,
  SOLUTION_ON_START_VARIABLE,
  SOLUTION_PREFERRED_VARIABLE,
  type SolutionOnStart,
} from "./solution-on-start.js";

export const roslynConfigDescriptors = [
  { key: ROSLYN_SERVER_VARIABLE, source: "environment" },
  { key: SOLUTION_ON_START_VARIABLE, source: "environment" },
  { key: SOLUTION_PREFERRED_VARIABLE, source: "environment" },
] as const;

const PLUGIN_ID = "ragents.lsp-roslyn";

const env = declaredEnvironment(roslynConfigDescriptors);

/** Ohne Angabe lädt ein neuer Run nichts von selbst; einschalten geht nur ausdrücklich mit "on". */
export const solutionOnStart = (): boolean => {
  const mode = env.optional(SOLUTION_ON_START_VARIABLE) ?? "off";
  if (mode !== "on" && mode !== "off") {
    throw new Error(`${SOLUTION_ON_START_VARIABLE} in der Sektion ragents.lsp-roslyn ist "on" oder "off", nicht "${mode}"`);
  }
  return mode === "on";
};

/** Ein Pfad relativ zur Wurzel des Arbeitsbereichs, wie ihn `roslyn_solutions` nennt; ohne Laden beim Start hätte er keine Wirkung. */
export const preferredSolution = (loadOnStart: boolean): string | undefined => {
  const preferred = env.optional(SOLUTION_PREFERRED_VARIABLE);
  if (preferred === undefined) return undefined;
  if (!loadOnStart) {
    throw new Error(`${SOLUTION_PREFERRED_VARIABLE} in der Sektion ragents.lsp-roslyn verlangt ${SOLUTION_ON_START_VARIABLE}: "on"`);
  }
  if (preferred === "" || preferred.includes("\\") || path.win32.isAbsolute(preferred)) {
    throw new Error(`${SOLUTION_PREFERRED_VARIABLE} in der Sektion ragents.lsp-roslyn ist ein Pfad relativ zum Arbeitsbereich mit Schrägstrichen, nicht "${preferred}"`);
  }
  return preferred;
};

export const plugin: PluginModule = {
  requires: ["ragents.ask"],
  create: () => {
    let startup: SolutionOnStart | undefined;
    const languageServer = createLanguageServerPlugin({
      id: PLUGIN_ID,
      languageServer: roslynLanguageServer,
      configDescriptors: roslynConfigDescriptors,
      onOpened: (runId) => startup?.opened(runId),
    });
    return {
      manifest: languageServer.manifest,
      register: (host) => {
        languageServer.register(host);
        const loadOnStart = solutionOnStart();
        const preferred = preferredSolution(loadOnStart);
        if (!loadOnStart) return;
        startup = createSolutionOnStart({
          pluginId: PLUGIN_ID,
          adapterId: roslynLanguageServer.id,
          preferred,
          sandbox: () => host.service(sandboxServicesToken),
          runtime: () => host.service(runtimeProviderToken)(),
          ask: () => host.service(askServiceToken),
        });
        host.lifecycle(startup.lifecycle);
      },
    };
  },
};

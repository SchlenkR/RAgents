import { roslynAdapter, ROSLYN_SERVER_VARIABLE } from "@ragents/workspace-executor";
import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";
import { createLanguageServerPlugin } from "@ragents/host/plugin-support/language-server/plugin.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { runtimeProviderToken } from "@ragents/host/ragents/host-services.js";
import { askServiceToken } from "@ragents/plugins/ragents.ask/server/contract.js";
import { createSolutionOnStart, SOLUTION_ON_START_VARIABLE, type SolutionOnStart } from "./solution-on-start.js";

export const roslynConfigDescriptors = [
  { key: ROSLYN_SERVER_VARIABLE, source: "environment" },
  { key: SOLUTION_ON_START_VARIABLE, source: "environment" },
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

export const plugin: PluginModule = {
  requires: ["ragents.ask"],
  create: () => {
    let startup: SolutionOnStart | undefined;
    const languageServer = createLanguageServerPlugin({
      id: PLUGIN_ID,
      adapter: roslynAdapter,
      configDescriptors: roslynConfigDescriptors,
      onOpened: (runId) => startup?.opened(runId),
    });
    return {
      manifest: languageServer.manifest,
      register: (host) => {
        languageServer.register(host);
        if (!solutionOnStart()) return;
        startup = createSolutionOnStart({
          pluginId: PLUGIN_ID,
          adapterId: roslynAdapter.id,
          sandbox: () => host.service(sandboxServicesToken),
          runtime: () => host.service(runtimeProviderToken)(),
          ask: () => host.service(askServiceToken),
        });
        host.lifecycle(startup.lifecycle);
      },
    };
  },
};

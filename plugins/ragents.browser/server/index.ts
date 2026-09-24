import type { RAgentsPlugin } from "@ragents/engine";
import { BROWSER_EXECUTABLE_VARIABLE } from "@ragents/workspace-executor";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { documentStoreToken } from "@ragents/host/ragents/document-store.js";
import { RunBrowser } from "./browser.js";
import { browserRuntimeToken } from "./contract.js";
import { createBrowserFunctions, createBrowserImageContribution } from "./tools.js";

/** Der Executor des Servers liest den Wert aus seiner Umgebung; ein Arbeitsplatz aus seiner eigenen, nie aus dem Profil. */
export const browserConfigDescriptors = [{ key: BROWSER_EXECUTABLE_VARIABLE, source: "environment" }] as const;

const browserPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.browser" },
  register: (host) => {
    const documents = host.service(documentStoreToken);
    const browser = new RunBrowser({
      sandbox: host.service(sandboxServicesToken),
      filesFor: (runId) => documents.directoryFor(runId),
    });
    host.config(...browserConfigDescriptors);
    host.provide(browserRuntimeToken, browser);
    host.functions(...createBrowserFunctions(browser));
    host.agentRuntime(createBrowserImageContribution(browser));
    host.lifecycle({
      id: "ragents.browser.lifecycle",
      prepareSession: ({ runId }) => browser.restore(runId),
      stopSession: ({ runId }) => browser.close(runId),
      afterStopSession: ({ runId }) => browser.close(runId),
      deleteSession: ({ runId }) => browser.delete(runId),
      shutdown: () => browser.shutdown(),
    });
  },
};

export const plugin: PluginModule = { requires: ["ragents.documents"], create: () => browserPlugin };

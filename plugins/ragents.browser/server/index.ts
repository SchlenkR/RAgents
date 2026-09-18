import type { RAgentsPlugin } from "@aicontainer/ragents";
import { declaredEnvironment } from "@aicontainer/server/plugin-support/plugin-config.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { documentStoreToken } from "@aicontainer/server/ragents/document-store.js";
import { RunBrowser } from "./browser.js";
import { browserRuntimeToken } from "./contract.js";
import { createBrowserFunctions, createBrowserImageContribution } from "./tools.js";

export const browserConfigDescriptors = [{ key: "BROWSER_EXECUTABLE_PATH", source: "environment" }] as const;
const env = declaredEnvironment(browserConfigDescriptors);

const browserPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.browser" },
  register: (host) => {
    const documents = host.service(documentStoreToken);
    const browser = new RunBrowser({
      filesFor: (runId) => documents.directoryFor(runId),
      executablePath: env.optional("BROWSER_EXECUTABLE_PATH"),
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

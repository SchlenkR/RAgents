import type { RAgentsPlugin } from "@ragents/engine";
import { actorProgramsToken } from "@ragents/host/plugin-support/actor-programs/service.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { documentStoreToken } from "@ragents/host/ragents/document-store.js";
import { hostAddressToken } from "@ragents/host/ragents/host-services.js";
import { BROWSER_CHROMIUM_SANDBOX_VARIABLE, BROWSER_EXECUTABLE_VARIABLE } from "../executor/contract.js";
import { browserOrigin } from "../executor/network.js";
import { chromiumSandbox } from "../executor/playwright.js";
import { RunBrowser } from "./browser.js";
import { browserRuntimeToken } from "./contract.js";
import { createBrowserFunctions, createBrowserImageContribution } from "./tools.js";
import { createViewSnapshotFunction } from "./view-snapshot.js";

/** Browser executable and Chromium's sandbox belong to the machine; network exceptions belong to the server profile. */
export const browserConfigDescriptors = [
  { key: BROWSER_EXECUTABLE_VARIABLE, source: "environment" },
  { key: BROWSER_CHROMIUM_SANDBOX_VARIABLE, source: "environment" },
  { key: "BROWSER_ALLOWED_ORIGINS", source: "profile" },
] as const;

export const browserAllowedOrigins = (configured: string | undefined = process.env.BROWSER_ALLOWED_ORIGINS): readonly string[] => {
  if (configured === undefined) return [];
  const origins: unknown = (() => {
    try { return JSON.parse(configured); }
    catch { throw new Error("BROWSER_ALLOWED_ORIGINS in the ragents.browser section must be a list of HTTP or HTTPS origins."); }
  })();
  if (!Array.isArray(origins) || origins.some((origin) => typeof origin !== "string")) {
    throw new Error("BROWSER_ALLOWED_ORIGINS in the ragents.browser section must be a list of HTTP or HTTPS origins.");
  }
  return [...new Set(origins.map((origin) => browserOrigin(origin)))];
};

const browserPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.browser" },
  register: (host) => {
    if (!chromiumSandbox()) console.log(`Browser checks: Chromium starts without its own sandbox (${BROWSER_CHROMIUM_SANDBOX_VARIABLE} is false)`);
    const documents = host.service(documentStoreToken);
    const sandbox = host.service(sandboxServicesToken);
    if (sandbox.registerBrowserOrigins === undefined) throw new Error("The host does not support browser network policies; update the host before loading ragents.browser.");
    const allowedOrigins = browserAllowedOrigins();
    sandbox.registerBrowserOrigins(() => allowedOrigins);
    const browser = new RunBrowser({
      sandbox,
      filesFor: (runId) => documents.directoryFor(runId),
    });
    host.config(...browserConfigDescriptors);
    host.provide(browserRuntimeToken, browser);
    const address = host.service(hostAddressToken);
    host.functions(
      ...createBrowserFunctions(browser),
      createViewSnapshotFunction({ browser, actorPrograms: () => host.optionalService(actorProgramsToken), address }),
    );
    host.prompts(boundToTools(
      { ...handlebarsPrompt("ragents.browser.view-snapshot", 750, pluginAsset("ragents.browser", "view-snapshot.hbs")), delivery: "initial" },
      "actor_view_snapshot",
    ));
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

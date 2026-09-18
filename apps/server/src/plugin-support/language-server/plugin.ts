import type { PluginConfigDescriptor, RAgentsPlugin } from "@aicontainer/ragents";
import { sessionGuardToken } from "../../ragents/host-services.js";
import { sandboxServicesToken } from "../workspace-sandbox-host.js";
import { languageServerRoutePrefix } from "./contract.js";
import { LanguageServerHost, type LanguageServerAdapter } from "./host.js";
import { createLanguageServerRoutes } from "./snapshot-route.js";
import { createLanguageServerToolContributor } from "./tools.js";

export interface LanguageServerPluginOptions {
  id: string;
  adapter: LanguageServerAdapter;
  tabLabel?: string;
  configDescriptors?: readonly PluginConfigDescriptor[];
}

export const createLanguageServerPlugin = (options: LanguageServerPluginOptions): RAgentsPlugin => ({
  manifest: { id: options.id },
  register: (host) => {
    const sandbox = host.service(sandboxServicesToken);
    const servers = new LanguageServerHost(options.adapter, sandbox);
    if (options.configDescriptors) host.config(...options.configDescriptors);
    host.functions(createLanguageServerToolContributor(servers));
    host.clientConfig({
      routePrefix: languageServerRoutePrefix(options.id),
      label: options.tabLabel ?? options.adapter.label,
      openTool: `${options.adapter.id}_open`,
    });
    host.http(...createLanguageServerRoutes({
      pluginId: options.id,
      servers,
      ensureSession: host.service(sessionGuardToken),
    }));
    sandbox.registerEditAnnotator({
      id: options.adapter.label,
      annotate: (runId, absolutePath) => servers.annotate(runId, absolutePath),
    });
    host.lifecycle({
      id: `${options.id}.lifecycle`,
      stopSession: ({ runId }) => servers.stopSession(runId),
      deleteSession: ({ runId }) => servers.stopSession(runId),
      shutdown: () => servers.shutdown(),
    });
  },
});

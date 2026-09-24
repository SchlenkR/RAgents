import type { PluginConfigDescriptor, RAgentsPlugin } from "@ragents/engine";
import type { LanguageServerAdapter } from "@ragents/workspace-executor";
import { workspaceGuardToken } from "../../ragents/host-services.js";
import { sandboxServicesToken } from "../workspace-sandbox-host.js";
import { createLanguageServerSnapshotMethod } from "./snapshot-method.js";
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
    if (options.configDescriptors) host.config(...options.configDescriptors);
    host.functions(createLanguageServerToolContributor(options.adapter, sandbox));
    host.clientConfig({
      label: options.tabLabel ?? options.adapter.label,
      openTool: `${options.adapter.id}_open`,
    });
    host.methods(createLanguageServerSnapshotMethod({
      pluginId: options.id,
      adapterId: options.adapter.id,
      sandbox,
      ensureWorkspaceAccess: host.service(workspaceGuardToken),
    }));
  },
});

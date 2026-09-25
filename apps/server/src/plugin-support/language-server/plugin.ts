import type { PluginConfigDescriptor, RAgentsPlugin } from "@ragents/engine";
import type { LanguageServerAdapter } from "@ragents/workspace-executor";
import { workspaceGuardToken } from "../../ragents/host-services.js";
import { sandboxServicesToken } from "../workspace-sandbox-host.js";
import { createLanguageServerSnapshotMethod, createLanguageServerSolutionMethods } from "./snapshot-method.js";
import { createLanguageServerToolContributor } from "./tools.js";

export interface LanguageServerPluginOptions {
  id: string;
  adapter: LanguageServerAdapter;
  tabLabel?: string;
  configDescriptors?: readonly PluginConfigDescriptor[];
  /** Nach jedem erfolgreichen Öffnen über Werkzeug oder Umschalten, mit dem Run. */
  onOpened?: (runId: string) => void;
}

export const createLanguageServerPlugin = (options: LanguageServerPluginOptions): RAgentsPlugin => ({
  manifest: { id: options.id },
  register: (host) => {
    const sandbox = host.service(sandboxServicesToken);
    if (options.configDescriptors) host.config(...options.configDescriptors);
    const opened = options.onOpened ?? (() => undefined);
    host.functions(createLanguageServerToolContributor(options.adapter, sandbox, opened));
    const solutions = options.adapter.solutionExtensions !== undefined;
    host.clientConfig({
      label: options.tabLabel ?? options.adapter.label,
      openTool: `${options.adapter.id}_open`,
      solutions,
    });
    const methodOptions = {
      pluginId: options.id,
      adapterId: options.adapter.id,
      sandbox,
      ensureWorkspaceAccess: host.service(workspaceGuardToken),
      opened,
    };
    host.methods(
      createLanguageServerSnapshotMethod(methodOptions),
      ...solutions ? createLanguageServerSolutionMethods(methodOptions) : [],
    );
  },
});

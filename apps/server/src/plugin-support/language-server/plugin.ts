import type { PluginConfigDescriptor, RAgentsPlugin } from "@ragents/engine";
import type { LanguageServerDescription } from "@ragents/workspace-executor";
import { workspaceGuardToken } from "../../ragents/host-services.js";
import { sandboxServicesToken } from "../workspace-sandbox-host.js";
import { createLanguageServerSnapshotMethod, createLanguageServerSolutionMethods } from "./snapshot-method.js";
import { createLanguageServerToolContributor } from "./tools.js";

export interface LanguageServerPluginOptions {
  id: string;
  /** Beschreibt den Sprachserver für Werkzeuge und Reiter; gestartet wird er im Executor aus dem Beitrag des Plugins. */
  languageServer: LanguageServerDescription;
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
    host.functions(createLanguageServerToolContributor(options.id, options.languageServer, sandbox, opened));
    const solutions = options.languageServer.solutionExtensions !== undefined;
    host.clientConfig({
      label: options.tabLabel ?? options.languageServer.label,
      openTool: `${options.languageServer.id}_open`,
      solutions,
    });
    const methodOptions = {
      pluginId: options.id,
      adapterId: options.languageServer.id,
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

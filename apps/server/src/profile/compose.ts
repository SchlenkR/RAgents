import { PluginHost, type PluginWebAddresses } from "@ragents/engine";
import { pluginToolsDirectory, prepareExecutorContribution, type LoadedExecutorContribution } from "@ragents/workspace-executor";
import { config, HOST_SECRET_ENV_NAMES } from "../config.js";
import { SESSION_MODE, SESSIONS_MODE } from "../layout.js";
import { aliasCompletionModel, aliasCompletionModelToken } from "../plugin-support/model-completion.js";
import { withFolderAssets } from "../plugin-support/plugin-folder.js";
import type { PluginModule } from "../plugin-support/plugin-module.js";
import { runManagementToken } from "../ragents/global-chat.js";
import { registerTypeScriptFunctions } from "../ragents/typescript-tools.js";
import {
  executorContributionsToken,
  hostAddressToken,
  runtimeProviderToken,
  secretEnvNamesToken,
  runGuardToken,
  runWorkspaceProviderToken,
  workspaceGuardToken,
  type HostBridges,
} from "../ragents/host-services.js";

export interface ProductDescriptor {
  readonly id: string;
  readonly title: string;
  readonly accessCookieName?: string;
}

export interface ProfileComposition {
  readonly product: ProductDescriptor;
  readonly pluginIds: readonly string[];
  readonly modules: ReadonlyMap<string, PluginModule>;
  /** The plugins with a web half and where the browser loads it; the web loads exactly these. */
  readonly web: ReadonlyMap<string, PluginWebAddresses>;
  /** The bundles' contributions to the executor; the server builds them with the tool folders of its data folder. */
  readonly executor: readonly LoadedExecutorContribution[];
  /** The template from defaultStartEntry of the profile file; the host rejects an unregistered one when sealing. */
  readonly defaultStartEntry?: string;
}

export const composeProfile = (options: ProfileComposition, bridges: HostBridges): PluginHost => {
  const host = new PluginHost({
    product: options.product,
    dataDirectory: config.dataDir,
    storageModes: { sessionsRoot: SESSIONS_MODE, session: SESSION_MODE },
    ...(options.defaultStartEntry !== undefined ? { defaultStartEntry: options.defaultStartEntry } : {}),
  });
  host.provideHost(runGuardToken, bridges.ensureSession);
  host.provideHost(workspaceGuardToken, bridges.ensureWorkspaceAccess);
  host.provideHost(runWorkspaceProviderToken, bridges.sessionWorkspaceFor);
  host.provideHost(runtimeProviderToken, bridges.runtime);
  host.provideHost(hostAddressToken, () => bridges.apiBaseUrl);
  host.provideHost(executorContributionsToken, options.executor.map((loaded) =>
    prepareExecutorContribution(loaded, pluginToolsDirectory(config.dataDir, loaded.plugin))));
  host.provideHost(runManagementToken, () => {
    if (!bridges.sessions) throw new Error("The host provides no session management");
    return bridges.sessions();
  });
  host.provideHost(aliasCompletionModelToken, (alias) => aliasCompletionModel(() => {
    if (!bridges.modelRuntime) throw new Error("The host provides no model runtime");
    return bridges.modelRuntime();
  }, alias));
  host.provideHost(secretEnvNamesToken, () =>
    [...new Set([...HOST_SECRET_ENV_NAMES, ...host.config.secretKeys()])]);
  for (const id of options.pluginIds) {
    const module = options.modules.get(id);
    if (!module) throw new Error(`The plugin ${id} was not loaded`);
    const plugin = module.create(host);
    if (plugin.manifest.id !== id) {
      throw new Error(`The plugin folder ${id} reports the different id ${plugin.manifest.id}`);
    }
    if (plugin.manifest.requires !== undefined) {
      throw new Error(`Plugin ${id} declares requires in the manifest; it belongs in the module contract`);
    }
    if (plugin.manifest.web !== undefined) {
      throw new Error(`Plugin ${id} declares web in the manifest; that follows from the bundle`);
    }
    const web = options.web.get(id);
    host.register(withFolderAssets({
      ...plugin,
      manifest: {
        ...plugin.manifest,
        ...(web ? { web } : {}),
        ...(module.requires ? { requires: module.requires } : {}),
      },
    }));
  }
  registerTypeScriptFunctions(host);
  host.seal();
  return host;
};

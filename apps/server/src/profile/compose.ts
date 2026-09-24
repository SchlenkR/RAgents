import { PluginHost, type PluginWebAddresses } from "@ragents/engine";
import { config, HOST_SECRET_ENV_NAMES } from "../config.js";
import { SESSION_MODE, SESSIONS_MODE } from "../layout.js";
import { withFolderAssets } from "../plugin-support/plugin-folder.js";
import type { PluginModule } from "../plugin-support/plugin-module.js";
import { runManagementToken } from "../ragents/global-chat.js";
import { registerTypeScriptFunctions } from "../ragents/typescript-tools.js";
import {
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
  /** Die Vorlage aus defaultStartEntry der Profildatei; der Host lehnt eine nicht registrierte beim Versiegeln ab. */
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
  host.provideHost(runManagementToken, () => {
    if (!bridges.sessions) throw new Error("Der Host stellt keine Sitzungsverwaltung bereit");
    return bridges.sessions();
  });
  host.provideHost(secretEnvNamesToken, () =>
    [...new Set([...HOST_SECRET_ENV_NAMES, ...host.config.secretKeys()])]);
  for (const id of options.pluginIds) {
    const module = options.modules.get(id);
    if (!module) throw new Error(`Das Plugin ${id} wurde nicht geladen`);
    const plugin = module.create(host);
    if (plugin.manifest.id !== id) {
      throw new Error(`Der Plugin-Ordner ${id} meldet die abweichende Kennung ${plugin.manifest.id}`);
    }
    if (plugin.manifest.requires !== undefined) {
      throw new Error(`Plugin ${id} deklariert requires im Manifest; es gehört in den Modulvertrag`);
    }
    if (plugin.manifest.web !== undefined) {
      throw new Error(`Plugin ${id} deklariert web im Manifest; das ergibt sich aus dem Bundle`);
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

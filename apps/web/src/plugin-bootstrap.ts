import { isRecord } from "./lib/guards";
import { startEntryFrom, type StartEntry } from "../../server/src/plugin-support/start-entries-contract";
import { PluginRegistry, type WebPlugin } from "./PluginRegistry";

export interface PluginDescriptor {
  id: string;
  web: boolean;
  config?: Record<string, unknown>;
}

export interface PluginBootstrap {
  product: {
    id: string;
    title: string;
  };
  plugins: PluginDescriptor[];
  startEntries: StartEntry[];
}

export type WebPluginLoader = () => Promise<WebPlugin>;
export type WebPluginLoaders = ReadonlyMap<string, WebPluginLoader>;

const isWebPlugin = (value: unknown): value is WebPlugin =>
  typeof value === "object" && value !== null && typeof (value as WebPlugin).id === "string";

const loaderFor = (id: string, load: () => Promise<unknown>): WebPluginLoader => async () => {
  const module = await load() as Record<string, unknown>;
  const plugin = module.webPlugin;
  if (!isWebPlugin(plugin)) {
    throw new Error(`Der Web-Einstieg des Plugins ${id} exportiert keine Konstante webPlugin mit einer Plugin-Kennung`);
  }
  if (plugin.id !== id) {
    throw new Error(`Der Plugin-Ordner ${id} meldet die abweichende Kennung ${plugin.id}`);
  }
  return plugin;
};

/** Turns the bundle's entry map (plugin id to web entry import) into loaders. */
export const webPluginLoadersFrom = (entries: Readonly<Record<string, () => Promise<unknown>>>): WebPluginLoaders =>
  new Map(Object.entries(entries).map(([id, load]) => [id, loaderFor(id, load)]));

/** A plugin without a web half stays a bare descriptor; a web half missing from the bundle is a build error. */
const pluginFor = (descriptor: PluginDescriptor, loaders: WebPluginLoaders): Promise<WebPlugin> => {
  const load = loaders.get(descriptor.id);
  if (load) return load();
  if (descriptor.web) {
    throw new Error(`Das Web-Bundle enthält das Plugin ${descriptor.id} nicht; mit dem Profil dieses Servers bauen`);
  }
  return Promise.resolve({ id: descriptor.id });
};

export const activatePlugins = async (
  bootstrap: PluginBootstrap,
  loaders: WebPluginLoaders,
): Promise<{ bootstrap: PluginBootstrap; registry: PluginRegistry }> => {
  const plugins = await Promise.all(bootstrap.plugins.map((descriptor) => pluginFor(descriptor, loaders)));
  const configurations = new Map(bootstrap.plugins.map((plugin) => [plugin.id, plugin.config ?? {}]));
  return {
    bootstrap,
    registry: new PluginRegistry(
      { plugins, product: bootstrap.product, startEntries: bootstrap.startEntries },
      configurations,
    ),
  };
};

export const pluginBootstrapFrom = (value: unknown): PluginBootstrap => {
  if (!isRecord(value) || !isRecord(value.product) || !Array.isArray(value.plugins)
    || !Array.isArray(value.startEntries)
    || typeof value.product.id !== "string" || !value.product.id
    || typeof value.product.title !== "string" || !value.product.title) {
    throw new Error("Die Plugin-Konfiguration entspricht nicht dem erwarteten Format");
  }
  const plugins = value.plugins.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id || typeof entry.web !== "boolean"
      || entry.config !== undefined && !isRecord(entry.config)) {
      throw new Error("Die Plugin-Konfiguration enthält einen ungültigen Plugin-Descriptor");
    }
    return {
      id: entry.id,
      web: entry.web,
      config: entry.config as Record<string, unknown> | undefined,
    };
  });
  return {
    product: { id: value.product.id, title: value.product.title },
    plugins,
    startEntries: value.startEntries.map(startEntryFrom),
  };
};

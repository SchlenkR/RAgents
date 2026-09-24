import { isRecord } from "./lib/guards";
import { startEntryFrom, type StartEntry } from "../../server/src/plugin-support/start-entries-contract";
import { PluginRegistry, type WebPlugin } from "./PluginRegistry";

/** Where the browser loads a plugin's web half from; the host serves the bundle under these addresses. */
export interface PluginWebAddresses {
  readonly entry: string;
  readonly css?: string;
}

export interface PluginDescriptor {
  id: string;
  web?: PluginWebAddresses;
  config?: Record<string, unknown>;
}

export interface PluginBootstrap {
  product: {
    id: string;
    title: string;
  };
  plugins: PluginDescriptor[];
  startEntries: StartEntry[];
  defaultStartEntry?: string;
}

/** Loads a module and a stylesheet by address; the browser does it with import() and a link element. */
export interface WebBundleLoader {
  readonly module: (url: string) => Promise<unknown>;
  readonly stylesheet: (url: string) => Promise<void>;
}

const isWebPlugin = (value: unknown): value is WebPlugin =>
  typeof value === "object" && value !== null && typeof (value as WebPlugin).id === "string";

const webPluginFrom = (id: string, module: unknown): WebPlugin => {
  const plugin = (module as Record<string, unknown>).webPlugin;
  if (!isWebPlugin(plugin)) {
    throw new Error(`Der Web-Einstieg des Plugins ${id} exportiert keine Konstante webPlugin mit einer Plugin-Kennung`);
  }
  if (plugin.id !== id) {
    throw new Error(`Das Bundle ${id} meldet die abweichende Kennung ${plugin.id}`);
  }
  return plugin;
};

const loaded = <T>(id: string, url: string, load: Promise<T>): Promise<T> =>
  load.catch((cause: unknown) => {
    throw new Error(`Die Web-Hälfte des Plugins ${id} lädt nicht von ${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
  });

/** A plugin without a web half stays a bare descriptor; one with a web half loads its bundle and stylesheet. */
const pluginFor = async (descriptor: PluginDescriptor, loader: WebBundleLoader): Promise<WebPlugin> => {
  const web = descriptor.web;
  if (!web) return { id: descriptor.id };
  const [module] = await Promise.all([
    loaded(descriptor.id, web.entry, loader.module(web.entry)),
    ...(web.css === undefined ? [] : [loaded(descriptor.id, web.css, loader.stylesheet(web.css))]),
  ]);
  return webPluginFrom(descriptor.id, module);
};

/** A web half that did not load; the plugin keeps its server part and shows as this error instead of taking the interface down. */
export interface PluginFailure {
  readonly id: string;
  readonly message: string;
}

export const activatePlugins = async (
  bootstrap: PluginBootstrap,
  loader: WebBundleLoader,
): Promise<{ bootstrap: PluginBootstrap; registry: PluginRegistry; failures: readonly PluginFailure[] }> => {
  const settled = await Promise.allSettled(bootstrap.plugins.map((descriptor) => pluginFor(descriptor, loader)));
  const failures = settled.flatMap((result, index): PluginFailure[] => result.status === "rejected"
    ? [{ id: bootstrap.plugins[index]!.id, message: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
    : []);
  const plugins = settled.map((result, index): WebPlugin => result.status === "fulfilled" ? result.value : { id: bootstrap.plugins[index]!.id });
  const configurations = new Map(bootstrap.plugins.map((plugin) => [plugin.id, plugin.config ?? {}]));
  try {
    const registry = new PluginRegistry({ plugins, product: bootstrap.product, startEntries: bootstrap.startEntries,
      ...(bootstrap.defaultStartEntry === undefined ? {} : { defaultStartEntry: bootstrap.defaultStartEntry }) }, configurations);
    return { bootstrap, registry, failures };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error([reason, ...failures.map((failure) => failure.message)].join("\n"), { cause });
  }
};

const isWebAddresses = (value: unknown): value is PluginWebAddresses =>
  isRecord(value) && typeof value.entry === "string" && value.entry.length > 0
  && (value.css === undefined || typeof value.css === "string" && value.css.length > 0)
  && Object.keys(value).every((key) => key === "entry" || key === "css");

export const pluginBootstrapFrom = (value: unknown): PluginBootstrap => {
  if (!isRecord(value) || !isRecord(value.product) || !Array.isArray(value.plugins)
    || !Array.isArray(value.startEntries)
    || value.defaultStartEntry !== undefined && typeof value.defaultStartEntry !== "string"
    || typeof value.product.id !== "string" || !value.product.id
    || typeof value.product.title !== "string" || !value.product.title) {
    throw new Error("Die Plugin-Konfiguration entspricht nicht dem erwarteten Format");
  }
  const plugins = value.plugins.map((entry): PluginDescriptor => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id || entry.web !== undefined && !isWebAddresses(entry.web)
      || entry.config !== undefined && !isRecord(entry.config)) {
      throw new Error("Die Plugin-Konfiguration enthält einen ungültigen Plugin-Descriptor");
    }
    return {
      id: entry.id,
      ...(entry.web === undefined ? {} : { web: entry.web }),
      config: entry.config as Record<string, unknown> | undefined,
    };
  });
  return {
    product: { id: value.product.id, title: value.product.title },
    plugins,
    startEntries: value.startEntries.map(startEntryFrom),
    ...(value.defaultStartEntry === undefined ? {} : { defaultStartEntry: value.defaultStartEntry }),
  };
};

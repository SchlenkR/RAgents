import { useEffect, useState } from "react";
import { coreContracts } from "@ragents/host/api/contracts";
import { rpc } from "./rpc";
import { activatePlugins, pluginBootstrapFrom, type PluginBootstrap, type PluginFailure, type WebBundleLoader } from "./plugin-bootstrap";
import type { PluginRegistry } from "./PluginRegistry";

export type { PluginBootstrap } from "./plugin-bootstrap";

export type PluginActivationState =
  | { status: "loading" }
  | { status: "ready"; bootstrap: PluginBootstrap; registry: PluginRegistry; failures: readonly PluginFailure[] }
  | { status: "failed"; error: string };

export function usePluginActivation(): PluginActivationState {
  const [state, setState] = useState<PluginActivationState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void activate(controller.signal)
      .then((ready) => {
        if (controller.signal.aborted) return;
        setState(ready);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "failed", error: caught instanceof Error ? caught.message : String(caught) });
      });
    return () => controller.abort();
  }, []);

  return state;
}

const stylesheets = new Map<string, Promise<void>>();

const linkStylesheet = (url: string): Promise<void> => new Promise((resolve, reject) => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.onload = () => resolve();
  link.onerror = () => reject(new Error(`das Stylesheet ${url} fehlt`));
  document.head.append(link);
});

/** The web halves come from the host by address; each stylesheet is linked once, after the host's own. */
const browserLoader: WebBundleLoader = {
  module: (url) => import(/* @vite-ignore */ url),
  stylesheet: (url) => {
    const known = stylesheets.get(url) ?? linkStylesheet(url);
    stylesheets.set(url, known);
    return known;
  },
};

const activate = async (signal: AbortSignal): Promise<PluginActivationState> => {
  const bootstrap = await loadPluginBootstrap(signal);
  return { status: "ready", ...(await activatePlugins(bootstrap, browserLoader)) };
};

const loadPluginBootstrap = async (signal: AbortSignal): Promise<PluginBootstrap> =>
  pluginBootstrapFrom(await rpc.call(coreContracts.plugins.bootstrap, {}, { signal }));

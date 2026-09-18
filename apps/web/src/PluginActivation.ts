import { useEffect, useState } from "react";
import { activatePlugins, pluginBootstrapFrom, type PluginBootstrap } from "./plugin-bootstrap";
import { webPluginLoaders } from "./plugin-discovery";
import type { PluginRegistry } from "./PluginRegistry";

export type { PluginBootstrap } from "./plugin-bootstrap";

export type PluginActivationState =
  | { status: "loading" }
  | { status: "ready"; bootstrap: PluginBootstrap; registry: PluginRegistry }
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

const activate = async (signal: AbortSignal): Promise<PluginActivationState> => {
  const bootstrap = await loadPluginBootstrap(signal);
  return { status: "ready", ...(await activatePlugins(bootstrap, webPluginLoaders)) };
};

const loadPluginBootstrap = async (signal: AbortSignal): Promise<PluginBootstrap> => {
  const response = await fetch("/api/plugins", { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Plugin-Konfiguration konnte nicht geladen werden (${response.status})`);
  return pluginBootstrapFrom(await response.json() as unknown);
};

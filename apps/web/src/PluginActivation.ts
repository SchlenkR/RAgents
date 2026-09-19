import { useEffect, useState } from "react";
import { coreContracts } from "@aicontainer/server/api/contracts";
import { rpc } from "./rpc";
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

const loadPluginBootstrap = async (signal: AbortSignal): Promise<PluginBootstrap> =>
  pluginBootstrapFrom(await rpc.call(coreContracts.plugins.bootstrap, {}, { signal }));

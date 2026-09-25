import type { RAgentsPlugin } from "@ragents/engine";
import { modelUpstreamsToken } from "@ragents/host/plugin-support/model-upstreams.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { Protocol } from "@ragents/host/protocol.js";
import { modelRelayConfig } from "./config.js";
import { createRelayRoutes, resolveAliases, type ResolvedAlias } from "./relay.js";

const modelRelayPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.model-relay" },
  register: (host) => {
    const upstreams = host.service(modelUpstreamsToken);
    let resolved: readonly ResolvedAlias[] | undefined;
    const aliases = (): readonly ResolvedAlias[] => resolved ??= resolveAliases(modelRelayConfig.aliases(), upstreams());
    const log = new Protocol(host.storage.root("relay.log"));
    host.lifecycle({
      id: "ragents.model-relay",
      initialize: () => {
        const list = aliases();
        log.write(`=== Start: ${list.map((entry) => `${entry.alias}=${entry.upstream.id}/${entry.model.id}`).join(", ")} ===`);
        console.log(`Modell-Relay: ${list.length} Aliasse unter /relay/v1 (${list.map((entry) => entry.alias).join(", ")})`);
      },
      shutdown: () => log.close(),
    });
    host.http(...createRelayRoutes({ aliases, log: (line) => log.write(line) }));
  },
};

export const plugin: PluginModule = {
  create: () => modelRelayPlugin,
};

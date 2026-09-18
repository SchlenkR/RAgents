import type { JsonValue, RAgentsPlugin } from "@aicontainer/ragents";
import { randomUUID } from "node:crypto";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { runtimeProviderToken } from "@aicontainer/server/ragents/host-services.js";
import { WATCH_PLUGIN_ID } from "../contract.js";
import { watchServiceToken } from "./contract.js";
import { compileWatchCondition } from "./condition.js";
import { watchFunctions } from "./functions.js";
import { WatchService } from "./service.js";

const watchPlugin: RAgentsPlugin = {
  manifest: { id: WATCH_PLUGIN_ID },
  register: (host) => {
    const runtime = host.service(runtimeProviderToken);
    const service = new WatchService({
      runtime,
      compile: (condition, signal) => compileWatchCondition(condition, signal),
      operationExists: (id) => host.operation(id) !== undefined,
      observe: (runId, id, signal) => host.invokeOperation(id, {
        runId, invocationId: `ragents.watch:${randomUUID()}`, signal,
        principal: { kind: "operator", actorId: runtime().view(runId).ownerId },
      }, {}) as Promise<JsonValue>,
    });
    host.provide(watchServiceToken, service);
    host.functions(watchFunctions(service));
    host.lifecycle({
      id: "ragents.watch.lifecycle",
      prepareSession: ({ runId }) => service.prepare(runId),
      stopSession: ({ runId }) => service.stop(runId),
      deleteSession: ({ runId }) => service.stop(runId),
      shutdown: () => service.shutdown(),
    });
  },
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration"],
  create: () => watchPlugin,
};

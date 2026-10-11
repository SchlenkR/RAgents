import { implement, implementChannel } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { actorProgramsToken } from "@ragents/host/plugin-support/actor-programs/service.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import { globalChatToken, runManagementToken } from "@ragents/host/ragents/global-chat.js";
import { runGuardToken, runtimeProviderToken, runOwnerAccessToken, userAccessToken, workspaceGuardToken } from "@ragents/host/ragents/host-services.js";
import { GLOBAL_APPS_PLUGIN_ID, globalAppsContracts } from "../contract.js";
import { globalAppsFunctions, appManagementToolNames } from "./functions.js";
import { GlobalAppsService } from "./service.js";

export const plugin: PluginModule = {
  requires: ["ragents.orchestration", "ragents.actor-programs", "ragents.overseer"],
  create: () => ({
    manifest: { id: GLOBAL_APPS_PLUGIN_ID },
    register: (host) => {
      const runtime = host.service(runtimeProviderToken);
      const global = host.service(globalChatToken);
      const service = new GlobalAppsService({
        runtime,
        programs: host.service(actorProgramsToken),
        userAccess: host.service(userAccessToken),
        ensureRun: host.service(runGuardToken),
        globalRunIdFor: global.runIdFor,
        isGlobalRun: global.isCoordinator,
        ensureGlobalRun: (access, signal) => host.service(runManagementToken)().globalSpace(access, signal),
        interrupt: (runId, actorId, reason) => host.service(runManagementToken)().interruptTurn(runId, actorId, reason),
      });
      host.functions(globalAppsFunctions(service, host.service(runOwnerAccessToken)));
      host.prompts(boundToTools({
        ...handlebarsPrompt("ragents.global-apps.prompt", 120, pluginAsset(GLOBAL_APPS_PLUGIN_ID, "prompt.hbs")),
        delivery: "initial",
      }, ...appManagementToolNames));
      host.methods(
        implement(globalAppsContracts.create, async ({ sourceRunId, ...input }, context) => {
          host.service(workspaceGuardToken)(context.access, sourceRunId);
          const view = runtime().view(sourceRunId);
          if (!view.primaryActorId) throw new Error("The source run needs an authoring actor.");
          return service.create(context.access, { runId: sourceRunId, actorId: view.primaryActorId, turnId: null }, input, context.signal);
        }),
        implement(globalAppsContracts.list, (input, context) => service.list(context.access, input.limit)),
        implement(globalAppsContracts.remove, (input, context) => service.remove(context.access, input.name)),
      );
      host.channels(implementChannel(globalAppsContracts.changed, (_input, emit, { access }) => service.subscribe(access, emit)));
      host.lifecycle({
        id: "ragents.global-apps.lifecycle",
        serverReady: () => service.ready(),
        shutdown: () => service.shutdown(),
      });
      host.accessProjections({
        id: GLOBAL_APPS_PLUGIN_ID,
        private: true,
        state: () => undefined,
        chatEvent: () => undefined,
      });
    },
  }),
};

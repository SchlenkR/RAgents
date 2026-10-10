import { implement, implementChannel } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { actorProgramsToken } from "@ragents/host/plugin-support/actor-programs/service.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import { runManagementToken } from "@ragents/host/ragents/global-chat.js";
import {
  runGuardToken,
  runtimeProviderToken,
  runOwnerAccessToken,
  userAccessToken,
  runWorkspaceProviderToken,
  workspaceGuardToken,
} from "@ragents/host/ragents/host-services.js";
import { workspaceRuntimeToken } from "@ragents/host/ragents/workspace-runtime.js";
import { agentToolsFrom } from "@ragents/plugins/ragents.actor-programs/server/agent-tools.js";
import { GLOBAL_APPS_PLUGIN_ID, globalAppsContracts } from "../contract.js";
import { globalAppsFunctions, appManagementToolNames } from "./functions.js";
import { GlobalAppsService } from "./service.js";

export const plugin: PluginModule = {
  requires: ["ragents.orchestration", "ragents.workspace", "ragents.actor-programs"],
  create: (root) => ({
    manifest: { id: GLOBAL_APPS_PLUGIN_ID },
    register: (host) => {
      const runtime = host.service(runtimeProviderToken);
      const programs = host.service(actorProgramsToken);
      const sandbox = host.service(sandboxServicesToken);
      const workspace = host.service(runWorkspaceProviderToken);
      const ownerAccess = host.service(runOwnerAccessToken);
      const agentFunctions = agentToolsFrom(root);
      const service = new GlobalAppsService({
        runtime,
        programs,
        userAccess: host.service(userAccessToken),
        ensureRun: host.service(runGuardToken),
        prepareRun: async (runId) => {
          await workspace(runId);
        },
        interrupt: (runId, actorId, reason) => host.service(runManagementToken)().interruptTurn(runId, actorId, reason),
        functionsFor: (runId, actor) => actor.kind === "human" ? Promise.resolve([]) : agentFunctions(runId, actor.id, actor),
        sandboxFor: async (runId) => {
          const directory = await programs.workspaceDirectory(runId);
          return Boolean((await sandbox.isolatedProcessContextFor(runId, [directory], [])).sandbox);
        },
        sourceRoots: async (runId) => {
          const directory = await programs.workspaceDirectory(runId);
          const placement = host.service(workspaceRuntimeToken).placementOf(runId);
          if (placement.machine !== "server") return {
            read: [directory],
            write: [directory],
          };
          const source = await workspace(runId);
          const current = await source.currentRoot();
          return {
            read: [current, directory, ...source.sandboxFolders?.map((folder) => folder.directory) ?? []],
            write: [current, directory, ...source.sandboxFolders?.filter((folder) => folder.access === "write").map((folder) => folder.directory) ?? []],
          };
        },
      });
      host.functions(globalAppsFunctions(service, ownerAccess));
      host.prompts(boundToTools({
        ...handlebarsPrompt("ragents.global-apps.prompt", 120, pluginAsset(GLOBAL_APPS_PLUGIN_ID, "prompt.hbs")),
        delivery: "initial",
      }, ...appManagementToolNames));
      host.methods(
        implement(globalAppsContracts.view, (input, context) => service.view(context.access, input.name, input.viewId)),
        implement(globalAppsContracts.register, async ({ sourceRunId, ...input }, context) => {
          host.service(workspaceGuardToken)(context.access, sourceRunId);
          const view = runtime().view(sourceRunId);
          if (!view.primaryActorId) throw new Error("The source run needs an authoring actor.");
          return service.register(context.access, {
            runId: sourceRunId,
            actorId: view.primaryActorId,
            turnId: null,
          }, input, context.signal);
        }),
        implement(globalAppsContracts.list, (input, context) => service.list(context.access, input.limit)),
        implement(globalAppsContracts.read, (input, context) => service.read(context.access, input.name, input.logLimit)),
        implement(globalAppsContracts.run, (input, context) => service.run(context.access, input.name)),
        implement(globalAppsContracts.pause, (input, context) => service.pause(context.access, input.name, input.paused)),
        implement(globalAppsContracts.remove, (input, context) => service.remove(context.access, input.name)),
      );
      host.channels(implementChannel(globalAppsContracts.changed, (_input, emit, { access }) => service.subscribe(access, emit)));
      host.lifecycle({
        id: "ragents.global-apps.lifecycle",
        serverReady: () => service.ready(),
        stopSession: ({ runId }) => service.stop(runId),
        deleteSession: ({ runId }) => service.forget(runId),
        shutdown: () => service.shutdown(),
      });
      host.sessionMetadata({
        id: GLOBAL_APPS_PLUGIN_ID,
        describe: ({ runId }) => runId.startsWith("global-apps-") ? { kind: "global-apps" } : undefined,
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

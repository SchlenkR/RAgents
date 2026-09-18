import path from "node:path";
import type { PluginHost, RAgentsPlugin } from "@aicontainer/ragents";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { runtimeProviderToken, sessionGuardToken } from "@aicontainer/server/ragents/host-services.js";
import { askServiceToken } from "@aicontainer/plugins/ragents.ask/server/contract.js";
import { agentToolsFrom } from "./agent-tools.js";
import { createMiniAppRoutes, miniAppsApiPrefix } from "./routes.js";
import { ActorProgramRuntime } from "./runtime.js";
import { actorProgramManagementToolNames, actorProgramToolsAvailable, createActorProgramToolContributors } from "./tool-contributor.js";
import { createControlsToolContributor } from "./controls-tool.js";
import { actorProgramSummary } from "./prompts.js";
import { sandboxServicesToken } from "@aicontainer/server/plugin-support/workspace-sandbox-host.js";
import { actorProgramsToken } from "@aicontainer/server/plugin-support/actor-programs/service.js";
import { createProjectDiagnostics } from "./project-diagnostics.js";
const actorProgramsPlugin = (pluginHost: PluginHost): RAgentsPlugin => ({
    manifest: { id: "ragents.actor-programs" },
    register: (host) => {
        const runtime = new ActorProgramRuntime({
            runtime: host.service(runtimeProviderToken), agentToolsFor: agentToolsFrom(pluginHost), askService: () => host.service(askServiceToken), reservedToolNames: () => pluginHost.tools.describe().map((entry) => entry.name),
            processContextFor: (runId) => host.service(sandboxServicesToken).processContextFor(runId),
            operations: { operation: (id) => host.operation(id), invoke: (id, context, input) => host.invokeOperation(id, context, input), list: () => pluginHost.operations.describe() },
            directoryFor: (runId) => host.storage.session(runId, "programs"),
            scriptSources: (entryId, name) => {
                const script = pluginHost.startEntries.scriptPackage(entryId);
                return !script ? undefined : script.handle === name ? script.files : script.programs.find((program) => program.name === name)?.files;
            },
        });
        host.provide(actorProgramsToken, runtime);
        const diagnostics = createProjectDiagnostics({
            workspaceFor: (runId) => runtime.workspaceDirectory(runId), check: (runId, name, actorId, signal) => runtime.check(runId, name, actorId, signal),
            applies: (runId, actorId) => {
                const view = host.service(runtimeProviderToken)().view(runId);
                const actor = view.actors.find((candidate) => candidate.id === actorId);
                return !!actor && actor.kind !== "human" && actorProgramToolsAvailable(actor, view) && (actor.toolNames === null || actor.toolNames.some((name) => (actorProgramManagementToolNames as readonly string[]).includes(name)));
            },
        });
        host.agentRuntime(diagnostics.contribution);
        host.clientConfig({ routePrefix: miniAppsApiPrefix });
        host.http(...createMiniAppRoutes({ ensureSession: host.service(sessionGuardToken), runtime }));
        host.lifecycle({ id: "ragents.actor-programs.lifecycle",
            initialize: () => host.service(sandboxServicesToken).registerWorkspaceRoot({ id: "ragents.actor-programs", alias: "@actors", environmentVariable: "RAGENTS_ACTORS_DIR", directoryFor: (runId) => runtime.workspaceDirectory(runId), ownershipDirectoryFor: async (runId) => path.dirname(await runtime.workspaceDirectory(runId)) }),
            prepareSession: ({ runId }) => runtime.prepareSession(runId), stopSession: ({ runId, signal }) => runtime.stopSession(runId, signal),
            deleteSession: async ({ runId }) => { diagnostics.forget(runId); await runtime.deleteSession(runId); }, shutdown: () => runtime.shutdown(),
        });
        host.prompts(actorProgramSummary);
        host.functions(createControlsToolContributor(), ...createActorProgramToolContributors(runtime, diagnostics));
    },
});
export const plugin: PluginModule = { requires: ["ragents.ask"], create: actorProgramsPlugin };

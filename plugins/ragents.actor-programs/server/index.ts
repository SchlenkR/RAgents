import path from "node:path";
import type { PluginHost, RAgentsPlugin } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { runtimeProviderToken, runGuardToken, runOwnerAccessToken, runReadGuardToken, runWorkspaceProviderToken } from "@ragents/host/ragents/host-services.js";
import { runManagementToken } from "@ragents/host/ragents/global-chat.js";
import { workspaceRuntimeToken } from "@ragents/host/ragents/workspace-runtime.js";
import { askServiceToken } from "@ragents/plugins/ragents.ask/server/contract.js";
import { agentToolsFrom } from "./agent-tools.js";
import { createActorProgramMethods } from "./methods.js";
import { createMiniAppFrameRoutes, miniAppsApiPrefix } from "./routes.js";
import { ActorProgramRuntime } from "./runtime.js";
import { actorProgramManagementToolNames, actorProgramToolsAvailable, createActorProgramToolContributors } from "./tool-contributor.js";
import { createControlsToolContributor } from "./controls-tool.js";
import { actorProgramSummary } from "./prompts.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { actorProgramsToken } from "@ragents/host/plugin-support/actor-programs/service.js";
import { ProgramBuildCache } from "@ragents/host/plugin-support/actor-programs/build-cache.js";
import { createProjectDiagnostics } from "./project-diagnostics.js";
import { actorProgramAccessProjections } from "./access-projections.js";
import { programPermissionFunctions } from "./permissions.js";
import { AppDisplays, appDisplaysProjection, createAppDisplayChannel, createAppDisplayMethods, createAppDisplayTools } from "./displays.js";
const actorProgramsPlugin = (pluginHost: PluginHost): RAgentsPlugin => ({
    manifest: { id: "ragents.actor-programs" },
    register: (host) => {
        const runtime: ActorProgramRuntime = new ActorProgramRuntime({
            runtime: host.service(runtimeProviderToken), agentToolsFor: agentToolsFrom(pluginHost), askService: () => host.service(askServiceToken), reservedToolNames: () => pluginHost.tools.describe().map((entry) => entry.name),
            serverProcessContextFor: (runId) => host.service(sandboxServicesToken).serverProcessContextFor(runId),
            isolatedProcessContextFor: (runId, directories, readable) => host.service(sandboxServicesToken).isolatedProcessContextFor(runId, directories, readable),
            isolatedSandbox: (writable, readable) => host.service(sandboxServicesToken).isolatedSandbox(writable, readable),
            operations: { operation: (id) => host.operation(id), invoke: (id, context, input) => host.invokeOperation(id, context, input), list: () => pluginHost.operations.describe() },
            directoryFor: (runId) => host.storage.session(runId, "programs"),
            scriptSources: (entryId, name) => {
                const script = pluginHost.startEntries.scriptPackage(entryId);
                return !script ? undefined : script.handle === name ? script.files : script.programs.find((program) => program.name === name)?.files;
            },
            sharedPackage: (name) => pluginHost.actorPackages.get(name),
            ownerAccess: (runId) => host.service(runOwnerAccessToken)(runId),
            buildCache: new ProgramBuildCache(host.storage.root("build-cache"), { entries: 256, bytes: 128 * 1024 * 1024 }),
            workspaceRoots: async (runId) => {
                const directory = await runtime.workspaceDirectory(runId);
                if (host.service(workspaceRuntimeToken).placementOf(runId).machine !== "server")
                    return { read: [directory], write: [directory] };
                const workspace = await host.service(runWorkspaceProviderToken)(runId);
                const current = await workspace.currentRoot();
                return {
                    read: [current, directory, ...workspace.sandboxFolders?.map((folder) => folder.directory) ?? []],
                    write: [current, directory, ...workspace.sandboxFolders?.filter((folder) => folder.access === "write").map((folder) => folder.directory) ?? []],
                };
            },
            triggers: {
                prepareRun: async (runId) => { await host.service(runWorkspaceProviderToken)(runId); },
                interrupt: (runId, actorId, reason) => host.service(runManagementToken)().interruptTurn(runId, actorId, reason),
            },
        });
        host.provide(actorProgramsToken, runtime);
        const displays = new AppDisplays({
            runtime: host.service(runtimeProviderToken), programs: runtime, readable: (access, runId) => host.service(runReadGuardToken)(access, runId),
            runs: (access) => host.service(runManagementToken)().list(access), ownerAccess: (runId) => host.service(runOwnerAccessToken)(runId),
        });
        const diagnostics = createProjectDiagnostics({
            workspaceFor: (runId) => runtime.workspaceDirectory(runId), check: (runId, name, recipientId, signal) => runtime.diagnose(runId, name, recipientId, signal),
            context: (runId, name) => runtime.diagnosisContext(runId, name),
            applies: (runId, actorId) => {
                const view = host.service(runtimeProviderToken)().view(runId);
                const actor = view.actors.find((candidate) => candidate.id === actorId);
                return !!actor && actor.kind !== "human" && actorProgramToolsAvailable(actor, view) && (actor.toolNames === null || actor.toolNames.some((name) => (actorProgramManagementToolNames as readonly string[]).includes(name)));
            },
        });
        host.agentRuntime(diagnostics.contribution);
        host.clientConfig({ routePrefix: miniAppsApiPrefix });
        host.methods(...createActorProgramMethods({ ensureSession: host.service(runGuardToken), runtime }), ...createAppDisplayMethods(displays));
        host.channels(createAppDisplayChannel(displays));
        host.http(...createMiniAppFrameRoutes({ ensureSession: host.service(runGuardToken), runtime }));
        host.lifecycle({ id: "ragents.actor-programs.lifecycle",
            initialize: () => host.service(sandboxServicesToken).registerWorkspaceRoot({ id: "ragents.actor-programs", alias: "@actors", environmentVariable: "RAGENTS_ACTORS_DIR", directoryFor: (runId) => runtime.workspaceDirectory(runId), ownershipDirectoryFor: async (runId) => path.dirname(await runtime.workspaceDirectory(runId)) }),
            serverReady: () => runtime.triggers.ready(),
            prepareSession: ({ runId }) => runtime.prepareSession(runId), stopSession: ({ runId, signal }) => runtime.stopSession(runId, signal),
            deleteSession: async ({ runId }) => { diagnostics.forget(runId); displays.deleted(runId); await runtime.deleteSession(runId); },
            shutdown: () => { displays.shutdown(); return runtime.shutdown(); },
        });
        host.prompts(actorProgramSummary);
        host.accessProjections(...actorProgramAccessProjections, appDisplaysProjection);
        host.functions(createControlsToolContributor(), ...createActorProgramToolContributors(runtime, diagnostics), createAppDisplayTools(displays, () => runtime.namedAppSources().length > 0), programPermissionFunctions({
            permissionsOf: (runId, actorId) => {
                const program = runtime.programsOf(host.service(runtimeProviderToken)().view(runId)).find((entry) => entry.actorId === actorId);
                return program ? program.permissions ?? {} : undefined;
            },
            ownerAccess: (runId) => host.service(runOwnerAccessToken)(runId),
        }));
    },
});
export const plugin: PluginModule = { requires: ["ragents.orchestration", "ragents.ask"], create: actorProgramsPlugin };

import path from "node:path";
import { DomainError, type JsonValue, type RAgentsPlugin, type RunState } from "@ragents/engine";
import { documentStoreToken } from "@ragents/host/ragents/document-store.js";
import { workspaceResolverToken, workspaceRuntimeToken, type WorkspaceResolver } from "@ragents/host/ragents/workspace-runtime.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import {
  runtimeProviderToken,
  sessionGuardToken,
  sessionWorkspaceProviderToken,
  workspaceGuardToken,
} from "@ragents/host/ragents/host-services.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { shellPlatformPrompt } from "./shell-platform.js";
import { agentWorkspaceToolNames } from "./workspace-tool-naming.js";
import { startOptionScope } from "@ragents/host/ragents/start-option-state.js";
import { WORKSPACE_BINDING_OPTION_ID, WORKSPACE_METADATA_ID } from "../contract.js";
import { bindingOf, executorShellChapter, sessionMetadataOf, workspaceBindingOption, workspaceLocation, workspaceOwnerOf } from "./binding.js";
import { createBrowseChannel, createBrowseMethods } from "./browse-route.js";
import { clientMethods, WorkspaceClientRegistry } from "./clients.js";
import { RunWorkspaceRuntime } from "./runtime.js";

const ragentsWorkspacePlugin = (skillPaths: () => Promise<readonly string[]>): RAgentsPlugin => ({
  manifest: { id: "ragents.workspace" },
  register: (host) => {
    const sessionWorkspaceFor = host.service(sessionWorkspaceProviderToken);
    const orchestration = host.service(runtimeProviderToken);
    const runState = (runId: string): RunState | null => {
      try {
        return orchestration().state(runId);
      } catch (error) {
        if (error instanceof DomainError && error.code === "run-not-found") return null;
        throw error;
      }
    };
    const documentsFor = (runId: string): Promise<string | undefined> =>
      host.optionalService(documentStoreToken)?.directoryFor(runId) ?? Promise.resolve(undefined);
    const documentsRoot = async (runId: string): Promise<string> => {
      const directory = await documentsFor(runId);
      if (!directory) throw new Error("In diesem Profil gibt es keine Dateiablage; das Plugin ragents.documents fehlt");
      return directory;
    };
    const clients = new WorkspaceClientRegistry();
    const contribution = (): WorkspaceResolver | undefined => host.optionalService(workspaceResolverToken);
    const runtime = new RunWorkspaceRuntime({
      clients,
      globalDirectory: host.storage.root(),
      sessionDirectory: (runId, ...segments) => host.storage.session(runId, ...segments),
      storageRootFor: (runId) => path.join(host.storage.sessionsRoot, runId),
      sessionsDirectoryPattern: path.join(host.storage.sessionsRoot, "{runId}", "plugins", host.manifest.id),
      sessionWorkspaceFor,
      skillPaths,
      resolver: contribution,
      runState,
      storeBinding: (runId, binding) => {
        const state = orchestration().state(runId);
        orchestration().replacePluginState(
          { actorId: state.ownerId, commandId: `workspace-binding:${runId}:${state.revision}` },
          runId,
          { pluginId: WORKSPACE_BINDING_OPTION_ID, scope: startOptionScope, state: binding as unknown as JsonValue },
        );
      },
    });
    host.provide(workspaceRuntimeToken, runtime);
    host.provide(sandboxServicesToken, runtime.sandbox);
    host.functions(runtime.sandbox.workspaceTools());
    const rules = handlebarsPrompt("ragents.workspace.prompt", 100, pluginAsset("ragents.workspace", "prompt.hbs"));
    host.prompts(
      boundToTools({
        ...rules,
        delivery: "initial",
        // Die Regeln gelten für die Arbeitsbereiche des Hosts; eine beigesteuerte Art beschreibt ihre eigenen.
        render: (context) => contribution()?.kind ? "" : rules.render(context),
      }, ...agentWorkspaceToolNames),
      shellPlatformPrompt("ragents.workspace.shell.prompt", 102, (runId) => {
        const state = runState(runId);
        return executorShellChapter(clients, workspaceOwnerOf(state), bindingOf(state));
      }),
    );
    const browseOptions = {
      ensureSession: host.service(sessionGuardToken),
      ensureWorkspaceAccess: host.service(workspaceGuardToken),
      execute: runtime.sandbox.execute.bind(runtime.sandbox),
      documentsFor: documentsRoot,
      locationOf: (runId: string, location: string) => workspaceLocation(bindingOf(runState(runId)), location),
    };
    host.methods(...createBrowseMethods(browseOptions), ...clientMethods(clients));
    host.channels(createBrowseChannel(browseOptions));
    host.startOptions(workspaceBindingOption(clients, () => contribution()?.kind));
    host.sessionMetadata({ id: WORKSPACE_METADATA_ID, describe: ({ runId }) => sessionMetadataOf(runState(runId), contribution()?.kind) });
    host.lifecycle({
      id: "ragents.workspace.lifecycle",
      stopSession: ({ runId }) => runtime.stopSession(runId),
      deleteSession: ({ runId }) => runtime.deleteSession(runId),
      shutdown: () => runtime.shutdown(),
    });
  },
});

export const plugin: PluginModule = {
  create: (host) => ragentsWorkspacePlugin(() => host.skills.global()),
};

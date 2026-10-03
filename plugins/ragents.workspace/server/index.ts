import path from "node:path";
import { DomainError, type JsonValue, type RAgentsPlugin, type RunState } from "@ragents/engine";
import { documentStoreToken } from "@ragents/host/ragents/document-store.js";
import { workspaceResolverToken, workspaceRuntimeToken, type WorkspaceResolver } from "@ragents/host/ragents/workspace-runtime.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import {
  executorContributionsToken,
  hostAddressToken,
  runtimeProviderToken,
  runGuardToken,
  runWorkspaceProviderToken,
  workspaceGuardToken,
} from "@ragents/host/ragents/host-services.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import { ServerProcessSandbox } from "@ragents/host/plugin-support/process-sandbox.js";
import { ripgrepAvailable } from "@ragents/workspace-executor";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { shellPlatformPrompt } from "./shell-platform.js";
import { agentWorkspaceToolNames } from "./workspace-tool-naming.js";
import { startOptionScope } from "@ragents/host/ragents/start-option-state.js";
import { WORKSPACE_BINDING_OPTION_ID, WORKSPACE_METADATA_ID, type WorkspaceSessionMetadata } from "../contract.js";
import { bindingOf, currentBindingOf, executorShellChapter, sessionMetadataOf, workspaceBindingOption, workspaceListDetail, workspaceLocation, workspaceOwnerOf } from "./binding.js";
import { createBrowseChannel, createBrowseMethods } from "./browse-route.js";
import { clientMethods, WorkspaceClientRegistry } from "./clients.js";
import { createCopyTool } from "./copy-tool.js";
import { bashSetting, bashTimeoutSetting, PROCESS_SANDBOX_OFF, processSandboxSetting, rgSetting, workspaceConfigDescriptors } from "./config.js";
import { RunWorkspaceRuntime } from "./runtime.js";

const warnWithoutSandbox = (): void => {
  console.warn(`Process sandbox turned off (${PROCESS_SANDBOX_OFF}): run processes run on the server without a sandbox.`);
};

const ragentsWorkspacePlugin = (skillPaths: () => Promise<readonly string[]>): RAgentsPlugin => ({
  manifest: { id: "ragents.workspace" },
  register: (host) => {
    const sessionWorkspaceFor = host.service(runWorkspaceProviderToken);
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
      if (!directory) throw new Error("This profile has no file store; the plugin ragents.documents is missing");
      return directory;
    };
    const contributions = host.service(executorContributionsToken);
    const clients = new WorkspaceClientRegistry(contributions);
    const contribution = (): WorkspaceResolver | undefined => host.optionalService(workspaceResolverToken);
    host.config(...workspaceConfigDescriptors);
    const sandboxSetting = processSandboxSetting();
    const serverAddress = host.service(hostAddressToken);
    const processSandbox = sandboxSetting.enabled
      ? new ServerProcessSandbox({
        network: sandboxSetting.network,
        serverAddress: serverAddress(),
        dataDirectory: path.dirname(host.storage.sessionsRoot),
        disableSetting: PROCESS_SANDBOX_OFF,
      })
      : undefined;
    const bash = bashSetting();
    const rg = rgSetting();
    const bashTimeoutSeconds = bashTimeoutSetting();
    const serverTools = { ripgrep: ripgrepAvailable(rg, process.env) };
    const runtime = new RunWorkspaceRuntime({
      clients,
      contributions: contributions.map((contribution) => contribution.parts),
      ...(processSandbox ? { processSandbox } : {}),
      ...(bash === undefined ? {} : { bash }),
      ...(rg === undefined ? {} : { rg }),
      ...(bashTimeoutSeconds === undefined ? {} : { bashTimeoutSeconds }),
      serverAddress,
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
    host.functions(runtime.sandbox.workspaceTools(), createCopyTool(runtime.sandbox));
    const rules = handlebarsPrompt("ragents.workspace.prompt", 100, pluginAsset("ragents.workspace", "prompt.hbs"));
    host.prompts(
      boundToTools({
        ...rules,
        delivery: "initial",
        // The rules apply to the host's workspaces; a contributed kind describes its own.
        render: (context) => contribution()?.kind ? "" : rules.render(context),
      }, ...agentWorkspaceToolNames),
      shellPlatformPrompt("ragents.workspace.shell.prompt", 102, serverTools, (runId) => {
        const state = runState(runId);
        return executorShellChapter(clients, workspaceOwnerOf(state), bindingOf(state), serverTools);
      }),
    );
    const browseOptions = {
      ensureSession: host.service(runGuardToken),
      ensureWorkspaceAccess: host.service(workspaceGuardToken),
      execute: runtime.sandbox.execute.bind(runtime.sandbox),
      documentsFor: documentsRoot,
      locationOf: (runId: string, location: string) => workspaceLocation(currentBindingOf(clients, runState(runId)), location),
    };
    host.methods(...createBrowseMethods(browseOptions), ...clientMethods(clients));
    host.channels(createBrowseChannel(browseOptions));
    host.startOptions(workspaceBindingOption(clients, contribution));
    host.sessionMetadata({
      id: WORKSPACE_METADATA_ID,
      describe: ({ runId }) => sessionMetadataOf(currentBindingOf(clients, runState(runId)), contribution()),
      // The value is the one describe returned in this process.
      listDetail: (value) => workspaceListDetail(value as WorkspaceSessionMetadata),
    });
    host.lifecycle({
      id: "ragents.workspace.lifecycle",
      initialize: () => processSandbox ? processSandbox.start() : warnWithoutSandbox(),
      stopSession: ({ runId }) => runtime.stopSession(runId),
      deleteSession: ({ runId }) => runtime.deleteSession(runId),
      shutdown: async () => {
        await runtime.shutdown();
        await processSandbox?.stop();
      },
    });
  },
});

export const plugin: PluginModule = {
  create: (host) => ragentsWorkspacePlugin(() => host.skills.global()),
};

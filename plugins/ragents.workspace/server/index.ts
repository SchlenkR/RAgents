import path from "node:path";
import { homedir } from "node:os";
import { DomainError, type JsonValue, type RAgentsPlugin } from "@ragents/engine";
import { documentStoreToken } from "@ragents/host/ragents/document-store.js";
import { workspaceResolverToken, workspaceRuntimeToken, type WorkspaceResolver } from "@ragents/host/ragents/workspace-runtime.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import {
  executorContributionsToken,
  hostAddressToken,
  runtimeProviderToken,
  runOwnerAccessToken,
  userAccessToken,
  runGuardToken,
  runWorkspaceProviderToken,
  workspaceGuardToken,
} from "@ragents/host/ragents/host-services.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import { ServerProcessSandbox } from "@ragents/host/plugin-support/process-sandbox.js";
import { ripgrepAvailable, type WorkspaceGrantPolicy } from "@ragents/workspace-executor";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { shellPlatformPrompt } from "./shell-platform.js";
import { agentWorkspaceToolNames } from "./workspace-tool-naming.js";
import { startOptionScope } from "@ragents/host/ragents/start-option-state.js";
import { WORKSPACE_BINDING_OPTION_ID, WORKSPACE_ACCESS_OPTION_ID, WORKSPACE_METADATA_ID, WORKSPACE_GRANTS_STATE_ID, type WorkspaceBinding, type WorkspaceSessionMetadata } from "../contract.js";
import { WorkspaceAccessRequests, accessRequestMethods, grantsOf, requestAccessContributor } from "./grants.js";
import { runSecurityPolicyToken } from "./contract.js";
import { bindingOf, currentBindingOf, executorShellChapter, sessionMetadataOf, workspaceBindingOption, workspaceListDetail, workspaceLocation, workspaceOwnerOf, type WorkspaceRunState } from "./binding.js";
import { createBrowseChannel, createBrowseMethods } from "./browse-route.js";
import { clientMethods, WorkspaceClientRegistry } from "./clients.js";
import { createCopyTool } from "./copy-tool.js";
import { bashSetting, bashTimeoutSetting, PROCESS_SANDBOX_OFF, processSandboxSetting, rgSetting, workspaceConfigDescriptors } from "./config.js";
import { RunWorkspaceRuntime } from "./runtime.js";
import { accessStartOption, accessDescription, accessNoteContribution, assertAccessBinding, securityPolicyFor } from "./security.js";

const ragentsWorkspacePlugin = (skillPaths: () => Promise<readonly string[]>): RAgentsPlugin => ({
  manifest: { id: "ragents.workspace" },
  register: (host) => {
    const sessionWorkspaceFor = host.service(runWorkspaceProviderToken);
    const orchestration = host.service(runtimeProviderToken);
    const runState = (runId: string): WorkspaceRunState | null => {
      try {
        const options = [WORKSPACE_BINDING_OPTION_ID, WORKSPACE_ACCESS_OPTION_ID, WORKSPACE_GRANTS_STATE_ID, contribution()?.optionId];
        return orchestration().select(runId, (state) => ({
          ownerUserId: state.ownerUserId,
          pluginStates: new Map([...state.pluginStates].filter(([, entry]) => entry.scope.kind === "run" && options.includes(entry.pluginId))),
        }));
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
    const clients = new WorkspaceClientRegistry(contributions, (runId) => ({ level: securityFor(runId).level, grants: grantsOf(runState(runId)) }),
      (runId) => runState(runId) ? orchestration().select(runId, (state) => state.title) : undefined);
    const contribution = (): WorkspaceResolver | undefined => host.optionalService(workspaceResolverToken);
    host.config(...workspaceConfigDescriptors);
    const sandboxSetting = processSandboxSetting();
    const ownerAccess = host.service(runOwnerAccessToken);
    const userAccess = host.service(userAccessToken);
    const securityFor = (runId: string) => {
      const state = runState(runId);
      return securityPolicyFor(sandboxSetting.mode === "on", state ? ownerAccess(runId) : userAccess(null), state);
    };
    const otherRunFolders = async (runId: string, workstation: boolean, requireReadable = false): Promise<readonly string[]> => {
      const binding = bindingOf(runState(runId));
      return orchestration().runIds().filter((id) => id !== runId).flatMap((id) => {
        try {
          const state = runState(id);
          if (!state) return [];
          const other = bindingOf(state);
          const sameMachine = workstation && binding.machine !== "server" && other.machine !== "server"
            ? binding.machine.client === other.machine.client && workspaceOwnerOf(state) === workspaceOwnerOf(runState(runId))
            : !workstation && other.machine === "server";
          return sameMachine && other.folder !== "fresh" ? [other.folder.path] : [];
        } catch (error) {
          if (error instanceof DomainError && error.code === "journal-unavailable") {
            if (requireReadable) throw new DomainError("workspace-grant-roots-unavailable", "Other run folders cannot be verified while a journal is unavailable. Repair the unavailable run before requesting narrow access.", 409);
            return [];
          }
          throw error;
        }
      });
    };
    const localGrantPolicy = async (runId: string, requireReadable = false): Promise<WorkspaceGrantPolicy> => ({
      homeDirectories: [homedir()],
      dataDirectory: path.dirname(host.storage.sessionsRoot),
      protectedPaths: await otherRunFolders(runId, false, requireReadable),
    });
    const requestGrantPolicy = async (runId: string): Promise<WorkspaceGrantPolicy> => {
      const state = runState(runId);
      const binding = bindingOf(state);
      if (binding.machine === "server") return localGrantPolicy(runId, true);
      const client = clients.info(workspaceOwnerOf(state), binding.machine.client);
      return { protectedPaths: [...client ? [client.runsDirectory] : [], ...await otherRunFolders(runId, true, true)] };
    };
    const grantDisabledReason = (runId: string, userId: string | null): string | null => {
      const state = runState(runId);
      if (!state || state.ownerUserId !== userId) return "Only the run's owner may answer access requests.";
      try { assertAccessBinding("full", sandboxSetting.mode === "on", ownerAccess(runId), bindingOf(state)); }
      catch (error) {
        if (error instanceof DomainError) return error.message;
        throw error;
      }
      return null;
    };
    const initialAccessEvent = (runId: string) => {
      const events = orchestration().events(runId);
      const created = events.find((event) => event.type === "run.created");
      return events.find((event) => event.type === "plugin.state-replaced" && event.payload.pluginId === WORKSPACE_ACCESS_OPTION_ID
        && event.commandId === created?.commandId);
    };
    const initialLevel = (runId: string): "isolated" | "full" => {
      const event = initialAccessEvent(runId);
      return event?.type === "plugin.state-replaced" && event.payload.state === "full" ? "full" : "isolated";
    };
    const platformFor = (binding: WorkspaceBinding, owner: string | null): string | undefined =>
      binding.machine === "server" ? process.platform : clients.info(owner, binding.machine.client)?.platform;
    host.provide(runSecurityPolicyToken, securityFor);
    const serverAddress = host.service(hostAddressToken);
    let startedSandbox: Promise<ServerProcessSandbox> | undefined;
    const startSandbox = (): Promise<ServerProcessSandbox> => {
      if (startedSandbox) return startedSandbox;
      const pending = (async () => {
        const sandbox = new ServerProcessSandbox({
          network: sandboxSetting.network,
          serverAddress: serverAddress(),
          dataDirectory: path.dirname(host.storage.sessionsRoot),
          disableSetting: PROCESS_SANDBOX_OFF,
        });
        await sandbox.start();
        return sandbox;
      })();
      startedSandbox = pending;
      void pending.catch(() => { if (startedSandbox === pending) startedSandbox = undefined; });
      return pending;
    };
    const bash = bashSetting();
    const rg = rgSetting();
    const bashTimeoutSeconds = bashTimeoutSetting();
    const serverTools = { ripgrep: ripgrepAvailable(rg, process.env) };
    const runtime = new RunWorkspaceRuntime({
      clients,
      contributions: contributions.map((contribution) => contribution.parts),
      processSandboxFor: (runId) => bindingOf(runState(runId)).machine !== "server" || securityFor(runId).restricted ? startSandbox() : Promise.resolve(undefined),
      isolatedProcessSandboxFor: (runId) => bindingOf(runState(runId)).machine === "server" && !securityFor(runId).restricted ? Promise.resolve(undefined) : startSandbox(),
      isolatedProcessSandbox: () => sandboxSetting.mode === "off" ? Promise.resolve(undefined) : startSandbox(),
      restrictedFor: (runId) => bindingOf(runState(runId)).machine !== "server" || securityFor(runId).restricted,
      grantsFor: (runId) => bindingOf(runState(runId)).machine === "server" ? grantsOf(runState(runId)) : [],
      grantPolicyFor: localGrantPolicy,
      fullAccessFor: (runId) => bindingOf(runState(runId)).machine === "server" && securityFor(runId).level === "full",
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
      administratorFor: (runId) => ownerAccess(runId).can("*"),
      storeBinding: (runId, binding) => {
        const state = orchestration().select(runId, (state) => ({ ownerId: state.ownerId, revision: state.revision }));
        orchestration().replacePluginState(
          { actorId: state.ownerId, commandId: `workspace-binding:${runId}:${state.revision}` },
          runId,
          { pluginId: WORKSPACE_BINDING_OPTION_ID, scope: startOptionScope, state: binding as unknown as JsonValue },
        );
      },
    });
    const accessRequests = new WorkspaceAccessRequests({
      runtime: orchestration,
      sandbox: runtime.sandbox,
      policyFor: requestGrantPolicy,
      disabledReason: grantDisabledReason,
      onBindingMachine: (runId, requested) => bindingOf(runState(runId)).machine === "server" || !requested.startsWith("@"),
    });
    host.provide(workspaceRuntimeToken, runtime);
    host.provide(sandboxServicesToken, runtime.sandbox);
    host.functions(runtime.sandbox.workspaceTools(), createCopyTool(runtime.sandbox), requestAccessContributor(accessRequests));
    host.agentRuntime(runtime.sandbox.readImageContribution(), accessNoteContribution(runState, (runId) =>
      orchestration().events(runId).filter((event) => (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched")
        && event.payload.pluginId === WORKSPACE_ACCESS_OPTION_ID).at(-1)?.sequence ?? 0, (runId) => initialAccessEvent(runId)?.sequence ?? 0, platformFor));
    const rules = handlebarsPrompt("ragents.workspace.prompt", 100, pluginAsset("ragents.workspace", "prompt.hbs"));
    host.prompts(
      boundToTools({
        ...rules,
        delivery: "initial",
        // The rules apply to the host's workspaces; a contributed kind describes its own.
        render: (context) => contribution()?.kind ? "" : rules.render(context),
      }, ...agentWorkspaceToolNames),
      boundToTools({
        id: "ragents.workspace.access.prompt",
        order: 101,
        delivery: "initial",
        render: () => accessDescription("isolated", false),
        renderForRun: (runId) => {
          const state = runState(runId);
          const binding = bindingOf(state);
          return accessDescription(initialLevel(runId), binding.machine !== "server", platformFor(binding, workspaceOwnerOf(state)));
        },
      }, ...agentWorkspaceToolNames),
      shellPlatformPrompt("ragents.workspace.shell.prompt", 102, serverTools, (runId) => {
        const state = runState(runId);
        return executorShellChapter(clients, workspaceOwnerOf(state), bindingOf(state), serverTools, initialLevel(runId));
      }),
    );
    const browseOptions = {
      ensureSession: host.service(runGuardToken),
      ensureWorkspaceAccess: host.service(workspaceGuardToken),
      execute: runtime.sandbox.execute.bind(runtime.sandbox),
      documentsFor: documentsRoot,
      locationOf: (runId: string, location: string) => workspaceLocation(currentBindingOf(clients, runState(runId)), location),
    };
    host.methods(
      ...createBrowseMethods(browseOptions),
      ...accessRequestMethods(accessRequests, host.service(runGuardToken)),
      ...clientMethods(clients, (signIn) => runtime.resumeBackgroundTasks(orchestration(), signIn)),
    );
    host.channels(createBrowseChannel(browseOptions));
    host.startOptions(workspaceBindingOption(clients, contribution, userAccess, (binding, context) => {
      const state = runState(context.runId);
      const level = context.values?.[WORKSPACE_ACCESS_OPTION_ID] ?? securityFor(context.runId).level;
      assertAccessBinding(String(level), sandboxSetting.mode === "on", userAccess(state ? state.ownerUserId : context.userId), binding);
    }), accessStartOption(sandboxSetting.mode === "on", userAccess, runState, async (runId) => {
      const results = await Promise.allSettled([orchestration().stopNativeProcesses(runId), runtime.accessChanged(runId)]);
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    }, platformFor));
    host.sessionMetadata({
      id: WORKSPACE_METADATA_ID,
      describe: ({ runId }) => sessionMetadataOf(currentBindingOf(clients, runState(runId)), contribution()),
      // The value is the one describe returned in this process.
      listDetail: (value) => workspaceListDetail(value as WorkspaceSessionMetadata),
    });
    host.lifecycle({
      id: "ragents.workspace.lifecycle",
      initialize: async () => {
        if (sandboxSetting.enabled) await startSandbox();
      },
      serverReady: () => accessRequests.bind(orchestration()),
      stopSession: async ({ runId }) => {
        accessRequests.withdraw(runId);
        await runtime.stopSession(runId);
      },
      afterStopSession: ({ runId }) => accessRequests.withdraw(runId),
      deleteSession: async ({ runId }) => {
        accessRequests.withdraw(runId);
        await runtime.deleteSession(runId);
      },
      shutdown: async () => {
        await runtime.shutdown();
        const pending = startedSandbox;
        startedSandbox = undefined;
        await pending?.then((sandbox) => sandbox.stop(), () => undefined);
      },
    });
  },
});

export const plugin: PluginModule = {
  create: (host) => ragentsWorkspacePlugin(() => host.skills.global()),
};

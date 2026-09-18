import path from "node:path";
import { DomainError, type RAgentsPlugin, type RunState } from "@aicontainer/ragents";
import { documentStoreToken } from "@aicontainer/server/ragents/document-store.js";
import { workspaceResolverToken, workspaceRuntimeToken } from "@aicontainer/server/ragents/workspace-runtime.js";
import { sandboxServicesToken } from "@aicontainer/server/plugin-support/workspace-sandbox-host.js";
import {
  runtimeProviderToken,
  eventHubToken,
  sessionGuardToken,
  sessionWorkspaceProviderToken,
} from "@aicontainer/server/ragents/host-services.js";
import { pluginAssetPath } from "@aicontainer/server/plugin-support/asset-path.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { handlebarsPrompt } from "@aicontainer/server/plugin-support/prompt.js";
import { shellPlatformPrompt } from "@aicontainer/server/plugin-support/shell-platform.js";
import type { BrowseRoot } from "../contract.js";
import { createBrowseChannel, createBrowseRoutes, workspaceApiPrefix } from "./browse-route.js";
import { RunWorkspaceRuntime } from "./runtime.js";

const promptFile = pluginAssetPath(import.meta.url, "../prompt.hbs");

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
    const runtime = new RunWorkspaceRuntime({
      globalDirectory: host.storage.root(),
      sessionDirectory: (runId, ...segments) => host.storage.session(runId, ...segments),
      sessionsDirectoryPattern: path.join(host.storage.sessionsRoot, "{runId}", "plugins", host.manifest.id),
      sessionWorkspaceFor,
      skillPaths,
      resolver: () => host.optionalService(workspaceResolverToken),
      runState,
      documentsFor,
    });
    host.provide(workspaceRuntimeToken, runtime);
    host.provide(sandboxServicesToken, runtime.sandbox);
    host.functions(runtime.sandbox.workspaceTools());
    host.prompts(handlebarsPrompt("ragents.workspace.prompt", 100, promptFile), shellPlatformPrompt("ragents.workspace.shell.prompt", 102));
    host.clientConfig({ routePrefix: workspaceApiPrefix });
    const browseOptions = {
      ensureSession: host.service(sessionGuardToken),
      rootFor: (runId: string, root: BrowseRoot) => root === "files"
        ? documentsRoot(runId)
        : sessionWorkspaceFor(runId).then((workspace) => workspace.currentRoot()),
    };
    host.http(...createBrowseRoutes(browseOptions));
    host.service(eventHubToken).channels(createBrowseChannel(browseOptions));
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

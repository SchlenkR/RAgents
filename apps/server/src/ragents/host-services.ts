import {
  serviceToken,
  type AccessContext,
  type Orchestration,
  type PluginHost,
  type ServiceToken,
} from "@ragents/engine";
import type { ModelRuntime } from "@ragents/agent";
import type { PreparedExecutorContribution } from "@ragents/workspace-executor";
import type { SessionWorkspace } from "./workspace-runtime.js";
import type { RunManagement } from "./global-chat.js";

export const runGuardToken: ServiceToken<(runId: string) => void> = serviceToken("host.run-guard");

/** Every path from outside into a run's workspace (files, processes, language servers) checks run and access with this: a run that only its owner operates shows its workspace only to that owner. */
export const workspaceGuardToken: ServiceToken<(access: AccessContext, runId: string) => void> = serviceToken("host.workspace-guard");

export const runWorkspaceProviderToken: ServiceToken<(runId: string) => Promise<SessionWorkspace>> =
  serviceToken("host.run-workspaces");

export const secretEnvNamesToken: ServiceToken<() => readonly string[]> = serviceToken("host.secret-env-names");

export const runtimeProviderToken: ServiceToken<() => Orchestration> = serviceToken("host.runtime-provider");

/** The address at which this server offers its API, e.g. http://127.0.0.1:4710; none without HTTP (stdio only). */
export const hostAddressToken: ServiceToken<() => string | undefined> = serviceToken("host.address");

/** The executor contributions of this profile's bundles, built for the server; every executor of the server carries them, every workstation the same ones. */
export const executorContributionsToken: ServiceToken<readonly PreparedExecutorContribution[]> = serviceToken("host.executor-contributions");

export interface HostBridges {
  ensureSession: (runId: string) => void;
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  runtime: () => Orchestration;
  sessionWorkspaceFor: (runId: string) => Promise<SessionWorkspace>;
  sessions?: () => RunManagement;
  /** The server's one model runtime with the profile's providers and aliases. */
  modelRuntime?: () => Promise<ModelRuntime>;
  apiBaseUrl?: string;
}

export type ProductProfileFactory = (bridges: HostBridges) => PluginHost;

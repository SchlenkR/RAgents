import {
  serviceToken,
  type AccessContext,
  type Orchestration,
  type PluginHost,
  type ServiceToken,
} from "@ragents/engine";
import type { SessionWorkspace } from "./workspace-runtime.js";
import type { RunManagement } from "./global-chat.js";

export const runGuardToken: ServiceToken<(runId: string) => void> = serviceToken("host.run-guard");

/** Jeder Weg von außen zum Arbeitsbereich eines Runs (Dateien, Prozesse, Sprachserver) prüft damit Run und Zugang: ein Run, den nur sein Eigentümer bedient, zeigt seinen Arbeitsbereich nur ihm. */
export const workspaceGuardToken: ServiceToken<(access: AccessContext, runId: string) => void> = serviceToken("host.workspace-guard");

export const runWorkspaceProviderToken: ServiceToken<(runId: string) => Promise<SessionWorkspace>> =
  serviceToken("host.run-workspaces");

export const secretEnvNamesToken: ServiceToken<() => readonly string[]> = serviceToken("host.secret-env-names");

export const runtimeProviderToken: ServiceToken<() => Orchestration> = serviceToken("host.runtime-provider");

export interface HostBridges {
  ensureSession: (runId: string) => void;
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  runtime: () => Orchestration;
  sessionWorkspaceFor: (runId: string) => Promise<SessionWorkspace>;
  sessions?: () => RunManagement;
}

export type ProductProfileFactory = (bridges: HostBridges) => PluginHost;

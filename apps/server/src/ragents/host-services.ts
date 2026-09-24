import {
  serviceToken,
  type AccessContext,
  type Orchestration,
  type PluginHost,
  type ServiceToken,
} from "@ragents/engine";
import type { SessionWorkspace } from "./workspace-runtime.js";
import type { SessionManagement } from "./global-chat.js";

export const sessionGuardToken: ServiceToken<(runId: string) => void> = serviceToken("host.session-guard");

/** Jeder Weg von außen zum Arbeitsbereich eines Runs (Dateien, Prozesse, Sprachserver) prüft damit Run und Zugang: ein Run, den nur sein Eigentümer bedient, zeigt seinen Arbeitsbereich nur ihm. */
export const workspaceGuardToken: ServiceToken<(access: AccessContext, runId: string) => void> = serviceToken("host.workspace-guard");

export const sessionWorkspaceProviderToken: ServiceToken<(runId: string) => Promise<SessionWorkspace>> =
  serviceToken("host.session-workspaces");

export const secretEnvNamesToken: ServiceToken<() => readonly string[]> = serviceToken("host.secret-env-names");

export const runtimeProviderToken: ServiceToken<() => Orchestration> = serviceToken("host.runtime-provider");

export interface HostBridges {
  ensureSession: (runId: string) => void;
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  runtime: () => Orchestration;
  sessionWorkspaceFor: (runId: string) => Promise<SessionWorkspace>;
  sessions?: () => SessionManagement;
}

export type ProductProfileFactory = (bridges: HostBridges) => PluginHost;

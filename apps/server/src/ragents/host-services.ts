import {
  serviceToken,
  type Orchestration,
  type PluginHost,
  type ServiceToken,
} from "@aicontainer/ragents";
import type { SessionWorkspace } from "./workspace-runtime.js";
import type { SessionManagement } from "./global-chat.js";
import type { EventChannelRegistry } from "../event-hub.js";

export const sessionGuardToken: ServiceToken<(runId: string) => void> = serviceToken("host.session-guard");

export const sessionWorkspaceProviderToken: ServiceToken<(runId: string) => Promise<SessionWorkspace>> =
  serviceToken("host.session-workspaces");

export const secretEnvNamesToken: ServiceToken<() => readonly string[]> = serviceToken("host.secret-env-names");

export const runtimeProviderToken: ServiceToken<() => Orchestration> = serviceToken("host.runtime-provider");

export const eventHubToken: ServiceToken<EventChannelRegistry> = serviceToken("host.event-hub");

export interface HostBridges {
  ensureSession: (runId: string) => void;
  runtime: () => Orchestration;
  sessionWorkspaceFor: (runId: string) => Promise<SessionWorkspace>;
  sessions?: () => SessionManagement;
  eventHub?: EventChannelRegistry;
}

export type ProductProfileFactory = (bridges: HostBridges) => PluginHost;

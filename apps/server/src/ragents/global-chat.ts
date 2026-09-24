import { serviceToken, type AccessContext, type CatalogModel, type ExecutableActor, type JournalEvent, type JsonValue, type ModelSelection, type Orchestration, type RunView } from "@ragents/engine";
import type { GlobalRunPolicy } from "../api/rights.js";
import type { ChatUser, SessionInfo } from "../chat-handler.js";

export interface GlobalChatPolicy {
  /** Der Koordinator eines Benutzers; ohne Anmeldung (null) gibt es genau einen. */
  runIdFor: (userId: string | null) => string;
  /** Jede Kennung, die einem Koordinator vorbehalten ist, auch eine, die keinem Zugang mehr gehört. */
  isCoordinator: (runId: string) => boolean;
  access?: { read: string; write: string };
  title: string;
  prompt: string;
  preparationPrompt?: string;
  toolNames: readonly string[];
  workspaceDirectory: (runId: string) => string;
  prepareWorkspace?: (directory: string) => Promise<void>;
  /** Je Koordinator eine Datei <runId>.json, solange sein Gesprächsreset nicht abgeschlossen ist. */
  resetIntentDirectory?: string;
  inputContext?: (runtime: Orchestration, runId: string, value: unknown) => Promise<readonly string[]>;
  contextPrompt?: (runtime: Orchestration, runId: string, actor: ExecutableActor) => string;
  model?: {
    initialize: (models: readonly (CatalogModel & { input: readonly string[] })[], initial: ModelSelection, requiredInputs: () => readonly string[]) => Promise<void>;
    selection: () => ModelSelection;
    forTurn: (runtime: Orchestration, runId: string, actorId: string, turnId: string) => ModelSelection;
  };
}

export type ManagedRunStart = {
  title: string;
  options?: Readonly<Record<string, JsonValue>>;
  /** Wer die Startoptionen wählt und den Run besitzt: der Benutzer der Anfrage, null ohne Anmeldung. */
  user: ChatUser | null;
} & ({ kind: "message"; message: string } | { kind: "script"; entryId: string; input: JsonValue }
  | { kind: "package"; directory: string; input: JsonValue });

export interface RunManagement {
  /** Mit einem Zugang bleiben nur dessen eigene Runs übrig; ohne ihn ist es die Liste des Servers. */
  list: (access?: AccessContext) => Promise<SessionInfo[]>;
  view: (runId: string) => RunView;
  events: (runId: string) => readonly JournalEvent[];
  create: (start: ManagedRunStart) => Promise<string>;
  /** Eine Nachricht bedient den Run; der Host prüft dafür denselben Zugang wie beim Chat. */
  send: (runId: string, message: string, access: AccessContext) => Promise<void>;
  stop: (runId: string) => Promise<void>;
  resetGlobal: (runId: string) => Promise<void>;
}

export const globalChatToken = serviceToken<GlobalChatPolicy>("host.global-chat");

/** Die Rechte der Koordinatoren für die Nachrichtenschicht; ohne Rechte des Plugins gilt keiner als eigener Run. */
export const globalRunPolicyOf = (policy: GlobalChatPolicy | undefined): GlobalRunPolicy | undefined =>
  policy?.access ? { isCoordinator: policy.isCoordinator, runIdFor: policy.runIdFor, ...policy.access } : undefined;
export const runManagementToken = serviceToken<() => RunManagement>("host.run-management");

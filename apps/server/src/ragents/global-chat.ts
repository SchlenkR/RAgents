import { serviceToken, type AccessContext, type CatalogModel, type ExecutableActor, type JournalEvent, type JsonValue, type ModelSelection, type Orchestration, type RunView } from "@ragents/engine";
import type { ChatUser, SessionInfo } from "../chat-handler.js";

export interface GlobalChatPolicy {
  runId: string;
  access?: { read: string; write: string };
  title: string;
  prompt: string;
  preparationPrompt?: string;
  toolNames: readonly string[];
  workspaceDirectory: string;
  prepareWorkspace?: (directory: string) => Promise<void>;
  resetIntentFile?: string;
  inputContext?: (runtime: Orchestration, value: unknown) => Promise<readonly string[]>;
  contextPrompt?: (runtime: Orchestration, actor: ExecutableActor) => string;
  model?: {
    initialize: (models: readonly (CatalogModel & { input: readonly string[] })[], initial: ModelSelection, requiredInputs: () => readonly string[]) => Promise<void>;
    selection: () => ModelSelection;
    forTurn: (runtime: Orchestration, actorId: string, turnId: string) => ModelSelection;
  };
}

export type ManagedRunStart = {
  title: string;
  options?: Readonly<Record<string, JsonValue>>;
  /** Wer die Startoptionen wählt und den Run besitzt: der Benutzer der Anfrage, null ohne Anmeldung. */
  user: ChatUser | null;
} & ({ kind: "message"; message: string } | { kind: "script"; entryId: string; input: JsonValue }
  | { kind: "package"; directory: string; input: JsonValue });

export interface SessionManagement {
  /** Mit einem Zugang bleiben nur dessen eigene Runs übrig; ohne ihn ist es die Liste des Servers. */
  list: (access?: AccessContext) => Promise<SessionInfo[]>;
  view: (runId: string) => RunView;
  events: (runId: string) => readonly JournalEvent[];
  create: (start: ManagedRunStart) => Promise<string>;
  /** Eine Nachricht bedient den Run; der Host prüft dafür denselben Zugang wie beim Chat. */
  send: (runId: string, message: string, access: AccessContext) => Promise<void>;
  stop: (runId: string) => Promise<void>;
  resetGlobal: () => Promise<void>;
}

export const globalChatToken = serviceToken<GlobalChatPolicy>("host.global-chat");
export const sessionManagementToken = serviceToken<() => SessionManagement>("host.session-management");

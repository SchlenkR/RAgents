/** Die Verträge der Runs, gegen die Kernmethoden und Auslieferung arbeiten. */
import type { ChatAttachment, ChatAttachmentInput, ChatEvent } from "./chat-events.js";
import type { ActorConversations } from "./ragents/actor-chat-history.js";

export interface SessionInfo {
  id: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  revision?: number;
}

export interface ChatUser {
  id: string;
  label: string;
}

/** Was der HTTP-Adapter von einem Run braucht. */
export interface ChatSessionLike {
  readonly running: boolean;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  send(text: string, attachments?: ChatAttachmentInput[], userLocation?: unknown, user?: ChatUser, entryId?: string): void | Promise<void>;
  sendToActor?(actorId: string, text: string, attachments?: ChatAttachmentInput[], user?: ChatUser): Promise<void>;
  actorConversations?(): ActorConversations;
  capabilities?(actor: string, userId: string | null): Promise<{ input: string[]; model: string }>;
  attachment?(artifactId: string): { attachment: ChatAttachment; content: Uint8Array };
  start(entryId: string, input: unknown, user?: ChatUser): void;
  stop(): void | Promise<void>;
}

/** Was der Aufrufer der Run-Liste sieht und welchen Arbeitsbereich er erreicht. */
export interface RunListScope {
  visible: (runId: string) => boolean;
  workspaceAccessible: (runId: string) => boolean;
}

export interface ChatSessionProvider {
  get(id: string): Promise<ChatSessionLike>;
  hasRun?(id: string): boolean;
  /** Ohne Bereich alle Runs, aber kein Arbeitsbereich, den nur sein Eigentümer bedient. */
  list(scope?: RunListScope): Promise<SessionInfo[]>;
  subscribeList?(listener: () => void): () => void;
  delete(id: string): Promise<void>;
}

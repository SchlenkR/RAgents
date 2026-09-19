/** Die Verträge der Unterhaltungen, gegen die Kernmethoden und Auslieferung arbeiten. */
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

/** Was der HTTP-Adapter von einer Unterhaltung braucht. */
export interface ChatSessionLike {
  readonly running: boolean;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  send(text: string, attachments?: ChatAttachmentInput[], userLocation?: unknown, user?: ChatUser): void | Promise<void>;
  sendToActor?(actorId: string, text: string, attachments?: ChatAttachmentInput[]): Promise<void>;
  actorConversations?(): ActorConversations;
  capabilities?(actor?: string): Promise<{ input: string[]; model: string }>;
  attachment?(artifactId: string): { attachment: ChatAttachment; content: Uint8Array };
  start(entryId: string, input: unknown, user?: ChatUser): void;
  stop(): void | Promise<void>;
}

export interface ChatSessionProvider {
  get(id: string): Promise<ChatSessionLike>;
  hasRun?(id: string): boolean;
  list(): Promise<SessionInfo[]>;
  subscribeList?(listener: () => void): () => void;
  delete(id: string): Promise<void>;
}

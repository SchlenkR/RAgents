/** The contracts of the runs that core methods and delivery work against. */
import type { ChatAttachment, ChatAttachmentInput, ChatEvent } from "quassel/events";
import type { PublicStartEntry } from "@ragents/engine";
import type { ActorConversations } from "./ragents/actor-chat-history.js";

export interface SessionInfo {
  id: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  revision?: number;
  /** Why the run is locked; it stays visible and deletable, everything else reports journal-unavailable. */
  locked?: string;
}

export interface ChatUser {
  id: string;
  label: string;
}

/** What the HTTP adapter needs from a run. */
/** A started run script: its actor and which start of its package in the run this was. */
export interface StartedScript {
  readonly actorId: string;
  readonly handle: string;
  readonly count: number;
}

/** A run script as a run lists it: whether it can start there now, and otherwise why not. */
export interface RunScriptListing {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly available: boolean;
  readonly reason?: string;
}

export interface ChatSessionLike {
  readonly running: boolean;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  send(text: string, attachments?: ChatAttachmentInput[], userLocation?: unknown, user?: ChatUser, entryId?: string): void | Promise<void>;
  sendToActor?(actorId: string, text: string, attachments?: ChatAttachmentInput[], user?: ChatUser): Promise<void>;
  actorConversations?(): ActorConversations;
  capabilities?(actor: string, userId: string | null): Promise<{ input: string[]; model: string }>;
  attachment?(artifactId: string): { attachment: ChatAttachment; content: Uint8Array };
  start(entryId: string, input: unknown, user?: ChatUser): void;
  startAndWait?(entryId: string, input: unknown, user?: ChatUser, startedBy?: string): Promise<StartedScript>;
  runScripts?(entries: readonly PublicStartEntry[], userId: string | null): RunScriptListing[];
  stop(): void | Promise<void>;
}

/** What the caller of the run list sees and which workspace it reaches. */
export interface RunListScope {
  visible: (runId: string) => boolean;
  workspaceAccessible: (runId: string) => boolean;
}

export interface ChatSessionProvider {
  get(id: string): Promise<ChatSessionLike>;
  hasRun?(id: string): boolean;
  /** Without a scope all runs, but no workspace that only its owner operates. */
  list(scope?: RunListScope): Promise<SessionInfo[]>;
  subscribeList?(listener: () => void): () => void;
  delete(id: string): Promise<void>;
}

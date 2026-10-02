/** The contracts of the runs that core methods and delivery work against. */
import type { ChatAttachment, ChatAttachmentInput, ChatEvent } from "quassel/events";
import type { PublicStartEntry, RunListDetail, RunShareAccess } from "@ragents/engine";
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

/** What a run list row shows as its state: paused until a person continues it, running, waiting for the owner's input, ended once every actor stopped, otherwise idle. */
export type RunListState = "paused" | "running" | "waiting" | "idle" | "ended";

/** What the caller of the run list learns about a run's sharing. */
export interface ListedSharing {
  /** The caller may change whom the run is shared with (ragents.runs.sharing and ragents.runs.share). */
  canShare?: true;
  /** For a caller who may change it: the run is shared with anyone. */
  shared?: true;
  /** For a caller who sees the run only through a share: the access it gives. */
  sharedAccess?: RunShareAccess;
}

/** A run as `ragents.runs.list` delivers it; the run list of every host draws its rows from it. */
export interface ListedSession extends SessionInfo, ListedSharing {
  running: boolean;
  state: RunListState;
  /** Pending actions of the run, such as open questions to the owner. */
  pendingActions: number;
  /** Whether the caller reaches the run's workspace; otherwise UIs hide what needs it. */
  workspaceAccessible: boolean;
  /** Whether the caller operates the run as far as its rights go: not in a run shared with it for reading, not in someone else's run only its owner operates. */
  operable: boolean;
  /** Display name of the user who created the run; missing for a run created without sign-in. */
  ownerLabel?: string;
  /** The highest revision the caller has viewed; missing until the caller views the run. */
  seenRevision?: number;
  metadata?: Readonly<Record<string, unknown>>;
  metadataUnavailable?: Readonly<Record<string, string>>;
  /** The list lines of the run metadata contributions in registration order. */
  listDetails?: readonly RunListDetail[];
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

/** What the caller of the run list sees, which workspace it reaches, what it operates, what it learns about sharing, and whose read markers it gets. */
export interface RunListScope {
  visible: (runId: string) => boolean;
  workspaceAccessible: (runId: string) => boolean;
  operable: (runId: string) => boolean;
  sharing: (runId: string) => ListedSharing;
  /** The caller's user; null without sign-in. */
  userId: string | null;
}

export interface ChatSessionProvider {
  get(id: string): Promise<ChatSessionLike>;
  hasRun?(id: string): boolean;
  /** Without a scope all runs, but no workspace that only its owner operates, no sharing details and no read markers. */
  list(scope?: RunListScope): Promise<ListedSession[]>;
  /** Every list change reaches every listener, a changed read marker only the listeners of its user. */
  subscribeList?(listener: () => void, userId: string | null): () => void;
  delete(id: string): Promise<void>;
}

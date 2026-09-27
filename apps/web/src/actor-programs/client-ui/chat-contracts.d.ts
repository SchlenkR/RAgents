export type Role = "user" | "assistant" | "thinking" | "tool" | "system" | "action";

export interface ChatAttachmentInput {
  name: string;
  mediaType: string;
  data: string;
}

export interface ChatAttachment {
  name: string;
  mediaType: string;
  size: number;
  url: string;
}

export interface ChatAttachmentCapabilities {
  input: readonly string[];
  model: string;
}

export interface ToolInfo {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
}

export interface ChatTextCursor {
  conversationId: string;
  sequence: number;
  /** Accumulated non-whitespace UTF-16 units in the turn anchored by sequence. */
  offset: number;
}

/** An action waiting for input from the user; payload and result belong to the plugin in owner, a set status marks it done. */
export interface PendingAction {
  actionId: string;
  owner: string | null;
  payload: unknown;
  status?: "approved" | "dismissed";
  result?: unknown;
}

export interface Message {
  key: string;
  role: Role;
  /** Sender identity for the display, independent of role and bubble label. */
  sender?: string;
  text: string;
  textCursor?: ChatTextCursor;
  closed?: boolean;
  attachments?: ChatAttachment[];
  tool?: ToolInfo;
  action?: PendingAction;
  /** ISO time of the message, shown with showTimestamps. */
  at?: string;
  /** The actor input behind an incoming message; the steering mark belongs to it. */
  inputId?: string;
  /** The message went into a turn that was already running instead of starting its own. */
  steered?: boolean;
  /** A colored bubble instead of plain text, for example in conversations of several parties. */
  bubble?: { color: string; side: "start" | "end"; label?: string };
}

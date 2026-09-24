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

export interface ChatJournalCursor {
  conversationId: string;
  eventId: string;
  sequence: number;
}

/**
 * Eine Aktion, die auf eine Eingabe des Benutzers wartet. Form und Inhalt von `payload` und
 * `result` gehören dem Plugin in `owner`; `status` gesetzt heißt: erledigt, die Karte ist Beleg.
 */
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
  /** Absenderkennung für die Darstellung; unabhängig von Rolle und Sprechblasenlabel. */
  sender?: string;
  text: string;
  textCursor?: ChatTextCursor;
  closed?: boolean;
  attachments?: ChatAttachment[];
  tool?: ToolInfo;
  action?: PendingAction;
  /** ISO-Zeitpunkt der Nachricht; Anzeige optional (ChatMessages showTimestamps). */
  at?: string;
  /** Farbige Sprechblase statt Fliesstext, z.B. fuer Mehrparteien-Gespraeche. */
  bubble?: { color: string; side: "start" | "end"; label?: string };
}

export interface ChatStartupStatus {
  status: "preparing" | "failed";
  message: string;
}

export type ChatEvent =
  | { kind: "reset"; reason?: "conversation-reset"; conversationId: string | null }
  | { kind: "replay-end"; conversationId: string | null }
  | { kind: "user"; text: string; at?: string; attachments?: ChatAttachment[] }
  | { kind: "text"; delta: string; at?: string; cursor: ChatTextCursor }
  | { kind: "thinking"; delta: string; at?: string }
  | { kind: "tool"; id: string; name: string; arguments: string; label?: string; at?: string }
  | { kind: "tool-result"; id: string; result: string; isError?: boolean }
  | { kind: "action"; actionId: string; owner: string | null; text: string; payload: unknown; at?: string }
  | { kind: "action-resolved"; actionId: string; status: "approved" | "dismissed"; result: unknown }
  | { kind: "system"; text: string; at?: string }
  | { kind: "status"; running: boolean; startup?: ChatStartupStatus }
  | { kind: "turn-done" }
  | { kind: "extension"; pluginId: string; type: string; payload?: unknown; at?: string; journal?: ChatJournalCursor };

function openMessageIndex(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message.closed && (message.role === "assistant" || message.role === "thinking")) return index;
  }
  return -1;
}

function closeOpen(messages: Message[]): Message[] {
  const index = openMessageIndex(messages);
  if (index === -1) {
    return messages;
  }
  return messages.map((message, position) => position === index ? { ...message, closed: true } : message);
}

function appendDelta(messages: Message[], role: Role, delta: string, at?: string, textCursor?: ChatTextCursor): Message[] {
  const index = openMessageIndex(messages);
  const current = messages[index];
  if (current && current.role === role
    && current.textCursor?.conversationId === textCursor?.conversationId
    && current.textCursor?.sequence === textCursor?.sequence) {
    return messages.map((message, position) => position === index
      ? { ...message, text: message.text + delta, ...(textCursor ? { textCursor } : {}) }
      : message);
  }
  return [...closeOpen(messages), { key: crypto.randomUUID(), role, text: delta, at, ...(textCursor ? { textCursor } : {}) }];
}

/** Eingehende Nachrichten lassen den laufenden Ausgabeblock offen. */
export function applyEvent(messages: Message[], event: ChatEvent): Message[] {
  switch (event.kind) {
    case "reset":
      return [];
    case "user":
      return [...messages, { key: crypto.randomUUID(), role: "user", text: event.text, closed: true, at: event.at,
        ...(event.attachments?.length ? { attachments: event.attachments } : {}) }];
    case "text":
      return appendDelta(messages, "assistant", event.delta, event.at, event.cursor);
    case "thinking":
      return appendDelta(messages, "thinking", event.delta, event.at);
    case "tool":
      return [
        ...closeOpen(messages),
        {
          key: crypto.randomUUID(),
          role: "tool",
          text: event.label ?? event.name,
          closed: true,
          tool: { id: event.id, name: event.name, arguments: event.arguments },
          at: event.at,
        },
      ];
    case "tool-result": {
      const index = messages.map((message) => message.tool?.id).lastIndexOf(event.id);
      return messages.map((message, position) =>
        position === index && message.tool
          ? { ...message, tool: { ...message.tool, result: event.result, isError: event.isError } }
          : message,
      );
    }
    case "action":
      return [
        ...closeOpen(messages),
        {
          key: crypto.randomUUID(),
          role: "action",
          text: event.text,
          closed: true,
          action: { actionId: event.actionId, owner: event.owner, payload: event.payload },
          at: event.at,
        },
      ];
    case "action-resolved":
      return messages.map((message) =>
        message.action?.actionId === event.actionId
          ? { ...message, action: { ...message.action, status: event.status, result: event.result } }
          : message,
      );
    case "system":
      return [...closeOpen(messages), { key: crypto.randomUUID(), role: "system", text: event.text, closed: true, at: event.at }];
    case "turn-done":
      return closeOpen(messages);
    default:
      return messages;
  }
}

export function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function compactToolLine(tool: ToolInfo): string {
  const args = tool.arguments.replace(/\s+/g, " ").trim();
  const line = args && args !== "{}" ? `${tool.name} ${args}` : tool.name;
  return line.length > 160 ? `${line.slice(0, 160)} ...` : line;
}

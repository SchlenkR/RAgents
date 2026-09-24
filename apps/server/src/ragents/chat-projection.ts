import type { ChatAttachment, ChatEvent, ChatTextCursor } from "../chat-events.js";
import { PluginStateProjection, type JournalEvent, type Turn } from "@ragents/engine";
import { ChatTextPositions } from "./chat-text-positions.js";
import { actionEventOf, actionResolvedEventOf, journalChatEventsOf, type InterruptedToolCalls } from "./journal-chat-events.js";

const interruptedIn = (scope: ChatProjectionScope): InterruptedToolCalls => (turnId) =>
  scope.turnOf(turnId).toolCalls.filter((call) => call.status === "interrupted").map((call) => call.id);

export interface ChatProjectionScope {
  conversationId: string;
  primaryActorId: string;
  ownerId: string;
  labelOf: (actorId: string) => string | undefined;
  turnOf: (turnId: string) => Pick<Turn, "actorId" | "toolCalls">;
  /** Whether this command also interrupted a turn of the actor; its stop then repeats no reason. */
  interruptedByCommand: (commandId: string, actorId: string) => boolean;
  attachmentOf?: (artifactId: string) => ChatAttachment;
}

export const chatEventsOf = (event: JournalEvent, scope: ChatProjectionScope, cursor: ChatTextCursor | undefined, pluginStates: PluginStateProjection): ChatEvent[] => {
  const at = event.occurredAt;
  const pluginState = pluginStates.observe(event);

  if (event.type === "actor.input.enqueued") {
    if (event.payload.presentation === "background") return [];
    return event.payload.subscriptionId === null && event.actorId === scope.ownerId && event.payload.actorId === scope.primaryActorId
      ? [{ kind: "user", text: event.payload.content, inputId: event.payload.inputId, at,
        ...(scope.attachmentOf && event.payload.artifactIds.length > 0
          ? { attachments: event.payload.artifactIds.map(scope.attachmentOf) } : {}),
      }]
      : [];
  }

  if (event.type === "turn.input-steered")
    return scope.turnOf(event.payload.turnId).actorId === scope.primaryActorId ? [{ kind: "steered", inputId: event.payload.inputId }] : [];

  if (event.type === "action.proposed") {
    const asker = event.actorId === scope.primaryActorId
      ? undefined
      : scope.labelOf(event.actorId);
    return [actionEventOf(event.payload, at, asker)];
  }

  if (event.type === "action.resolved") return [actionResolvedEventOf(event)];

  if (event.type === "actor.stopped")
    return event.payload.actorId === scope.primaryActorId && !scope.interruptedByCommand(event.commandId, event.payload.actorId)
      ? journalChatEventsOf(event, cursor, interruptedIn(scope))
      : [];

  if (event.type === "turn.interrupted")
    return scope.turnOf(event.payload.turnId).actorId === scope.primaryActorId ? journalChatEventsOf(event, cursor, interruptedIn(scope)) : [];

  if (event.actorId !== scope.primaryActorId) return [];

  if (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") return [{
    kind: "plugin", pluginId: event.payload.pluginId, type: "state-replaced",
    payload: { scope: event.payload.scope, state: pluginState }, at,
    journal: { conversationId: scope.conversationId, eventId: event.eventId, sequence: event.sequence },
  }];

  return journalChatEventsOf(event, cursor, interruptedIn(scope));
};

export const chatHistoryOf = (events: readonly JournalEvent[], scope: ChatProjectionScope, positions = new ChatTextPositions(), pluginStates = new PluginStateProjection()): ChatEvent[] =>
  events.flatMap((event) => chatEventsOf(event, scope, positions.observe(event), pluginStates));

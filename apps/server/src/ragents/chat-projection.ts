import type { ChatAttachment, ChatEvent, ChatTextCursor } from "../chat-events.js";
import { PluginStateProjection, type JournalEvent } from "@aicontainer/ragents";
import { ChatTextPositions } from "./chat-text-positions.js";
import { journalChatEventsOf, questionAnswerEventOf, questionEventOf } from "./journal-chat-events.js";

export interface ChatProjectionScope {
  conversationId: string;
  primaryActorId: string;
  ownerId: string;
  labelOf: (actorId: string) => string | undefined;
  actionKindOf: (actionId: string) => "action" | "question" | undefined;
  attachmentOf?: (artifactId: string) => ChatAttachment;
}

export const chatEventsOf = (event: JournalEvent, scope: ChatProjectionScope, cursor: ChatTextCursor | undefined, pluginStates: PluginStateProjection): ChatEvent[] => {
  const at = event.occurredAt;
  const pluginState = pluginStates.observe(event);

  if (event.type === "actor.input.enqueued") {
    if (event.payload.presentation === "background") return [];
    return event.payload.subscriptionId === null && event.actorId === scope.ownerId && event.payload.actorId === scope.primaryActorId
      ? [{ kind: "user", text: event.payload.content, at,
        ...(scope.attachmentOf && event.payload.artifactIds.length > 0
          ? { attachments: event.payload.artifactIds.map(scope.attachmentOf) } : {}),
      }]
      : [];
  }

  if (event.type === "action.proposed" && event.payload.kind === "question") {
    const asker = event.actorId === scope.primaryActorId
      ? undefined
      : scope.labelOf(event.actorId);
    return [questionEventOf(event.payload, at, asker)];
  }

  if (event.type === "action.resolved" && scope.actionKindOf(event.payload.actionId) === "question") {
    return [questionAnswerEventOf(event)];
  }

  if (event.type === "actor.stopped")
    return event.payload.actorId === scope.primaryActorId ? journalChatEventsOf(event, cursor) : [];

  if (event.actorId !== scope.primaryActorId) return [];

  if (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") return [{
    kind: "extension", pluginId: event.payload.pluginId, type: "state-replaced",
    payload: { scope: event.payload.scope, state: pluginState }, at,
    journal: { conversationId: scope.conversationId, eventId: event.eventId, sequence: event.sequence },
  }];

  return journalChatEventsOf(event, cursor);
};

export const chatHistoryOf = (events: readonly JournalEvent[], scope: ChatProjectionScope, positions = new ChatTextPositions(), pluginStates = new PluginStateProjection()): ChatEvent[] =>
  events.flatMap((event) => chatEventsOf(event, scope, positions.observe(event), pluginStates));

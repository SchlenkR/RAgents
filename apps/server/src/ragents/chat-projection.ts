import type { ChatAttachment, ChatEvent, ChatTextCursor } from "quassel/events";
import { PluginStateProjection, type ActorInput, type JournalEvent, type Turn } from "@ragents/engine";
import { ChatTextPositions } from "./chat-text-positions.js";
import { actionEventOf, actionResolvedEventOf, journalChatEventsOf, type InterruptedToolCalls } from "./journal-chat-events.js";

const interruptedIn = (scope: ChatProjectionScope): InterruptedToolCalls => (turnId) =>
  scope.turnOf(turnId).toolCalls.filter((call) => call.status === "interrupted").map((call) => call.id);

export interface ChatProjectionScope {
  conversationId: string;
  primaryActorId: string;
  ownerId: string;
  labelOf: (actorId: string) => string | undefined;
  /** The handle of a TypeScript actor a run script installed; the chat shows its runtime output too. */
  scriptActorHandle?: (actorId: string) => string | undefined;
  turnOf: (turnId: string) => Pick<Turn, "actorId" | "toolCalls">;
  /** The input a turn claimed; the chat names what started a turn of the primary actor that no person asked for. */
  inputOf: (inputId: string) => Pick<ActorInput, "enqueuedBy" | "origin" | "sourceEventIds">;
  /** The type of an earlier event of the run and the actor it concerns, as eventSubjectOf determines it. */
  sourceOf: (eventId: string) => { type: JournalEvent["type"]; subjectId: string };
  handleOf: (actorId: string) => string;
  /** Whether this command also interrupted a turn of the actor; its stop then repeats no reason. */
  interruptedByCommand: (commandId: string, actorId: string) => boolean;
  attachmentOf?: (artifactId: string) => ChatAttachment;
}

const byUser = (userId: string | undefined): string => userId === undefined ? "" : ` by ${userId}`;

/** A person's own message needs no hint; otherwise its source event, the message of another actor, or an automatic input. */
const triggerOf = (inputId: string, scope: ChatProjectionScope): string | undefined => {
  const input = scope.inputOf(inputId);
  if (input.origin === "human") return undefined;
  const [sourceEventId] = input.sourceEventIds;
  if (sourceEventId !== undefined) {
    const source = scope.sourceOf(sourceEventId);
    return `${source.type} of @${scope.handleOf(source.subjectId)}`;
  }
  return input.enqueuedBy === scope.ownerId || input.enqueuedBy === scope.primaryActorId
    ? "an automatic input"
    : `a message from @${scope.handleOf(input.enqueuedBy)}`;
};

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
    const asker = event.actorId === scope.primaryActorId || event.actorId === scope.ownerId
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

  if (event.type === "run.paused") return [{ kind: "system", text: `Run paused${byUser(event.payload.userId)}`, at }];

  if (event.type === "run.resumed") return [{ kind: "system", text: `Run resumed${byUser(event.payload.userId)}`, at }];

  if (event.type === "runtime.output.recorded" && event.actorId !== scope.primaryActorId) {
    const handle = scope.scriptActorHandle?.(event.actorId);
    return handle ? [{ kind: "system", text: `@${handle}: ${event.payload.text}`, at }] : [];
  }

  if (event.actorId !== scope.primaryActorId) return [];

  if (event.type === "turn.started") {
    const trigger = triggerOf(event.payload.inputId, scope);
    return trigger ? [{ kind: "system", text: `New turn, triggered by ${trigger}`, at }] : [];
  }

  if (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") return [{
    kind: "plugin", pluginId: event.payload.pluginId, type: "state-replaced",
    payload: { scope: event.payload.scope, state: pluginState }, at,
    journal: { conversationId: scope.conversationId, eventId: event.eventId, sequence: event.sequence },
  }];

  return journalChatEventsOf(event, cursor, interruptedIn(scope));
};

export const chatHistoryOf = (events: readonly JournalEvent[], scope: ChatProjectionScope, positions = new ChatTextPositions(), pluginStates = new PluginStateProjection()): ChatEvent[] =>
  events.flatMap((event) => chatEventsOf(event, scope, positions.observe(event), pluginStates));

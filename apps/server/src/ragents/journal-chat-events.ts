import type { JournalEvent } from "@ragents/engine";
import type { ChatEvent, ChatTextCursor } from "../chat-events.js";

type ActionPayload = Extract<JournalEvent, { type: "action.proposed" }>["payload"];

export const actionEventOf = (action: ActionPayload, at: string, asker?: string): ChatEvent => ({
  kind: "action",
  actionId: action.actionId,
  owner: action.owner,
  text: asker ? `${asker}: ${action.title}` : action.title,
  payload: action.payload,
  at,
});

export const actionResolvedEventOf = (event: Extract<JournalEvent, { type: "action.resolved" }>): ChatEvent => ({
  kind: "action-resolved",
  actionId: event.payload.actionId,
  status: event.payload.decision,
  result: event.payload.result,
});

/** The calls a turn end left open; the run view keeps them as interrupted. */
export type InterruptedToolCalls = (turnId: string) => readonly string[];

const closedBy = (turnId: string, reason: string, interrupted: InterruptedToolCalls, toolId: (turnId: string, callId: string) => string): ChatEvent[] =>
  interrupted(turnId).map((callId) => ({ kind: "tool-result", id: toolId(turnId, callId), result: reason, isError: true }));

export const journalChatEventsOf = (
  event: JournalEvent,
  cursor: ChatTextCursor | undefined,
  interrupted: InterruptedToolCalls,
  toolId: (turnId: string, callId: string) => string = (_turnId, callId) => callId,
): ChatEvent[] => {
  const at = event.occurredAt;
  switch (event.type) {
    case "model.output.completed":
    case "model.output.interrupted":
      if (!cursor) throw new Error("Die Journalposition des Antworttexts fehlt.");
      return [{ kind: "text", delta: event.payload.text, at, cursor }];
    case "model.reasoning.completed":
      return [{ kind: "thinking", delta: event.payload.text, at }];
    case "runtime.output.recorded":
      return [{ kind: "system", text: event.payload.text, at }];
    case "tool.call.started":
      return [{ kind: "tool", id: toolId(event.payload.turnId, event.payload.toolCallId), name: event.payload.name,
        arguments: JSON.stringify(event.payload.input), at }];
    case "tool.call.completed":
      return [{ kind: "tool-result", id: toolId(event.payload.turnId, event.payload.toolCallId),
        result: typeof event.payload.output === "string" ? event.payload.output : JSON.stringify(event.payload.output ?? {}), isError: false }];
    case "tool.call.failed":
      return [{ kind: "tool-result", id: toolId(event.payload.turnId, event.payload.toolCallId), result: event.payload.error, isError: true }];
    case "turn.finished":
      return [
        ...event.payload.outcome === "failed" ? closedBy(event.payload.turnId, event.payload.reason, interrupted, toolId) : [],
        { kind: "turn-done" },
      ];
    case "turn.interrupted":
      return [
        ...closedBy(event.payload.turnId, event.payload.reason, interrupted, toolId),
        { kind: "system", text: event.payload.reason, at },
        { kind: "turn-done" },
      ];
    case "actor.stopped":
      return [{ kind: "system", text: event.payload.reason, at }];
    default:
      return [];
  }
};

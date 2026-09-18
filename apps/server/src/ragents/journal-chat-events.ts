import type { JournalEvent } from "@aicontainer/ragents";
import type { ChatEvent, ChatTextCursor } from "../chat-events.js";

type QuestionPayload = Extract<Extract<JournalEvent, { type: "action.proposed" }>["payload"], { kind: "question" }>;

export const questionEventOf = (question: QuestionPayload, at: string, asker?: string): ChatEvent => ({
  kind: "question",
  callId: question.actionId,
  text: asker ? `${asker} fragt: ${question.title}` : question.title,
  options: question.question?.options ?? [],
  multi: question.question?.multi === true,
  at,
});

export const questionAnswerEventOf = (event: Extract<JournalEvent, { type: "action.resolved" }>): ChatEvent => ({
  kind: "question-answered",
  callId: event.payload.actionId,
  answer: event.payload.decision === "approved" ? event.payload.response ?? "" : "Der Benutzer hat die Frage verworfen.",
});

export const journalChatEventsOf = (
  event: JournalEvent,
  cursor: ChatTextCursor | undefined,
  toolId: (turnId: string, callId: string) => string = (_turnId, callId) => callId,
): ChatEvent[] => {
  const at = event.occurredAt;
  switch (event.type) {
    case "model.output.completed":
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
      return [{ kind: "turn-done" }];
    case "turn.interrupted":
      return [{ kind: "system", text: event.payload.reason, at }, { kind: "turn-done" }];
    case "actor.stopped":
      return [{ kind: "system", text: event.payload.reason, at }];
    default:
      return [];
  }
};

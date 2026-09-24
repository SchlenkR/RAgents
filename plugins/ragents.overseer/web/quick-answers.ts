import type { ChatEvent } from "@ragents/host/chat-events";
import { OVERSEER_PLUGIN_ID, QUICK_ANSWER_MAX_LENGTH } from "../contract";

export interface QuickAnswerNotice {
  id: string;
  question: string;
  text: string;
}

const validText = (value: unknown): value is string => typeof value === "string" && !!value.trim()
  && value.length <= QUICK_ANSWER_MAX_LENGTH && !/[\r\n]/.test(value);

export function createQuickAnswers() {
  let conversationId: string | null | undefined;
  let initialized = false;
  let replaying = true;
  let seenSequence = 0;
  let replaySequence = 0;
  let pending: QuickAnswerNotice | undefined;
  return {
    event(event: ChatEvent): QuickAnswerNotice | undefined {
      if (event.kind === "reset") {
        if (event.reason === "conversation-reset" || (conversationId != null && conversationId !== event.conversationId)) {
          seenSequence = 0;
          initialized = true;
        }
        conversationId = event.conversationId;
        replaying = true;
        replaySequence = seenSequence;
        pending = undefined;
      }
      if (event.kind === "replay-end") {
        conversationId = event.conversationId;
        replaying = false;
        seenSequence = replaySequence;
        const notice = initialized ? pending : undefined;
        initialized = true;
        pending = undefined;
        return notice;
      }
      if (event.kind !== "extension" || event.pluginId !== OVERSEER_PLUGIN_ID || event.type !== "state-replaced") return;
      const payload = event.payload;
      if (!payload || typeof payload !== "object" || !("state" in payload)) return;
      if (!("scope" in payload) || !payload.scope || typeof payload.scope !== "object"
        || !("kind" in payload.scope) || payload.scope.kind !== "run") return;
      const state = payload.state;
      if (!state || typeof state !== "object" || !("kind" in state) || state.kind !== "quick-answer") return;
      if (!event.journal || !event.journal.eventId?.trim() || !event.journal.conversationId?.trim()
        || !Number.isSafeInteger(event.journal.sequence) || event.journal.sequence <= 0) {
        throw new Error("Die Journalposition der Kurzantwort ist ungültig.");
      }
      if (conversationId != null && conversationId !== event.journal.conversationId) return;
      conversationId = event.journal.conversationId;
      if (event.journal.sequence <= (replaying ? replaySequence : seenSequence)) return;
      if (replaying && !initialized) { replaySequence = event.journal.sequence; return; }
      const question = "question" in state ? state.question : undefined;
      const text = "text" in state ? state.text : undefined;
      if (!validText(question) || !validText(text)) throw new Error("Die Kurzfrage oder Kurzantwort ist ungültig.");
      const notice = { id: event.journal.eventId, question, text };
      if (replaying) { replaySequence = event.journal.sequence; pending = notice; }
      else { seenSequence = event.journal.sequence; return notice; }
    },
  };
}

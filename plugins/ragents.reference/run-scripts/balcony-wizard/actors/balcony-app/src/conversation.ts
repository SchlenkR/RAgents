import type { ChatSnapshot } from "@ragents/client/ui";

export const advisor = "@balcony-advisor";
export const startMarker = "START_BALCONY_INTERVIEW";
export const retryMarker = "RETRY_BALCONY_RESPONSE";
export const answerCount = 5;

export interface Conversation {
  phase: "loading" | "start" | "waiting" | "question" | "evaluating" | "complete" | "error";
  answers: number;
  latestInputKey: string | undefined;
  text: string;
  error: string | undefined;
  canRetry: boolean;
}

export function deriveConversation(snapshot: ChatSnapshot | undefined): Conversation {
  const state: Conversation = { phase: "loading", answers: 0, latestInputKey: undefined, text: "", error: undefined, canRetry: false };
  if (!snapshot) return state;
  let started = false;
  let response: { text: string; closed: boolean } | undefined;
  let problem: string | undefined;
  for (const message of snapshot.messages) {
    if (message.role === "user") {
      state.latestInputKey = message.key;
      response = undefined;
      problem = undefined;
      if (message.text.trim() === startMarker) started = true;
      const match = /^ANSWER ([1-5])\/5\r?\n([\s\S]+)$/.exec(message.text);
      if (match && Number(match[1]) === state.answers + 1 && match[2]?.trim()) {
        state.answers++;
        started = true;
      }
    } else if (started && message.role === "assistant" && message.text.trim()) {
      response = { text: message.text, closed: message.closed === true };
      problem = undefined;
    } else if (started && message.role === "system" && message.text.trim()) {
      problem = message.text;
    }
  }
  state.error = snapshot.error || (!snapshot.running ? problem : undefined);
  if (state.error) {
    state.phase = "error";
    state.canRetry = started && !snapshot.running && !snapshot.readOnly;
  } else if (!started) state.phase = "start";
  else if (snapshot.running || !response?.closed) state.phase = state.answers === answerCount ? "evaluating" : "waiting";
  else {
    state.phase = state.answers === answerCount ? "complete" : "question";
    state.text = response.text;
  }
  return state;
}

export function answerInput(answers: number, text: string): string {
  if (!Number.isInteger(answers) || answers < 0 || answers >= answerCount) throw new Error("Das Interview nimmt genau fünf Antworten an.");
  if (!text.trim()) throw new Error("Bitte eine Antwort eingeben.");
  return `ANSWER ${answers + 1}/5\n${text.trim()}`;
}

export function createSender(deliver: (text: string) => Promise<void>) {
  let sending = false;
  let awaiting: { key: string | undefined; finalAnswer: boolean } | undefined;
  return {
    get pending() { return sending || awaiting !== undefined; },
    get finalAnswer() { return awaiting?.finalAnswer === true; },
    observe(snapshot: ChatSnapshot | undefined) {
      if (awaiting && (deriveConversation(snapshot).latestInputKey !== awaiting.key || snapshot?.error)) awaiting = undefined;
    },
    async send(snapshot: ChatSnapshot | undefined, text: string): Promise<boolean> {
      if (!snapshot || sending || awaiting || snapshot.running || snapshot.readOnly) return false;
      sending = true;
      awaiting = { key: deriveConversation(snapshot).latestInputKey, finalAnswer: text.startsWith("ANSWER 5/5\n") };
      try {
        await deliver(text);
        return true;
      } catch (error) {
        awaiting = undefined;
        throw error;
      } finally { sending = false; }
    },
  };
}

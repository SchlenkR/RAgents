import { serviceToken, type ServiceToken } from "@ragents/engine";
import type { AskQuestion, QuestionAnswer } from "../ask-payload.js";

export type { AskOption, AskQuestion, QuestionAnswer } from "../ask-payload.js";

export interface AskCall {
  runId: string;
  /** Who asks: an agent, or the run owner on behalf of the system. */
  agentId: string;
  turnId: string | null;
  commandId: string;
}

export interface AskRequest {
  questions: readonly AskQuestion[];
  description?: string;
  parameters?: Record<string, string>;
  /** The actor that receives an answer nobody waits for anymore; if omitted, the asker. */
  recipient?: string;
}

/** How a waiting `ask` ends: one answer per question, or closed without answers (dismissed or withdrawn). */
export type AskOutcome =
  | { readonly kind: "answered"; readonly answers: readonly QuestionAnswer[] }
  | { readonly kind: "dismissed" };

const answerTextOf = (answer: QuestionAnswer): string =>
  "text" in answer ? `free answer ${JSON.stringify(answer.text)}` : answer.selected.map((label) => JSON.stringify(label)).join(", ");

/** The input that brings the outcome to an actor: one line per question with the chosen labels or the free answer. */
export const answerMessageOf = (questions: readonly AskQuestion[], outcome: AskOutcome, whose: "your" | "the"): string => {
  const noun = questions.length === 1 ? "question" : "questions";
  return outcome.kind === "answered"
    ? [`The user answered ${whose} ${noun}:`,
      ...questions.map((question, index) => `${JSON.stringify(question.question)} = ${answerTextOf(outcome.answers[index]!)}`)].join("\n")
    : [`The user dismissed ${whose} ${noun} without an answer:`, ...questions.map((question) => JSON.stringify(question.question))].join("\n");
};

export interface AskService {
  /** Shows the questions without waiting and returns the action id; undefined if a message of the user already waits for the asker. */
  pose: (call: AskCall, request: AskRequest) => string | undefined;
  /** Waits for the answers; only outside a turn, for questions on behalf of the system. */
  ask: (call: AskCall & { turnId: null }, request: AskRequest, signal: AbortSignal | undefined) => Promise<AskOutcome>;
  /** Withdraws open questions: their record says so, a waiting call gets the dismissed outcome, nobody gets an input. */
  withdraw: (runId: string, actionId: string) => void;
}

export const askServiceToken: ServiceToken<AskService> = serviceToken("ragents.ask.service");

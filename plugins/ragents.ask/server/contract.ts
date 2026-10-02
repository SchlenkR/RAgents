import { serviceToken, type ServiceToken } from "@ragents/engine";

/** The answer `ask` returns when the user dismisses the question. */
export const DISMISSED_ANSWER = "The user dismissed the question.";

export interface AskCall {
  runId: string;
  /** Who asks: an agent, or the run owner on behalf of the system. */
  agentId: string;
  turnId: string | null;
  commandId: string;
}

export interface AskRequest {
  question: string;
  options: string[];
  multi?: boolean;
  description?: string;
  parameters?: Record<string, string>;
  /** The actor that receives an answer nobody waits for anymore; if omitted, the asker. */
  recipient?: string;
}

export interface AskService {
  /** Shows the question without waiting and returns its id; undefined if a message of the user already waits for the asker. */
  pose: (call: AskCall, request: AskRequest) => string | undefined;
  /** Waits for the answer; only outside a turn, for questions on behalf of the system. */
  ask: (call: AskCall & { turnId: null }, request: AskRequest, signal: AbortSignal | undefined) => Promise<string>;
  /** Dismisses an open question: a waiting call gets DISMISSED_ANSWER, nobody gets an input. */
  withdraw: (runId: string, actionId: string) => void;
}

export const askServiceToken: ServiceToken<AskService> = serviceToken("ragents.ask.service");

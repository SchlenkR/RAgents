import { serviceToken, type ServiceToken } from "@ragents/engine";

/** The answer `ask` returns when the user dismisses the question. */
export const DISMISSED_ANSWER = "The user dismissed the question.";

export interface AskCall {
  runId: string;
  /** Who asks: an agent in its running turn, without a turn the run owner. */
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
  ask: (call: AskCall, request: AskRequest, signal: AbortSignal | undefined) => Promise<string>;
  /** Dismisses an open question: a waiting call gets DISMISSED_ANSWER, nobody gets an input. */
  withdraw: (runId: string, actionId: string) => void;
}

export const askServiceToken: ServiceToken<AskService> = serviceToken("ragents.ask.service");

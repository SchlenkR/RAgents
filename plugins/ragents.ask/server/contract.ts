import { serviceToken, type ServiceToken } from "@ragents/engine";

/** Die Antwort, die `ask` liefert, wenn der Benutzer die Frage verwirft. */
export const DISMISSED_ANSWER = "Der Benutzer hat die Frage verworfen.";

export interface AskCall {
  runId: string;
  /** Wer fragt: ein Agent in seinem laufenden Turn, ohne Turn der Eigentümer des Runs. */
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
  /** Der Actor, dem eine Antwort zugeht, auf die niemand mehr wartet; ohne Angabe der Fragende. */
  recipient?: string;
}

export interface AskService {
  ask: (call: AskCall, request: AskRequest, signal: AbortSignal | undefined) => Promise<string>;
  /** Verwirft eine offene Frage: ein wartender Aufruf bekommt DISMISSED_ANSWER, niemand bekommt einen Input. */
  withdraw: (runId: string, actionId: string) => void;
}

export const askServiceToken: ServiceToken<AskService> = serviceToken("ragents.ask.service");

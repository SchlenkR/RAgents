import { serviceToken, type ServiceToken } from "@ragents/engine";

export interface AskCall {
  runId: string;
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
}

export interface AskService {
  ask: (call: AskCall, request: AskRequest, signal: AbortSignal | undefined) => Promise<string>;
}

export const askServiceToken: ServiceToken<AskService> = serviceToken("ragents.ask.service");

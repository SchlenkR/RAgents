export const WATCH_PLUGIN_ID = "ragents.watch";

export type WatchDefinition = {
  id: string;
  sourceActorId: string;
  sourceHandle: string;
  targetActorId: string;
  targetHandle: string;
  condition: string;
  observe?: string;
  instruction?: string;
  stallAfterSeconds?: number;
  createdBy: string;
};

export type WatchVerdict = {
  at: string;
  wake: boolean;
  reason: string;
  changes: string[];
};

export type WatchSummary = {
  id: string;
  source: string;
  target: string;
  condition: string;
  observe?: string;
  stallAfterSeconds?: number;
  wakes: number;
  lastEvaluatedAt?: string;
  lastVerdict?: WatchVerdict;
};

export type WatchRequest = {
  source: string;
  condition: string;
  target?: string;
  observe?: string;
  instruction?: string;
  stallAfterSeconds?: number;
};

export interface WatchServiceApi {
  create(runId: string, callerActorId: string, request: WatchRequest): Promise<WatchSummary>;
  list(runId: string): WatchSummary[];
  remove(runId: string, watchId: string, reason: string): void;
}

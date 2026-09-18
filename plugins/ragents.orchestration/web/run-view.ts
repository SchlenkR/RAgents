export interface RunCapabilityGrant {
  capability: string;
  scope: { kind: "run" } | { kind: "workspace"; path: string };
  delegable: boolean;
  usable?: boolean;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface RunExecution {
  driver: {
    kind: string;
    config: {
      provider?: string | null;
      model?: string | null;
      thinking?: string | null;
    };
  };
  workspacePath: string | null;
  turnTimeoutMs: number | null;
}

export interface RunActor {
  id: string;
  kind: "human" | "agent" | "script";
  handle: string;
  displayName: string;
  grants: RunCapabilityGrant[];
  createdAt: string;
  createdBy?: string;
  prompt?: string;
  source?: string;
  sourceHash?: string;
  platformVersion?: 2;
  compilationHash?: string;
  capabilityIds?: string[];
  capabilityContractHash?: string;
  inputs?: Record<string, string>;
  execution?: RunExecution;
  lifecycle?:
    | { kind: "idle"; since: string }
    | { kind: "running"; turnId: string; inputId: string; startedAt: string }
    | { kind: "stopped"; stoppedAt: string; reason: string };
  usage?: RunUsage;
  toolNames?: string[] | null;
}

export type RunActorInputLifecycle =
  | { kind: "pending" }
  | { kind: "claimed"; turnId: string }
  | { kind: "discarded"; at: string; reason: string };

export interface RunActorInput {
  presentation?: "background";
  id: string;
  actorId: string;
  content: string;
  artifactIds: string[];
  sourceEventIds: string[];
  subscriptionId: string | null;
  enqueuedBy: string;
  enqueuedAt: string;
  sequence: number;
  lifecycle: RunActorInputLifecycle;
}

export const isPendingRunActorInput = (input: RunActorInput) =>
  input.lifecycle.kind === "pending";

export interface RunTurnOutput {
  text: string;
  sequence: number;
  occurredAt: string;
}

export interface RunTurn {
  id: string;
  actorId: string;
  inputId: string;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt: string;
  finishedAt: string | null;
  reason: string | null;
  usage: RunUsage;
  outputs?: RunTurnOutput[];
  toolCalls?: readonly { id: string; name: string; status: "running" | "completed" | "failed" | "interrupted"; startedAt: string; finishedAt: string | null }[];
}

const isRunTurnOutput = (value: unknown): value is RunTurnOutput => {
  if (typeof value !== "object" || value === null) return false;
  const output = value as RunTurnOutput;
  return typeof output.text === "string"
    && typeof output.sequence === "number"
    && typeof output.occurredAt === "string";
};

/** Die Modellantworten eines Turns in Journal-Reihenfolge; eine Ansicht ohne das Feld liefert nichts. */
export const runTurnOutputs = (turn: RunTurn): RunTurnOutput[] =>
  (Array.isArray(turn.outputs) ? turn.outputs.filter(isRunTurnOutput) : [])
    .sort((left, right) => left.sequence - right.sequence);

export type RunSubscription = {
  id: string;
  subscriberId: string;
  sourceActorIds: string[] | null;
  sourceActorKinds: Array<RunActor["kind"]> | null;
  eventTypes: string[];
  includeSelf: boolean;
  createdBy: string;
  createdAt: string;
  createdSequence: number;
} & (
  | { status: "active" }
  | { status: "removed"; endedAt: string; reason: string }
  | { status: "failed"; endedAt: string; reason: string; sourceEventId: string }
);

export interface RunPluginState {
  pluginId: string;
  scope: { kind: "run" } | { kind: "actor"; actorId: string };
  state: unknown;
  updatedAt: string;
}

export interface RunAction {
  id: string;
  askedBy: string;
  kind: "action" | "question";
  question: { options: string[]; multi: boolean } | null;
  title: string;
  description: string | null;
  parameters: Record<string, string>;
  input: { label: string; placeholder: string | null; required: boolean } | null;
  status: "pending" | "approved" | "dismissed";
  proposedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  response: string | null;
}

export interface RunArtifact {
  id: string;
  title: string;
  mediaType: string;
  hash: string;
  size: number;
  previousVersionId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface RunView {
  id: string;
  revision: number;
  title: string;
  ownerId: string;
  primaryActorId: string | null;
  createdAt: string;
  forkedFrom: { runId: string; sequence: number } | null;
  actors: RunActor[];
  inputs: RunActorInput[];
  turns: RunTurn[];
  subscriptions: RunSubscription[];
  pluginStates: RunPluginState[];
  actions: RunAction[];
  artifacts: RunArtifact[];
}

export type ActorSurface = "agent" | "primary" | "script";

export const actorSurface = (view: RunView, actor: RunActor): ActorSurface =>
  actor.kind === "script" ? "script" : actor.id === view.primaryActorId ? "primary" : "agent";

export const runViewFrom = (value: unknown): RunView | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const view = value as RunView;
  return typeof view.id === "string"
    && typeof view.ownerId === "string"
    && (typeof view.primaryActorId === "string" || view.primaryActorId === null)
    && Array.isArray(view.actors)
    && Array.isArray(view.inputs)
    && Array.isArray(view.turns)
    && Array.isArray(view.subscriptions)
    && Array.isArray(view.pluginStates)
    && Array.isArray(view.actions)
    && Array.isArray(view.artifacts)
    ? view
    : undefined;
};

export const runRoute = (runId: string, path: string) =>
  `/ragents/api/runs/${encodeURIComponent(runId)}${path}`;

export const runArtifactContentUrl = (runId: string, artifactId: string) =>
  runRoute(runId, `/artifacts/${encodeURIComponent(artifactId)}/content`);

import type { AgentExecution } from "./driver.ts";
import type { JournalEvent } from "./events.ts";
import type { JsonObject, JsonValue } from "./json.ts";
import type { CapabilityName, ObservableEventType } from "./vocabulary.ts";

export type { CapabilityName, ObservableEventType };
export type { AgentDriverKind, AgentDriverRef, AgentExecution, ModelSelection } from "./driver.ts";

export type ActorId = string;
export type InputId = string;
export type SubscriptionId = string;
export type RunId = string;
export type TurnId = string;
export type ArtifactId = string;
export type ActionId = string;

export type CapabilityScope =
    | { kind: "run" }
    | { kind: "workspace"; path: string };

export type CapabilityGrant = {
    capability: CapabilityName;
    scope: CapabilityScope;
    delegable: boolean;
    usable?: boolean;
};

export type ActorKind = "human" | "agent" | "script";

type ActorBase = {
    id: ActorId;
    handle: string;
    displayName: string;
    grants: readonly CapabilityGrant[];
    createdAt: string;
};

export type HumanActor = ActorBase & {
    kind: "human";
};

export type ActorLifecycle =
    | { kind: "idle"; since: string }
    | { kind: "running"; turnId: TurnId; inputId: InputId; startedAt: string }
    | { kind: "stopped"; stoppedAt: string; reason: string };

export type TurnUsage = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
};

type ExecutableActorBase = ActorBase & {
    createdBy: ActorId;
    execution: AgentExecution;
    lifecycle: ActorLifecycle;
    usage: TurnUsage;
    toolNames: readonly string[] | null;
    openedToolNames: readonly string[];
};

export type AgentActor = ExecutableActorBase & {
    kind: "agent";
    prompt: string;
    forkOf: ActorId | null;
};

export const actorStatePluginId = "ragents.actor-state";

export type ScriptActor = ExecutableActorBase & { kind: "script" };

export type ExecutableActor = AgentActor | ScriptActor;
export type Actor = HumanActor | ExecutableActor;

/** `steered` marks an input that joined its already running turn instead of starting it. */
export type ActorInputLifecycle =
    | { kind: "pending" }
    | { kind: "claimed"; turnId: TurnId; steered: boolean }
    | { kind: "discarded"; at: string; reason: string };

export type ActorInput = {
    id: InputId;
    actorId: ActorId;
    content: string;
    presentation?: "background";
    artifactIds: readonly ArtifactId[];
    enqueuedBy: ActorId;
    enqueuedAt: string;
    sequence: number;
    lifecycle: ActorInputLifecycle;
} & (
    | { subscriptionId: null; sourceEventIds: readonly string[] }
    | { subscriptionId: SubscriptionId; sourceEventIds: readonly [string, ...string[]] }
);

export const isPendingActorInput = (input: ActorInput) => input.lifecycle.kind === "pending";

export type TurnStatus = "running" | "completed" | "failed" | "interrupted";

/** Der volle Text eines model.output.completed; nie gekürzt, `sequence` ist die Journal-Reihenfolge. */
export type TurnOutput = {
    text: string;
    sequence: number;
    occurredAt: string;
};

export type TurnToolCall = {
    id: string;
    name: string;
    status: "running" | "completed" | "failed" | "interrupted";
    startedAt: string;
    finishedAt: string | null;
};

export type Turn = {
    id: TurnId;
    actorId: ActorId;
    inputId: InputId;
    status: TurnStatus;
    startedAt: string;
    finishedAt: string | null;
    reason: string | null;
    usage: TurnUsage;
    outputs: readonly TurnOutput[];
    toolCalls: readonly TurnToolCall[];
};

export type EventSubscription = {
    id: SubscriptionId;
    subscriberId: ActorId;
    sourceActorIds: readonly ActorId[] | null;
    sourceActorKinds: readonly ActorKind[] | null;
    eventTypes: readonly ObservableEventType[];
    includeSelf: boolean;
    createdBy: ActorId;
    createdAt: string;
    createdSequence: number;
} & (
    | { status: "active" }
    | { status: "removed"; endedAt: string; reason: string }
    | { status: "failed"; endedAt: string; reason: string; sourceEventId: string }
);

export type PluginStateScope =
    | { kind: "run" }
    | { kind: "actor"; actorId: ActorId };

export type PluginState = {
    pluginId: string;
    scope: PluginStateScope;
    state: JsonValue;
    updatedAt: string;
};

export const pluginStateKey = (pluginId: string, scope: PluginStateScope): string =>
    `${pluginId}\0${scope.kind}\0${scope.kind === "actor" ? scope.actorId : ""}`;

export type ActionInput = {
    label: string;
    placeholder: string | null;
    required: boolean;
};

export type ActionStatus = "pending" | "approved" | "dismissed";

export type Action = {
    id: ActionId;
    askedBy: ActorId;
    owner: string | null;
    title: string;
    description: string | null;
    parameters: Readonly<Record<string, string>>;
    input: ActionInput | null;
    payload: JsonObject | null;
    status: ActionStatus;
    proposedAt: string;
    resolvedAt: string | null;
    resolvedBy: ActorId | null;
    result: JsonValue | null;
};

export type Artifact = {
    id: ArtifactId;
    title: string;
    mediaType: string;
    hash: string;
    size: number;
    previousVersionId: ArtifactId | null;
    createdBy: ActorId;
    createdAt: string;
};

export type RunState = {
    id: RunId;
    revision: number;
    title: string;
    ownerId: ActorId;
    /** Der angemeldete Benutzer, dem der Run gehört; null für Runs, die ohne Anmeldung entstanden sind. */
    ownerUserId: string | null;
    primaryActorId: ActorId | null;
    /** Der Primary-Actor, der als solcher gestoppt wurde, bis ein Primary-Actor gewählt wird; sein Neustart durch den Owner macht ihn wieder dazu. */
    stoppedPrimaryActorId: ActorId | null;
    createdAt: string;
    forkedFrom: { runId: RunId; sequence: number } | null;
    actors: ReadonlyMap<ActorId, Actor>;
    inputs: ReadonlyMap<InputId, ActorInput>;
    turns: ReadonlyMap<TurnId, Turn>;
    subscriptions: ReadonlyMap<SubscriptionId, EventSubscription>;
    pluginStates: ReadonlyMap<string, PluginState>;
    actions: ReadonlyMap<ActionId, Action>;
    artifacts: ReadonlyMap<ArtifactId, Artifact>;
};

/** Der Actor, den ein Event betrifft: bei Turn-Enden der Besitzer des Turns, bei Stopp und Neustart der Ziel-Actor, sonst der Schreiber. */
export const eventSubjectOf = (state: RunState, event: JournalEvent): ActorId => {
    switch (event.type) {
        case "turn.finished":
        case "turn.interrupted": {
            const turn = state.turns.get(event.payload.turnId);

            if (!turn)
                throw new Error(`Turn ${event.payload.turnId} of event ${event.eventId} does not exist.`);

            return turn.actorId;
        }

        case "actor.stopped":
        case "actor.restarted":
            return event.payload.actorId;

        default:
            return event.actorId;
    }
};

type Collections = "actors" | "inputs" | "turns" | "subscriptions" | "pluginStates" | "actions" | "artifacts";

/** Die Run-Ansicht für Clients; der Eigentümer bleibt serverseitig und steht nicht in ihr. */
export type RunView = Omit<RunState, Collections | "ownerUserId"> & {
    actors: Actor[];
    inputs: ActorInput[];
    turns: Turn[];
    subscriptions: EventSubscription[];
    pluginStates: PluginState[];
    actions: Action[];
    artifacts: Artifact[];
};

export const emptyUsage = (): TurnUsage => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
});

const checkedTokenTotal = (name: keyof Omit<TurnUsage, "costUsd">, left: number, right: number) => {
    const total = left + right;
    const valid = (value: number) => Number.isSafeInteger(value) && value >= 0;

    if (!valid(left) || !valid(right) || !valid(total))
        throw new Error(`Cumulative turn usage ${name} must be a non-negative safe integer.`);

    return total;
};

const checkedCostTotal = (left: number, right: number) => {
    const total = left + right;
    const valid = (value: number) => Number.isFinite(value) && value >= 0 && !Object.is(value, -0);

    if (!valid(left) || !valid(right) || !valid(total))
        throw new Error("Cumulative turn usage costUsd must be a finite non-negative number.");

    return total;
};

export const addUsage = (left: TurnUsage, right: TurnUsage): TurnUsage => ({
    inputTokens: checkedTokenTotal("inputTokens", left.inputTokens, right.inputTokens),
    outputTokens: checkedTokenTotal("outputTokens", left.outputTokens, right.outputTokens),
    cacheReadTokens: checkedTokenTotal("cacheReadTokens", left.cacheReadTokens, right.cacheReadTokens),
    cacheWriteTokens: checkedTokenTotal("cacheWriteTokens", left.cacheWriteTokens, right.cacheWriteTokens),
    costUsd: checkedCostTotal(left.costUsd, right.costUsd),
});

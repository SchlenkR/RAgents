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
    /** The room the actor belongs to; null is the main room, where the owner and every actor of an older journal stand. */
    room: string | null;
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

/** Longest short description an actor may carry for overviews. */
export const actorDescriptionMaxLength = 160;

type ExecutableActorBase = ActorBase & {
    createdBy: ActorId;
    description: string | null;
    execution: AgentExecution;
    lifecycle: ActorLifecycle;
    usage: TurnUsage;
    toolNames: readonly string[] | null;
    openedToolNames: readonly string[];
    /** Held since a pause: no turn starts until the run resumes as its primary actor or someone addresses it directly. */
    held?: true;
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
    /** Set only on a person's own message, because system inputs are enqueued under the owner too. */
    origin?: "human";
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

/** The full text of a model.output.completed; never truncated, `sequence` is the journal order. */
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
    owner: string;
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

/** What a share permits: reading sees the run, writing also operates it as far as the user's own rights go. */
export type RunShareAccess = "read" | "write";

/** Whom a run is shared with besides its owner: every user of the profile and individual users, each with its own access. */
export type RunSharing = {
    everyone: RunShareAccess | null;
    users: { userId: string; access: RunShareAccess }[];
};

export const notShared = (): RunSharing => ({ everyone: null, users: [] });

export const isShared = (sharing: RunSharing): boolean => sharing.everyone !== null || sharing.users.length > 0;

/** The access a user gets through the run's sharing: the higher of everyone's and their own. */
export const sharedAccessOf = (sharing: RunSharing, userId: string): RunShareAccess | undefined => {
    const levels = [sharing.everyone, sharing.users.find((user) => user.userId === userId)?.access];

    return levels.includes("write") ? "write" : levels.includes("read") ? "read" : undefined;
};

/** Order of the users does not matter; both sides must not name a user twice. */
export const sameSharing = (left: RunSharing, right: RunSharing): boolean =>
    left.everyone === right.everyone
    && left.users.length === right.users.length
    && left.users.every((user) => right.users.some((other) => other.userId === user.userId && other.access === user.access));

/** A delimited part of the run with its own actors; origin is the room it was opened from, null for the main room. */
export type Room = {
    name: string;
    origin: string | null;
    openedBy: ActorId;
    openedAt: string;
};

/** Who paused the run, when and why; userId is the signed-in user, null without sign-in. */
export type RunPause = {
    pausedAt: string;
    reason: string;
    userId: string | null;
};

export type RunState = {
    id: RunId;
    revision: number;
    title: string;
    ownerId: ActorId;
    /** The signed-in user who owns the run; null for runs created without sign-in. */
    ownerUserId: string | null;
    /** Whom the run is shared with besides its owner; nobody until a run.sharing-changed. */
    sharing: RunSharing;
    primaryActorId: ActorId | null;
    /** The primary actor that was stopped as such, until a primary actor is chosen; its restart by the owner makes it primary again. */
    stoppedPrimaryActorId: ActorId | null;
    /** Set from run.paused to run.resumed; while it is set, no turn starts. */
    pause: RunPause | null;
    createdAt: string;
    forkedFrom: { runId: RunId; sequence: number } | null;
    /** The rooms opened besides the main room, by name. */
    rooms: ReadonlyMap<string, Room>;
    actors: ReadonlyMap<ActorId, Actor>;
    inputs: ReadonlyMap<InputId, ActorInput>;
    turns: ReadonlyMap<TurnId, Turn>;
    subscriptions: ReadonlyMap<SubscriptionId, EventSubscription>;
    pluginStates: ReadonlyMap<string, PluginState>;
    actions: ReadonlyMap<ActionId, Action>;
    artifacts: ReadonlyMap<ArtifactId, Artifact>;
    /** Turns that presented input to the model, with their actor; only they leave model context behind. */
    contextTurns: ReadonlyMap<TurnId, ActorId>;
};

/** The actor an event concerns: for turn ends the owner of the turn, for stop and restart the target actor, otherwise the writer. */
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

type Collections = "rooms" | "actors" | "inputs" | "turns" | "subscriptions" | "pluginStates" | "actions" | "artifacts";

/** The run view for clients; owner, sharing and context turns stay on the server and are not part of it. */
export type RunView = Omit<RunState, Collections | "ownerUserId" | "sharing" | "contextTurns"> & {
    rooms: Room[];
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

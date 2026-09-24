import type { Draft } from "./draft.ts";
import {
    assertEventSemantics,
    eventSemanticContext,
    recordEventSemantics,
    type EventSemanticContext,
} from "./event-semantics.ts";
import type { JournalEvent } from "./events.ts";
import { applyJsonChanges } from "./json-patch.ts";
import { addUsage, emptyUsage, pluginStateKey } from "./model.ts";
import type { Action, Actor, ActorInput, EventSubscription, ExecutableActor, RunState, RunView, Turn } from "./model.ts";

export type RunDraft = Draft<RunState>;

// Existing entries are mutated only through get; iteration remains read-only.
class ProjectionMap<Key, Value> extends Map<Key, Value> {
    readonly #copied = new Set<Key>();
    readonly #copy: (value: Value) => Value;

    constructor(source: ReadonlyMap<Key, Value>, copy: (value: Value) => Value) {
        super();
        this.#copy = copy;
        for (const [key, value] of source) super.set(key, value);
    }

    override get(key: Key): Value | undefined {
        const value = super.get(key);
        if (value === undefined || this.#copied.has(key)) return value;
        const copy = this.#copy(value);
        this.set(key, copy);
        return copy;
    }

    override set(key: Key, value: Value): this {
        this.#copied.add(key);
        return super.set(key, value);
    }
}

export const forkProjection = (state: RunDraft): RunDraft => ({
    ...state,
    actors: new ProjectionMap(state.actors, (value) => ({ ...value })),
    inputs: new ProjectionMap(state.inputs, (value) => ({ ...value })),
    turns: new ProjectionMap(state.turns, (value) => ({
        ...value,
        outputs: [...value.outputs],
        toolCalls: value.toolCalls.map((call) => ({ ...call })),
    })),
    actions: new ProjectionMap(state.actions, (value) => ({ ...value })),
    subscriptions: new Map(state.subscriptions),
    pluginStates: new Map(state.pluginStates),
    artifacts: new Map(state.artifacts),
});

const actor = (state: RunDraft, id: string) => {
    const found = state.actors.get(id);

    if (!found)
        throw new Error(`Actor ${id} does not exist.`);

    return found;
};

const executable = (state: RunDraft, id: string): Draft<ExecutableActor> => {
    const found = actor(state, id);

    if (found.kind === "human")
        throw new Error(`Actor ${id} is a human and takes no turns.`);

    return found;
};

const turn = (state: RunDraft, id: string): Draft<Turn> => {
    const found = state.turns.get(id);

    if (!found)
        throw new Error(`Turn ${id} does not exist.`);

    return found;
};

/** A turn end closes the calls still open: they are interrupted, whatever ended the turn. */
const interruptOpenToolCalls = (current: Draft<Turn>, at: string) => {
    for (const call of current.toolCalls) {
        if (call.status !== "running") continue;
        call.status = "interrupted";
        call.finishedAt = at;
    }
};

const subscriptionBaseOf = (subscription: Draft<EventSubscription>) => ({
    id: subscription.id,
    subscriberId: subscription.subscriberId,
    sourceActorIds: subscription.sourceActorIds,
    sourceActorKinds: subscription.sourceActorKinds,
    eventTypes: subscription.eventTypes,
    includeSelf: subscription.includeSelf,
    createdBy: subscription.createdBy,
    createdAt: subscription.createdAt,
    createdSequence: subscription.createdSequence,
});

const created = (event: Extract<JournalEvent, { type: "run.created" }>): RunDraft => ({
    id: event.runId,
    revision: event.sequence,
    title: event.payload.title,
    ownerId: event.payload.owner.id,
    ownerUserId: event.payload.owner.userId ?? null,
    primaryActorId: null,
    stoppedPrimaryActorId: null,
    createdAt: event.occurredAt,
    forkedFrom: null,
    actors: new Map([
        [
            event.payload.owner.id,
            {
                kind: "human" as const,
                id: event.payload.owner.id,
                handle: event.payload.owner.handle,
                displayName: event.payload.owner.displayName,
                grants: event.payload.owner.grants,
                createdAt: event.occurredAt,
            },
        ],
    ]),
    inputs: new Map(),
    turns: new Map(),
    subscriptions: new Map(),
    pluginStates: new Map(),
    actions: new Map(),
    artifacts: new Map(),
});

export function applyEvent(
    state: RunDraft | null,
    event: JournalEvent,
    context: EventSemanticContext,
): RunDraft {
    assertEventSemantics(state, event, context);

    if (event.type === "run.created") {
        if (state)
            throw new Error(`Run ${event.runId} was created twice.`);

        const result = created(event);
        recordEventSemantics(event, context);

        return result;
    }

    if (!state)
        throw new Error(`Run ${event.runId} has no creation event.`);

    switch (event.type) {
        case "run.forked":
            state.forkedFrom = {
                runId: event.payload.sourceRunId,
                sequence: event.payload.sourceSequence,
            };
            break;

        case "run.primary-actor-selected":
            executable(state, event.payload.actorId);
            state.primaryActorId = event.payload.actorId;
            state.stoppedPrimaryActorId = null;
            break;

        case "run.title-changed":
            state.title = event.payload.title;
            break;

        case "agent.spawned":
            state.actors.set(event.payload.agentId, {
                kind: "agent",
                id: event.payload.agentId,
                handle: event.payload.handle,
                displayName: event.payload.displayName,
                createdBy: event.actorId,
                prompt: event.payload.prompt,
                forkOf: event.payload.forkOf ?? null,
                execution: event.payload.execution,
                grants: event.payload.grants,
                toolNames: event.payload.toolNames,
                createdAt: event.occurredAt,
                lifecycle: { kind: "idle", since: event.occurredAt },
                usage: emptyUsage(),
                openedToolNames: [],
            });
            break;

        case "script.created":
            state.actors.set(event.payload.scriptId, {
                kind: "script",
                id: event.payload.scriptId,
                handle: event.payload.handle,
                displayName: event.payload.displayName,
                createdBy: event.actorId,
                execution: event.payload.execution,
                grants: event.payload.grants,
                toolNames: event.payload.toolNames,
                createdAt: event.occurredAt,
                lifecycle: { kind: "idle", since: event.occurredAt },
                usage: emptyUsage(),
                openedToolNames: [],
            });
            break;

        case "actor.input.enqueued": {
            const source = event.payload.subscriptionId === null
                ? null
                : context.events.get(event.payload.sourceEventIds[0]);

            if (event.payload.subscriptionId !== null && !source)
                throw new Error(`Input ${event.payload.inputId} has no source event.`);

            const base = {
                id: event.payload.inputId,
                actorId: event.payload.actorId,
                content: event.payload.subscriptionId === null ? event.payload.content : JSON.stringify(source),
                ...(event.payload.presentation ? { presentation: event.payload.presentation } : {}),
                artifactIds: event.payload.artifactIds,
                enqueuedBy: event.actorId,
                enqueuedAt: event.occurredAt,
                sequence: event.sequence,
                lifecycle: { kind: "pending" as const },
            };
            const input: Draft<ActorInput> = event.payload.subscriptionId === null
                ? { ...base, subscriptionId: null, sourceEventIds: event.payload.sourceEventIds }
                : { ...base, subscriptionId: event.payload.subscriptionId, sourceEventIds: [...event.payload.sourceEventIds] };
            state.inputs.set(input.id, input);
            break;
        }

        case "turn.started": {
            const target = executable(state, event.actorId);
            const input = state.inputs.get(event.payload.inputId);

            if (!input)
                throw new Error(`Input ${event.payload.inputId} does not exist.`);

            if (input.actorId !== target.id)
                throw new Error(`Input ${input.id} is not addressed to actor ${target.id}.`);

            if (input.lifecycle.kind === "claimed")
                throw new Error(`Input ${input.id} already belongs to turn ${input.lifecycle.turnId}.`);

            input.lifecycle = { kind: "claimed", turnId: event.payload.turnId, steered: false };
            target.lifecycle = {
                kind: "running",
                turnId: event.payload.turnId,
                inputId: input.id,
                startedAt: event.occurredAt,
            };
            state.turns.set(event.payload.turnId, {
                id: event.payload.turnId,
                actorId: target.id,
                inputId: input.id,
                status: "running",
                startedAt: event.occurredAt,
                finishedAt: null,
                reason: null,
                usage: emptyUsage(),
                outputs: [],
                toolCalls: [],
            });
            break;
        }

        case "turn.input-steered": {
            const current = turn(state, event.payload.turnId);
            const input = state.inputs.get(event.payload.inputId);

            if (!input)
                throw new Error(`Input ${event.payload.inputId} does not exist.`);

            input.lifecycle = { kind: "claimed", turnId: current.id, steered: true };
            break;
        }

        case "turn.finished": {
            const current = turn(state, event.payload.turnId);
            const target = executable(state, current.actorId);
            const cumulativeUsage = event.payload.usage
                ? addUsage(target.usage, event.payload.usage)
                : null;
            current.status = event.payload.outcome;
            current.finishedAt = event.occurredAt;
            current.reason = event.payload.outcome === "failed" ? event.payload.reason : null;
            interruptOpenToolCalls(current, event.occurredAt);

            if (event.payload.usage && cumulativeUsage) {
                current.usage = event.payload.usage;
                target.usage = cumulativeUsage;
            }

            if (target.lifecycle.kind === "running" && target.lifecycle.turnId === current.id)
                target.lifecycle = { kind: "idle", since: event.occurredAt };

            break;
        }

        case "turn.interrupted": {
            const current = turn(state, event.payload.turnId);
            const target = executable(state, current.actorId);
            current.status = "interrupted";
            current.finishedAt = event.occurredAt;
            current.reason = event.payload.reason;
            interruptOpenToolCalls(current, event.occurredAt);

            if (target.lifecycle.kind === "running" && target.lifecycle.turnId === current.id)
                target.lifecycle = { kind: "idle", since: event.occurredAt };

            break;
        }

        case "model.output.completed": {
            const current = turn(state, event.payload.turnId);
            current.outputs.push({
                text: event.payload.text,
                sequence: event.sequence,
                occurredAt: event.occurredAt,
            });
            break;
        }

        case "tool.call.started": {
            turn(state, event.payload.turnId).toolCalls.push({
                id: event.payload.toolCallId,
                name: event.payload.name,
                status: "running",
                startedAt: event.occurredAt,
                finishedAt: null,
            });
            break;
        }

        case "tool.call.completed":
        case "tool.call.failed": {
            const call = turn(state, event.payload.turnId).toolCalls.find((entry) => entry.id === event.payload.toolCallId);
            if (!call) throw new Error(`Tool call ${event.payload.toolCallId} is missing from its turn projection.`);
            call.status = event.type === "tool.call.completed" ? "completed" : "failed";
            call.finishedAt = event.occurredAt;
            break;
        }

        case "model.reasoning.completed":
        case "model.output.interrupted":
        case "runtime.output.recorded":
        case "tool.call.source":
            break;

        case "actor.tools.opened": {
            const target = executable(state, event.payload.actorId);
            target.openedToolNames = [...new Set([...target.openedToolNames, ...event.payload.toolNames])];
            break;
        }

        case "actor.stopped":
            executable(state, event.payload.actorId).lifecycle = {
                kind: "stopped",
                stoppedAt: event.occurredAt,
                reason: event.payload.reason,
            };

            if (state.primaryActorId === event.payload.actorId) {
                state.primaryActorId = null;
                state.stoppedPrimaryActorId = event.payload.actorId;
            }
            break;

        case "actor.restarted":
            executable(state, event.payload.actorId).lifecycle = { kind: "idle", since: event.occurredAt };
            break;

        case "subscription.created":
            state.subscriptions.set(event.payload.subscriptionId, {
                id: event.payload.subscriptionId,
                subscriberId: event.payload.subscriberId,
                sourceActorIds: event.payload.sourceActorIds,
                sourceActorKinds: event.payload.sourceActorKinds,
                eventTypes: event.payload.eventTypes,
                includeSelf: event.payload.includeSelf,
                status: "active",
                createdBy: event.actorId,
                createdAt: event.occurredAt,
                createdSequence: event.sequence,
            });
            break;

        case "subscription.removed": {
            const subscription = state.subscriptions.get(event.payload.subscriptionId);

            if (!subscription)
                throw new Error(`Subscription ${event.payload.subscriptionId} does not exist.`);

            state.subscriptions.set(subscription.id, {
                ...subscriptionBaseOf(subscription),
                status: "removed",
                endedAt: event.occurredAt,
                reason: event.payload.reason,
            });

            const discardedInputIds = event.payload.discardedInputIds ?? [];

            for (const inputId of discardedInputIds) {
                const input = state.inputs.get(inputId);

                if (!input)
                    throw new Error(`Input ${inputId} does not exist.`);

                input.lifecycle = { kind: "discarded", at: event.occurredAt, reason: event.payload.reason };
            }

            break;
        }

        case "subscription.failed": {
            const subscription = state.subscriptions.get(event.payload.subscriptionId);

            if (!subscription)
                throw new Error(`Subscription ${event.payload.subscriptionId} does not exist.`);

            state.subscriptions.set(subscription.id, {
                ...subscriptionBaseOf(subscription),
                status: "failed",
                endedAt: event.occurredAt,
                reason: event.payload.reason,
                sourceEventId: event.payload.sourceEventId,
            });
            break;
        }

        case "plugin.state-patched":
        case "plugin.state-replaced": {
            const { pluginId, scope } = event.payload;

            if (scope.kind === "actor")
                actor(state, scope.actorId);

            const key = pluginStateKey(pluginId, scope);
            const previous = state.pluginStates.get(key);
            if (event.type === "plugin.state-patched" && !previous)
                throw new Error(`Plugin state ${pluginId} must exist before it can be patched.`);

            state.pluginStates.set(key, {
                pluginId,
                scope,
                state: event.type === "plugin.state-replaced" ? event.payload.state : applyJsonChanges(previous!.state, event.payload.changes),
                updatedAt: event.occurredAt,
            });
            break;
        }

        case "action.proposed": {
            const action: Draft<Action> = {
                id: event.payload.actionId,
                askedBy: event.actorId,
                owner: event.payload.owner,
                title: event.payload.title,
                description: event.payload.description,
                parameters: event.payload.parameters,
                input: event.payload.input,
                payload: event.payload.payload,
                status: "pending",
                proposedAt: event.occurredAt,
                resolvedAt: null,
                resolvedBy: null,
                result: null,
            };
            state.actions.set(action.id, action);
            break;
        }

        case "action.resolved": {
            const found = state.actions.get(event.payload.actionId);

            if (!found)
                throw new Error(`Action ${event.payload.actionId} does not exist.`);

            found.status = event.payload.decision;
            found.resolvedAt = event.occurredAt;
            found.resolvedBy = event.actorId;
            found.result = event.payload.result;
            break;
        }

        case "artifact.published":
            state.artifacts.set(event.payload.artifact.id, {
                ...event.payload.artifact,
                createdBy: event.actorId,
                createdAt: event.occurredAt,
            });
            break;
    }

    state.revision = event.sequence;
    recordEventSemantics(event, context);

    return state;
}

export function project(events: readonly JournalEvent[]): RunState | null {
    let state: RunDraft | null = null;
    const context = eventSemanticContext();

    for (const event of events)
        state = applyEvent(state, event, context);

    return state;
}

export function viewOf(state: RunState): RunView {
    return {
        id: state.id,
        revision: state.revision,
        title: state.title,
        ownerId: state.ownerId,
        primaryActorId: state.primaryActorId,
        stoppedPrimaryActorId: state.stoppedPrimaryActorId,
        createdAt: state.createdAt,
        forkedFrom: state.forkedFrom,
        actors: [...state.actors.values()],
        inputs: [...state.inputs.values()],
        turns: [...state.turns.values()],
        subscriptions: [...state.subscriptions.values()],
        pluginStates: [...state.pluginStates.values()],
        actions: [...state.actions.values()],
        artifacts: [...state.artifacts.values()],
    };
}

export const isActiveActor = (entry: Actor) => entry.kind === "human" || entry.lifecycle.kind !== "stopped";

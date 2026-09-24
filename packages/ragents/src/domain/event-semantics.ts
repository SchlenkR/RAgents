import { resolve } from "node:path";

import type { JournalEvent } from "./events.ts";
import type { JsonValue } from "./json.ts";
import type {
    Actor,
    AgentExecution,
    CapabilityGrant,
    CapabilityName,
    CapabilityScope,
    EventSubscription,
    ExecutableActor,
    RunState,
    Turn,
} from "./model.ts";
import { eventSubjectOf, isPendingActorInput, actorStatePluginId } from "./model.ts";
import { isObservableEventType } from "./vocabulary.ts";

export type EventSemanticContext = {
    events: Map<string, JournalEvent>;
    /** Tool calls with a recorded source, by turn and call; their state stands in the turn. */
    sourcedToolCalls: Set<string>;
};

export const eventSemanticContext = (): EventSemanticContext => ({
    events: new Map(),
    sourcedToolCalls: new Set(),
});

const existingActorOf = (state: RunState, actorId: string): Actor => {
    const actor = state.actors.get(actorId);

    if (!actor)
        throw new Error(`Actor ${actorId} does not exist.`);

    return actor;
};

const executableOf = (state: RunState, actorId: string): ExecutableActor => {
    const actor = existingActorOf(state, actorId);

    if (actor.kind === "human")
        throw new Error(`Actor ${actorId} is not executable.`);

    return actor;
};

const activeExecutableOf = (state: RunState, actorId: string): ExecutableActor => {
    const actor = executableOf(state, actorId);

    if (actor.lifecycle.kind === "stopped")
        throw new Error(`Actor ${actorId} is stopped.`);

    return actor;
};

const turnOf = (state: RunState, turnId: string): Turn => {
    const turn = state.turns.get(turnId);

    if (!turn)
        throw new Error(`Turn ${turnId} does not exist.`);

    return turn;
};

const runningTurnOf = (state: RunState, turnId: string): Turn => {
    const turn = turnOf(state, turnId);
    const actor = executableOf(state, turn.actorId);

    if (turn.status !== "running"
        || actor.lifecycle.kind !== "running"
        || actor.lifecycle.turnId !== turn.id)
        throw new Error(`Turn ${turnId} is not running.`);

    return turn;
};

const assertTurnAuthor = (turn: Turn, event: JournalEvent) => {
    if (event.actorId !== turn.actorId)
        throw new Error(`Event actor ${event.actorId} does not own turn ${turn.id}.`);
};

const assertNewId = <Value>(values: ReadonlyMap<string, Value>, id: string, kind: string) => {
    if (values.has(id))
        throw new Error(`${kind} ${id} already exists.`);
};

const assertUnique = (values: readonly string[], kind: string) => {
    if (new Set(values).size !== values.length)
        throw new Error(`${kind} contains duplicate references.`);
};

const isBlankResult = (result: JsonValue | null) =>
    result === null || (typeof result === "string" && result.trim() === "");

const toolCallKey = (turnId: string, toolCallId: string) => `${turnId}\0${toolCallId}`;

const toolCallOf = (turn: Turn, toolCallId: string) => {
    const call = turn.toolCalls.find((entry) => entry.id === toolCallId);

    if (!call)
        throw new Error(`Tool call ${toolCallId} does not exist in turn ${turn.id}.`);

    return call;
};

const assertExistingEvents = (context: EventSemanticContext, eventIds: readonly string[]) => {
    assertUnique(eventIds, "sourceEventIds");

    for (const eventId of eventIds) {
        if (!context.events.has(eventId))
            throw new Error(`Source event ${eventId} does not exist before this event.`);
    }
};

const canReadArtifact = (state: RunState, actorId: string, artifactId: string) => {
    const artifact = state.artifacts.get(artifactId);

    if (!artifact)
        throw new Error(`Artifact ${artifactId} does not exist.`);

    return actorId === state.ownerId
        || actorId === artifact.createdBy
        || [...state.inputs.values()].some((input) =>
            input.actorId === actorId && input.artifactIds.includes(artifactId));
};

const assertArtifactRead = (state: RunState, actorId: string, artifactId: string) => {
    if (!canReadArtifact(state, actorId, artifactId))
        throw new Error(`Actor ${actorId} cannot read artifact ${artifactId}.`);
};

const commandActorOf = (state: RunState, actorId: string) => {
    const actor = existingActorOf(state, actorId);

    if (actor.kind !== "human" && actor.lifecycle.kind !== "running")
        throw new Error(`Actor ${actor.id} cannot author a command while ${actor.lifecycle.kind}.`);

    return actor;
};

const hasRunCapability = (actor: Actor, capability: CapabilityName) =>
    actor.grants.some((grant) =>
        grant.capability === capability && grant.scope.kind === "run" && grant.usable !== false);

const assertRunCapability = (state: RunState, actorId: string, capability: CapabilityName) => {
    const actor = commandActorOf(state, actorId);

    if (!hasRunCapability(actor, capability))
        throw new Error(`Actor ${actor.id} lacks ${capability}.`);

    return actor;
};

const scopeCovers = (parent: CapabilityScope, child: CapabilityScope) => {
    if (parent.kind === "run")
        return true;

    if (parent.kind !== "workspace" || child.kind !== "workspace")
        return false;

    const parentPath = resolve(parent.path);
    const childPath = resolve(child.path);
    const root = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;

    return childPath === parentPath || childPath.startsWith(root);
};

const assertDelegation = (actor: Actor, grants: readonly CapabilityGrant[]) => {
    for (const grant of grants) {
        const delegated = actor.grants.some((parent) =>
            parent.capability === grant.capability && parent.delegable && scopeCovers(parent.scope, grant.scope));

        if (!delegated)
            throw new Error(`Actor ${actor.id} cannot delegate ${grant.capability}.`);
    }
};

const assertActiveHandleFree = (state: RunState, handle: string) => {
    const existing = [...state.actors.values()].find((actor) =>
        actor.handle === handle && (actor.kind === "human" || actor.lifecycle.kind !== "stopped"));

    if (existing)
        throw new Error(`Handle ${handle} already belongs to active actor ${existing.id}.`);
};

const assertForkSource = (state: RunState, sourceId: string, execution: AgentExecution) => {
    const source = state.actors.get(sourceId);

    if (!source || source.kind !== "agent")
        throw new Error(`Fork source ${sourceId} is not an LLM agent of this run.`);

    if (source.execution.driver.kind !== "agent" || execution.driver.kind !== "agent")
        throw new Error(`Fork source ${sourceId} and the new agent must both use the agent driver.`);
};

const assertHandleUnused = (state: RunState, handle: string) => {
    const existing = [...state.actors.values()].find((actor) => actor.handle === handle);

    if (existing)
        throw new Error(`Handle ${handle} already belongs to actor ${existing.id}.`);
};

const belongsToBranch = (state: RunState, target: ExecutableActor, creatorId: string) => {
    let currentId = target.createdBy;
    const visited = new Set<string>();

    while (!visited.has(currentId)) {
        if (currentId === creatorId)
            return true;

        visited.add(currentId);
        const current = state.actors.get(currentId);

        if (!current || current.kind === "human")
            return false;

        currentId = current.createdBy;
    }

    return false;
};

const canStopActor = (state: RunState, authorId: string, target: ExecutableActor) => {
    if (authorId === state.ownerId)
        return true;

    const author = commandActorOf(state, authorId);

    return hasRunCapability(author, "execution.stopOwned") && belongsToBranch(state, target, authorId);
};

const assertOwnerEvent = (state: RunState, event: JournalEvent) => {
    if (event.actorId !== state.ownerId)
        throw new Error(`Event ${event.eventId} must be authored by run owner ${state.ownerId}.`);
};

/** The owner configures the run by right; any other actor needs run.configure. */
const assertRunConfigurator = (state: RunState, event: JournalEvent) => {
    if (event.actorId === state.ownerId) return;
    assertRunCapability(state, event.actorId, "run.configure");
};

const assertSubscriptionSource = (
    state: RunState,
    context: EventSemanticContext,
    subscription: EventSubscription,
    sourceEventId: string,
) => {
    const source = context.events.get(sourceEventId);

    if (!source)
        throw new Error(`Source event ${sourceEventId} does not exist before this event.`);

    if (source.sequence <= subscription.createdSequence)
        throw new Error(`Source event ${sourceEventId} predates subscription ${subscription.id}.`);

    if (!isObservableEventType(source.type) || !subscription.eventTypes.includes(source.type))
        throw new Error(`Source event ${sourceEventId} does not match subscription ${subscription.id}.`);

    const subjectId = eventSubjectOf(state, source);

    if (!subscription.includeSelf && subjectId === subscription.subscriberId)
        throw new Error(`Source event ${sourceEventId} is excluded by subscription ${subscription.id}.`);

    if (subscription.sourceActorIds && !subscription.sourceActorIds.includes(subjectId))
        throw new Error(`Source event ${sourceEventId} has the wrong actor for subscription ${subscription.id}.`);

    if (subscription.sourceActorKinds) {
        const sourceActor = existingActorOf(state, subjectId);

        if (!subscription.sourceActorKinds.includes(sourceActor.kind))
            throw new Error(`Source event ${sourceEventId} has the wrong actor kind for subscription ${subscription.id}.`);
    }
};

export const assertEventSemantics = (
    state: RunState | null,
    event: JournalEvent,
    context: EventSemanticContext,
) => {
    if (context.events.has(event.eventId))
        throw new Error(`Event ${event.eventId} already exists.`);

    const expectedSequence = (state?.revision ?? 0) + 1;

    if (event.sequence !== expectedSequence)
        throw new Error(`Event ${event.eventId} has sequence ${event.sequence}, expected ${expectedSequence}.`);

    if (state && event.runId !== state.id)
        throw new Error(`Event ${event.eventId} belongs to run ${event.runId}, expected ${state.id}.`);

    if (event.type === "run.created") {
        if (state)
            throw new Error(`Run ${event.runId} was created twice.`);

        if (event.actorId !== event.payload.owner.id)
            throw new Error(`Run creator ${event.actorId} does not match owner ${event.payload.owner.id}.`);

        return;
    }

    if (!state)
        throw new Error(`Run ${event.runId} has no creation event.`);

    existingActorOf(state, event.actorId);

    switch (event.type) {
        case "run.forked":
            assertOwnerEvent(state, event);

            if (event.payload.sourceRunId === state.id)
                throw new Error(`Run ${state.id} cannot be forked from itself.`);

            if (event.payload.sourceSequence !== event.sequence - 1)
                throw new Error(`Fork source sequence ${event.payload.sourceSequence} does not match the inherited history.`);
            break;

        case "run.primary-actor-selected":
            assertRunConfigurator(state, event);
            activeExecutableOf(state, event.payload.actorId);
            break;

        case "run.title-changed":
            assertRunConfigurator(state, event);
            break;

        case "agent.spawned": {
            const author = assertRunCapability(state, event.actorId, "agent.spawn");
            assertDelegation(author, event.payload.grants);
            assertActiveHandleFree(state, event.payload.handle);
            assertNewId(state.actors, event.payload.agentId, "Actor");
            assertUnique(event.payload.toolNames ?? [], "toolNames");
            if (event.payload.forkOf !== undefined) assertForkSource(state, event.payload.forkOf, event.payload.execution);
            break;
        }

        case "script.created": {
            const author = assertRunCapability(state, event.actorId, "agent.spawn");
            assertDelegation(author, event.payload.grants);
            assertHandleUnused(state, event.payload.handle);
            assertNewId(state.actors, event.payload.scriptId, "Actor");
            assertUnique(event.payload.toolNames ?? [], "toolNames");
            break;
        }

        case "actor.input.enqueued": {
            const target = activeExecutableOf(state, event.payload.actorId);
            assertNewId(state.inputs, event.payload.inputId, "Input");
            assertUnique(event.payload.artifactIds, "artifactIds");
            assertExistingEvents(context, event.payload.sourceEventIds);

            for (const artifactId of event.payload.artifactIds)
                assertArtifactRead(state, event.actorId, artifactId);

            if (event.payload.subscriptionId) {
                const subscription = state.subscriptions.get(event.payload.subscriptionId);

                if (!subscription)
                    throw new Error(`Subscription ${event.payload.subscriptionId} does not exist.`);

                if (subscription.status !== "active")
                    throw new Error(`Subscription ${subscription.id} is not active.`);

                if (subscription.subscriberId !== target.id || event.actorId !== target.id)
                    throw new Error(`Subscription ${subscription.id} cannot enqueue input for actor ${target.id}.`);

                for (const sourceEventId of event.payload.sourceEventIds)
                    assertSubscriptionSource(state, context, subscription, sourceEventId);
            } else if (event.actorId !== state.ownerId) {
                assertRunCapability(state, event.actorId, "actor.input");
            }
            break;
        }

        case "turn.started": {
            assertNewId(state.turns, event.payload.turnId, "Turn");
            const target = activeExecutableOf(state, event.actorId);
            const input = state.inputs.get(event.payload.inputId);

            if (!input)
                throw new Error(`Input ${event.payload.inputId} does not exist.`);

            if (input.actorId !== target.id)
                throw new Error(`Input ${input.id} is not addressed to actor ${target.id}.`);

            if (input.lifecycle.kind === "claimed")
                throw new Error(`Input ${input.id} already belongs to turn ${input.lifecycle.turnId}.`);

            if (input.lifecycle.kind === "discarded")
                throw new Error(`Input ${input.id} was discarded.`);

            if (target.lifecycle.kind !== "idle")
                throw new Error(`Actor ${target.id} is not idle.`);
            break;
        }

        case "turn.input-steered": {
            const turn = runningTurnOf(state, event.payload.turnId);
            assertTurnAuthor(turn, event);
            const input = state.inputs.get(event.payload.inputId);

            if (!input)
                throw new Error(`Input ${event.payload.inputId} does not exist.`);

            if (input.actorId !== turn.actorId)
                throw new Error(`Input ${input.id} is not addressed to actor ${turn.actorId}.`);

            if (!isPendingActorInput(input))
                throw new Error(`Input ${input.id} is no longer pending and cannot join turn ${turn.id}.`);

            const earlier = [...state.inputs.values()].find((entry) =>
                entry.actorId === input.actorId && isPendingActorInput(entry) && entry.sequence < input.sequence);

            if (earlier)
                throw new Error(`Input ${input.id} cannot join turn ${turn.id} before the earlier input ${earlier.id}.`);
            break;
        }

        case "turn.finished": {
            const turn = runningTurnOf(state, event.payload.turnId);
            assertTurnAuthor(turn, event);
            const openCalls = turn.toolCalls.filter((call) => call.status === "running");

            if (event.payload.outcome === "completed" && openCalls.length > 0)
                throw new Error(
                    `Turn ${turn.id} still has running tool calls: ${openCalls.map((call) => call.id).join(", ")}.`,
                );
            break;
        }

        case "turn.interrupted": {
            const turn = runningTurnOf(state, event.payload.turnId);
            const target = executableOf(state, turn.actorId);

            if (event.actorId !== turn.actorId && !canStopActor(state, event.actorId, target))
                throw new Error(`Actor ${event.actorId} cannot interrupt turn ${turn.id}.`);
            break;
        }

        case "model.output.completed":
        case "model.output.interrupted":
        case "model.reasoning.completed":
        case "runtime.output.recorded": {
            const turn = runningTurnOf(state, event.payload.turnId);
            assertTurnAuthor(turn, event);
            break;
        }

        case "tool.call.started": {
            const turn = runningTurnOf(state, event.payload.turnId);
            assertTurnAuthor(turn, event);

            if (turn.toolCalls.some((call) => call.id === event.payload.toolCallId))
                throw new Error(`Tool call ${event.payload.toolCallId} already exists in turn ${turn.id}.`);
            break;
        }

        case "tool.call.completed":
        case "tool.call.failed": {
            const turn = runningTurnOf(state, event.payload.turnId);
            assertTurnAuthor(turn, event);
            const call = toolCallOf(turn, event.payload.toolCallId);

            if (call.status !== "running")
                throw new Error(`Tool call ${call.id} in turn ${turn.id} is already ${call.status}.`);

            if (call.name !== event.payload.name)
                throw new Error(`Tool call ${call.id} started as ${call.name}, not ${event.payload.name}.`);
            break;
        }

        case "tool.call.source": {
            const turn = runningTurnOf(state, event.payload.turnId);
            assertTurnAuthor(turn, event);
            const call = toolCallOf(turn, event.payload.toolCallId);
            if (call.status !== "running")
                throw new Error(`Tool call ${call.id} in turn ${turn.id} is already ${call.status}.`);
            if (context.sourcedToolCalls.has(toolCallKey(turn.id, call.id)))
                throw new Error(`Tool call ${call.id} in turn ${turn.id} already has a source snapshot.`);
            break;
        }

        case "actor.tools.opened": {
            const target = activeExecutableOf(state, event.payload.actorId);

            if (target.id !== event.actorId)
                throw new Error(`Actor ${event.actorId} cannot open tools for actor ${target.id}.`);

            if (event.payload.toolNames.length === 0)
                throw new Error(`Actor ${target.id} opened no tool.`);
            break;
        }

        case "actor.stopped": {
            const target = activeExecutableOf(state, event.payload.actorId);

            if (!canStopActor(state, event.actorId, target))
                throw new Error(`Actor ${event.actorId} cannot stop actor ${target.id}.`);

            if (target.lifecycle.kind === "running")
                throw new Error(`Actor ${target.id} still has a running turn.`);
            break;
        }

        case "actor.restarted": {
            const target = executableOf(state, event.payload.actorId);

            if (!canStopActor(state, event.actorId, target))
                throw new Error(`Actor ${event.actorId} cannot restart actor ${target.id}.`);

            if (target.lifecycle.kind !== "stopped")
                throw new Error(`Actor ${target.id} is not stopped.`);
            break;
        }

        case "subscription.created": {
            assertNewId(state.subscriptions, event.payload.subscriptionId, "Subscription");
            const subscriber = activeExecutableOf(state, event.payload.subscriberId);
            const author = commandActorOf(state, event.actorId);

            if (author.id !== state.ownerId
                && (author.id !== subscriber.id || !hasRunCapability(author, "event.subscribe")))
                throw new Error(`Actor ${author.id} cannot create subscription ${event.payload.subscriptionId}.`);

            assertUnique(event.payload.sourceActorIds ?? [], "sourceActorIds");
            assertUnique(event.payload.sourceActorKinds ?? [], "sourceActorKinds");
            assertUnique(event.payload.eventTypes, "eventTypes");

            for (const actorId of event.payload.sourceActorIds ?? [])
                existingActorOf(state, actorId);
            break;
        }

        case "subscription.removed": {
            const subscription = state.subscriptions.get(event.payload.subscriptionId);

            if (!subscription)
                throw new Error(`Subscription ${event.payload.subscriptionId} does not exist.`);

            if (subscription.status !== "active")
                throw new Error(`Subscription ${subscription.id} is not active.`);

            const author = commandActorOf(state, event.actorId);
            const subscriber = executableOf(state, subscription.subscriberId);
            const directRemoval = (author.id === subscription.subscriberId || author.id === subscription.createdBy)
                && hasRunCapability(author, "event.subscribe");
            const stopRemoval = subscriber.lifecycle.kind === "stopped"
                && canStopActor(state, author.id, subscriber);

            if (author.id !== state.ownerId && !directRemoval && !stopRemoval)
                throw new Error(`Actor ${author.id} cannot remove subscription ${subscription.id}.`);

            if (event.payload.discardedInputIds) {
                const expectedInputIds = [...state.inputs.values()]
                    .filter((input) => input.subscriptionId === subscription.id && isPendingActorInput(input))
                    .map((input) => input.id);
                const expectedInputIdSet = new Set(expectedInputIds);
                assertUnique(event.payload.discardedInputIds, "discardedInputIds");

                if (event.payload.discardedInputIds.length !== expectedInputIds.length
                    || event.payload.discardedInputIds.some((inputId) => !expectedInputIdSet.has(inputId)))
                    throw new Error(`Subscription ${subscription.id} must discard all of its pending inputs.`);
            }

            break;
        }

        case "subscription.failed": {
            const subscription = state.subscriptions.get(event.payload.subscriptionId);

            if (!subscription)
                throw new Error(`Subscription ${event.payload.subscriptionId} does not exist.`);

            if (subscription.status !== "active")
                throw new Error(`Subscription ${subscription.id} is not active.`);

            if (event.actorId !== subscription.subscriberId)
                throw new Error(`Event actor ${event.actorId} does not own subscription ${subscription.id}.`);

            assertSubscriptionSource(state, context, subscription, event.payload.sourceEventId);
            break;
        }

        case "plugin.state-patched":
        case "plugin.state-replaced": {
            const author = commandActorOf(state, event.actorId);

            if (event.payload.scope.kind === "actor") {
                existingActorOf(state, event.payload.scope.actorId);

                if (author.id !== state.ownerId && author.id !== event.payload.scope.actorId)
                    throw new Error(`Actor ${author.id} cannot replace plugin state for ${event.payload.scope.actorId}.`);
            }

            const intrinsicActorState = event.payload.pluginId === actorStatePluginId;
            if (intrinsicActorState) {
                if (event.payload.scope.kind !== "actor")
                    throw new Error("Intrinsic actor state requires actor scope.");
                executableOf(state, event.payload.scope.actorId);
            }

            if (author.kind !== "human" && !intrinsicActorState && !hasRunCapability(author, "plugin.state.write"))
                throw new Error(`Actor ${author.id} lacks plugin.state.write.`);
            break;
        }

        case "action.proposed": {
            const author = commandActorOf(state, event.actorId);
            assertNewId(state.actions, event.payload.actionId, "Action");

            if (event.payload.owner === null && !hasRunCapability(author, "action.propose"))
                throw new Error(`Actor ${author.id} lacks action.propose.`);
            break;
        }

        case "action.resolved": {
            const action = state.actions.get(event.payload.actionId);

            if (!action)
                throw new Error(`Action ${event.payload.actionId} does not exist.`);

            if (action.status !== "pending")
                throw new Error(`Action ${action.id} is already ${action.status}.`);

            if (existingActorOf(state, event.actorId).kind !== "human")
                throw new Error(`Action ${action.id} was not resolved by a human actor.`);

            if (event.payload.decision === "approved" && action.input?.required && isBlankResult(event.payload.result))
                throw new Error(`Action ${action.id} requires a result.`);
            break;
        }

        case "artifact.published": {
            const artifact = event.payload.artifact;
            assertRunCapability(state, event.actorId, "artifact.publish");
            assertNewId(state.artifacts, artifact.id, "Artifact");

            if (artifact.previousVersionId)
                assertArtifactRead(state, event.actorId, artifact.previousVersionId);
            break;
        }

        default: {
            const unsupported: never = event;
            return unsupported;
        }
    }
};

export const recordEventSemantics = (event: JournalEvent, context: EventSemanticContext) => {
    context.events.set(event.eventId, event);

    if (event.type === "tool.call.source")
        context.sourcedToolCalls.add(toolCallKey(event.payload.turnId, event.payload.toolCallId));
};

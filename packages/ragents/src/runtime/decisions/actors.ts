
import type {
    Actor,
    AgentExecution,
    CapabilityGrant,
    ExecutableActor,
    PluginStateScope,
    RunState,
} from "../../domain/model.ts";
import { assertJsonValue, type JsonValue } from "../../domain/json.ts";
import { jsonChanges } from "../../domain/json-patch.ts";
import type { UncommittedEvent } from "../../domain/events.ts";
import { isPendingActorInput, actorStatePluginId, pluginStateKey } from "../../domain/model.ts";
import { scriptExecution } from "../../domain/driver.ts";
import { isActiveActor } from "../../domain/projection.ts";
import { event, type CommandContext, type Decision } from "../command.ts";
import { DomainError } from "../domain-error.ts";
import { descendantsOf } from "../stop.ts";
import {
    actorById,
    commandActorOf,
    addressedActorOf,
    assertCapability,
    assertDelegation,
    uniqueHandleOf,
    clean,
    executableActorOf,
    handleOf,
    hasCapability,
} from "../guards.ts";

const selectedToolNames = (value: readonly string[] | null): string[] | null => {
    if (value === null)
        return null;

    const toolNames = value.map((name) => clean(name, "tool name"));

    if (new Set(toolNames).size !== toolNames.length)
        throw new DomainError("invalid-value", "toolNames must not contain duplicates.", 400);

    return toolNames;
};

const isRunConfigurator = (state: RunState, caller: Actor) =>
    caller.id === state.ownerId || hasCapability(caller, "run.configure", { kind: "run" });

/** The owner configures the run by right; any other actor needs the capability run.configure. */
const assertRunConfigurator = (state: RunState, caller: Actor) => {
    if (!isRunConfigurator(state, caller))
        throw new DomainError(
            "run-configuration-denied",
            `${caller.displayName} may not configure the run; that takes the owner or the capability run.configure.`,
            403,
        );
};

export const selectPrimaryActor = (actorId: string): Decision => (state, context) => {
    const caller = commandActorOf(state, context);
    const target = executableActorOf(state, actorId);

    assertRunConfigurator(state, caller);

    if (!isActiveActor(target))
        throw new DomainError("actor-inactive", `Actor ${actorId} is stopped.`, 409);

    return [event(context, { type: "run.primary-actor-selected", payload: { actorId: target.id } })];
};

export const retitleRun = (title: string): Decision => (state, context) => {
    assertRunConfigurator(state, commandActorOf(state, context));

    return [event(context, { type: "run.title-changed", payload: { title: clean(title, "title") } })];
};

export const spawnAgent =
    (input: {
        handle: string;
        displayName: string;
        prompt: string;
        execution: AgentExecution;
        grants: readonly CapabilityGrant[];
        toolNames: readonly string[] | null;
        forkOf?: string;
    }): Decision =>
    (state, context, services) => {
        const caller = commandActorOf(state, context);
        assertCapability(caller, "agent.spawn", { kind: "run" });
        assertDelegation(caller, input.grants);

        const requested = handleOf(input.handle);
        const handle = uniqueHandleOf(state, requested);
        const suffix = handle === requested ? "" : ` ${handle.slice(requested.length + 1)}`;
        const forkOf = input.forkOf === undefined ? undefined : forkSourceOf(state, input.forkOf);

        return [
            event(context, {
                type: "agent.spawned",
                payload: {
                    agentId: services.newId("agent"),
                    handle,
                    displayName: `${clean(input.displayName, "displayName")}${suffix}`,
                    prompt: input.prompt.trim(),
                    execution: input.execution,
                    grants: [...input.grants],
                    toolNames: selectedToolNames(input.toolNames),
                    ...(forkOf ? { forkOf } : {}),
                },
            }),
        ];
    };

const forkSourceOf = (state: RunState, reference: string): string => {
    const source = addressedActorOf(state.actors.values(), reference);

    if (source.kind !== "agent")
        throw new DomainError("invalid-value", `Fork source ${reference} is not an LLM agent.`, 400);

    if (source.execution.driver.kind !== "agent")
        throw new DomainError("invalid-value", `Fork source ${reference} has no model context to fork.`, 400);

    return source.id;
};

export const createScriptActor =
    (input: {
        handle: string;
        displayName: string;
        grants: readonly CapabilityGrant[];
        toolNames: readonly string[] | null;
        turnTimeoutMs?: number | null;
    }): Decision =>
    (state, context, services) => {
        const caller = commandActorOf(state, context);
        assertCapability(caller, "agent.spawn", { kind: "run" });
        assertDelegation(caller, input.grants);
        const handle = handleOf(input.handle);
        if ([...state.actors.values()].some((actor) => actor.handle === handle))
            throw new DomainError("handle-exists", `Handle @${handle} already belongs to an actor.`);

        return [event(context, {
            type: "script.created",
            payload: {
                scriptId: services.newId("script"),
                handle,
                displayName: clean(input.displayName, "displayName"),
                execution: scriptExecution(input.turnTimeoutMs ?? null),
                grants: [...input.grants],
                toolNames: selectedToolNames(input.toolNames),
            },
        })];
    };

const belongsToBranch = (state: RunState, actor: ExecutableActor, ownerId: string) => {
    let creatorId = actor.createdBy;
    const visited = new Set<string>();

    while (!visited.has(creatorId)) {
        if (creatorId === ownerId)
            return true;

        visited.add(creatorId);
        const creator = state.actors.get(creatorId);
        if (!creator || creator.kind === "human")
            return false;

        creatorId = creator.createdBy;
    }

    return false;
};

export const restartActor =
    (actorId: string, reason: string): Decision =>
    (state, context) => {
        const caller = commandActorOf(state, context);
        const target = executableActorOf(state, actorId);

        if (caller.id !== state.ownerId) {
            assertCapability(caller, "execution.stopOwned", { kind: "run" });

            if (!belongsToBranch(state, target, caller.id))
                throw new DomainError(
                    "actor-restart-denied",
                    `${caller.displayName} may only restart actors in its own branch.`,
                    403,
                );
        }

        if (target.lifecycle.kind !== "stopped")
            throw new DomainError("actor-active", `Actor ${actorId} is not stopped.`);

        const restarted = event(context, { type: "actor.restarted", payload: { actorId: target.id, reason: clean(reason, "reason") } });

        return state.stoppedPrimaryActorId === target.id && isRunConfigurator(state, caller)
            ? [restarted, event(context, { type: "run.primary-actor-selected", payload: { actorId: target.id } })]
            : [restarted];
    };

const stopEventsOf = (state: RunState, context: CommandContext, targets: readonly ExecutableActor[], reason: string) => {
    const cleanReason = clean(reason, "reason");

    return targets.flatMap((target): UncommittedEvent[] => [
        ...(target.lifecycle.kind === "running"
            ? [event(context, {
                  type: "turn.interrupted" as const,
                  payload: { turnId: target.lifecycle.turnId, reason: cleanReason },
              })]
            : []),
        event(context, { type: "actor.stopped", payload: { actorId: target.id, reason: cleanReason } }),
        ...[...state.subscriptions.values()]
            .filter((subscription) => subscription.subscriberId === target.id && subscription.status === "active")
            .map((subscription) => event(context, {
                type: "subscription.removed" as const,
                payload: {
                    subscriptionId: subscription.id,
                    reason: cleanReason,
                    discardedInputIds: [...state.inputs.values()]
                        .filter((input) =>
                            input.subscriptionId === subscription.id && isPendingActorInput(input))
                        .map((input) => input.id),
                },
            })),
    ]);
};

const stoppableActorOf = (state: RunState, caller: Actor, actorId: string) => {
    const target = executableActorOf(state, actorId);

    if (caller.id !== state.ownerId) {
        assertCapability(caller, "execution.stopOwned", { kind: "run" });

        if (!belongsToBranch(state, target, caller.id))
            throw new DomainError("actor-stop-denied", `${caller.displayName} may only stop actors in its own branch.`, 403);
    }

    if (!isActiveActor(target))
        throw new DomainError("actor-inactive", `Actor ${actorId} is already stopped.`);

    return target;
};

/** Stops the actor and all of its active descendants together, in the name of the caller. */
export const stopActor =
    (actorId: string, reason: string): Decision =>
    (state, context) => {
        const target = stoppableActorOf(state, commandActorOf(state, context), actorId);

        return stopEventsOf(state, context, [target, ...descendantsOf({ actors: state.actors.values() }, target.id)], reason);
    };

/** Stops exactly these actors together; the caller names every one of them. */
export const stopActors =
    (actorIds: readonly string[], reason: string): Decision =>
    (state, context) => {
        const caller = commandActorOf(state, context);

        if (actorIds.length === 0)
            throw new DomainError("invalid-value", "actorIds must name at least one actor.", 400);

        if (new Set(actorIds).size !== actorIds.length)
            throw new DomainError("invalid-value", "actorIds must not contain duplicates.", 400);

        return stopEventsOf(state, context, actorIds.map((actorId) => stoppableActorOf(state, caller, actorId)), reason);
    };

const stateChange = (state: RunState, context: CommandContext, pluginId: string, scope: PluginStateScope, raw: JsonValue): UncommittedEvent => {
    assertJsonValue(raw, "state");
    const value: JsonValue = JSON.parse(JSON.stringify(raw));
    const previous = state.pluginStates.get(pluginStateKey(pluginId, scope));
    const replacement = event(context, { type: "plugin.state-replaced", payload: { pluginId, scope, state: value } });
    if (previous) {
        const changes = jsonChanges(previous.state, value);
        const patch = event(context, { type: "plugin.state-patched", payload: { pluginId, scope, changes } });
        if (Buffer.byteLength(JSON.stringify(patch)) < Buffer.byteLength(JSON.stringify(replacement)))
            return patch;
    }
    return replacement;
};

export const replacePluginState =
    (input: { pluginId: string; scope: PluginStateScope; state: JsonValue }): Decision =>
    (state, context) => {
        const caller = commandActorOf(state, context);
        const pluginId = clean(input.pluginId, "pluginId");

        if (input.scope.kind === "actor") {
            actorById(state, input.scope.actorId);

            if (caller.id !== input.scope.actorId && caller.id !== state.ownerId)
                throw new DomainError("plugin-state-access-denied", "An actor may only replace its own plugin state.", 403);
        }

        if (caller.kind !== "human")
            assertCapability(caller, "plugin.state.write", { kind: "run" });

        return [stateChange(state, context, pluginId, input.scope, input.state)];
    };

export const replaceActorState = (actorId: string, value: JsonValue): Decision => (state, context) => {
    const caller = commandActorOf(state, context);
    executableActorOf(state, actorId);
    if (caller.id !== actorId && caller.id !== state.ownerId)
        throw new DomainError("actor-state-access-denied", "An actor may only replace its own intrinsic state.", 403);

    return [stateChange(state, context, actorStatePluginId, { kind: "actor", actorId }, value)];
};

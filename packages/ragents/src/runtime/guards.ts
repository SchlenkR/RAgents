import { resolve } from "node:path";

import type {
    Actor,
    AgentActor,
    Artifact,
    CapabilityGrant,
    CapabilityName,
    CapabilityScope,
    ExecutableActor,
    RunState,
} from "../domain/model.ts";
import { isActiveActor } from "../domain/projection.ts";
import { DomainError } from "./domain-error.ts";

export const clean = (value: string, name: string) => {
    const result = value.trim();

    if (!result)
        throw new DomainError("invalid-value", `${name} must not be empty.`, 400);

    return result;
};

export const optionalClean = (value: string | null | undefined, name: string) => {
    if (value === null || value === undefined)
        return null;

    const result = value.trim();

    return result ? clean(result, name) : null;
};

export const handleOf = (value: string) => {
    const result = value.trim().replace(/^@/, "").normalize("NFC").toLowerCase();

    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(result))
        throw new DomainError("invalid-handle", "A handle may contain letters, digits, dot, dash, and underscore.", 400);

    return result;
};

export const uniqueHandleOf = (state: RunState, handle: string): string => {
    const taken = new Set([...state.actors.values()].map((entry) => entry.handle));

    if (!taken.has(handle))
        return handle;

    for (let counter = 1; ; counter += 1) {
        const candidate = `${handle}-${counter}`;

        if (!taken.has(candidate))
            return candidate;
    }
};

export const actorById = (state: RunState, actorId: string): Actor => {
    const found = state.actors.get(actorId);

    if (!found)
        throw new DomainError("actor-not-found", `Actor ${actorId} does not exist.`, 404);

    return found;
};

export const executableActorOf = (state: RunState, actorId: string): ExecutableActor => {
    const found = actorById(state, actorId);

    if (found.kind === "human")
        throw new DomainError("actor-not-executable", `Actor ${actorId} is a human and takes no turns.`, 404);

    return found;
};

export const agentActorOf = (state: RunState, agentId: string): AgentActor => {
    const found = actorById(state, agentId);

    if (found.kind !== "agent")
        throw new DomainError("agent-not-found", `Actor ${agentId} is not an agent.`, 404);

    return found;
};

export const artifactOf = (state: RunState, artifactId: string): Artifact => {
    const found = state.artifacts.get(artifactId);

    if (!found)
        throw new DomainError("artifact-not-found", `Artifact ${artifactId} does not exist.`, 404);

    return found;
};

export const addressedActorOf = (state: RunState, reference: string): Actor => {
    const direct = state.actors.get(reference);

    if (direct)
        return direct;

    const wanted = reference.trim().replace(/^@/, "").normalize("NFC").toLowerCase();
    const sharing = [...state.actors.values()].filter((entry) => entry.handle === wanted);
    const byHandle = sharing.find(isActiveActor) ?? sharing.at(-1);

    if (!byHandle)
        throw new DomainError("actor-not-found", `Actor ${reference} does not exist.`, 404);

    return byHandle;
};

export const assertActorCanCommand = (actor: Actor, turnId: string | undefined) => {
    if (actor.kind === "human")
        return;

    if (actor.lifecycle.kind !== "running")
        throw new DomainError(
            "actor-not-running",
            `Actor ${actor.id} cannot issue commands while ${actor.lifecycle.kind}.`,
            409,
        );

    if (!turnId || actor.lifecycle.turnId !== turnId)
        throw new DomainError("turn-mismatch", `Turn ${turnId ?? "<missing>"} is not running for actor ${actor.id}.`, 409);
};

export const actorOf = (state: RunState, context: { actorId: string; turnId?: string }): Actor => {
    const actor = actorById(state, context.actorId);
    assertActorCanCommand(actor, context.turnId);

    return actor;
};

export const isActiveCommandActor = (state: RunState, actor: Actor) => isActiveActor(actorById(state, actor.id));

export const scopeCovers = (parent: CapabilityScope, child: CapabilityScope) => {
    if (parent.kind === "run")
        return true;

    if (parent.kind === "workspace" && child.kind === "workspace") {
        const parentPath = resolve(parent.path);
        const childPath = resolve(child.path);
        const root = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;

        return childPath === parentPath || childPath.startsWith(root);
    }

    return false;
};

const matchingGrants = (actor: Actor, capability: CapabilityName, scope: CapabilityScope) =>
    actor.grants.filter((grant) => grant.capability === capability && scopeCovers(grant.scope, scope));

export const hasCapability = (actor: Actor, capability: CapabilityName, scope: CapabilityScope) =>
    matchingGrants(actor, capability, scope).some((grant) => grant.usable !== false);

export const assertCapability = (actor: Actor, capability: CapabilityName, scope: CapabilityScope) => {
    if (!hasCapability(actor, capability, scope))
        throw new DomainError("capability-denied", `${actor.displayName} may not use ${capability} in this scope.`, 403);
};

export const assertDelegation = (actor: Actor, grants: readonly CapabilityGrant[]) => {
    for (const grant of grants) {
        if (!matchingGrants(actor, grant.capability, grant.scope).some((parent) => parent.delegable))
            throw new DomainError("delegation-denied", `${actor.displayName} may not delegate ${grant.capability}.`, 403);
    }
};

export const inheritedGrants = (
    actor: Actor,
    withoutCapabilities: readonly CapabilityName[] = [],
): CapabilityGrant[] => {
    const excluded = new Set(withoutCapabilities);

    return actor.grants
        .filter((grant) => grant.delegable && !excluded.has(grant.capability))
        .map((grant) => ({
            capability: grant.capability,
            scope: grant.scope.kind === "run"
                ? { kind: "run" as const }
                : { kind: "workspace" as const, path: grant.scope.path },
            delegable: true,
        }));
};

export const assertArtifactRead = (state: RunState, actor: Actor, artifact: Artifact) => {
    if (actor.id === state.ownerId
        || actor.id === artifact.createdBy
        || [...state.inputs.values()].some((input) =>
            input.actorId === actor.id && input.artifactIds.includes(artifact.id)))
        return;

    throw new DomainError("artifact-read-denied", `${actor.displayName} may not read artifact ${artifact.id}.`, 403);
};

export const assertSelf = (context: { actorId: string }, actorId: string, action: string) => {
    if (context.actorId !== actorId)
        throw new DomainError("actor-identity-mismatch", `An actor may only ${action} for itself.`, 403);
};

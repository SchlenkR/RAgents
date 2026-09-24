import { isActiveActor } from "../../domain/projection.ts";
import { event, type Decision } from "../command.ts";
import { DomainError } from "../domain-error.ts";
import {
    actorById,
    commandActorOf,
    addressedActorOf,
    artifactOf,
    assertArtifactRead,
    assertCapability,
    clean,
    executableActorOf,
} from "../guards.ts";

export type EnqueueInput = {
    actorId: string;
    artifactIds?: readonly string[];
    presentation?: "background";
} & (
    | { content: string; sourceEventIds?: readonly string[]; subscriptionId?: null }
    | { content?: never; sourceEventIds: readonly [string]; subscriptionId: string }
);

export const enqueueInput =
    (input: EnqueueInput): Decision =>
    (state, context, services) => {
        const target = executableActorOf(state, addressedActorOf(state.actors.values(), input.actorId).id);
        const subscriptionId = input.subscriptionId ?? null;
        const caller = subscriptionId ? actorById(state, context.actorId) : commandActorOf(state, context);

        if (!isActiveActor(target))
            throw new DomainError("actor-inactive", `${target.displayName} is stopped.`);

        if (subscriptionId) {
            const subscription = state.subscriptions.get(subscriptionId);

            if (!subscription || subscription.status !== "active")
                throw new DomainError("subscription-inactive", `Subscription ${subscriptionId} is not active.`, 409);

            if (subscription.subscriberId !== caller.id || target.id !== caller.id)
                throw new DomainError("subscription-input-denied", `Subscription ${subscriptionId} cannot enqueue this input.`, 403);
        } else if (caller.id !== state.ownerId) {
            assertCapability(caller, "actor.input", { kind: "run" });
        }

        const artifactIds = [...new Set(input.artifactIds ?? [])];

        for (const artifactId of artifactIds)
            assertArtifactRead(state, caller, artifactOf(state, artifactId));

        const [firstSourceEventId, ...furtherSourceEventIds] =
            [...new Set((input.sourceEventIds ?? []).map((id) => clean(id, "sourceEventId")))];
        const base = {
            inputId: services.newId("input"),
            actorId: target.id,
            artifactIds,
            ...(input.presentation !== undefined ? { presentation: input.presentation } : {}),
        };

        if (subscriptionId && firstSourceEventId === undefined)
            throw new DomainError("subscription-source-required", `Subscription ${subscriptionId} input has no source event.`, 400);

        if (subscriptionId && furtherSourceEventIds.length > 0)
            throw new DomainError("subscription-source-invalid", `Subscription ${subscriptionId} input must have exactly one source event.`, 400);

        return [event(context, {
            type: "actor.input.enqueued",
            payload: subscriptionId && firstSourceEventId !== undefined
                ? { ...base, subscriptionId, sourceEventIds: [firstSourceEventId] }
                : {
                    ...base,
                    content: artifactIds.length > 0 ? input.content!.trim() : clean(input.content!, "content"),
                    subscriptionId: null,
                    sourceEventIds: firstSourceEventId === undefined
                        ? []
                        : [firstSourceEventId, ...furtherSourceEventIds],
                },
        })];
    };

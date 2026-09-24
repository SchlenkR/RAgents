import type { JournalEvent } from "../../domain/events.ts";
import { eventSubjectOf, isPendingActorInput, type EventSubscription, type ObservableEventType, type RunState } from "../../domain/model.ts";
import { isActiveActor } from "../../domain/projection.ts";
import { isObservableEventType, observableEventTypes } from "../../domain/vocabulary.ts";
import { event, type Decision } from "../command.ts";
import { DomainError } from "../domain-error.ts";
import { actorById, commandActorOf, assertCapability, clean, executableActorOf } from "../guards.ts";

export const createSubscription =
    (input: {
        subscriberId: string;
        sourceActorIds?: readonly string[] | null;
        sourceActorKinds?: readonly ("human" | "agent" | "script")[] | null;
        eventTypes: readonly ObservableEventType[];
        includeSelf?: boolean;
    }): Decision =>
    (state, context, services) => {
        const caller = commandActorOf(state, context);
        const subscriber = executableActorOf(state, input.subscriberId);

        if (caller.id !== state.ownerId) {
            assertCapability(caller, "event.subscribe", { kind: "run" });

            if (caller.id !== subscriber.id)
                throw new DomainError("subscription-access-denied", "An actor may only subscribe itself.", 403);
        }

        if (!isActiveActor(subscriber))
            throw new DomainError("actor-inactive", `Actor ${subscriber.id} is stopped.`, 409);

        const eventTypes = [...new Set(input.eventTypes)];

        if (eventTypes.length === 0)
            throw new DomainError("subscription-events-empty", "A subscription needs at least one event type.", 400);

        const denied = eventTypes.filter((type) => !isObservableEventType(type));

        if (denied.length > 0)
            throw new DomainError(
                "subscription-event-denied",
                `The subscription contains a control or unknown event type: ${denied.join(", ")}. `
                + `Subscribable event types: ${observableEventTypes.join(", ")}.`,
                400,
            );

        const sourceActorIds = input.sourceActorIds === null || input.sourceActorIds === undefined
            ? null
            : [...new Set(input.sourceActorIds.map((id) => actorById(state, id).id))];
        const sourceActorKinds = input.sourceActorKinds === null || input.sourceActorKinds === undefined
            ? null
            : [...new Set(input.sourceActorKinds)];

        return [event(context, {
            type: "subscription.created",
            payload: {
                subscriptionId: services.newId("subscription"),
                subscriberId: subscriber.id,
                sourceActorIds,
                sourceActorKinds,
                eventTypes,
                includeSelf: input.includeSelf === true,
            },
        })];
    };

export const removeSubscription =
    (subscriptionId: string, reason: string): Decision =>
    (state, context) => {
        const caller = commandActorOf(state, context);
        const subscription = state.subscriptions.get(subscriptionId);

        if (!subscription)
            throw new DomainError("subscription-not-found", `Subscription ${subscriptionId} does not exist.`, 404);

        if (subscription.status !== "active")
            throw new DomainError("subscription-inactive", `Subscription ${subscriptionId} is ${subscription.status}.`, 409);

        if (caller.id !== state.ownerId && caller.id !== subscription.subscriberId && caller.id !== subscription.createdBy)
            throw new DomainError("subscription-access-denied", `Actor ${caller.id} may not remove ${subscriptionId}.`, 403);

        if (caller.id !== state.ownerId)
            assertCapability(caller, "event.subscribe", { kind: "run" });

        const discardedInputIds = [...state.inputs.values()]
            .filter((input) => input.subscriptionId === subscriptionId && isPendingActorInput(input))
            .map((input) => input.id);

        return [event(context, {
            type: "subscription.removed",
            payload: { subscriptionId, reason: clean(reason, "reason"), discardedInputIds },
        })];
    };

export const failSubscription =
    (subscriptionId: string, sourceEventId: string, reason: string): Decision =>
    (state, context) => {
        const subscription = state.subscriptions.get(subscriptionId);

        if (!subscription)
            throw new DomainError("subscription-not-found", `Subscription ${subscriptionId} does not exist.`, 404);

        actorById(state, context.actorId);

        return [event(context, {
            type: "subscription.failed",
            payload: {
                subscriptionId,
                sourceEventId: clean(sourceEventId, "sourceEventId"),
                reason: clean(reason, "reason"),
            },
        })];
    };

export const matchesSubscription = (state: RunState, subscription: EventSubscription, source: JournalEvent) => {
    if (subscription.status !== "active" || !isObservableEventType(source.type))
        return false;

    if (!subscription.eventTypes.includes(source.type))
        return false;

    const subjectId = eventSubjectOf(state, source);

    if (!subscription.includeSelf && subjectId === subscription.subscriberId)
        return false;

    if (subscription.sourceActorIds && !subscription.sourceActorIds.includes(subjectId))
        return false;

    if (subscription.sourceActorKinds) {
        const sourceActor = state.actors.get(subjectId);

        if (!sourceActor || !subscription.sourceActorKinds.includes(sourceActor.kind))
            return false;
    }

    return true;
};

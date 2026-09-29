import { isObservableEventType, type ObservableEventType } from "../domain/vocabulary.ts";
import { validatedEventPayloadOf } from "../domain/event-validation.ts";
import type { EventPayloads } from "../domain/events.ts";
import type { ActorInput, RunView } from "../domain/model.ts";
import { canonicalJson } from "../runtime/canonical-json.ts";

export type DeliveredEvent = {
    [Name in ObservableEventType]: {
        readonly type: Name;
        readonly eventId: string;
        readonly sequence: number;
        readonly occurredAt: string;
        readonly sourceActorId: string;
        readonly sourceActorHandle: string;
        readonly payload: Readonly<EventPayloads[Name]>;
    };
}[ObservableEventType];

export type DeliveredInput = ActorInput & {
    readonly event: DeliveredEvent | null;
};

const eventTypesWithText = ["model.output.completed", "model.reasoning.completed", "runtime.output.recorded"] as const;

type TextEventType = (typeof eventTypesWithText)[number];

export const carriesText = (type: ObservableEventType): type is TextEventType =>
    (eventTypesWithText as readonly ObservableEventType[]).includes(type);

const carriesTextEvent = (event: DeliveredEvent): event is Extract<DeliveredEvent, { type: TextEventType }> =>
    carriesText(event.type);

const recordOf = (value: unknown, what: string): Readonly<Record<string, unknown>> => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error(`${what} is not an object.`);

    return value as Record<string, unknown>;
};

const stringOf = (source: Readonly<Record<string, unknown>>, field: string, what: string): string => {
    const value = source[field];

    if (typeof value !== "string")
        throw new Error(`${what} has no text field ${field}.`);

    return value;
};

const numberOf = (source: Readonly<Record<string, unknown>>, field: string, what: string): number => {
    const value = source[field];

    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`${what} has no number field ${field}.`);

    return value;
};

export const deliveredContentOf = (event: DeliveredEvent): string =>
    carriesTextEvent(event) ? event.payload.text : canonicalJson(event.payload);

export const deliveredEventOf = (
    source: {
        readonly eventId: string;
        readonly sequence: number;
        readonly occurredAt: string;
        readonly actorId: string;
        readonly type: string;
        readonly payload: unknown;
    },
    sourceActorHandle: string,
): DeliveredEvent => {
    if (!isObservableEventType(source.type))
        throw new Error(`The event type ${source.type} is not observable and is not delivered.`);

    return {
        type: source.type,
        eventId: source.eventId,
        sequence: source.sequence,
        occurredAt: source.occurredAt,
        sourceActorId: source.actorId,
        sourceActorHandle,
        payload: validatedEventPayloadOf(source.type, source.payload, `event ${source.eventId} payload`),
    } as DeliveredEvent;
};

const sourceEventOf = (inputId: string, content: string): Readonly<Record<string, unknown>> => {
    try {
        return recordOf(JSON.parse(content), `The delivered content of input ${inputId}`);
    } catch (error) {
        throw new Error(
            `The subscription input ${inputId} carries no event JSON: `
            + (error instanceof Error ? error.message : String(error)),
        );
    }
};

export const deliveredEventFromJson = (view: RunView, inputId: string, content: string): DeliveredEvent => {
    const what = `The delivered event of input ${inputId}`;
    const source = sourceEventOf(inputId, content);
    const actorId = stringOf(source, "actorId", what);
    const author = view.actors.find((entry) => entry.id === actorId);

    if (!author)
        throw new Error(`${what} comes from actor ${actorId}, which this run does not know.`);

    return deliveredEventOf({
        eventId: stringOf(source, "eventId", what),
        sequence: numberOf(source, "sequence", what),
        occurredAt: stringOf(source, "occurredAt", what),
        actorId,
        type: stringOf(source, "type", what),
        payload: source.payload,
    }, author.handle);
};

export const deliveredInputOf = (view: RunView, input: ActorInput): DeliveredInput => {
    if (input.subscriptionId === null)
        return { ...input, event: null };

    const event = deliveredEventFromJson(view, input.id, input.content);

    return { ...input, content: deliveredContentOf(event), event };
};

export type ScriptInput = {
    readonly id: string;
    readonly content: string;
    readonly artifactIds: readonly string[];
    readonly sourceEventIds: readonly string[];
    readonly subscriptionId: string | null;
    readonly event: DeliveredEvent | null;
};

export const scriptInputOf = (input: DeliveredInput): ScriptInput => ({
    id: input.id,
    content: input.content,
    artifactIds: [...input.artifactIds],
    sourceEventIds: [...input.sourceEventIds],
    subscriptionId: input.subscriptionId,
    event: input.event,
});

export const subscriptionSummaryFor = (view: RunView, actorId: string): readonly string[] => {
    const handleOf = (id: string) => {
        const found = view.actors.find((entry) => entry.id === id);

        return found ? `@${found.handle}` : id;
    };

    return view.subscriptions
        .filter((subscription) => subscription.subscriberId === actorId && subscription.status === "active")
        .map((subscription) => {
            const sources = subscription.sourceActorIds
                ? subscription.sourceActorIds.map(handleOf).join(", ")
                : subscription.sourceActorKinds
                    ? `all actors of kind ${subscription.sourceActorKinds.join(", ")}`
                    : "all actors";

            return `${subscription.id}: sources ${sources}; events ${subscription.eventTypes.join(", ")}`;
        });
};

export const actorRosterText = (view: RunView, actorId: string): string => [
    "[Actors in the run, as of turn start]",
    "These actors already exist. Keep using suitable participants; actor_list refreshes the roster.",
    "agent: conversation with a model. script: program with a fixed input protocol, not a chat partner; use documented functions or program inputs. primary denotes the default target, not a dialog capability.",
    ...view.actors.map((actor) => {
        const status = actor.kind === "human" ? "human" : actor.lifecycle.kind;
        const markers = [actor.id === actorId ? "you" : "", actor.id === view.primaryActorId ? "primary" : ""]
            .filter(Boolean);

        return `- @${actor.handle}: ${JSON.stringify(actor.displayName)}, ${actor.kind}, ${status}`
            + (markers.length > 0 ? ` (${markers.join(", ")})` : "");
    }),
].join("\n");

export const renderedPromptFor = (view: RunView, actorId: string, input: DeliveredInput): string => {
    const subscriptions = subscriptionSummaryFor(view, actorId);
    const header = [
        ...(input.event
            ? [`[Event ${input.event.type} from @${input.event.sourceActorHandle}, sequence ${input.event.sequence}]`]
            : []),
        ...(subscriptions.length > 0 ? [`[Active subscriptions] ${subscriptions.join(" | ")}`] : []),
    ];

    return header.length > 0 ? `${header.join("\n")}\n\n${input.content}` : input.content;
};

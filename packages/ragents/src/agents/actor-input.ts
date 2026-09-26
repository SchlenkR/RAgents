import { Type, type Static, type TSchema } from "typebox";

import type { EventPayloads, EventType } from "../domain/events.ts";
import { assertJsonValue, type JsonValue } from "../domain/json.ts";
import type { CommandContext } from "../runtime/command.ts";
import type { Orchestration } from "../runtime/orchestration.ts";

export const actorInputSchema = Type.Object({
    actor: Type.String({ minLength: 1, description: "Actor ID oder Handle" }),
    content: Type.String({ minLength: 1 }),
    artifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
}, { additionalProperties: false });

type KeysOf<Value> = Value extends unknown ? keyof Value : never;

const payloadOf = <Name extends EventType>(
    fields: { [Key in KeysOf<EventPayloads[Name]>]?: TSchema },
): TSchema => Type.Object(fields as Record<string, TSchema>, { additionalProperties: false });

const eventPayloads = {
    "run.created": payloadOf<"run.created">({
        title: Type.String(),
    }),
    "run.forked": payloadOf<"run.forked">({
        sourceRunId: Type.String({ description: "ID des Quell-Runs" }),
        sourceSequence: Type.Integer(),
    }),
    "run.primary-actor-selected": payloadOf<"run.primary-actor-selected">({
        actorId: Type.String({ description: "ID des primären Actors" }),
    }),
    "run.title-changed": payloadOf<"run.title-changed">({
        title: Type.String({ description: "Neuer Titel des Runs" }),
    }),
    "agent.spawned": payloadOf<"agent.spawned">({
        agentId: Type.String({ description: "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle" }),
        handle: Type.String(),
        displayName: Type.String(),
    }),
    "script.created": payloadOf<"script.created">({
        scriptId: Type.String({ description: "ID des neuen TypeScript-Actors" }),
        handle: Type.String(),
        displayName: Type.String(),
    }),
    "actor.input.enqueued": payloadOf<"actor.input.enqueued">({
        inputId: Type.String({ description: "ID des eingereihten Inputs" }),
        actorId: Type.String({ description: "ID des empfangenden Actors" }),
    }),
    "turn.started": payloadOf<"turn.started">({
        turnId: Type.String({ description: "ID des gestarteten Turns" }),
        inputId: Type.String(),
    }),
    "turn.input-steered": payloadOf<"turn.input-steered">({
        turnId: Type.String({ description: "Laufender Turn, in den der Input eingespeist wurde" }),
        inputId: Type.String(),
    }),
    "turn.finished": payloadOf<"turn.finished">({
        turnId: Type.String({ description: "ID des beendeten Turns" }),
        outcome: Type.String(),
        reason: Type.Optional(Type.String()),
    }),
    "turn.interrupted": payloadOf<"turn.interrupted">({
        turnId: Type.String({ description: "ID des unterbrochenen Turns" }),
    }),
    "model.output.completed": payloadOf<"model.output.completed">({
        turnId: Type.String({ description: "Turn, zu dem die Ausgabe gehört" }),
    }),
    "model.output.interrupted": payloadOf<"model.output.interrupted">({
        turnId: Type.String({ description: "Turn, zu dem die Ausgabe gehört" }),
    }),
    "model.reasoning.completed": payloadOf<"model.reasoning.completed">({
        turnId: Type.String({ description: "Turn, zu dem die Ausgabe gehört" }),
    }),
    "runtime.output.recorded": payloadOf<"runtime.output.recorded">({
        turnId: Type.String({ description: "Turn, zu dem die Ausgabe gehört" }),
    }),
    "tool.call.started": payloadOf<"tool.call.started">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID des Werkzeugaufrufs" }),
        name: Type.String(),
    }),
    "tool.call.source": payloadOf<"tool.call.source">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID des Werkzeugaufrufs" }),
        path: Type.Union([Type.String(), Type.Null()]),
    }),
    "tool.call.completed": payloadOf<"tool.call.completed">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID des Werkzeugaufrufs" }),
        name: Type.String(),
    }),
    "tool.call.failed": payloadOf<"tool.call.failed">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID des Werkzeugaufrufs" }),
        name: Type.String(),
        error: Type.String(),
    }),
    "actor.tools.opened": payloadOf<"actor.tools.opened">({
        actorId: Type.String({ description: "Actor, dessen Werkzeuge geöffnet wurden" }),
        toolNames: Type.Array(Type.String()),
    }),
    "actor.stopped": payloadOf<"actor.stopped">({
        actorId: Type.String({ description: "ID des gestoppten Actors" }),
    }),
    "actor.restarted": payloadOf<"actor.restarted">({
        actorId: Type.String({ description: "ID des neu gestarteten Actors" }),
    }),
    "subscription.created": payloadOf<"subscription.created">({
        subscriptionId: Type.String({ description: "ID der neuen Subscription" }),
        subscriberId: Type.String(),
    }),
    "subscription.removed": payloadOf<"subscription.removed">({
        subscriptionId: Type.String({ description: "ID der entfernten Subscription" }),
    }),
    "subscription.failed": payloadOf<"subscription.failed">({
        subscriptionId: Type.String({ description: "ID der gescheiterten Subscription" }),
        sourceEventId: Type.String(),
        reason: Type.String(),
    }),
    "action.proposed": payloadOf<"action.proposed">({
        actionId: Type.String({ description: "ID der vorgeschlagenen Aktion" }),
    }),
    "action.resolved": payloadOf<"action.resolved">({
        actionId: Type.String({ description: "ID der aufgelösten Aktion" }),
        decision: Type.String(),
    }),
    "artifact.published": payloadOf<"artifact.published">({
        artifact: Type.Object({
            id: Type.String({ description: "ID des Artefakts; artifact_read liest es damit" }),
        }, { additionalProperties: false }),
    }),
    "plugin.state-replaced": payloadOf<"plugin.state-replaced">({
        pluginId: Type.String({ description: "Plugin, dessen Zustand ersetzt wurde" }),
    }),
    "plugin.state-patched": payloadOf<"plugin.state-patched">({
        pluginId: Type.String({ description: "Plugin, dessen Zustand geändert wurde" }),
    }),
} satisfies Record<EventType, TSchema>;

/** Die Journal-Events eines Aufrufs, eingegrenzt auf die Typen, die er tatsächlich erzeugt. */
export const eventResultSchemaOf = (...types: readonly EventType[]): TSchema => {
    const variants = types.map((type) => Type.Object({ type: Type.Literal(type), payload: eventPayloads[type] }, { additionalProperties: false }));
    return Type.Array(variants.length === 1 ? variants[0]! : Type.Union(variants), {
        description: "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht.",
    });
};

export const eventResultSchema: TSchema = eventResultSchemaOf(...Object.keys(eventPayloads) as EventType[]);

const pickedBySchema = (schema: TSchema, value: JsonValue): JsonValue => {
    const properties = (schema as { properties?: Record<string, TSchema> }).properties;

    if (!properties || typeof value !== "object" || value === null || Array.isArray(value))
        return value;

    return Object.fromEntries(Object.entries(properties)
        .filter(([key]) => (value as Record<string, unknown>)[key] !== undefined)
        .map(([key, property]) => [key, pickedBySchema(property, (value as Record<string, JsonValue>)[key]!)]));
};

export const toolResultEventOf = (
    event: { readonly type: EventType; readonly payload: JsonValue },
): { type: EventType; payload: JsonValue } => ({
    type: event.type,
    payload: pickedBySchema(eventPayloads[event.type], event.payload),
});

export type ActorInputRequest = Static<typeof actorInputSchema>;

export const enqueueActorInput = (
    runtime: Orchestration,
    context: CommandContext,
    runId: string,
    input: ActorInputRequest,
): Array<{ type: string; payload: JsonValue }> => {
    runtime.enqueueInput(context, runId, {
        actorId: input.actor,
        content: input.content,
        artifactIds: input.artifactIds ?? [],
        sourceEventIds: [],
        subscriptionId: null,
    });

    return runtime.events(runId)
        .filter((event) => event.commandId === context.commandId)
        .map((event) => {
            assertJsonValue(event.payload, `Event ${event.eventId} payload`);
            return toolResultEventOf(event);
        });
};

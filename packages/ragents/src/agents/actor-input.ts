import { Type, type Static, type TSchema } from "typebox";

import type { EventPayloads, EventType } from "../domain/events.ts";
import { assertJsonValue, type JsonValue } from "../domain/json.ts";
import type { CommandContext } from "../runtime/command.ts";
import type { Orchestration } from "../runtime/orchestration.ts";

export const actorInputSchema = Type.Object({
    actor: Type.String({ minLength: 1, description: "Actor ID or handle" }),
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
        sourceRunId: Type.String({ description: "ID of the source run" }),
        sourceSequence: Type.Integer(),
    }),
    "run.primary-actor-selected": payloadOf<"run.primary-actor-selected">({
        actorId: Type.String({ description: "ID of the primary actor" }),
    }),
    "run.title-changed": payloadOf<"run.title-changed">({
        title: Type.String({ description: "New title of the run" }),
    }),
    "agent.spawned": payloadOf<"agent.spawned">({
        agentId: Type.String({ description: "ID of the new agent; actor_input and actor_stop take it or @handle" }),
        handle: Type.String(),
        displayName: Type.String(),
    }),
    "script.created": payloadOf<"script.created">({
        scriptId: Type.String({ description: "ID of the new TypeScript actor" }),
        handle: Type.String(),
        displayName: Type.String(),
    }),
    "actor.input.enqueued": payloadOf<"actor.input.enqueued">({
        inputId: Type.String({ description: "ID of the enqueued input" }),
        actorId: Type.String({ description: "ID of the receiving actor" }),
    }),
    "turn.started": payloadOf<"turn.started">({
        turnId: Type.String({ description: "ID of the started turn" }),
        inputId: Type.String(),
    }),
    "turn.input-steered": payloadOf<"turn.input-steered">({
        turnId: Type.String({ description: "Running turn into which the input was fed" }),
        inputId: Type.String(),
    }),
    "turn.finished": payloadOf<"turn.finished">({
        turnId: Type.String({ description: "ID of the finished turn" }),
        outcome: Type.String(),
        reason: Type.Optional(Type.String()),
    }),
    "turn.interrupted": payloadOf<"turn.interrupted">({
        turnId: Type.String({ description: "ID of the interrupted turn" }),
    }),
    "model.input.presented": payloadOf<"model.input.presented">({
        turnId: Type.String({ description: "Turn in which the model was given the input" }),
    }),
    "model.step.completed": payloadOf<"model.step.completed">({
        turnId: Type.String({ description: "Turn the model step belongs to" }),
        stopReason: Type.String(),
    }),
    "model.tool-result.presented": payloadOf<"model.tool-result.presented">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID of the tool call" }),
    }),
    "context.compacted": payloadOf<"context.compacted">({
        turnId: Type.String({ description: "Turn in which the context was compacted" }),
        tokensBefore: Type.Integer(),
    }),
    "model.output.completed": payloadOf<"model.output.completed">({
        turnId: Type.String({ description: "Turn the output belongs to" }),
    }),
    "model.output.interrupted": payloadOf<"model.output.interrupted">({
        turnId: Type.String({ description: "Turn the output belongs to" }),
    }),
    "model.reasoning.completed": payloadOf<"model.reasoning.completed">({
        turnId: Type.String({ description: "Turn the output belongs to" }),
    }),
    "runtime.output.recorded": payloadOf<"runtime.output.recorded">({
        turnId: Type.String({ description: "Turn the output belongs to" }),
    }),
    "tool.call.started": payloadOf<"tool.call.started">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID of the tool call" }),
        name: Type.String(),
    }),
    "tool.call.source": payloadOf<"tool.call.source">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID of the tool call" }),
        path: Type.Union([Type.String(), Type.Null()]),
    }),
    "tool.call.completed": payloadOf<"tool.call.completed">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID of the tool call" }),
        name: Type.String(),
    }),
    "tool.call.failed": payloadOf<"tool.call.failed">({
        turnId: Type.String(),
        toolCallId: Type.String({ description: "ID of the tool call" }),
        name: Type.String(),
        error: Type.String(),
    }),
    "actor.tools.opened": payloadOf<"actor.tools.opened">({
        actorId: Type.String({ description: "Actor whose tools were opened" }),
        toolNames: Type.Array(Type.String()),
    }),
    "actor.stopped": payloadOf<"actor.stopped">({
        actorId: Type.String({ description: "ID of the stopped actor" }),
    }),
    "actor.restarted": payloadOf<"actor.restarted">({
        actorId: Type.String({ description: "ID of the restarted actor" }),
    }),
    "subscription.created": payloadOf<"subscription.created">({
        subscriptionId: Type.String({ description: "ID of the new subscription" }),
        subscriberId: Type.String(),
    }),
    "subscription.removed": payloadOf<"subscription.removed">({
        subscriptionId: Type.String({ description: "ID of the removed subscription" }),
    }),
    "subscription.failed": payloadOf<"subscription.failed">({
        subscriptionId: Type.String({ description: "ID of the failed subscription" }),
        sourceEventId: Type.String(),
        reason: Type.String(),
    }),
    "action.proposed": payloadOf<"action.proposed">({
        actionId: Type.String({ description: "ID of the proposed action" }),
    }),
    "action.resolved": payloadOf<"action.resolved">({
        actionId: Type.String({ description: "ID of the resolved action" }),
        decision: Type.String(),
    }),
    "artifact.published": payloadOf<"artifact.published">({
        artifact: Type.Object({
            id: Type.String({ description: "ID of the artifact; artifact_read reads it with this" }),
        }, { additionalProperties: false }),
    }),
    "plugin.state-replaced": payloadOf<"plugin.state-replaced">({
        pluginId: Type.String({ description: "Plugin whose state was replaced" }),
    }),
    "plugin.state-patched": payloadOf<"plugin.state-patched">({
        pluginId: Type.String({ description: "Plugin whose state was changed" }),
    }),
} satisfies Record<EventType, TSchema>;

/** The journal events of a call, narrowed to the types it actually produces. */
export const eventResultSchemaOf = (...types: readonly EventType[]): TSchema => {
    const variants = types.map((type) => Type.Object({ type: Type.Literal(type), payload: eventPayloads[type] }, { additionalProperties: false }));
    return Type.Array(variants.length === 1 ? variants[0]! : Type.Union(variants), {
        description: "The journal events of this call. The payload names the ids of the result; it does not repeat inputs and hashes.",
    });
};

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

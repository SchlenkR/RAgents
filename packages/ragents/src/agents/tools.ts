import { Type, type Static, type TSchema } from "typebox";

import { thinkingLevels } from "../domain/driver.ts";
import type { JsonValue } from "../domain/json.ts";
import {
    actorDescriptionMaxLength,
    type Actor,
    type CapabilityName,
    type EventSubscription,
    type RunView,
} from "../domain/model.ts";
import { observableEventTypes } from "../domain/vocabulary.ts";
import type { CommandContext } from "../runtime/command.ts";
import { addressedActorOf, inheritedGrants } from "../runtime/guards.ts";
import type { Orchestration } from "../runtime/orchestration.ts";
import { actorInputSchema, enqueueActorInput, eventResultSchemaOf } from "./actor-input.ts";
import { resolveExecution, type ModelCatalog } from "./catalog.ts";
import {
    capabilitySchema,
    driverKindSchema,
    grantSchema,
    literalUnion,
    namedValuesSchema,
    recordOf,
} from "./schemas.ts";

export type ToolCaller = {
    runId: string;
    actorId: string;
    turnId: string | null;
};

export type ToolScope = {
    runtime: Orchestration;
    caller: ToolCaller;
    catalog: ModelCatalog;
    signal: AbortSignal | undefined;
    workspace?: string;
    context: (toolCallId: string, step?: string) => CommandContext;
    eventsFor: (toolCallId: string, step?: string) => Array<{ type: string; payload: JsonValue }>;
    invokeFunction: (toolCallId: string, name: string, input: JsonValue) => Promise<JsonValue>;
    functionGuidance: (names: readonly string[]) => Promise<string>;
    availableFunctions: () => readonly RunFunction[];
    resolveToolsFor: (actor: Actor, view?: RunView, onUnavailable?: (tool: RunFunction) => void) => Promise<readonly RunFunction[]>;
    /** Only for a direct call of the model: names the model context its result enters; it changes when that context is compacted or replaced. */
    modelContext?: string;
};

export type ToolAvailability = (actor: Actor, view: RunView) => boolean;

export type ToolAvailabilitySummary = {
    availability: "always" | "conditional";
    availabilityDetail: string;
    requiredCapabilities?: readonly CapabilityName[];
};

export type ToolDescriptor = ToolAvailabilitySummary & {
    name: string;
    description: string;
    scope: "global" | "per-agent" | "per-turn";
    nativeTool?: boolean;
};

type CataloguedToolAvailability = ToolAvailability & {
    readonly summary?: ToolAvailabilitySummary;
};

export const defineToolAvailability = (
    summary: ToolAvailabilitySummary,
    available: ToolAvailability,
): ToolAvailability => Object.assign(available, { summary: Object.freeze({ ...summary }) });

export const describeToolAvailability = (available: ToolAvailability): ToolAvailabilitySummary =>
    (available as CataloguedToolAvailability).summary ?? {
        availability: "conditional",
        availabilityDetail: "Die Verfügbarkeit wird für jeden Actor und Run aus dem aktuellen Kontext ermittelt.",
    };

export type ToolExecutionMode = "sequential" | "parallel";

export type RunFunction = {
    name: string;
    label: string;
    description: string;
    longDescription?: string;
    schema: TSchema;
    resultSchema: TSchema;
    available: ToolAvailability;
    run: (scope: ToolScope, toolCallId: string, input: never) => JsonValue | Promise<JsonValue>;
    recordOutput?: (output: JsonValue) => JsonValue;
    executionMode?: ToolExecutionMode;
    nativeTool?: boolean;
};

export const defineRunFunction = <Schema extends TSchema, ResultSchema extends TSchema>(definition: {
    name: string;
    label: string;
    description: string;
    longDescription?: string;
    schema: Schema;
    resultSchema: ResultSchema;
    available: ToolAvailability;
    run: (
        scope: ToolScope,
        toolCallId: string,
        input: Static<Schema>,
    ) => (Static<ResultSchema> & JsonValue) | Promise<Static<ResultSchema> & JsonValue>;
    recordOutput?: (output: Static<ResultSchema> & JsonValue) => JsonValue;
    executionMode?: ToolExecutionMode;
    nativeTool?: boolean;
}): RunFunction => definition as unknown as RunFunction;

const tool = defineRunFunction;

const always = defineToolAvailability({
    availability: "always",
    availabilityDetail: "In jedem Turn verfügbar.",
}, () => true);

export const holdsUsable = (actor: Actor, capability: CapabilityName) =>
    actor.grants.some((grant) => grant.capability === capability && grant.usable !== false);

const needs =
    (capability: CapabilityName): ToolAvailability =>
        defineToolAvailability({
            availability: "conditional",
            availabilityDetail: `Nur mit der Capability ${capability}.`,
            requiredCapabilities: [capability],
        }, (actor) => holdsUsable(actor, capability));

const actorKindSchema = Type.Union([
    Type.Literal("human"),
    Type.Literal("agent"),
    Type.Literal("script"),
]);

const observableEventTypeSchema = literalUnion(observableEventTypes);

const actorListResultSchema = Type.Array(Type.Object({
    id: Type.String(),
    handle: Type.String(),
    displayName: Type.String(),
    kind: actorKindSchema,
    lifecycle: Type.String(),
    createdBy: Type.Union([Type.String(), Type.Null()]),
    description: Type.Union([Type.String(), Type.Null()]),
    toolCount: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], {
        description: "Number of selected tools; 0 is a plain LLM, null an open, dynamically resolved toolset.",
    }),
    toolNames: Type.Optional(Type.Array(Type.String(), { description: "Only with toolNames: true, for a fixed selection." })),
}, { additionalProperties: false }));

const actorReferenceSchema = Type.Object({
    id: Type.String({ description: "Stable actor reference for actor_input and other functions." }),
    handle: Type.String({ description: "Actual unique handle, including any suffix assigned during creation." }),
}, { additionalProperties: false });

const subscriptionBaseSchema = {
    subscriptionId: Type.String({ description: "ID der Subscription; event_unsubscribe nimmt sie als subscriptionId" }),
    subscriberId: Type.String(),
    sourceActorIds: Type.Union([Type.Array(Type.String()), Type.Null()], {
        description: "Quell-Actors als ID; null = alle. ID und @handle sind als Eingabe gleichwertig.",
    }),
    sources: Type.Union([Type.Array(Type.String()), Type.Null()], {
        description: "Dieselben Quellen als @handle, soweit auflösbar; sonst die ID.",
    }),
    sourceActorKinds: Type.Union([Type.Array(actorKindSchema), Type.Null()]),
    eventTypes: Type.Array(Type.String()),
    includeSelf: Type.Boolean(),
    createdBy: Type.String(),
    createdAt: Type.String(),
    createdSequence: Type.Integer(),
};

const subscriptionSchema = Type.Union([
    Type.Object({
        ...subscriptionBaseSchema,
        status: Type.Literal("active"),
    }, { additionalProperties: false }),
    Type.Object({
        ...subscriptionBaseSchema,
        status: Type.Literal("removed"),
        endedAt: Type.String(),
        reason: Type.String(),
    }, { additionalProperties: false }),
    Type.Object({
        ...subscriptionBaseSchema,
        status: Type.Literal("failed"),
        endedAt: Type.String(),
        reason: Type.String(),
        sourceEventId: Type.String(),
    }, { additionalProperties: false }),
]);

const eventSchema = Type.Object({
    eventId: Type.String(),
    runId: Type.String(),
    sequence: Type.Integer(),
    schemaVersion: Type.Literal(3),
    occurredAt: Type.String(),
    actorId: Type.String(),
    commandId: Type.String(),
    correlationId: Type.Union([Type.String(), Type.Null()]),
    causationId: Type.Union([Type.String(), Type.Null()]),
    type: Type.String(),
    payload: Type.Unknown(),
}, { additionalProperties: false });

const artifactSchema = Type.Object({
    id: Type.String(),
    title: Type.String(),
    mediaType: Type.String(),
    size: Type.Integer({ minimum: 0 }),
    previousVersionId: Type.Union([Type.String(), Type.Null()]),
    createdBy: Type.String(),
    createdAt: Type.String(),
}, { additionalProperties: false });

const artifactReadResultSchema = Type.Object({
    artifact: artifactSchema,
    encoding: Type.Union([Type.Literal("utf8"), Type.Literal("base64")]),
    content: Type.String(),
}, { additionalProperties: false });

const profileBaseSchema = {
    name: Type.String(),
    description: Type.String(),
    turnTimeoutMs: Type.Union([Type.Integer(), Type.Null()]),
    isolateWorkspace: Type.Boolean(),
};

const modelListResultSchema = Type.Object({
    profiles: Type.Array(Type.Union([
        Type.Object({
            ...profileBaseSchema,
            driver: Type.Union([Type.Literal("manual"), Type.Literal("script")]),
        }, { additionalProperties: false }),
        Type.Object({
            ...profileBaseSchema,
            driver: Type.Literal("agent"),
            provider: Type.String(),
            model: Type.String(),
            thinking: Type.Optional(Type.String()),
        }, { additionalProperties: false }),
    ])),
    models: Type.Array(Type.Object({
        driver: Type.String(),
        provider: Type.String(),
        model: Type.String(),
        label: Type.String(),
        thinking: Type.Array(Type.String(), {
            description: "Denkstufen, die agent_spawn für dieses Modell annimmt.",
        }),
    }, { additionalProperties: false })),
}, { additionalProperties: false });

const executionSchema = {
    profile: Type.Optional(Type.String({
        minLength: 1,
        description: "Execution profile from model_list. Normally supply this field: an LLM agent needs a model-bearing profile or an explicit model. The caller's model is not inherited.",
    })),
    driver: Type.Optional(driverKindSchema),
    provider: Type.Optional(Type.String({
        minLength: 1,
        description: "Provider from model_list for an explicit model selection; may be omitted when the profile or an unambiguous catalog entry supplies it.",
    })),
    model: Type.Optional(Type.String({
        minLength: 1,
        description: "Model from model_list. Required for an LLM agent unless profile supplies a model; also overrides the profile's model.",
    })),
    thinking: Type.Optional(Type.Union(thinkingLevels.map((level) => Type.Literal(level)))),
    turnTimeoutMs: Type.Optional(Type.Integer({ minimum: 1_000 })),
    isolateWorkspace: Type.Optional(Type.Boolean()),
};

const handleLabelOf = (view: RunView, actorId: string) => {
    const found = view.actors.find((entry) => entry.id === actorId);

    return found ? `@${found.handle}` : actorId;
};

const subscriptionView = (view: RunView, subscription: EventSubscription) => {
    const { id, ...rest } = subscription;

    return {
        ...rest,
        subscriptionId: id,
        sourceActorIds: subscription.sourceActorIds ? [...subscription.sourceActorIds] : null,
        sources: subscription.sourceActorIds
            ? subscription.sourceActorIds.map((actorId) => handleLabelOf(view, actorId))
            : null,
        sourceActorKinds: subscription.sourceActorKinds ? [...subscription.sourceActorKinds] : null,
        eventTypes: [...subscription.eventTypes],
    };
};

const subscriptionCreatedSchema = Type.Object({
    subscriptionId: Type.String({ description: "ID der Subscription; event_unsubscribe nimmt sie als subscriptionId" }),
    sources: Type.Union([Type.Array(Type.String()), Type.Null()], {
        description: "Die aufgelösten Quell-Actors als @handle, soweit auflösbar, sonst als ID; null = alle.",
    }),
}, { additionalProperties: false });

const acknowledgementSchema = Type.Null({ description: "Erledigt; ein Fehler wirft." });

const subscriptionResult = (runtime: Orchestration, runId: string, commandId: string) => {
    const created = runtime.events(runId).findLast(
        (event) => event.commandId === commandId && event.type === "subscription.created",
    );

    if (!created || created.type !== "subscription.created")
        throw new Error("The subscription was not created.");

    const subscription = runtime.listSubscriptions(runId).find((entry) => entry.id === created.payload.subscriptionId);

    if (!subscription)
        throw new Error(`Subscription ${created.payload.subscriptionId} does not exist after creation.`);

    const { subscriptionId, sources } = subscriptionView(runtime.view(runId), subscription);

    return { subscriptionId, sources };
};

export const agentTools: RunFunction[] = [
    tool({
        name: "actor_list",
        label: "List Actors",
        description: "List existing actors with their identity, lifecycle and the size of their function selection.",
        longDescription: "Check before spawning: reuse suitable participants, including actors created by a setup or another actor. Only kind agent is a conversational partner. A script executes its programmed input protocol; it does not interpret arbitrary natural-language requests. Inspect its documented functions or program before using it. toolNames: true also lists the names of each fixed selection.",
        schema: Type.Object({
            toolNames: Type.Optional(Type.Boolean({ description: "Also list the tool names of each actor with a fixed selection." })),
        }, { additionalProperties: false }),
        resultSchema: actorListResultSchema,
        available: needs("actor.input"),
        run: ({ runtime, caller }, _toolCallId, input) => runtime.view(caller.runId).actors.map((actor) => {
            const selected = actor.kind === "human" ? null : actor.toolNames;
            return {
                id: actor.id,
                handle: actor.handle,
                displayName: actor.displayName,
                kind: actor.kind,
                lifecycle: actor.kind === "human" ? "human" : actor.lifecycle.kind,
                createdBy: actor.kind === "human" ? null : actor.createdBy,
                description: actor.kind === "human" ? null : actor.description,
                toolCount: selected === null ? null : selected.length,
                ...(input.toolNames && selected !== null ? { toolNames: [...selected] } : {}),
            };
        }),
    }),
    tool({
        name: "actor_input",
        label: "Enqueue Actor Input",
        description: "Enqueue plain text and optional artifacts for one actor. The actor receives no routing envelope.",
        longDescription: "This only confirms enqueueing, not processing, an answer or completion. An agent in the middle of a turn receives the text in that turn before its next model request; otherwise it starts the agent's next turn. Agents interpret natural language. TypeScript actors only process their programmed input protocol: use their documented functions, or send an exact supported program input after inspecting the program. Never address an unknown script with a natural-language task or assume an idle or completed turn means the requested work happened.",
        schema: actorInputSchema,
        resultSchema: eventResultSchemaOf("actor.input.enqueued"),
        available: needs("actor.input"),
        run: ({ runtime, caller, context }, toolCallId, input) =>
            enqueueActorInput(runtime, context(toolCallId), caller.runId, input),
    }),
    tool({
        name: "event_subscribe",
        label: "Subscribe to Events",
        description: "Subscribe this actor to run events delivered as later ActorInputs.",
        longDescription: "Source actors may be named by id or handle. Matching observable events arrive as new ActorInputs for this actor.",
        schema: Type.Object({
            sourceActorIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
            sourceActorKinds: Type.Optional(Type.Array(actorKindSchema, { uniqueItems: true })),
            eventTypes: Type.Array(observableEventTypeSchema, { minItems: 1, uniqueItems: true }),
            includeSelf: Type.Optional(Type.Boolean()),
        }, { additionalProperties: false }),
        resultSchema: subscriptionCreatedSchema,
        available: needs("event.subscribe"),
        run: ({ runtime, caller, context }, toolCallId, input) => {
            const command = context(toolCallId);
            const view = runtime.view(caller.runId);
            const sourceActorIds = input.sourceActorIds
                ? [...new Set(input.sourceActorIds.map((reference) => addressedActorOf(view.actors, reference).id))]
                : null;
            runtime.createSubscription(command, caller.runId, {
                subscriberId: caller.actorId,
                sourceActorIds,
                sourceActorKinds: input.sourceActorKinds ?? null,
                eventTypes: input.eventTypes,
                includeSelf: input.includeSelf ?? false,
            });

            return subscriptionResult(runtime, caller.runId, command.commandId);
        },
    }),
    tool({
        name: "event_unsubscribe",
        label: "Remove Event Subscription",
        description: "Remove one event subscription owned by this actor.",
        schema: Type.Object({
            subscriptionId: Type.String({ minLength: 1, description: "subscriptionId aus event_subscribe oder event_subscription_list" }),
            reason: Type.String({ minLength: 1 }),
        }, { additionalProperties: false }),
        resultSchema: acknowledgementSchema,
        available: needs("event.subscribe"),
        run: ({ runtime, caller, context }, toolCallId, input) => {
            runtime.removeSubscription(context(toolCallId), caller.runId, input.subscriptionId, input.reason);

            return null;
        },
    }),
    tool({
        name: "event_subscription_list",
        label: "List Event Subscriptions",
        description: "List this actor's event subscriptions, including inactive and failed ones.",
        schema: Type.Object({}, { additionalProperties: false }),
        resultSchema: Type.Array(subscriptionSchema),
        available: needs("event.subscribe"),
        run: ({ runtime, caller }) => {
            const view = runtime.view(caller.runId);

            return runtime
                .listSubscriptions(caller.runId, caller.actorId)
                .map((subscription) => subscriptionView(view, subscription));
        },
    }),
    tool({
        name: "event_query",
        label: "Query Events",
        description: "Read journal events in this run, optionally filtered by event ID, actor or event type.",
        schema: Type.Object({
            eventIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
            actorIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
            eventTypes: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
                uniqueItems: true,
                description:
                    "Jeder Journal-Eventtyp ist abfragbar. Abonnierbar sind nur die observable Typen; "
                    + "event_subscribe zeigt sie.",
            })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
        }, { additionalProperties: false }),
        resultSchema: Type.Array(eventSchema),
        available: needs("event.subscribe"),
        run: ({ runtime, caller }, _toolCallId, input) => {
            const view = runtime.view(caller.runId);
            const eventIds = input.eventIds ? new Set(input.eventIds) : null;
            const actorIds = input.actorIds
                ? new Set(input.actorIds.map((reference) => addressedActorOf(view.actors, reference).id))
                : null;
            const eventTypes = input.eventTypes ? new Set(input.eventTypes) : null;

            return runtime.events(caller.runId)
                .filter((event) => !eventIds || eventIds.has(event.eventId))
                .filter((event) => !actorIds || actorIds.has(event.actorId))
                .filter((event) => !eventTypes || eventTypes.has(event.type))
                .slice(-(input.limit ?? 100));
        },
    }),
    tool({
        name: "artifact_read",
        label: "Read Artifact",
        description: "Read an artifact created by this actor or attached to one of its inputs. The run owner may read every artifact.",
        schema: Type.Object({ artifactId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        resultSchema: artifactReadResultSchema,
        available: always,
        run: ({ runtime, caller }, _toolCallId, input) => {
            const { artifact: { hash, ...artifact }, content } = runtime.artifactContent(
                caller.runId,
                input.artifactId,
                caller.actorId,
            );
            const textual = artifact.mediaType.startsWith("text/")
                || artifact.mediaType.includes("json")
                || artifact.mediaType.includes("xml");

            return {
                artifact,
                encoding: textual ? "utf8" as const : "base64" as const,
                content: Buffer.from(content).toString(textual ? "utf8" : "base64"),
            };
        },
        recordOutput: (output) => {
            const result = output as { artifact: { id: string; size: number }; encoding: string };

            return {
                artifactId: result.artifact.id,
                size: result.artifact.size,
                encoding: result.encoding,
            };
        },
    }),
    tool({
        name: "model_list",
        label: "List Models and Profiles",
        description: "List the execution profiles and provider models available for agent_spawn.",
        schema: Type.Object({ driver: Type.Optional(driverKindSchema) }, { additionalProperties: false }),
        resultSchema: modelListResultSchema,
        available: needs("agent.spawn"),
        run: async ({ catalog }, _toolCallId, input) => {
            const models = await catalog.models();
            const listed = input.driver ? models.filter((entry) => entry.driver === input.driver) : models;

            return {
                profiles: [...catalog.profiles()],
                models: listed.map((entry) => ({ ...entry, thinking: [...entry.thinking] })),
            };
        },
    }),
    tool({
        name: "action_propose",
        label: "Propose Action",
        description: "Propose an action for explicit human approval. This never executes the action directly.",
        schema: Type.Object({
            title: Type.String({ minLength: 1 }),
            description: Type.Optional(Type.String()),
            parameters: Type.Optional(namedValuesSchema),
            input: Type.Optional(Type.Object({
                label: Type.String({ minLength: 1 }),
                placeholder: Type.Optional(Type.String()),
                required: Type.Boolean(),
            }, { additionalProperties: false })),
        }, { additionalProperties: false }),
        resultSchema: eventResultSchemaOf("action.proposed"),
        available: needs("action.propose"),
        run: ({ runtime, caller, context, eventsFor }, toolCallId, input) => {
            runtime.proposeAction(context(toolCallId), caller.runId, {
                title: input.title,
                description: input.description ?? null,
                parameters: recordOf(input.parameters),
                input: input.input
                    ? {
                        label: input.input.label,
                        placeholder: input.input.placeholder ?? null,
                        required: input.input.required,
                    }
                    : null,
            });

            return eventsFor(toolCallId);
        },
    }),
    tool({
        name: "agent_spawn",
        label: "Spawn Agent",
        description: "Create an idle LLM agent with an explicit model or profile and function selection.",
        longDescription:
            "Create a new idle agent only when no existing actor fits the required role. Check actor_list first when available; actor_input reuses an existing actor. "
            + "Read model_list before the first spawn and pass a model-bearing profile, or an explicit model selection from that catalog. handle and prompt alone cannot create an LLM agent; the caller's model is not inherited. "
            + "It inherits delegable capabilities, but tools is required and never inherited: select exact names, [] for text-only work, or explicit null for an open, dynamically resolved toolset. "
            + "An empty tools array creates a plain LLM with no runtime, workspace or host tools; "
            + "drivers without plain-LLM isolation are rejected. "
            + "forkOf copies the model context of an existing LLM agent of this run into the new agent at its first turn: the copy ends before any unfinished tool call and carries no reasoning; the new agent still gets its own prompt, tools and model.",
        schema: Type.Object({
            handle: Type.String({ minLength: 1 }),
            displayName: Type.Optional(Type.String({ minLength: 1, description: "Anzeigename; ohne Angabe der Handle" })),
            description: Type.Optional(Type.String({ minLength: 1, maxLength: actorDescriptionMaxLength, description: "Sehr kurze Beschreibung der Aufgabe für die Übersicht der Beteiligten, wenige Wörter wie \"prüft die Regel zu Kommentaren\"" })),
            prompt: Type.String(),
            forkOf: Type.Optional(Type.String({ minLength: 1, description: "Handle oder ID eines LLM-Agenten dieses Runs, dessen bisheriger Modellkontext in den neuen Agenten kopiert wird" })),
            tools: Type.Union([Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }), Type.Null()], { description: "Required explicit selection: [] for plain text-only work including app-mediated conversations; an array for exact existing tool names; null only when the task needs an open, dynamically resolved toolset. Never inherits the caller's tools. Names of future, not yet activated actor functions are invalid; choose null when those must become available later." }),
            withoutCapabilities: Type.Optional(Type.Array(capabilitySchema, { uniqueItems: true })),
            ...executionSchema,
        }, { additionalProperties: false }),
        resultSchema: actorReferenceSchema,
        available: needs("agent.spawn"),
        run: async ({ runtime, caller, catalog, context, eventsFor, resolveToolsFor }, toolCallId, input) => {
            const executionId = `agent_${toolCallId}`;
            const execution = resolveExecution(catalog, input, executionId, await catalog.models());
            const actor = addressedActorOf(runtime.view(caller.runId).actors, caller.actorId);

            if (actor.kind === "human")
                throw new Error(`Actor ${caller.actorId} cannot call agent_spawn from a turn.`);

            if (input.tools !== null && input.tools.length > 0) {
                const view = runtime.view(caller.runId);
                const known = new Set<string>();
                const candidates = [actor, ...view.actors.filter((candidate) => candidate.kind !== "human" && candidate.lifecycle.kind !== "stopped" && candidate.id !== actor.id)];
                for (const candidate of candidates) {
                    const resolved = await resolveToolsFor(candidate, view, (entry) => known.add(entry.name));
                    resolved.forEach((entry) => known.add(entry.name));
                    if (input.tools.every((name) => known.has(name))) break;
                }
                const unknown = input.tools.filter((name) => !known.has(name));
                if (unknown.length > 0)
                    throw new Error(`Unknown agent tools: ${unknown.join(", ")}. Existing names: ${[...known].sort().join(", ")}. Use tools: [] for text-only work or tools: null for an explicitly dynamic toolset including future actor functions.`);
            }

            runtime.spawnAgent(context(toolCallId), caller.runId, {
                handle: input.handle,
                displayName: input.displayName ?? input.handle,
                ...(input.description === undefined ? {} : { description: input.description }),
                prompt: input.prompt,
                execution,
                grants: inheritedGrants(actor, input.withoutCapabilities),
                toolNames: input.tools,
                ...(input.forkOf === undefined ? {} : { forkOf: input.forkOf }),
            });

            const created = eventsFor(toolCallId).find((event) => event.type === "agent.spawned");
            const id = created?.payload && typeof created.payload === "object" && "agentId" in created.payload
                ? created.payload.agentId : null;
            const spawned = runtime.view(caller.runId).actors.find((entry) => entry.id === id);
            if (!spawned) throw new Error("The spawned actor is missing after creation.");
            return { id: spawned.id, handle: spawned.handle };
        },
    }),
    tool({
        name: "run_configure",
        label: "Configure Run",
        description:
            "Set the run title and/or choose the primary actor the chat talks to. Give title, primaryActor or both; "
            + "the primary actor must be an active agent or TypeScript actor of this run.",
        schema: Type.Object({
            title: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "Neuer Titel des Runs" })),
            primaryActor: Type.Optional(Type.String({
                minLength: 1,
                description: "Handle oder ID des Actors, mit dem der Chat des Benutzers spricht",
            })),
        }, { additionalProperties: false }),
        resultSchema: acknowledgementSchema,
        available: needs("run.configure"),
        run: ({ runtime, caller, context }, toolCallId, input) => {
            if (input.title === undefined && input.primaryActor === undefined)
                throw new Error("run_configure braucht title oder primaryActor; gültig sind { title }, { primaryActor } und beides zusammen.");

            if (input.title !== undefined)
                runtime.retitleRun(context(toolCallId, "title"), caller.runId, input.title);

            if (input.primaryActor !== undefined) {
                const target = addressedActorOf(runtime.view(caller.runId).actors, input.primaryActor);

                if (target.kind === "human")
                    throw new Error(`${input.primaryActor} is not an executable actor.`);

                runtime.selectPrimaryActor(context(toolCallId, "primary"), caller.runId, target.id);
            }

            return null;
        },
    }),
    tool({
        name: "actor_restart",
        label: "Restart Actor",
        description: "Restart a stopped actor in this actor's branch. It resumes with its full history; the LLM is stateless.",
        schema: Type.Object({
            actorId: Type.String({ minLength: 1, description: "Handle oder ID" }),
            reason: Type.String({ minLength: 1 }),
        }, { additionalProperties: false }),
        resultSchema: eventResultSchemaOf("actor.restarted", "run.primary-actor-selected"),
        available: needs("execution.stopOwned"),
        run: ({ runtime, caller, context, eventsFor }, toolCallId, input) => {
            const target = addressedActorOf(runtime.view(caller.runId).actors, input.actorId);

            if (target.kind === "human")
                throw new Error(`${input.actorId} is not an executable actor.`);

            runtime.restartActor(context(toolCallId), caller.runId, target.id, input.reason);

            return eventsFor(toolCallId);
        },
    }),
    tool({
        name: "actor_stop",
        label: "Stop Actor",
        description: "Stop an actor in this actor's branch together with its active descendants.",
        schema: Type.Object({
            actorId: Type.String({ minLength: 1, description: "Handle oder ID" }),
            reason: Type.String({ minLength: 1 }),
        }, { additionalProperties: false }),
        resultSchema: eventResultSchemaOf("turn.interrupted", "actor.stopped", "subscription.removed"),
        available: needs("execution.stopOwned"),
        run: ({ runtime, caller, context, eventsFor }, toolCallId, input) => {
            const target = addressedActorOf(runtime.view(caller.runId).actors, input.actorId);

            if (target.kind === "human")
                throw new Error(`${input.actorId} is not an executable actor.`);
            if (target.id === caller.actorId)
                throw new Error("An actor cannot stop itself; whoever created it decides that.");

            runtime.stopActor(context(toolCallId), caller.runId, target.id, input.reason);

            return eventsFor(toolCallId);
        },
    }),
    tool({
        name: "artifact_publish",
        label: "Publish Artifact",
        description: "Publish immutable text content to the run artifact store.",
        schema: Type.Object({
            title: Type.String({ minLength: 1 }),
            mediaType: Type.String({ minLength: 1 }),
            content: Type.String(),
            previousVersionId: Type.Optional(Type.String({ minLength: 1 })),
        }, { additionalProperties: false }),
        resultSchema: eventResultSchemaOf("artifact.published"),
        available: needs("artifact.publish"),
        run: ({ runtime, caller, context, eventsFor }, toolCallId, input) => {
            runtime.publishArtifact(context(toolCallId), caller.runId, {
                ...input,
                previousVersionId: input.previousVersionId ?? null,
            });

            return eventsFor(toolCallId);
        },
    }),
];

export const modelToolDescriptors: readonly ToolDescriptor[] = agentTools.map((entry) => ({
    name: entry.name,
    description: entry.description,
    scope: "per-turn",
    nativeTool: entry.nativeTool === true,
    ...describeToolAvailability(entry.available),
}));

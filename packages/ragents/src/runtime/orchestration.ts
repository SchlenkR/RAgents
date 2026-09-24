import type { JournalEvent, UncommittedEvent } from "../domain/events.ts";
import { assertJsonValue, type JsonObject, type JsonValue } from "../domain/json.ts";
import type {
    ActionInput,
    ActionStatus,
    ActorKind,
    AgentExecution,
    CapabilityGrant,
    ObservableEventType,
    PluginStateScope,
    RunState,
    TurnUsage,
} from "../domain/model.ts";
import { project, viewOf } from "../domain/projection.ts";
import { capabilityNames } from "../domain/vocabulary.ts";
import { MemoryArtifactContents, type ArtifactContents } from "./artifacts.ts";
import { event, journalCommand, type CommandContext, type Decision } from "./command.ts";
import * as actions from "./decisions/actions.ts";
import * as actors from "./decisions/actors.ts";
import * as artifacts from "./decisions/artifacts.ts";
import * as inputs from "./decisions/inputs.ts";
import * as subscriptions from "./decisions/subscriptions.ts";
import * as turns from "./decisions/turns.ts";
import { DomainError } from "./domain-error.ts";
import {
    actorById,
    commandActorOf,
    addressedActorOf,
    assertArtifactRead,
    assertCapability,
    artifactOf,
    clean,
    executableActorOf,
    handleOf,
    turnOf,
} from "./guards.ts";
import { journalFormatVersion, sameJournalCommand, type CommandRecord, type Journal } from "./journal.ts";
import type { RuntimeServices } from "./services.ts";

export type { CommandContext } from "./command.ts";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export class Orchestration {
    readonly #journal: Journal;
    readonly #services: RuntimeServices;
    readonly #artifactContents: ArtifactContents;
    readonly #suppressedSubscriptionRuns = new Set<string>();

    constructor(journal: Journal, services: RuntimeServices, artifactContents: ArtifactContents = new MemoryArtifactContents()) {
        this.#journal = journal;
        this.#services = services;
        this.#artifactContents = artifactContents;
        this.#journal.subscribe((events) => {
            this.#dispatchSubscriptions(events);
            this.#dispatchCreatorAlerts(events);
        });
        this.#interruptOpenTurns();
    }

    listRuns() {
        return this.#journal.runIds().map((runId) => {
            const state = this.state(runId);

            return {
                id: state.id,
                revision: state.revision,
                title: state.title,
                createdAt: state.createdAt,
                forkedFrom: state.forkedFrom,
                actors: state.actors.size,
            };
        });
    }

    get actorProgramLifecycle() { return this.#services.actorPrograms; }

    now(): string { return this.#services.now(); }

    get actorPrograms() {
        const programs = this.#services.actorPrograms;
        if (!programs) throw new Error("Für diese Laufzeit fehlt der Actor-Program-Executor.");
        return programs;
    }

    get nativeTypeScriptExecutor() {
        const executor = this.#services.nativeTypeScriptExecutor;
        if (!executor) throw new Error("Für diese Laufzeit fehlt der native TypeScript-Executor.");
        return executor;
    }

    events(runId: string) {
        return this.#journal.load(runId);
    }

    subscribe(listener: (events: JournalEvent[]) => void) {
        return this.#journal.subscribe(listener);
    }

    state(runId: string): RunState {
        this.#journal.assertRunAvailable(runId);
        const state = this.#journal.stateOf(runId);

        if (!state)
            throw new DomainError("run-not-found", `Run ${runId} does not exist.`, 404);

        return state;
    }

    view(runId: string) {
        return viewOf(this.state(runId));
    }

    viewAt(runId: string, sequence: number) {
        const state = this.state(runId);

        if (sequence >= state.revision)
            return viewOf(state);

        const replayed = project(this.#journal.load(runId).filter((entry) => entry.sequence <= sequence));

        if (!replayed)
            throw new DomainError("invalid-sequence", `Run ${runId} has no state at sequence ${sequence}.`, 400);

        return viewOf(replayed);
    }

    assertActorTurn(runId: string, actorId: string, turnId: string) {
        commandActorOf(this.state(runId), { actorId, turnId });
    }

    createRun(
        context: Omit<CommandContext, "actorId">,
        input: {
            title: string;
            ownerHandle: string;
            ownerDisplayName: string;
            /** Der angemeldete Benutzer, dem der Run gehört; ohne Anmeldung bleibt er offen. */
            ownerUserId?: string;
            runId?: string;
            initialPluginStates?: readonly { pluginId: string; state: JsonValue }[];
        },
    ) {
        const existing = this.#journal.creationCommand(context.commandId);
        const ownerId = existing?.command.actorId ?? this.#services.newId("human");
        const command = journalCommand(context.commandId, "run.create", ownerId, input);

        if (existing) {
            if (!sameJournalCommand(existing.command, command))
                throw new DomainError("command-id-collision", `Command ID ${context.commandId} was already used for another command.`, 409);

            return this.view(existing.runId);
        }

        if (input.runId && this.#journal.stateOf(input.runId))
            throw new DomainError("run-exists", `Run ${input.runId} already exists.`, 409);

        const runId = input.runId ?? this.#services.newId("run");
        const commandContext = { ...context, actorId: ownerId };
        const initialPluginStates = (input.initialPluginStates ?? []).map((entry) => {
            assertJsonValue(entry.state, "initial plugin state");

            return {
                pluginId: clean(entry.pluginId, "pluginId"),
                state: entry.state,
            };
        });

        this.#journal.append(runId, command, [
            event(commandContext, {
                type: "run.created",
                payload: {
                    title: clean(input.title, "title"),
                    owner: {
                        id: ownerId,
                        handle: handleOf(input.ownerHandle),
                        displayName: clean(input.ownerDisplayName, "ownerDisplayName"),
                        grants: capabilityNames.map((capability): CapabilityGrant => ({
                            capability,
                            scope: { kind: "run" },
                            delegable: true,
                        })),
                        ...input.ownerUserId === undefined ? {} : { userId: clean(input.ownerUserId, "ownerUserId") },
                    },
                },
            }),
            ...initialPluginStates.map((entry) => event(commandContext, {
                type: "plugin.state-replaced" as const,
                payload: {
                    pluginId: entry.pluginId,
                    scope: { kind: "run" as const },
                    state: entry.state,
                },
            })),
        ]);

        return this.view(runId);
    }

    forkRun(context: Omit<CommandContext, "actorId">, sourceRunId: string, sequence: number) {
        const source = this.state(sourceRunId);
        const command = journalCommand(context.commandId, "run.fork", source.ownerId, { sourceRunId, sequence });
        const existingRunId = this.#journal.findCommandRun(context.commandId);

        if (existingRunId) {
            const existing = this.#journal.commandFor(existingRunId, context.commandId);

            if (!existing || !sameJournalCommand(existing, command))
                throw new DomainError("command-id-collision", `Command ID ${context.commandId} was already used for another command.`, 409);

            return this.view(existingRunId);
        }

        if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > source.revision)
            throw new DomainError("invalid-sequence", `Run ${sourceRunId} has no sequence ${sequence}.`, 400);

        const records = this.#journal.records(sourceRunId);
        const boundaryIndex = records.findIndex((record) => record.events.at(-1)?.sequence === sequence);

        if (boundaryIndex < 0)
            throw new DomainError(
                "invalid-sequence",
                `Run ${sourceRunId} sequence ${sequence} is not a command boundary and cannot be forked.`,
                400,
            );

        const kept = records.slice(0, boundaryIndex + 1);
        const boundaryState = project(kept.flatMap((record) => record.events));
        const runningActor = [...(boundaryState?.actors.values() ?? [])]
            .find((actor) => actor.kind !== "human" && actor.lifecycle.kind === "running");

        if (runningActor)
            throw new DomainError(
                "invalid-sequence",
                `Run ${sourceRunId} sequence ${sequence} has an open turn and cannot be forked.`,
                400,
            );

        const runId = this.#services.newId("run");
        const eventIds = new Map(
            kept.flatMap((record) => record.events.map((entry) => [entry.eventId, this.#services.newId("event")])),
        );
        const rewriteReference = (value: string | null) => value === null ? null : eventIds.get(value) ?? value;
        const rewriteEventId = (value: string) => {
            const rewritten = eventIds.get(value);

            if (!rewritten)
                throw new Error(`Fork source event ${value} is not part of the inherited history.`);

            return rewritten;
        };
        const rewriteEvent = (entry: JournalEvent): JournalEvent => {
            const identities = {
                runId,
                eventId: rewriteEventId(entry.eventId),
                commandId: `${runId}:${entry.commandId}`,
                correlationId: rewriteReference(entry.correlationId),
                causationId: rewriteReference(entry.causationId),
            };

            if (entry.type === "actor.input.enqueued") {
                const payload = entry.payload;

                return {
                    ...entry,
                    ...identities,
                    payload: payload.subscriptionId === null
                        ? { ...payload, sourceEventIds: payload.sourceEventIds.map(rewriteEventId) }
                        : {
                            ...payload,
                            sourceEventIds: [
                                rewriteEventId(payload.sourceEventIds[0]),
                            ],
                        },
                };
            }

            if (entry.type === "subscription.failed") {
                return {
                    ...entry,
                    ...identities,
                    payload: {
                        ...entry.payload,
                        sourceEventId: rewriteEventId(entry.payload.sourceEventId),
                    },
                };
            }

            return { ...entry, ...identities };
        };
        const rewritten: CommandRecord[] = kept.map((record) => ({
            formatVersion: journalFormatVersion,
            runId,
            command: { ...record.command, id: `${runId}:${record.command.id}` },
            events: record.events.map(rewriteEvent),
        }));
        const lastSequence = rewritten.at(-1)?.events.at(-1)?.sequence ?? 0;
        const marker = event(
            { ...context, actorId: source.ownerId },
            { type: "run.forked" as const, payload: { sourceRunId, sourceSequence: sequence } },
        );

        this.#suppressedSubscriptionRuns.add(runId);

        try {
            this.#journal.adopt([
                ...rewritten,
                {
                    formatVersion: journalFormatVersion,
                    runId,
                    command,
                    events: [
                        {
                            ...marker,
                            eventId: this.#services.newId("event"),
                            runId,
                            sequence: lastSequence + 1,
                            schemaVersion: journalFormatVersion,
                            occurredAt: this.#services.now(),
                            commandId: context.commandId,
                        },
                    ],
                },
            ]);
        } finally {
            this.#suppressedSubscriptionRuns.delete(runId);
        }

        return this.view(runId);
    }

    selectPrimaryActor(context: CommandContext, runId: string, actorId: string) {
        return this.#run(context, runId, "run.primary-actor.select", { actorId }, actors.selectPrimaryActor(actorId));
    }

    retitleRun(context: CommandContext, runId: string, title: string) {
        return this.#run(context, runId, "run.retitle", { title }, actors.retitleRun(title));
    }

    spawnAgent(
        context: CommandContext,
        runId: string,
        input: {
            handle: string;
            displayName: string;
            prompt: string;
            execution: AgentExecution;
            grants: readonly CapabilityGrant[];
            toolNames: readonly string[] | null;
            forkOf?: string;
        },
    ) {
        return this.#run(context, runId, "agent.spawn", input, actors.spawnAgent(input));
    }

    createScriptActor(
        context: CommandContext,
        runId: string,
        input: {
            handle: string;
            displayName: string;
            grants: readonly CapabilityGrant[];
            toolNames: readonly string[] | null;
            turnTimeoutMs?: number | null;
        },
    ) {
        return this.#run(context, runId, "script.create", input, actors.createScriptActor(input));
    }

    enqueueInput(
        context: CommandContext,
        runId: string,
        input: inputs.EnqueueInput,
    ) {
        return this.#run(context, runId, "actor.input.enqueue", input, inputs.enqueueInput(input));
    }

    startTurn(context: CommandContext, runId: string, actorId: string, inputId: string) {
        return this.#run(context, runId, "turn.start", { actorId, inputId }, turns.startTurn(actorId, inputId));
    }

    steerInputs(context: CommandContext, runId: string, actorId: string, input: { turnId: string; inputIds: readonly string[] }) {
        return this.#run(context, runId, "turn.steer", { actorId, ...input }, turns.steerInputs(actorId, input));
    }

    appendModelOutput(context: CommandContext, runId: string, actorId: string, input: { turnId: string; text: string }) {
        return this.#run(context, runId, "model.output.complete", { actorId, ...input }, turns.appendModelOutput(actorId, input));
    }

    appendInterruptedModelOutput(context: CommandContext, runId: string, actorId: string, input: { turnId: string; text: string }) {
        return this.#run(context, runId, "model.output.interrupt", { actorId, ...input }, turns.appendInterruptedModelOutput(actorId, input));
    }

    appendModelReasoning(context: CommandContext, runId: string, actorId: string, input: { turnId: string; text: string }) {
        return this.#run(context, runId, "model.reasoning.complete", { actorId, ...input }, turns.appendModelReasoning(actorId, input));
    }

    appendRuntimeOutput(context: CommandContext, runId: string, actorId: string, input: { turnId: string; text: string }) {
        return this.#run(context, runId, "runtime.output.record", { actorId, ...input }, turns.appendRuntimeOutput(actorId, input));
    }

    startToolCall(
        context: CommandContext,
        runId: string,
        actorId: string,
        input: { turnId: string; toolCallId: string; name: string; input: JsonValue; ignoredFields?: string[] },
    ) {
        assertJsonValue(input.input, "tool input");
        return this.#run(context, runId, "tool.call.start", { actorId, ...input }, turns.startToolCall(actorId, input));
    }

    completeToolCall(
        context: CommandContext,
        runId: string,
        actorId: string,
        input: { turnId: string; toolCallId: string; name: string; output: JsonValue },
    ) {
        assertJsonValue(input.output, "tool output");
        return this.#run(context, runId, "tool.call.complete", { actorId, ...input }, turns.completeToolCall(actorId, input));
    }

    recordToolCallSource(
        context: CommandContext,
        runId: string,
        actorId: string,
        input: { turnId: string; toolCallId: string; code: string; path: string | null },
    ) {
        return this.#run(context, runId, "tool.call.source", { actorId, ...input }, turns.recordToolCallSource(actorId, input));
    }

    failToolCall(
        context: CommandContext,
        runId: string,
        actorId: string,
        input: { turnId: string; toolCallId: string; name: string; error: string },
    ) {
        return this.#run(context, runId, "tool.call.fail", { actorId, ...input }, turns.failToolCall(actorId, input));
    }

    finishTurn(
        context: CommandContext,
        runId: string,
        actorId: string,
        input: { turnId: string; usage?: TurnUsage }
            & ({ outcome: "completed" } | { outcome: "failed"; reason: string }),
    ) {
        return this.#run(context, runId, "turn.finish", { actorId, ...input }, turns.finishTurn(actorId, input));
    }

    interruptTurn(
        context: CommandContext,
        runId: string,
        actorId: string,
        input: { turnId: string; reason: string },
    ) {
        return this.#run(context, runId, "turn.interrupt", { actorId, ...input }, turns.interruptTurn(actorId, input));
    }

    createSubscription(
        context: CommandContext,
        runId: string,
        input: {
            subscriberId: string;
            sourceActorIds?: readonly string[] | null;
            sourceActorKinds?: readonly ActorKind[] | null;
            eventTypes: readonly ObservableEventType[];
            includeSelf?: boolean;
        },
    ) {
        return this.#run(context, runId, "subscription.create", input, subscriptions.createSubscription(input));
    }

    removeSubscription(context: CommandContext, runId: string, subscriptionId: string, reason: string) {
        return this.#run(
            context,
            runId,
            "subscription.remove",
            { subscriptionId, reason },
            subscriptions.removeSubscription(subscriptionId, reason),
        );
    }

    listSubscriptions(runId: string, subscriberId?: string) {
        const state = this.state(runId);
        const resolved = subscriberId ? addressedActorOf(state.actors.values(), subscriberId).id : null;

        return [...state.subscriptions.values()].filter((subscription) => !resolved || subscription.subscriberId === resolved);
    }

    proposeAction(
        context: CommandContext,
        runId: string,
        input: {
            owner?: string | null;
            title: string;
            description?: string | null;
            parameters?: Record<string, string>;
            input?: ActionInput | null;
            payload?: JsonObject | null;
        },
    ) {
        return this.#run(context, runId, "action.propose", input, actions.proposeAction(input));
    }

    resolveAction(
        context: CommandContext,
        runId: string,
        actionId: string,
        input: { decision: Exclude<ActionStatus, "pending">; result?: JsonValue | null },
    ) {
        return this.#run(context, runId, "action.resolve", { actionId, ...input }, actions.resolveAction(actionId, input));
    }

    restartActor(context: CommandContext, runId: string, actorId: string, reason: string) {
        return this.#run(context, runId, "actor.restart", { actorId, reason }, actors.restartActor(actorId, reason));
    }

    stopActor(context: CommandContext, runId: string, actorId: string, reason: string) {
        return this.#run(context, runId, "actor.stop", { actorId, reason }, actors.stopActor(actorId, reason));
    }

    stopActors(context: CommandContext, runId: string, actorIds: readonly string[], reason: string) {
        return this.#run(context, runId, "actors.stop", { actorIds, reason }, actors.stopActors(actorIds, reason));
    }

    replacePluginState(
        context: CommandContext,
        runId: string,
        input: { pluginId: string; scope: PluginStateScope; state: JsonValue },
    ) {
        assertJsonValue(input.state, "plugin state");
        return this.#run(context, runId, "plugin.state.replace", input, actors.replacePluginState(input));
    }

    replaceActorState(context: CommandContext, runId: string, actorId: string, state: JsonValue) {
        assertJsonValue(state, "actor state");
        return this.#run(context, runId, "actor.state.replace", { actorId, state }, actors.replaceActorState(actorId, state));
    }

    publishArtifact(
        context: CommandContext,
        runId: string,
        input: { title: string; mediaType: string; content: string | Uint8Array; previousVersionId: string | null },
    ) {
        assertCapability(commandActorOf(this.state(runId), context), "artifact.publish", { kind: "run" });
        const stored = this.#artifactContents.put(typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content);
        const { content: _content, ...metadata } = input;

        return this.#run(context, runId, "artifact.publish", { ...metadata, ...stored }, artifacts.publishArtifact(metadata, stored));
    }

    artifactContent(runId: string, artifactId: string, actorId: string) {
        const state = this.state(runId);
        const artifact = artifactOf(state, artifactId);
        assertArtifactRead(state, addressedActorOf(state.actors.values(), actorId), artifact);

        return { artifact, content: this.#artifactContents.read(artifact.hash) };
    }

    #run(context: CommandContext, runId: string, commandType: string, input: unknown, decide: Decision) {
        const command = journalCommand(context.commandId, commandType, context.actorId, {
            turnId: context.turnId ?? null,
            input,
        });
        const previous = this.#journal.commandFor(runId, context.commandId);

        if (previous && !sameJournalCommand(previous, command))
            throw new DomainError("command-id-collision", `Command ID ${context.commandId} was already used for another command.`, 409);

        if (!previous) {
            const proposed: UncommittedEvent[] = decide(this.state(runId), context, this.#services);
            this.#journal.append(runId, command, proposed);
        }

        return this.view(runId);
    }

    #dispatchSubscriptions(sources: readonly JournalEvent[]) {
        for (const source of sources) {
            if (this.#suppressedSubscriptionRuns.has(source.runId))
                continue;

            const state = this.state(source.runId);
            const matching = [...state.subscriptions.values()].filter(
                (subscription) =>
                    source.sequence > subscription.createdSequence &&
                    subscriptions.matchesSubscription(state, subscription, source),
            );

            for (const subscription of matching)
                this.#deliverSubscription(source, subscription.id, subscription.subscriberId);
        }
    }

    #dispatchCreatorAlerts(sources: readonly JournalEvent[]) {
        for (const source of sources) {
            if (this.#suppressedSubscriptionRuns.has(source.runId))
                continue;

            const alert = source.type === "turn.finished" && source.payload.outcome === "failed"
                ? { kind: "failed" as const, turnId: source.payload.turnId, reason: source.payload.reason }
                : source.type === "turn.interrupted"
                    ? { kind: "interrupted" as const, turnId: source.payload.turnId, reason: source.payload.reason }
                    : null;

            if (!alert)
                continue;

            const state = this.state(source.runId);
            const child = executableActorOf(state, turnOf(state, alert.turnId).actorId);

            if (child.createdBy === child.id || child.lifecycle.kind === "stopped")
                continue;

            const creator = state.actors.get(child.createdBy);

            if (!creator || creator.kind === "human" || creator.lifecycle.kind === "stopped")
                continue;

            const alreadyDelivered = [...state.subscriptions.values()].some((subscription) =>
                subscription.subscriberId === creator.id &&
                source.sequence > subscription.createdSequence &&
                subscriptions.matchesSubscription(state, subscription, source));

            if (alreadyDelivered)
                continue;

            const commandId = `creator-alert:${source.eventId}`;

            if (this.#journal.commandFor(source.runId, commandId))
                continue;

            const content = alert.kind === "failed"
                ? `[Automatische Meldung] Der Turn deines Actors @${child.handle} ist GESCHEITERT: ${alert.reason} `
                    + "Prüfe den Zustand mit event_query und entscheide: neu beauftragen, reparieren oder stoppen."
                : `[Automatische Meldung] Der Turn deines Actors @${child.handle} wurde unterbrochen: ${alert.reason}`;

            try {
                this.enqueueInput(
                    {
                        commandId,
                        actorId: state.ownerId,
                        correlationId: source.correlationId ?? source.eventId,
                        causationId: source.eventId,
                    },
                    source.runId,
                    { actorId: creator.id, content, sourceEventIds: [source.eventId] },
                );
            } catch (error) {
                console.error(`Creator alert for ${source.eventId} could not be delivered:`, error);
            }
        }
    }

    #deliverSubscription(source: JournalEvent, subscriptionId: string, subscriberId: string) {
        const commandId = `subscription:${subscriptionId}:${source.eventId}`;

        if (this.#journal.commandFor(source.runId, commandId))
            return;

        try {
            this.enqueueInput(
                {
                    commandId,
                    actorId: subscriberId,
                    correlationId: source.correlationId ?? source.eventId,
                    causationId: source.eventId,
                },
                source.runId,
                {
                    actorId: subscriberId,
                    sourceEventIds: [source.eventId],
                    subscriptionId,
                },
            );
        } catch (error) {
            if (this.#journal.commandFor(source.runId, commandId))
                return;

            const failureCommandId = `${commandId}:failed`;

            if (this.#journal.commandFor(source.runId, failureCommandId))
                return;

            this.#run(
                {
                    commandId: failureCommandId,
                    actorId: subscriberId,
                    correlationId: source.correlationId ?? source.eventId,
                    causationId: source.eventId,
                },
                source.runId,
                "subscription.fail",
                { subscriptionId, sourceEventId: source.eventId, reason: errorMessage(error) },
                subscriptions.failSubscription(subscriptionId, source.eventId, errorMessage(error)),
            );
        }
    }

    #interruptOpenTurns() {
        for (const runId of this.#journal.runIds()) {
            try {
                for (const actor of this.state(runId).actors.values()) {
                    if (actor.kind === "human" || actor.lifecycle.kind !== "running")
                        continue;

                    this.interruptTurn(
                        { actorId: actor.id, commandId: `recover:${actor.lifecycle.turnId}` },
                        runId,
                        actor.id,
                        {
                            turnId: actor.lifecycle.turnId,
                            reason: "Der Turn wurde durch einen Neustart der Runtime unterbrochen.",
                        },
                    );
                }
            } catch (error) {
                if (!this.#journal.failureOf(runId))
                    throw error;

                console.error(`Run ${runId} konnte beim Neustart nicht wiederhergestellt werden:`, error);
            }
        }
    }

}

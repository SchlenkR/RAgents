import type { ImageContent, TextContent, UserContent } from "@ragents/ai";

import type { EventPayloads, JournalEvent, ModelInputContent, ModelToolResultPart, UncommittedEvent } from "../domain/events.ts";
import { derivedToolResultText } from "../domain/tool-result-text.ts";
import { ModelContexts } from "../agents/model-context.ts";
import { assertJsonValue, type JsonObject, type JsonValue } from "../domain/json.ts";
import type {
    ActionInput,
    ActionStatus,
    ActorKind,
    AgentExecution,
    CapabilityGrant,
    ObservableEventType,
    PluginStateScope,
    RunSharing,
    RunState,
    TurnUsage,
} from "../domain/model.ts";
import { isShared, sameSharing } from "../domain/model.ts";
import { addressFrom } from "../domain/actor-reference.ts";
import { project, viewOf } from "../domain/projection.ts";
import { capabilityNames } from "../domain/vocabulary.ts";
import { MemoryArtifactContents, type ArtifactContents } from "./artifacts.ts";
import { event, journalCommand, type CommandContext, type Decision } from "./command.ts";
import * as actions from "./decisions/actions.ts";
import * as actors from "./decisions/actors.ts";
import * as artifacts from "./decisions/artifacts.ts";
import * as inputs from "./decisions/inputs.ts";
import * as pause from "./decisions/pause.ts";
import * as subscriptions from "./decisions/subscriptions.ts";
import * as turns from "./decisions/turns.ts";
import { DomainError } from "./domain-error.ts";
import {
    actorById,
    checkedSharing,
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

const firstOf = <Value, Found extends Value>(values: Iterable<Value>, matches: (value: Value) => value is Found): Found | undefined => {
    for (const value of values)
        if (matches(value))
            return value;

    return undefined;
};

export class Orchestration {
    readonly #journal: Journal;
    readonly #services: RuntimeServices;
    readonly #artifactContents: ArtifactContents;
    readonly #eventVisible: (event: JournalEvent) => boolean;
    readonly #suppressedSubscriptionRuns = new Set<string>();
    readonly #modelContexts: ModelContexts;

    constructor(journal: Journal, services: RuntimeServices, artifactContents: ArtifactContents = new MemoryArtifactContents(), eventVisible: (event: JournalEvent) => boolean = () => true) {
        this.#journal = journal;
        this.#services = services;
        this.#artifactContents = artifactContents;
        this.#eventVisible = eventVisible;
        this.#modelContexts = new ModelContexts({
            eventsSince: (runId, sequence) => this.#journal.eventsSince(runId, sequence),
            firstEventId: (runId) => this.#journal.firstEventId(runId),
            media: (hash) => this.mediaContent(hash),
        });
        this.#journal.subscribe((events) => {
            this.#releaseModelContexts(events);
            this.#dispatchSubscriptions(events.filter(this.#eventVisible));
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
        if (!programs) throw new Error("The actor program executor is missing for this runtime.");
        return programs;
    }

    get nativeTypeScriptExecutor() {
        const executor = this.#services.nativeTypeScriptExecutor;
        if (!executor) throw new Error("The native TypeScript executor is missing for this runtime.");
        return executor;
    }

    events(runId: string) {
        return this.#journal.load(runId);
    }

    publicEvents(runId: string) {
        return this.events(runId).filter(this.#eventVisible);
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

    /** A value of the current state without cloning all of it; `read` must neither keep nor change the state. */
    select<Value>(runId: string, read: (state: RunState) => Value): Value {
        const found = this.#journal.select(runId, (state) => ({ value: read(state) }));

        if (!found)
            throw new DomainError("run-not-found", `Run ${runId} does not exist.`, 404);

        return found.value;
    }

    /** The events of a run from the newest back, without copying the journal. */
    recentEvents(runId: string) {
        return this.#journal.recentEvents(runId);
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
            /** The signed-in user who owns the run; without sign-in it stays open. */
            ownerUserId?: string;
            runId?: string;
            initialPluginStates?: readonly { pluginId: string; state: JsonValue }[];
            /** Whom the run is shared with from its creation on, as its owner chose it; needs ownerUserId. */
            sharing?: RunSharing;
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
        const ownerUserId = input.ownerUserId === undefined ? undefined : clean(input.ownerUserId, "ownerUserId");
        const sharing = input.sharing === undefined ? undefined : checkedSharing(input.sharing, ownerUserId);

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
                        ...ownerUserId === undefined ? {} : { userId: ownerUserId },
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
            ...sharing && ownerUserId !== undefined && isShared(sharing) ? [event(commandContext, {
                type: "run.sharing-changed" as const,
                payload: { ...sharing, changedBy: ownerUserId },
            })] : [],
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

            if (entry.type === "context.compacted") {
                return {
                    ...entry,
                    ...identities,
                    payload: { ...entry.payload, firstKeptEventId: rewriteEventId(entry.payload.firstKeptEventId) },
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

    /** Replaces whom the run is shared with; an unchanged sharing writes nothing. */
    shareRun(context: CommandContext, runId: string, input: { sharing: RunSharing; changedBy: string }) {
        if (this.select(runId, (state) => sameSharing(state.sharing, checkedSharing(input.sharing, state.ownerUserId))))
            return this.view(runId);

        return this.#run(context, runId, "run.share", input, actors.shareRun(input));
    }

    /** From now on no turn starts; the running ones end through the scheduler. An already paused run writes nothing. */
    pauseRun(context: CommandContext, runId: string, input: { reason: string; userId?: string }) {
        if (this.select(runId, (state) => state.pause !== null))
            return this.view(runId);

        return this.#run(context, runId, "run.pause", input, pause.pauseRun(input));
    }

    /** Lifts the pause without an input; a run that is not paused writes nothing. */
    resumeRun(context: CommandContext, runId: string, input: { userId?: string }) {
        if (this.select(runId, (state) => state.pause === null))
            return this.view(runId);

        return this.#run(context, runId, "run.resume", input, pause.resumeRun({ trigger: "resume", ...input }));
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
            description?: string;
            /** The agent's first input, enqueued in the same command. */
            task?: string;
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
            description?: string;
            room?: actors.ScriptActorRoom;
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

    appendInterruptedModelOutput(context: CommandContext, runId: string, actorId: string, input: { turnId: string; text: string }) {
        return this.#run(context, runId, "model.output.interrupt", { actorId, ...input }, turns.appendInterruptedModelOutput(actorId, input));
    }

    appendRuntimeOutput(context: CommandContext, runId: string, actorId: string, input: { turnId: string; text: string }) {
        return this.#run(context, runId, "runtime.output.record", { actorId, ...input }, turns.appendRuntimeOutput(actorId, input));
    }

    appendExternalOutput(context: CommandContext, runId: string, actorId: string, input: { turnId: string; text: string; reasoning: boolean }) {
        return this.#run(context, runId, "external.output.record", { actorId, ...input }, turns.appendExternalOutput(actorId, input));
    }

    /** The model context of an actor, extended by the events since the last call. */
    modelContext(runId: string, actorId: string) {
        return this.#modelContexts.contextOf(runId, actorId);
    }

    /** How many actor contexts are held in memory. */
    heldModelContexts() {
        return this.#modelContexts.size;
    }

    #releaseModelContexts(events: readonly JournalEvent[]) {
        for (const event of events) {
            if ((event.type !== "turn.finished" && event.type !== "turn.interrupted") || this.#journal.failureOf(event.runId))
                continue;

            const actorId = this.#journal.select(event.runId, (state) => state.turns.get(event.payload.turnId)?.actorId);

            if (actorId)
                this.#modelContexts.forgetActor(event.runId, actorId);
        }
    }

    /** Removes a run from the journal and everything held for it in memory; its files stay. */
    forgetRun(runId: string) {
        this.#modelContexts.forget(runId);
        return this.#journal.forget(runId);
    }

    /** The Base64 of stored media bytes, for the model context. */
    mediaContent(hash: string): string {
        return Buffer.from(this.#artifactContents.read(hash)).toString("base64");
    }

    #storedMedia(data: string): string {
        return this.#artifactContents.put(Buffer.from(data, "base64")).hash;
    }

    presentModelInput(
        context: CommandContext,
        runId: string,
        actorId: string,
        input: { turnId: string; inputId: string | null; content: string | readonly UserContent[] },
    ) {
        const content: ModelInputContent = typeof input.content === "string"
            ? input.content
            : input.content.map((part) => {
                if (part.type === "text") return { type: "text" as const, text: part.text };
                const hash = this.#storedMedia(part.data);
                return part.type === "file"
                    ? { type: "file" as const, mimeType: part.mimeType, filename: part.filename, hash }
                    : { type: part.type, mimeType: part.mimeType, hash };
            });
        const payload = { turnId: input.turnId, inputId: input.inputId, content };

        return this.#run(context, runId, "model.input.present", { actorId, ...payload }, turns.presentModelInput(actorId, payload));
    }

    completeModelStep(context: CommandContext, runId: string, actorId: string, input: { turnId: string; step: turns.CompletedModelStep }) {
        const step = JSON.parse(JSON.stringify(input.step)) as turns.CompletedModelStep;

        return this.#run(context, runId, "model.step.complete", { actorId, turnId: input.turnId, step }, turns.completeModelStep(actorId, { turnId: input.turnId, step }));
    }

    /** Stores what the model saw of a tool result; the content is left out when it is exactly the text of the recorded result. */
    presentToolResult(
        context: CommandContext,
        runId: string,
        actorId: string,
        input: { turnId: string; toolCallId: string; toolName: string; isError: boolean; content: readonly (TextContent | ImageContent)[] },
    ) {
        const content: ModelToolResultPart[] = input.content.map((part) => part.type === "text"
            ? { type: "text", text: part.text }
            : { type: "image", mimeType: part.mimeType, hash: this.#storedMedia(part.data) });
        const recorded = firstOf(this.recentEvents(runId), (event): event is Extract<JournalEvent, { type: "tool.call.completed" | "tool.call.failed" }> =>
            (event.type === "tool.call.completed" || event.type === "tool.call.failed")
            && event.actorId === actorId
            && event.payload.turnId === input.turnId
            && event.payload.toolCallId === input.toolCallId);
        const derived = recorded !== undefined
            && content.length === 1
            && content[0]!.type === "text"
            && content[0]!.text === derivedToolResultText(recorded);
        const payload = {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            isError: input.isError,
            ...(derived ? {} : { content }),
        };

        return this.#run(context, runId, "model.tool-result.present", { actorId, ...payload }, turns.presentToolResult(actorId, payload));
    }

    compactContext(context: CommandContext, runId: string, actorId: string, input: EventPayloads["context.compacted"]) {
        return this.#run(context, runId, "context.compact", { actorId, ...input }, turns.compactContext(actorId, input));
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
            owner: string;
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
                ? `[Automatic notice] The turn of your actor @${addressFrom(child, creator.room)} FAILED: ${alert.reason} `
                    + "Check the state with event_query and decide: delegate again, repair or stop."
                : `[Automatic notice] The turn of your actor @${addressFrom(child, creator.room)} was interrupted: ${alert.reason}`;

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
                            reason: "The turn was interrupted by a restart of the runtime.",
                        },
                    );
                }
            } catch (error) {
                if (!this.#journal.failureOf(runId))
                    throw error;

                console.error(`Run ${runId} could not be restored on restart:`, error);
            }
        }
    }

}

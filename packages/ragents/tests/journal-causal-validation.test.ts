import { serializeJournalRecord } from "../src/runtime/journal-storage.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { manualExecution } from "../src/domain/driver.ts";
import type { UncommittedEvent } from "../src/domain/events.ts";
import { Journal, type CommandRecord } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { testServices } from "./support.ts";

const scenario = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun(
        { commandId: "create" },
        { title: "Causal journal", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Work.",
        execution: manualExecution(),
        grants: [{ capability: "artifact.publish", scope: { kind: "run" }, delegable: false }],
        toolNames: [],
    });
    const worker = view.actors.find((entry) => entry.kind === "agent");
    assert.ok(worker);
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-intruder" }, view.id, {
        handle: "intruder",
        displayName: "Intruder",
        prompt: "Wait.",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });
    const intruder = view.actors.find((entry) => entry.handle === "intruder");
    assert.ok(intruder && intruder.kind === "agent");
    view = runtime.createSubscription({ actorId: view.ownerId, commandId: "subscribe" }, view.id, {
        subscriberId: worker.id,
        sourceActorIds: [worker.id],
        eventTypes: ["model.output.completed"],
        includeSelf: true,
    });
    const subscription = view.subscriptions[0];
    assert.ok(subscription);
    view = runtime.proposeAction({ actorId: view.ownerId, commandId: "propose" }, view.id, {
        title: "Approve",
    });
    const action = view.actions[0];
    assert.ok(action);
    view = runtime.publishArtifact({ actorId: view.ownerId, commandId: "artifact" }, view.id, {
        title: "Owner artifact",
        mediaType: "text/plain",
        content: "content",
        previousVersionId: null,
    });
    const artifact = view.artifacts[0];
    assert.ok(artifact);
    view = runtime.enqueueInput({ actorId: view.ownerId, commandId: "input" }, view.id, {
        actorId: worker.id,
        content: "Start",
    });
    const input = view.inputs.find((entry) => entry.actorId === worker.id);
    assert.ok(input);
    view = runtime.startTurn({ actorId: worker.id, commandId: "turn" }, view.id, worker.id, input.id);
    const running = view.actors.find((entry) => entry.id === worker.id);
    assert.ok(running && running.kind === "agent" && running.lifecycle.kind === "running");
    const turnId = running.lifecycle.turnId;
    runtime.startToolCall(
        { actorId: worker.id, commandId: "tool-start", turnId },
        view.id,
        worker.id,
        { turnId, toolCallId: "call-1", name: "work", input: {} },
    );
    view = runtime.enqueueInput({ actorId: view.ownerId, commandId: "intruder-input" }, view.id, {
        actorId: intruder.id,
        content: "Wait",
    });
    const intruderInput = view.inputs.find((entry) => entry.actorId === intruder.id);
    assert.ok(intruderInput);
    view = runtime.startTurn(
        { actorId: intruder.id, commandId: "intruder-turn" },
        view.id,
        intruder.id,
        intruderInput.id,
    );

    return {
        services,
        journal,
        runtime,
        runId: view.id,
        ownerId: view.ownerId,
        worker,
        intruder,
        subscription,
        action,
        artifact,
        turnId,
    };
};

const event = <Event extends UncommittedEvent>(value: Event) => value;

test("append rejects structurally valid events with impossible causal references", () => {
    const setup = scenario();
    const revision = setup.runtime.view(setup.runId).revision;
    const runCreated = setup.runtime.events(setup.runId)[0];
    assert.ok(runCreated);

    const attempts: { value: UncommittedEvent; message: RegExp; commandActorId?: string }[] = [
        {
            value: event({
                type: "agent.spawned",
                actorId: "missing-creator",
                correlationId: null,
                causationId: null,
                payload: {
                    agentId: "agent-impossible",
                    handle: "impossible",
                    displayName: "Impossible",
                    prompt: "None",
                    execution: manualExecution(),
                    grants: [],
                    toolNames: [],
                },
            }),
            message: /Actor missing-creator does not exist/,
        },
        {
            value: event({
                type: "agent.spawned",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: {
                    agentId: "agent-unauthorized",
                    handle: "unauthorized",
                    displayName: "Unauthorized",
                    prompt: "None",
                    execution: manualExecution(),
                    grants: [],
                    toolNames: [],
                },
            }),
            message: /lacks agent.spawn/,
        },
        {
            value: event({
                type: "script.created",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: {
                    scriptId: "script-unauthorized",
                    handle: "script-unauthorized",
                    displayName: "Unauthorized",
                    execution: manualExecution(),
                    grants: [],
                    toolNames: [],
                },
            }),
            message: /lacks agent.spawn/,
        },
        {
            value: event({
                type: "run.primary-actor-selected",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: { actorId: setup.worker.id },
            }),
            message: /lacks run.configure/,
        },
        {
            value: event({
                type: "run.forked",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: { sourceRunId: "run-source", sourceSequence: revision },
            }),
            message: /must be authored by run owner/,
        },
        {
            value: event({
                type: "model.output.completed",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: { turnId: "turn-missing", text: "Impossible" },
            }),
            message: /Turn turn-missing does not exist/,
        },
        {
            value: event({
                type: "model.output.completed",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: { turnId: setup.turnId, text: "Valid event, wrong command actor" },
            }),
            commandActorId: setup.ownerId,
            message: /command actor/,
        },
        {
            value: event({
                type: "tool.call.completed",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: { turnId: setup.turnId, toolCallId: "call-missing", name: "work", output: {} },
            }),
            message: /Tool call call-missing does not exist/,
        },
        {
            value: event({
                type: "turn.finished",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: { turnId: setup.turnId, outcome: "completed" },
            }),
            message: /still has running tool calls: call-1/,
        },
        {
            value: event({
                type: "turn.interrupted",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: { turnId: setup.turnId, reason: "Impossible" },
            }),
            message: /cannot interrupt turn/,
        },
        {
            value: event({
                type: "subscription.failed",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: {
                    subscriptionId: setup.subscription.id,
                    sourceEventId: runCreated.eventId,
                    reason: "Impossible",
                },
            }),
            message: /predates subscription/,
        },
        {
            value: event({
                type: "subscription.created",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: {
                    subscriptionId: "subscription-impossible",
                    subscriberId: setup.worker.id,
                    sourceActorIds: null,
                    sourceActorKinds: null,
                    eventTypes: ["model.output.completed"],
                    includeSelf: false,
                },
            }),
            message: /cannot create subscription/,
        },
        {
            value: event({
                type: "subscription.created",
                actorId: setup.ownerId,
                correlationId: null,
                causationId: null,
                payload: {
                    subscriptionId: "subscription-duplicate-kinds",
                    subscriberId: setup.worker.id,
                    sourceActorIds: null,
                    sourceActorKinds: ["agent", "agent"],
                    eventTypes: ["model.output.completed"],
                    includeSelf: false,
                },
            }),
            message: /sourceActorKinds contains duplicate references/,
        },
        {
            value: event({
                type: "subscription.removed",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: { subscriptionId: setup.subscription.id, reason: "Impossible" },
            }),
            message: /cannot remove subscription/,
        },
        {
            value: event({
                type: "subscription.removed",
                actorId: setup.ownerId,
                correlationId: null,
                causationId: null,
                payload: {
                    subscriptionId: setup.subscription.id,
                    reason: "Impossible input set",
                    discardedInputIds: ["input-impossible"],
                },
            }),
            message: /must discard all of its pending inputs/,
        },
        {
            value: event({
                type: "actor.stopped",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: { actorId: setup.intruder.id, reason: "Impossible" },
            }),
            message: /cannot stop actor/,
        },
        {
            value: event({
                type: "actor.input.enqueued",
                actorId: setup.ownerId,
                correlationId: null,
                causationId: null,
                payload: {
                    inputId: "input-impossible",
                    actorId: "actor-missing",
                    content: "Impossible",
                    artifactIds: [],
                    sourceEventIds: [],
                    subscriptionId: null,
                },
            }),
            message: /Actor actor-missing does not exist/,
        },
        {
            value: event({
                type: "actor.input.enqueued",
                actorId: setup.ownerId,
                correlationId: null,
                causationId: null,
                payload: {
                    inputId: "input-with-missing-source",
                    actorId: setup.worker.id,
                    content: "Impossible",
                    artifactIds: [],
                    sourceEventIds: ["event-missing"],
                    subscriptionId: null,
                },
            }),
            message: /Source event event-missing does not exist/,
        },
        {
            value: event({
                type: "actor.input.enqueued",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: {
                    inputId: "input-unauthorized",
                    actorId: setup.worker.id,
                    content: "Impossible",
                    artifactIds: [],
                    sourceEventIds: [],
                    subscriptionId: null,
                },
            }),
            message: /lacks actor.input/,
        },
        {
            value: event({
                type: "plugin.state-replaced",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: { pluginId: "test", scope: { kind: "actor", actorId: setup.intruder.id }, state: {} },
            }),
            message: /lacks plugin.state.write/,
        },
        {
            value: event({
                type: "action.proposed",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: {
                    actionId: "action-unauthorized",
                    kind: "action",
                    title: "Impossible",
                    description: null,
                    parameters: {},
                    input: null,
                },
            }),
            message: /lacks action.propose/,
        },
        {
            value: event({
                type: "artifact.published",
                actorId: setup.intruder.id,
                correlationId: null,
                causationId: null,
                payload: {
                    artifact: {
                        id: "artifact-unauthorized",
                        title: "Unauthorized",
                        mediaType: "text/plain",
                        hash: "hash",
                        size: 1,
                        previousVersionId: null,
                    },
                },
            }),
            message: /lacks artifact.publish/,
        },
        {
            value: event({
                type: "artifact.published",
                actorId: setup.ownerId,
                correlationId: null,
                causationId: null,
                payload: {
                    artifact: {
                        id: "artifact-impossible",
                        title: "Impossible",
                        mediaType: "text/plain",
                        hash: "hash",
                        size: 1,
                        previousVersionId: "artifact-missing",
                    },
                },
            }),
            message: /Artifact artifact-missing does not exist/,
        },
        {
            value: event({
                type: "artifact.published",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: {
                    artifact: {
                        id: "artifact-unreadable",
                        title: "Unreadable",
                        mediaType: "text/plain",
                        hash: "hash",
                        size: 1,
                        previousVersionId: setup.artifact.id,
                    },
                },
            }),
            message: /cannot read artifact/,
        },
        {
            value: event({
                type: "action.resolved",
                actorId: setup.worker.id,
                correlationId: null,
                causationId: null,
                payload: {
                    actionId: setup.action.id,
                    decision: "approved",
                    response: null,
                },
            }),
            message: /was not resolved by a human actor/,
        },
    ];

    for (const [index, attempt] of attempts.entries()) {
        assert.throws(() => setup.journal.append(
            setup.runId,
            {
                id: `invalid-${index}`,
                type: "test.invalid",
                actorId: attempt.commandActorId ?? attempt.value.actorId,
                requestHash: `hash-${index}`,
            },
            [attempt.value],
        ), attempt.message);
        assert.equal(setup.runtime.view(setup.runId).revision, revision);
    }

    setup.journal.close();
});

test("adopt rejects a run creation whose command actor differs from its event actor", () => {
    const source = scenario();
    const records = structuredClone(source.journal.records(source.runId)) as CommandRecord[];
    const creation = records[0];
    assert.ok(creation);
    creation.command.actorId = "foreign-command-actor";

    const target = new Journal(":memory:", testServices());
    assert.throws(() => target.adopt(records), /does not match command actor/);
    assert.deepEqual(target.runIds(), []);

    target.close();
    source.journal.close();
});

test("journal load rejects an event whose derived createdBy actor does not exist", (t) => {
    const source = scenario();
    const records = structuredClone(source.journal.records(source.runId)) as CommandRecord[];
    const spawned = records.flatMap((record) => record.events).find((entry) => entry.type === "agent.spawned");
    assert.ok(spawned);
    spawned.actorId = "missing-creator";
    const spawnRecord = records.find((record) => record.events.includes(spawned));
    assert.ok(spawnRecord);
    spawnRecord.command.actorId = "missing-creator";
    source.journal.close();

    const root = mkdtempSync(join(tmpdir(), "ragents-causal-load-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const directory = join(root, source.runId);
    mkdirSync(directory);
    writeFileSync(
        join(directory, "journal.jsonl"),
        records.map((record) => serializeJournalRecord(record, directory)).join("\n") + "\n",
        "utf8",
    );

    const journal = new Journal(root, testServices());
    t.after(() => journal.close());
    assert.match(journal.failureOf(source.runId)?.message ?? "", /Actor missing-creator does not exist/);
    assert.deepEqual(journal.runIds(), []);
});

test("adopt rejects an unresolved tool-call reference without installing partial state", () => {
    const source = scenario();
    source.runtime.completeToolCall(
        { actorId: source.worker.id, commandId: "tool-complete", turnId: source.turnId },
        source.runId,
        source.worker.id,
        { turnId: source.turnId, toolCallId: "call-1", name: "work", output: {} },
    );
    const records = structuredClone(source.journal.records(source.runId)) as CommandRecord[];
    const completion = records.flatMap((record) => record.events).find((entry) => entry.type === "tool.call.completed");
    assert.ok(completion);
    completion.payload.toolCallId = "call-missing";

    const target = new Journal(":memory:", testServices());
    assert.throws(() => target.adopt(records), /Tool call call-missing does not exist/);
    assert.deepEqual(target.runIds(), []);
    assert.equal(target.stateOf(source.runId), null);

    target.close();
    source.journal.close();
});

test("fork rewrites inherited source-event references to the fork event IDs", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let source = runtime.createRun(
        { commandId: "create-source" },
        { title: "Source", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );

    for (const handle of ["speaker", "mediator"]) {
        source = runtime.spawnAgent({ actorId: source.ownerId, commandId: `spawn-${handle}` }, source.id, {
            handle,
            displayName: handle,
            prompt: "Work.",
            execution: manualExecution(),
            grants: [],
            toolNames: [],
        });
    }

    const speaker = source.actors.find((entry) => entry.handle === "speaker");
    const mediator = source.actors.find((entry) => entry.handle === "mediator");
    assert.ok(speaker && mediator);
    source = runtime.createSubscription({ actorId: source.ownerId, commandId: "subscribe" }, source.id, {
        subscriberId: mediator.id,
        sourceActorIds: [speaker.id],
        eventTypes: ["model.output.completed"],
    });
    source = runtime.enqueueInput({ actorId: source.ownerId, commandId: "input" }, source.id, {
        actorId: speaker.id,
        content: "Speak",
    });
    const input = source.inputs.find((entry) => entry.actorId === speaker.id);
    assert.ok(input);
    source = runtime.startTurn({ actorId: speaker.id, commandId: "turn" }, source.id, speaker.id, input.id);
    const running = source.actors.find((entry) => entry.id === speaker.id);
    assert.ok(running && running.kind !== "human" && running.lifecycle.kind === "running");
    source = runtime.appendModelOutput(
        { actorId: speaker.id, commandId: "output", turnId: running.lifecycle.turnId },
        source.id,
        speaker.id,
        { turnId: running.lifecycle.turnId, text: "Hello" },
    );
    const sourceDelivery = source.inputs.find((entry) => entry.subscriptionId !== null);
    assert.ok(sourceDelivery);
    source = runtime.finishTurn(
        { actorId: speaker.id, commandId: "finish", turnId: running.lifecycle.turnId },
        source.id,
        speaker.id,
        { turnId: running.lifecycle.turnId, outcome: "completed" },
    );

    const fork = runtime.forkRun({ commandId: "fork" }, source.id, source.revision);
    const forkDelivery = fork.inputs.find((entry) => entry.subscriptionId === sourceDelivery.subscriptionId);
    assert.ok(forkDelivery);
    assert.notDeepEqual(forkDelivery.sourceEventIds, sourceDelivery.sourceEventIds);
    assert.equal(
        forkDelivery.sourceEventIds.every((eventId) => runtime.events(fork.id).some((entry) => entry.eventId === eventId)),
        true,
    );

    journal.close();
});

test("failed incremental batches preserve committed turn projections and tool-call semantics", () => {
    const setup = scenario();
    const before = setup.journal.stateOf(setup.runId);
    const eventsBefore = setup.journal.load(setup.runId);
    let published = 0;
    const unsubscribe = setup.journal.subscribe(() => published++);
    const command = { id: "invalid-batch", type: "test", actorId: setup.worker.id, requestHash: "invalid-batch" };
    const finished: UncommittedEvent = {
        type: "tool.call.completed",
        actorId: setup.worker.id,
        correlationId: null,
        causationId: setup.turnId,
        payload: { turnId: setup.turnId, toolCallId: "call-1", name: "work", output: "done" },
    };
    const invalid: UncommittedEvent = {
        ...finished,
        payload: { ...finished.payload, toolCallId: "missing-call" },
    };

    assert.throws(() => setup.journal.append(setup.runId, command, [finished, invalid]), /Tool call missing-call does not exist/);
    assert.deepEqual(setup.journal.stateOf(setup.runId), before);
    assert.deepEqual(setup.journal.load(setup.runId), eventsBefore);
    assert.equal(published, 0);
    assert.equal(setup.journal.commandFor(setup.runId, command.id), null);

    setup.journal.append(setup.runId, command, [finished]);
    assert.equal(published, 1);
    assert.equal(setup.journal.stateOf(setup.runId)?.turns.get(setup.turnId)?.toolCalls[0]?.status, "completed");
    unsubscribe();
    setup.journal.close();
});

const rejectAfter = (setup: ReturnType<typeof scenario>, actorId: string, proposed: UncommittedEvent[]) => {
    const before = setup.journal.stateOf(setup.runId);
    const events = setup.journal.load(setup.runId);
    const command = { id: "rejected-snapshot", type: "test", actorId, requestHash: "rejected-snapshot" };
    const invalid: UncommittedEvent = {
        type: "action.resolved", actorId, correlationId: null, causationId: null,
        payload: { actionId: "missing-action", decision: "approved", response: null },
    };
    assert.throws(() => setup.journal.append(setup.runId, command, [...proposed, invalid]), /Action missing-action does not exist/);
    assert.deepEqual(setup.journal.stateOf(setup.runId), before);
    assert.deepEqual(setup.journal.load(setup.runId), events);
    assert.equal(setup.journal.commandFor(setup.runId, command.id), null);
    setup.journal.append(setup.runId, command, proposed);
    assert.equal(setup.journal.records(setup.runId).find((record) => record.command.id === command.id)?.events.length, proposed.length);
};

test("rejected projection snapshots preserve prior output arrays and opened tools", (t) => {
    const setup = scenario();
    t.after(() => setup.journal.close());
    const context = { actorId: setup.worker.id, correlationId: null, causationId: null };
    rejectAfter(setup, setup.worker.id, [
        { ...context, type: "model.output.completed", payload: { turnId: setup.turnId, text: "New output" } },
        { ...context, type: "actor.tools.opened", payload: { actorId: setup.worker.id, toolNames: ["new-tool"] } },
    ]);
    assert.equal(setup.journal.stateOf(setup.runId)?.turns.get(setup.turnId)?.outputs.length, 1);
});

test("rejected projection snapshots preserve input claims and actor lifecycle", (t) => {
    const setup = scenario();
    t.after(() => setup.journal.close());
    setup.runtime.interruptTurn({ actorId: setup.ownerId, commandId: "interrupt-before-claim" }, setup.runId, setup.worker.id, {
        turnId: setup.turnId, reason: "Prepare next turn",
    });
    const queued = setup.runtime.enqueueInput({ actorId: setup.ownerId, commandId: "next-input" }, setup.runId, {
        actorId: setup.worker.id, content: "Next",
    });
    const input = queued.inputs.find((entry) => entry.actorId === setup.worker.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    rejectAfter(setup, setup.worker.id, [{
        type: "turn.started", actorId: setup.worker.id, correlationId: null, causationId: null,
        payload: { turnId: "turn-next", inputId: input.id },
    }]);
    assert.equal(setup.journal.stateOf(setup.runId)?.inputs.get(input.id)?.lifecycle.kind, "claimed");
});

test("rejected projection snapshots preserve interrupted tool calls and stopped actors", (t) => {
    const setup = scenario();
    t.after(() => setup.journal.close());
    const context = { actorId: setup.ownerId, correlationId: null, causationId: null };
    rejectAfter(setup, setup.ownerId, [
        { ...context, type: "turn.interrupted", payload: { turnId: setup.turnId, reason: "Stop" } },
        { ...context, type: "actor.stopped", payload: { actorId: setup.worker.id, reason: "Stop" } },
    ]);
    assert.equal(setup.journal.stateOf(setup.runId)?.turns.get(setup.turnId)?.toolCalls[0]?.status, "interrupted");
});

test("rejected projection snapshots preserve subscription inputs, actions and nested plugin state", (t) => {
    const setup = scenario();
    t.after(() => setup.journal.close());
    const workerContext = { actorId: setup.worker.id, correlationId: null, causationId: null };
    const [source] = setup.journal.append(setup.runId, {
        id: "source-output", type: "test", actorId: setup.worker.id, requestHash: "source-output",
    }, [{ ...workerContext, type: "model.output.completed", payload: { turnId: setup.turnId, text: "Source" } }]);
    assert.ok(source);
    setup.journal.append(setup.runId, {
        id: "subscription-input", type: "test", actorId: setup.worker.id, requestHash: "subscription-input",
    }, [{
        ...workerContext, type: "actor.input.enqueued",
        payload: {
            inputId: "input-subscription", actorId: setup.worker.id, artifactIds: [],
            subscriptionId: setup.subscription.id, sourceEventIds: [source.eventId],
        },
    }]);
    setup.runtime.replacePluginState({ actorId: setup.ownerId, commandId: "initial-state" }, setup.runId, {
        pluginId: "test", scope: { kind: "run" }, state: { items: [{ label: "original" }, { label: "retained" }] },
    });
    const pendingInputIds = setup.runtime.view(setup.runId).inputs
        .filter((input) => input.subscriptionId === setup.subscription.id && input.lifecycle.kind === "pending")
        .map((input) => input.id);
    const context = { actorId: setup.ownerId, correlationId: null, causationId: null };
    rejectAfter(setup, setup.ownerId, [
        { ...context, type: "subscription.removed", payload: {
            subscriptionId: setup.subscription.id, reason: "Removed", discardedInputIds: pendingInputIds,
        } },
        { ...context, type: "action.resolved", payload: { actionId: setup.action.id, decision: "approved", response: "Yes" } },
        { ...context, type: "plugin.state-patched", payload: {
            pluginId: "test", scope: { kind: "run" }, changes: [{ op: "set", path: ["items", 0, "label"], value: "changed" }],
        } },
    ]);
    assert.equal(setup.journal.stateOf(setup.runId)?.inputs.get("input-subscription")?.lifecycle.kind, "discarded");
    assert.equal(setup.journal.stateOf(setup.runId)?.actions.get(setup.action.id)?.status, "approved");
});

import { serializeJournalRecord } from "../src/runtime/journal-storage.ts";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { deliveredInputOf } from "../src/agents/delivery.ts";
import { manualExecution } from "../src/domain/driver.ts";
import type { JournalEvent } from "../src/domain/events.ts";
import type { CapabilityGrant, RunView } from "../src/domain/model.ts";
import { project, viewOf } from "../src/domain/projection.ts";
import { capabilityNames } from "../src/domain/vocabulary.ts";
import { DomainError } from "../src/runtime/domain-error.ts";
import { Journal, type CommandRecord } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { testServices } from "./support.ts";

const grant = (capability: CapabilityGrant["capability"], delegable = true): CapabilityGrant => ({
    capability,
    scope: { kind: "run" },
    delegable,
});

const create = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const view = runtime.createRun(
        { commandId: "create" },
        { title: "Actor events", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );

    return { journal, runtime, view };
};

const spawn = (
    runtime: Orchestration,
    view: RunView,
    handle: string,
    grants: readonly CapabilityGrant[] = [],
    createdBy = view.ownerId,
    turnId?: string,
    toolNames: readonly string[] | null = null,
) => {
    const next = runtime.spawnAgent(
        { actorId: createdBy, commandId: `spawn-${handle}`, ...(turnId ? { turnId } : {}) },
        view.id,
        {
            handle,
            displayName: handle,
            prompt: `${handle} prompt`,
            execution: manualExecution(),
            grants,
            toolNames,
        },
    );
    const actor = next.actors.find((entry) => entry.handle === handle && entry.kind === "agent");

    assert.ok(actor);

    return { view: next, actor };
};

const start = (runtime: Orchestration, view: RunView, actorId: string, name: string) => {
    const enqueued = runtime.enqueueInput(
        { actorId: view.ownerId, commandId: `input-${name}` },
        view.id,
        { actorId, content: `Input ${name}` },
    );
    const input = enqueued.inputs.find((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending");

    assert.ok(input);

    const running = runtime.startTurn(
        { actorId, commandId: `turn-${name}` },
        view.id,
        actorId,
        input.id,
    );
    const actor = running.actors.find((entry) => entry.id === actorId);

    if (!actor || actor.kind === "human" || actor.lifecycle.kind !== "running")
        throw new Error(`Actor ${actorId} did not start.`);

    return { view: running, input, turnId: actor.lifecycle.turnId };
};

test("a v3 run is reconstructed from actor, input, turn and event records", () => {
    const { journal, runtime, view } = create();
    const worker = spawn(runtime, view, "worker", [], view.ownerId, undefined, []).actor;
    const turn = start(runtime, runtime.view(view.id), worker.id, "work");
    runtime.appendModelReasoning(
        { actorId: worker.id, commandId: "reasoning", turnId: turn.turnId },
        view.id,
        worker.id,
        { turnId: turn.turnId, text: "I will answer directly." },
    );
    runtime.appendModelOutput(
        { actorId: worker.id, commandId: "output", turnId: turn.turnId },
        view.id,
        worker.id,
        { turnId: turn.turnId, text: "Done." },
    );
    const finished = runtime.finishTurn(
        { actorId: worker.id, commandId: "finish", turnId: turn.turnId },
        view.id,
        worker.id,
        { turnId: turn.turnId, outcome: "completed" },
    );

    assert.equal(finished.actors.length, 2);
    assert.equal(finished.inputs.length, 1);
    assert.equal(finished.turns[0]?.status, "completed");
    assert.deepEqual(finished.subscriptions, []);
    assert.deepEqual(
        runtime.events(view.id).map((entry) => entry.type),
        [
            "run.created",
            "agent.spawned",
            "actor.input.enqueued",
            "turn.started",
            "model.reasoning.completed",
            "model.output.completed",
            "turn.finished",
        ],
    );
    assert.equal(runtime.events(view.id).every((entry) => entry.schemaVersion === 3), true);
    assert.equal("nodes" in finished, false);
    assert.equal("channels" in finished, false);
    assert.equal("messages" in finished, false);
    journal.close();
});

test("normal model output is a durable observable event", () => {
    const { journal, runtime, view } = create();
    const worker = spawn(runtime, view, "worker").actor;
    const turn = start(runtime, runtime.view(view.id), worker.id, "answer");
    runtime.appendModelOutput(
        { actorId: worker.id, commandId: "answer-output", turnId: turn.turnId },
        view.id,
        worker.id,
        { turnId: turn.turnId, text: "A normal answer." },
    );

    const output = runtime.events(view.id).find((entry) => entry.type === "model.output.completed");
    assert.equal(output?.actorId, worker.id);
    assert.deepEqual(output?.payload, { turnId: turn.turnId, text: "A normal answer." });
    journal.close();
});

test("the view carries the model outputs of a non-primary actor in journal order", () => {
    const { journal, runtime, view } = create();
    const primary = spawn(runtime, view, "primary").actor;
    runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "primary" }, view.id, primary.id);
    const worker = spawn(runtime, runtime.view(view.id), "worker").actor;
    const turn = start(runtime, runtime.view(view.id), worker.id, "answer");
    runtime.appendModelReasoning(
        { actorId: worker.id, commandId: "worker-reasoning", turnId: turn.turnId },
        view.id,
        worker.id,
        { turnId: turn.turnId, text: "Nur ein Gedanke." },
    );
    runtime.appendModelOutput(
        { actorId: worker.id, commandId: "worker-first", turnId: turn.turnId },
        view.id,
        worker.id,
        { turnId: turn.turnId, text: "Erste Antwort." },
    );
    const answered = runtime.appendModelOutput(
        { actorId: worker.id, commandId: "worker-second", turnId: turn.turnId },
        view.id,
        worker.id,
        { turnId: turn.turnId, text: "Zweite Antwort." },
    );

    assert.notEqual(answered.primaryActorId, worker.id);
    const workerTurn = answered.turns.find((entry) => entry.actorId === worker.id);
    assert.ok(workerTurn);
    assert.deepEqual(workerTurn.outputs.map((output) => output.text), ["Erste Antwort.", "Zweite Antwort."]);
    assert.ok(workerTurn.outputs[0] && workerTurn.outputs[1]);
    assert.equal(workerTurn.outputs[0].sequence < workerTurn.outputs[1].sequence, true);
    assert.equal(workerTurn.outputs.every((output) => typeof output.occurredAt === "string"), true);
    journal.close();
});

test("a structured subscription delivers each matching source event exactly once", () => {
    const { journal, runtime, view } = create();
    const source = spawn(runtime, view, "source").actor;
    const observer = spawn(runtime, runtime.view(view.id), "observer", [grant("event.subscribe")]).actor;
    const observerTurn = start(runtime, runtime.view(view.id), observer.id, "subscribe");
    const subscribed = runtime.createSubscription(
        { actorId: observer.id, commandId: "subscribe", turnId: observerTurn.turnId },
        view.id,
        {
            subscriberId: observer.id,
            sourceActorIds: [source.id],
            sourceActorKinds: ["agent"],
            eventTypes: ["model.output.completed"],
        },
    );
    const subscription = subscribed.subscriptions[0];
    assert.ok(subscription);
    runtime.finishTurn(
        { actorId: observer.id, commandId: "finish-subscribe", turnId: observerTurn.turnId },
        view.id,
        observer.id,
        { turnId: observerTurn.turnId, outcome: "completed" },
    );

    const sourceTurn = start(runtime, runtime.view(view.id), source.id, "source");
    const published: string[] = [];
    const unsubscribe = journal.subscribe((events) => published.push(...events.map((event) => event.type)));
    runtime.appendModelOutput(
        { actorId: source.id, commandId: "source-output", turnId: sourceTurn.turnId },
        view.id,
        source.id,
        { turnId: sourceTurn.turnId, text: "Observed." },
    );

    const delivered = runtime.view(view.id).inputs.filter((entry) => entry.subscriptionId === subscription.id);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]?.actorId, observer.id);
    assert.equal(delivered[0]?.sourceEventIds.length, 1);
    const sourceEvent = runtime.events(view.id).find((entry) => entry.eventId === delivered[0]?.sourceEventIds[0]);
    assert.equal(sourceEvent?.type, "model.output.completed");
    assert.deepEqual(JSON.parse(delivered[0]?.content ?? "null"), sourceEvent);
    const inputEvent = runtime.events(view.id).find((entry) => entry.type === "actor.input.enqueued"
        && entry.payload.subscriptionId === subscription.id);
    assert.ok(inputEvent && inputEvent.type === "actor.input.enqueued");
    assert.equal(Object.hasOwn(inputEvent.payload, "content"), false);
    assert.equal(JSON.stringify(inputEvent).includes("Observed."), false);
    assert.deepEqual(viewOf(project(runtime.events(view.id))!).inputs, runtime.view(view.id).inputs);
    const delivery = deliveredInputOf(runtime.view(view.id), delivered[0]!);
    assert.equal(delivery.content, "Observed.");
    assert.equal(delivery.event?.eventId, sourceEvent?.eventId);
    assert.deepEqual(published, ["model.output.completed", "actor.input.enqueued"]);
    unsubscribe();

    runtime.appendModelReasoning(
        { actorId: source.id, commandId: "source-reasoning", turnId: sourceTurn.turnId },
        view.id,
        source.id,
        { turnId: sourceTurn.turnId, text: "Not subscribed." },
    );
    assert.equal(runtime.view(view.id).inputs.filter((entry) => entry.subscriptionId === subscription.id).length, 1);
    runtime.finishTurn(
        { actorId: source.id, commandId: "finish-source", turnId: sourceTurn.turnId },
        view.id,
        source.id,
        { turnId: sourceTurn.turnId, outcome: "completed" },
    );
    const fork = runtime.forkRun({ commandId: "fork-subscription" }, view.id, runtime.view(view.id).revision);
    const forkInput = fork.inputs.find((entry) => entry.subscriptionId === subscription.id)!;
    const forkDelivery = deliveredInputOf(fork, forkInput);
    assert.equal(forkDelivery.content, "Observed.");
    assert.equal(forkDelivery.event?.eventId, forkInput.sourceEventIds[0]);
    assert.notEqual(forkDelivery.event?.eventId, delivery.event?.eventId);
    assert.equal(JSON.parse(forkInput.content).runId, fork.id);
    journal.close();
});

test("a control event type is refused by name together with the subscribable list", () => {
    const { journal, runtime, view } = create();
    const observer = spawn(runtime, view, "observer").actor;

    assert.throws(
        () => runtime.createSubscription(
            { actorId: view.ownerId, commandId: "subscribe-control" },
            view.id,
            {
                subscriberId: observer.id,
                eventTypes: ["turn.started" as never, "model.output.completed"],
            },
        ),
        /turn\.started\. Subscribable event types: turn\.finished, /,
    );
    journal.close();
});

test("removing a subscription discards only its pending deliveries and journals their IDs", () => {
    const { journal, runtime, view } = create();
    const source = spawn(runtime, view, "source").actor;
    const observer = spawn(runtime, runtime.view(view.id), "observer").actor;
    const subscribed = runtime.createSubscription(
        { actorId: view.ownerId, commandId: "subscribe-discard" },
        view.id,
        {
            subscriberId: observer.id,
            sourceActorIds: [source.id],
            eventTypes: ["model.output.completed"],
        },
    );
    const subscription = subscribed.subscriptions[0];
    assert.ok(subscription);

    const first = start(runtime, runtime.view(view.id), source.id, "discard-source-first");
    runtime.appendModelOutput(
        { actorId: source.id, commandId: "discard-output-first", turnId: first.turnId },
        view.id,
        source.id,
        { turnId: first.turnId, text: "First event." },
    );
    runtime.finishTurn(
        { actorId: source.id, commandId: "discard-finish-first", turnId: first.turnId },
        view.id,
        source.id,
        { turnId: first.turnId, outcome: "completed" },
    );
    const second = start(runtime, runtime.view(view.id), source.id, "discard-source-second");
    runtime.appendModelOutput(
        { actorId: source.id, commandId: "discard-output-second", turnId: second.turnId },
        view.id,
        source.id,
        { turnId: second.turnId, text: "Second event." },
    );
    runtime.finishTurn(
        { actorId: source.id, commandId: "discard-finish-second", turnId: second.turnId },
        view.id,
        source.id,
        { turnId: second.turnId, outcome: "completed" },
    );
    const withNormalInput = runtime.enqueueInput(
        { actorId: view.ownerId, commandId: "normal-observer-input" },
        view.id,
        { actorId: observer.id, content: "Keep this input." },
    );
    const normalInput = withNormalInput.inputs.find((input) => input.subscriptionId === null && input.actorId === observer.id);
    assert.ok(normalInput);
    const pendingDeliveries = withNormalInput.inputs.filter((input) => input.subscriptionId === subscription.id);
    assert.equal(pendingDeliveries.length, 2);

    const removed = runtime.removeSubscription(
        { actorId: view.ownerId, commandId: "remove-with-pending" },
        view.id,
        subscription.id,
        "Conversation finished.",
    );
    const discarded = removed.inputs.filter((input) => input.subscriptionId === subscription.id);
    const retained = removed.inputs.find((input) => input.id === normalInput.id);
    const removalEvent = runtime.events(view.id).find(
        (entry) => entry.type === "subscription.removed" && entry.payload.subscriptionId === subscription.id,
    );

    assert.equal(
        discarded.every((input) => input.lifecycle.kind === "discarded" && input.lifecycle.reason === "Conversation finished."),
        true,
    );
    assert.deepEqual(
        removalEvent?.type === "subscription.removed" ? removalEvent.payload.discardedInputIds : undefined,
        pendingDeliveries.map((input) => input.id),
    );
    assert.equal(retained?.lifecycle.kind, "pending");
    assert.throws(
        () => runtime.startTurn(
            { actorId: observer.id, commandId: "start-discarded" },
            view.id,
            observer.id,
            discarded[0]?.id ?? "missing",
        ),
        (error: unknown) => error instanceof DomainError && error.code === "input-discarded",
    );

    const replayEvents = runtime.events(view.id).map((entry) => {
        if (entry.type !== "subscription.removed" || entry.payload.subscriptionId !== subscription.id)
            return entry;

        const { discardedInputIds: _, ...payload } = entry.payload;

        return { ...entry, payload };
    });
    const replayed = project(replayEvents);
    assert.ok(replayed);
    assert.equal(
        viewOf(replayed).inputs
            .filter((input) => input.subscriptionId === subscription.id)
            .every((input) => input.lifecycle.kind !== "discarded"),
        true,
    );

    const boundary = replayEvents.at(-1);
    assert.ok(boundary);
    const oldTurn: JournalEvent = {
        ...boundary,
        eventId: "event-old-turn",
        sequence: boundary.sequence + 1,
        occurredAt: "2026-08-16T13:00:00.000Z",
        actorId: observer.id,
        commandId: "old-turn-after-removal",
        type: "turn.started",
        payload: { turnId: "turn-old", inputId: pendingDeliveries[0]?.id ?? "missing" },
    };
    const replayedOldHistory = project([...replayEvents, oldTurn]);
    assert.equal(replayedOldHistory?.turns.get("turn-old")?.status, "running");
    journal.close();
});

test("journal load preserves pending deliveries for legacy v3 subscription removals", (t) => {
    const root = mkdtempSync(join(tmpdir(), "ragents-legacy-subscription-removal-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const services = testServices();
    const journal = new Journal(root, services);
    const runtime = new Orchestration(journal, services);
    const view = runtime.createRun(
        { commandId: "create-legacy-removal" },
        { title: "Legacy removal", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    const source = spawn(runtime, view, "legacy-source").actor;
    const observer = spawn(runtime, runtime.view(view.id), "legacy-observer").actor;
    const subscribed = runtime.createSubscription(
        { actorId: view.ownerId, commandId: "subscribe-legacy-removal" },
        view.id,
        {
            subscriberId: observer.id,
            sourceActorIds: [source.id],
            eventTypes: ["model.output.completed"],
        },
    );
    const subscription = subscribed.subscriptions[0];
    assert.ok(subscription);
    const sourceTurn = start(runtime, runtime.view(view.id), source.id, "legacy-source");
    const delivered = runtime.appendModelOutput(
        { actorId: source.id, commandId: "legacy-source-output", turnId: sourceTurn.turnId },
        view.id,
        source.id,
        { turnId: sourceTurn.turnId, text: "Legacy delivery." },
    ).inputs.find((input) => input.subscriptionId === subscription.id);
    assert.ok(delivered);
    runtime.finishTurn(
        { actorId: source.id, commandId: "legacy-source-finish", turnId: sourceTurn.turnId },
        view.id,
        source.id,
        { turnId: sourceTurn.turnId, outcome: "completed" },
    );
    runtime.removeSubscription(
        { actorId: view.ownerId, commandId: "remove-legacy-subscription" },
        view.id,
        subscription.id,
        "Legacy removal.",
    );
    const records = structuredClone(journal.records(view.id)) as CommandRecord[];
    const removal = records
        .flatMap((record) => record.events)
        .find((event) => event.type === "subscription.removed" && event.payload.subscriptionId === subscription.id);
    assert.ok(removal && removal.type === "subscription.removed");
    delete removal.payload.discardedInputIds;
    journal.close();

    writeFileSync(
        join(root, view.id, "journal.jsonl"),
        records.map((record) => serializeJournalRecord(record, join(root, view.id))).join("\n") + "\n",
        "utf8",
    );

    let replayId = 0;
    const replayServices = {
        ...testServices(13),
        newId: (kind: string) => `replay-${kind}-${++replayId}`,
    };
    const replayJournal = new Journal(root, replayServices);
    t.after(() => replayJournal.close());
    const replayRuntime = new Orchestration(replayJournal, replayServices);
    const replayed = replayRuntime.view(view.id);
    const pending = replayed.inputs.find((input) => input.id === delivered.id);

    assert.equal(replayed.subscriptions.find((entry) => entry.id === subscription.id)?.status, "removed");
    assert.equal(pending?.lifecycle.kind, "pending");

    const started = replayRuntime.startTurn(
        { actorId: observer.id, commandId: "start-legacy-delivery" },
        view.id,
        observer.id,
        delivered.id,
    );
    const startedLifecycle = started.inputs.find((input) => input.id === delivered.id)?.lifecycle;
    assert.ok(startedLifecycle?.kind === "claimed");
    assert.equal(started.turns.find((turn) => turn.id === startedLifecycle.turnId)?.status, "running");
});

test("removing a subscription does not discard a delivery whose turn already started", () => {
    const { journal, runtime, view } = create();
    const source = spawn(runtime, view, "source").actor;
    const observer = spawn(runtime, runtime.view(view.id), "observer").actor;
    const subscribed = runtime.createSubscription(
        { actorId: view.ownerId, commandId: "subscribe-running" },
        view.id,
        {
            subscriberId: observer.id,
            sourceActorIds: [source.id],
            eventTypes: ["model.output.completed"],
        },
    );
    const subscription = subscribed.subscriptions[0];
    assert.ok(subscription);
    const sourceTurn = start(runtime, runtime.view(view.id), source.id, "running-source");
    const delivered = runtime.appendModelOutput(
        { actorId: source.id, commandId: "running-source-output", turnId: sourceTurn.turnId },
        view.id,
        source.id,
        { turnId: sourceTurn.turnId, text: "Start delivery." },
    ).inputs.find((input) => input.subscriptionId === subscription.id);
    assert.ok(delivered);
    runtime.startTurn(
        { actorId: observer.id, commandId: "start-delivery" },
        view.id,
        observer.id,
        delivered.id,
    );

    const removed = runtime.removeSubscription(
        { actorId: view.ownerId, commandId: "remove-running" },
        view.id,
        subscription.id,
        "No more events.",
    );
    const runningInput = removed.inputs.find((input) => input.id === delivered.id);
    const removalEvent = runtime.events(view.id).find(
        (entry) => entry.type === "subscription.removed" && entry.payload.subscriptionId === subscription.id,
    );

    assert.equal(runningInput?.lifecycle.kind, "claimed");
    assert.deepEqual(
        removalEvent?.type === "subscription.removed" ? removalEvent.payload.discardedInputIds : undefined,
        [],
    );
    journal.close();
});

test("an incremental append needs no run directory fsync and keeps a delivered subscription active", {
    skip: process.platform === "win32" || process.getuid?.() === 0,
}, (t) => {
    const root = mkdtempSync(join(tmpdir(), "ragents-subscription-commit-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const services = testServices();
    const journal = new Journal(root, services);
    const runtime = new Orchestration(journal, services);
    const view = runtime.createRun(
        { commandId: "create" },
        { title: "Subscription commit", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    const source = spawn(runtime, view, "source").actor;
    const observer = spawn(runtime, runtime.view(view.id), "observer").actor;
    const subscribed = runtime.createSubscription(
        { actorId: view.ownerId, commandId: "subscribe" },
        view.id,
        {
            subscriberId: observer.id,
            sourceActorIds: [source.id],
            eventTypes: ["model.output.completed"],
        },
    );
    const subscription = subscribed.subscriptions[0];
    assert.ok(subscription);
    const sourceTurn = start(runtime, runtime.view(view.id), source.id, "source-post-commit");
    const runDirectory = join(root, view.id);
    chmodSync(runDirectory, 0o300);
    let appendError: unknown;

    try {
        runtime.appendModelOutput(
            { actorId: source.id, commandId: "source-post-commit-output", turnId: sourceTurn.turnId },
            view.id,
            source.id,
            { turnId: sourceTurn.turnId, text: "Committed before fsync failed." },
        );
    } catch (error) {
        appendError = error;
    } finally {
        chmodSync(runDirectory, 0o700);
    }

    assert.equal(appendError, undefined);
    const current = runtime.view(view.id);
    assert.equal(current.inputs.filter((entry) => entry.subscriptionId === subscription.id).length, 1);
    assert.equal(current.subscriptions.find((entry) => entry.id === subscription.id)?.status, "active");
    assert.equal(runtime.events(view.id).some((entry) => entry.type === "subscription.failed"), false);
    journal.close();
});

test("runtime restart does not catch up subscriptions from existing journal events", () => {
    const { journal, runtime, view } = create();
    const source = spawn(runtime, view, "source").actor;
    const observer = spawn(runtime, runtime.view(view.id), "observer").actor;
    const subscribed = runtime.createSubscription(
        { actorId: view.ownerId, commandId: "subscribe" },
        view.id,
        {
            subscriberId: observer.id,
            sourceActorIds: [source.id],
            eventTypes: ["model.output.completed"],
        },
    );
    const subscription = subscribed.subscriptions[0];
    assert.ok(subscription);
    const sourceTurn = start(runtime, runtime.view(view.id), source.id, "source-before-restart");
    runtime.appendModelOutput(
        { actorId: source.id, commandId: "source-before-restart-output", turnId: sourceTurn.turnId },
        view.id,
        source.id,
        { turnId: sourceTurn.turnId, text: "Already observed by the old runtime." },
    );
    assert.equal(runtime.view(view.id).inputs.filter((entry) => entry.subscriptionId === subscription.id).length, 1);

    let sequence = 0;
    const withoutOldDelivery = journal.records(view.id)
        .filter((record) => !record.command.id.startsWith(`subscription:${subscription.id}:`))
        .map((record) => ({
            ...record,
            events: record.events.map((event) => ({ ...event, sequence: ++sequence })),
        }));
    let replayId = 0;
    let replayTick = 0;
    const replayServices = {
        now: () => new Date(Date.UTC(2026, 7, 16, 13, 0, replayTick++)).toISOString(),
        newId: (kind: string) => `restart-${kind}-${++replayId}`,
    };
    const replayJournal = new Journal(":memory:", replayServices);
    replayJournal.adopt(withoutOldDelivery);
    const restarted = new Orchestration(replayJournal, replayServices);

    assert.equal(
        restarted.view(view.id).inputs.filter((entry) => entry.subscriptionId === subscription.id).length,
        0,
    );
    assert.equal(restarted.view(view.id).turns.find((entry) => entry.id === sourceTurn.turnId)?.status, "interrupted");
    replayJournal.close();
    journal.close();
});

test("failed and interrupted turns consume their input without requeue", () => {
    const { journal, runtime, view } = create();
    const worker = spawn(runtime, view, "worker").actor;
    const failed = start(runtime, runtime.view(view.id), worker.id, "failed");
    runtime.finishTurn(
        { actorId: worker.id, commandId: "fail", turnId: failed.turnId },
        view.id,
        worker.id,
        { turnId: failed.turnId, outcome: "failed", reason: "Expected failure." },
    );
    const interrupted = start(runtime, runtime.view(view.id), worker.id, "interrupted");
    runtime.interruptTurn(
        { actorId: view.ownerId, commandId: "interrupt" },
        view.id,
        worker.id,
        { turnId: interrupted.turnId, reason: "Runtime stopped." },
    );

    const current = runtime.view(view.id);
    assert.deepEqual(current.turns.map((entry) => entry.status), ["failed", "interrupted"]);
    assert.equal(current.inputs.length, 2);
    assert.equal(current.inputs.every((entry) => entry.lifecycle.kind === "claimed"), true);
    assert.equal(current.inputs.some((entry) => entry.lifecycle.kind === "pending"), false);
    journal.close();
});

test("input arriving during a turn waits for the next turn", () => {
    const { journal, runtime, view } = create();
    const worker = spawn(runtime, view, "worker").actor;
    const first = start(runtime, runtime.view(view.id), worker.id, "first");
    runtime.enqueueInput(
        { actorId: view.ownerId, commandId: "input-second" },
        view.id,
        { actorId: worker.id, content: "Second input" },
    );

    const during = runtime.view(view.id);
    const secondInput = during.inputs.find((entry) => entry.lifecycle.kind === "pending");
    assert.ok(secondInput);
    assert.throws(
        () => runtime.startTurn({ actorId: worker.id, commandId: "turn-too-soon" }, view.id, worker.id, secondInput.id),
        /cannot start a turn while running/,
    );
    runtime.finishTurn(
        { actorId: worker.id, commandId: "finish-first", turnId: first.turnId },
        view.id,
        worker.id,
        { turnId: first.turnId, outcome: "completed" },
    );
    const second = runtime.startTurn(
        { actorId: worker.id, commandId: "turn-second" },
        view.id,
        worker.id,
        secondInput.id,
    );
    assert.equal(second.turns.length, 2);
    journal.close();
});

test("action resolution stays an event and does not route actor input", () => {
    const { journal, runtime, view } = create();
    const worker = spawn(runtime, view, "worker").actor;
    const turn = start(runtime, runtime.view(view.id), worker.id, "question");
    const proposed = runtime.proposeAction(
        { actorId: worker.id, commandId: "question", turnId: turn.turnId },
        view.id,
        { kind: "question", title: "Choose", question: { options: ["A", "B"] } },
    );
    const action = proposed.actions[0];
    assert.ok(action);
    const resolved = runtime.resolveAction(
        { actorId: view.ownerId, commandId: "answer" },
        view.id,
        action.id,
        { decision: "approved", response: "A" },
    );

    assert.equal(resolved.actions[0]?.status, "approved");
    assert.equal(resolved.inputs.length, 1);
    assert.equal(runtime.events(view.id).at(-1)?.type, "action.resolved");
    journal.close();
});

test("artifact access cannot be self-granted and may be forwarded by an authorized actor", () => {
    const { journal, runtime, view } = create();
    const author = spawn(runtime, view, "author", [grant("artifact.publish")]).actor;
    const reader = spawn(runtime, runtime.view(view.id), "reader", [grant("actor.input")]).actor;
    const recipient = spawn(runtime, runtime.view(view.id), "recipient").actor;
    const turn = start(runtime, runtime.view(view.id), author.id, "publish");
    const published = runtime.publishArtifact(
        { actorId: author.id, commandId: "publish", turnId: turn.turnId },
        view.id,
        { title: "Result", mediaType: "text/plain", content: "content", previousVersionId: null },
    );
    const artifact = published.artifacts[0];
    assert.ok(artifact);
    runtime.finishTurn(
        { actorId: author.id, commandId: "finish-publish", turnId: turn.turnId },
        view.id,
        author.id,
        { turnId: turn.turnId, outcome: "completed" },
    );

    assert.equal(Buffer.from(runtime.artifactContent(view.id, artifact.id, author.id).content).toString("utf8"), "content");
    assert.equal(Buffer.from(runtime.artifactContent(view.id, artifact.id, view.ownerId).content).toString("utf8"), "content");
    assert.throws(() => runtime.artifactContent(view.id, artifact.id, reader.id), /may not read artifact/);
    const unshared = runtime.enqueueInput(
        { actorId: view.ownerId, commandId: "unshared-input" },
        view.id,
        { actorId: reader.id, content: "No artifact attached." },
    );
    const escapedInput = runtime.view(view.id).inputs.find((entry) => entry.id === unshared.inputs.at(-1)?.id);
    assert.ok(escapedInput);
    (escapedInput.artifactIds as string[]).push(artifact.id);
    assert.throws(() => runtime.artifactContent(view.id, artifact.id, reader.id), /may not read artifact/);

    const escapedRecord = journal.records(view.id)
        .flatMap((record) => record.events)
        .find((event) => event.type === "artifact.published");
    assert.ok(escapedRecord?.type === "artifact.published");
    assert.throws(() => {
        escapedRecord.payload.artifact.title = "Tampered";
    }, TypeError);
    const fork = runtime.forkRun({ commandId: "snapshot-fork" }, view.id, runtime.view(view.id).revision);
    assert.equal(fork.artifacts.find((entry) => entry.id === artifact.id)?.title, "Result");
    assert.throws(() => runtime.artifactContent(fork.id, artifact.id, reader.id), /may not read artifact/);

    const readerTurn = start(runtime, runtime.view(view.id), reader.id, "reader");
    assert.throws(
        () => runtime.enqueueInput(
            { actorId: reader.id, commandId: "self-share-artifact", turnId: readerTurn.turnId },
            view.id,
            { actorId: reader.id, content: "Grant this artifact to myself.", artifactIds: [artifact.id] },
        ),
        (error) => error instanceof DomainError && error.code === "artifact-read-denied" && error.status === 403,
    );
    runtime.enqueueInput(
        { actorId: view.ownerId, commandId: "share-artifact" },
        view.id,
        { actorId: reader.id, content: "Read the attached result.", artifactIds: [artifact.id] },
    );
    assert.equal(Buffer.from(runtime.artifactContent(view.id, artifact.id, reader.id).content).toString("utf8"), "content");
    runtime.enqueueInput(
        { actorId: reader.id, commandId: "forward-artifact", turnId: readerTurn.turnId },
        view.id,
        { actorId: recipient.id, content: "Read the forwarded result.", artifactIds: [artifact.id] },
    );
    assert.equal(Buffer.from(runtime.artifactContent(view.id, artifact.id, recipient.id).content).toString("utf8"), "content");
    journal.close();
});

test("delegation uses any covering delegable grant", () => {
    const { journal, runtime, view } = create();
    const lead = spawn(runtime, view, "lead", [
        grant("agent.spawn"),
        grant("artifact.publish", false),
        grant("artifact.publish"),
    ]).actor;
    const turn = start(runtime, runtime.view(view.id), lead.id, "delegate");
    const child = spawn(
        runtime,
        runtime.view(view.id),
        "child",
        [grant("artifact.publish")],
        lead.id,
        turn.turnId,
    ).actor;

    assert.deepEqual(child.grants, [grant("artifact.publish")]);
    journal.close();
});

test("repeated commands are idempotent and collisions fail", () => {
    const { journal, runtime, view } = create();
    const worker = spawn(runtime, view, "worker").actor;
    runtime.enqueueInput(
        { actorId: view.ownerId, commandId: "same-input" },
        view.id,
        { actorId: worker.id, content: "Once" },
    );
    const revision = runtime.view(view.id).revision;
    runtime.enqueueInput(
        { actorId: view.ownerId, commandId: "same-input" },
        view.id,
        { actorId: worker.id, content: "Once" },
    );
    assert.equal(runtime.view(view.id).revision, revision);
    assert.throws(
        () => runtime.enqueueInput(
            { actorId: view.ownerId, commandId: "same-input" },
            view.id,
            { actorId: worker.id, content: "Different" },
        ),
        /already used for another command/,
    );
    journal.close();
});

test("the owner holds the complete v3 capability vocabulary", () => {
    const { journal, view } = create();
    const owner = view.actors.find((entry) => entry.id === view.ownerId);
    assert.deepEqual(owner?.grants.map((entry) => entry.capability), capabilityNames);
    journal.close();
});

test("runtime startup isolates an unwritable open-turn journal and recovers healthy runs", {
    skip: process.platform === "win32" || process.getuid?.() === 0,
}, (t) => {
    const root = mkdtempSync(join(tmpdir(), "ragents-recovery-isolation-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const services = testServices();
    const journal = new Journal(root, services);
    const runtime = new Orchestration(journal, services);
    const views = ["blocked", "healthy"].map((name) => runtime.createRun({ commandId: `create-${name}` }, {
        title: name, ownerHandle: "owner", ownerDisplayName: "Owner",
    }));
    const turns = views.map((view, index) => {
        const worker = spawn(runtime, view, `worker-${index}`);
        return start(runtime, worker.view, worker.actor.id, `turn-${index}`);
    });
    journal.close();
    const blockedPath = join(root, views[0]!.id, "journal.jsonl");
    chmodSync(blockedPath, 0o400);
    const reopened = new Journal(root, services);
    t.after(() => reopened.close());
    const restarted = new Orchestration(reopened, services);

    assert.deepEqual(reopened.runIds(), [views[1]!.id]);
    assert.throws(() => restarted.state(views[0]!.id), { code: "journal-unavailable", status: 409 });
    assert.equal(restarted.view(views[1]!.id).turns.find((turn) => turn.id === turns[1]!.turnId)?.status, "interrupted");
    assert.equal(reopened.stateOf(views[0]!.id)?.turns.get(turns[0]!.turnId)?.status, "running");
});

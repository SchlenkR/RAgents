import assert from "node:assert/strict";
import test from "node:test";

import { project } from "../src/domain/projection.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { manualExecution, testServices } from "./support.ts";

const setup = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun(
        { commandId: "create" },
        { title: "Creator alerts", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-parent" }, view.id, {
        handle: "parent",
        displayName: "Parent",
        prompt: "",
        execution: manualExecution(),
        grants: [
            { capability: "agent.spawn", scope: { kind: "run" }, delegable: true },
            { capability: "event.subscribe", scope: { kind: "run" }, delegable: true },
        ],
        toolNames: [],
    });
    const parent = view.actors.find((entry) => entry.handle === "parent");
    assert.ok(parent?.kind === "agent");
    view = runtime.enqueueInput(
        { actorId: view.ownerId, commandId: "parent-input" },
        view.id,
        { actorId: parent.id, content: "Spawn a child." },
    );
    const parentInput = view.inputs.at(-1);
    assert.ok(parentInput);
    view = runtime.startTurn({ actorId: parent.id, commandId: "parent-turn" }, view.id, parent.id, parentInput.id);
    const parentTurn = view.turns.at(-1);
    assert.ok(parentTurn);
    view = runtime.spawnAgent(
        { actorId: parent.id, commandId: "spawn-child", turnId: parentTurn.id },
        view.id,
        {
            handle: "child",
            displayName: "Child",
            prompt: "",
            execution: manualExecution(),
            grants: [],
            toolNames: [],
        },
    );
    runtime.finishTurn(
        { actorId: parent.id, commandId: "finish-parent", turnId: parentTurn.id },
        view.id,
        parent.id,
        { turnId: parentTurn.id, outcome: "completed" },
    );
    const child = runtime.view(view.id).actors.find((entry) => entry.handle === "child");
    assert.ok(child?.kind === "agent");

    return { journal, runtime, runId: view.id, parent, child };
};

const failChildTurn = (
    runtime: Orchestration,
    runId: string,
    childId: string,
    ownerId: string,
    suffix: string,
) => {
    let view = runtime.enqueueInput(
        { actorId: ownerId, commandId: `child-input-${suffix}` },
        runId,
        { actorId: childId, content: "Work." },
    );
    const input = view.inputs.findLast((entry) => entry.actorId === childId && entry.lifecycle.kind === "pending");
    assert.ok(input);
    view = runtime.startTurn({ actorId: childId, commandId: `child-turn-${suffix}` }, runId, childId, input.id);
    const turn = view.turns.at(-1);
    assert.ok(turn);
    runtime.finishTurn(
        { actorId: childId, commandId: `child-finish-${suffix}`, turnId: turn.id },
        runId,
        childId,
        { turnId: turn.id, outcome: "failed", reason: "Kaputt gegangen." },
    );
};

test("a failed child turn is delivered to its creator without any subscription", () => {
    const context = setup();

    try {
        const before = context.runtime.view(context.runId).inputs.length;
        failChildTurn(context.runtime, context.runId, context.child.id, context.runtime.state(context.runId).ownerId, "one");
        const inputs = context.runtime.view(context.runId).inputs;
        const alert = inputs.find((entry) =>
            entry.actorId === context.parent.id && entry.content.includes("Automatische Meldung"));

        assert.ok(alert, "the creator did not receive an alert input");
        assert.match(alert.content, /@child/);
        assert.match(alert.content, /GESCHEITERT: Kaputt gegangen\./);
        assert.equal(alert.subscriptionId, null);
        assert.equal(alert.sourceEventIds.length, 1);
        assert.equal(inputs.length, before + 2);
    } finally {
        context.journal.close();
    }
});

test("an explicit matching subscription suppresses the duplicate creator alert", () => {
    const context = setup();

    try {
        const ownerId = context.runtime.state(context.runId).ownerId;
        let view = context.runtime.enqueueInput(
            { actorId: ownerId, commandId: "parent-subscribe-input" },
            context.runId,
            { actorId: context.parent.id, content: "Subscribe to your child." },
        );
        const input = view.inputs.findLast((entry) => entry.actorId === context.parent.id && entry.lifecycle.kind === "pending");
        assert.ok(input);
        view = context.runtime.startTurn(
            { actorId: context.parent.id, commandId: "parent-subscribe-turn" },
            context.runId,
            context.parent.id,
            input.id,
        );
        const turn = view.turns.at(-1);
        assert.ok(turn);
        context.runtime.createSubscription(
            { actorId: context.parent.id, commandId: "subscribe-child", turnId: turn.id },
            context.runId,
            {
                subscriberId: context.parent.id,
                sourceActorIds: [context.child.id],
                sourceActorKinds: null,
                eventTypes: ["turn.finished"],
                includeSelf: false,
            },
        );
        context.runtime.finishTurn(
            { actorId: context.parent.id, commandId: "parent-subscribe-finish", turnId: turn.id },
            context.runId,
            context.parent.id,
            { turnId: turn.id, outcome: "completed" },
        );
        failChildTurn(context.runtime, context.runId, context.child.id, context.runtime.state(context.runId).ownerId, "two");
        const inputs = context.runtime.view(context.runId).inputs.filter((entry) => entry.actorId === context.parent.id);
        const alerts = inputs.filter((entry) => entry.content.includes("Automatische Meldung"));
        const deliveries = inputs.filter((entry) => entry.subscriptionId !== null);

        assert.equal(alerts.length, 0);
        assert.equal(deliveries.length, 1);
    } finally {
        context.journal.close();
    }
});

test("a failing agent created by the human owner alerts nobody", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);

    try {
        let view = runtime.createRun(
            { commandId: "create" },
            { title: "Owner child", ownerHandle: "owner", ownerDisplayName: "Owner" },
        );
        view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-worker" }, view.id, {
            handle: "worker",
            displayName: "Worker",
            prompt: "",
            execution: manualExecution(),
            grants: [],
            toolNames: [],
        });
        const worker = view.actors.find((entry) => entry.handle === "worker");
        assert.ok(worker);
        failChildTurn(runtime, view.id, worker.id, view.ownerId, "owner");
        const alerts = runtime.view(view.id).inputs.filter((entry) => entry.content.includes("Automatische Meldung"));

        assert.equal(alerts.length, 0);
    } finally {
        journal.close();
    }
});

const branchGrants = [
    { capability: "agent.spawn" as const, scope: { kind: "run" as const }, delegable: true },
    { capability: "execution.stopOwned" as const, scope: { kind: "run" as const }, delegable: true },
];

const startTurnOf = (runtime: Orchestration, runId: string, actorId: string, name: string) => {
    const view = runtime.enqueueInput(
        { actorId: runtime.state(runId).ownerId, commandId: `input-${name}` },
        runId,
        { actorId, content: name },
    );
    const input = view.inputs.findLast((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const started = runtime.startTurn({ actorId, commandId: `turn-${name}` }, runId, actorId, input.id);
    const turn = started.turns.at(-1);
    assert.ok(turn);

    return turn.id;
};

const spawnIn = (runtime: Orchestration, runId: string, creatorId: string, turnId: string | undefined, handle: string) => {
    const view = runtime.spawnAgent(
        { actorId: creatorId, commandId: `spawn-${handle}`, ...(turnId ? { turnId } : {}) },
        runId,
        { handle, displayName: handle, prompt: "", execution: manualExecution(), grants: branchGrants, toolNames: [] },
    );
    const actor = view.actors.find((entry) => entry.handle === handle);
    assert.ok(actor?.kind === "agent");

    return actor;
};

const lineage = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const runId = runtime.createRun(
        { commandId: "create" },
        { title: "Interruptions", ownerHandle: "owner", ownerDisplayName: "Owner" },
    ).id;
    const ownerId = runtime.state(runId).ownerId;
    const coordinator = spawnIn(runtime, runId, ownerId, undefined, "coordinator");
    const coordinatorTurn = startTurnOf(runtime, runId, coordinator.id, "coordinator");
    const worker = spawnIn(runtime, runId, coordinator.id, coordinatorTurn, "worker");
    runtime.finishTurn(
        { actorId: coordinator.id, commandId: "finish-coordinator", turnId: coordinatorTurn },
        runId,
        coordinator.id,
        { turnId: coordinatorTurn, outcome: "completed" },
    );
    const workerTurn = startTurnOf(runtime, runId, worker.id, "worker");
    const helper = spawnIn(runtime, runId, worker.id, workerTurn, "helper");
    startTurnOf(runtime, runId, helper.id, "helper");

    return { journal, runtime, runId, ownerId, coordinator, worker, workerTurn, helper };
};

const alertsFor = (runtime: Orchestration, runId: string, actorId: string) =>
    runtime.view(runId).inputs.filter((entry) => entry.actorId === actorId && entry.content.includes("Automatische Meldung"));

test("an interruption without a stop alerts the creator of the actor whose turn it ended", () => {
    const context = lineage();

    try {
        const helperTurn = context.runtime.view(context.runId).turns.findLast((entry) => entry.actorId === context.helper.id);
        assert.ok(helperTurn);
        context.runtime.interruptTurn(
            { actorId: context.ownerId, commandId: "owner-interrupts-helper" },
            context.runId,
            context.helper.id,
            { turnId: helperTurn.id, reason: "Die Zeitgrenze ist abgelaufen." },
        );
        const alerts = alertsFor(context.runtime, context.runId, context.worker.id);

        assert.equal(alerts.length, 1);
        assert.match(alerts[0]!.content, /@helper wurde unterbrochen: Die Zeitgrenze ist abgelaufen\./);
        assert.equal(alertsFor(context.runtime, context.runId, context.coordinator.id).length, 0);
    } finally {
        context.journal.close();
    }
});

test("a deliberate stop alerts nobody, whoever stops, so a stopped branch wakes no one", () => {
    const context = lineage();

    try {
        context.runtime.stopActor(
            { actorId: context.worker.id, commandId: "worker-stops-helper", turnId: context.workerTurn },
            context.runId,
            context.helper.id,
            "Erledigt.",
        );

        assert.equal(alertsFor(context.runtime, context.runId, context.worker.id).length, 0);
        assert.equal(alertsFor(context.runtime, context.runId, context.coordinator.id).length, 0);

        context.runtime.stopActor(
            { actorId: context.ownerId, commandId: "owner-stops-worker" },
            context.runId,
            context.worker.id,
            "Der Bediener hält an.",
        );

        assert.equal(alertsFor(context.runtime, context.runId, context.coordinator.id).length, 0);
    } finally {
        context.journal.close();
    }
});

test("a subscription on an actor sees its interruption and stop, whoever stops it", () => {
    const context = lineage();

    try {
        const subscribed = context.runtime.createSubscription(
            { actorId: context.ownerId, commandId: "coordinator-watches-worker" },
            context.runId,
            {
                subscriberId: context.coordinator.id,
                sourceActorIds: [context.worker.id],
                sourceActorKinds: ["agent"],
                eventTypes: ["turn.interrupted", "actor.stopped"],
                includeSelf: false,
            },
        );
        const subscription = subscribed.subscriptions.at(-1);
        assert.ok(subscription);
        context.runtime.stopActor(
            { actorId: context.ownerId, commandId: "owner-stops-worker" },
            context.runId,
            context.worker.id,
            "Der Bediener hält an.",
        );
        const events = context.runtime.events(context.runId);
        const deliveries = context.runtime.view(context.runId).inputs
            .filter((entry) => entry.subscriptionId === subscription.id)
            .map((entry) => events.find((event) => event.eventId === entry.sourceEventIds[0]));

        assert.deepEqual(deliveries.map((event) => event?.type), ["turn.interrupted", "actor.stopped"]);
        assert.ok(deliveries.every((event) => event?.actorId === context.ownerId));
        assert.equal(deliveries[1]?.type === "actor.stopped" && deliveries[1].payload.actorId, context.worker.id);
        assert.ok(project(events));
    } finally {
        context.journal.close();
    }
});

test("a subscription excludes the interruption of its own subscriber's turn without includeSelf", () => {
    const context = lineage();

    try {
        const subscribed = context.runtime.createSubscription(
            { actorId: context.ownerId, commandId: "worker-watches-own-end" },
            context.runId,
            { subscriberId: context.worker.id, eventTypes: ["turn.interrupted"], includeSelf: false },
        );
        const subscription = subscribed.subscriptions.at(-1);
        assert.ok(subscription);
        context.runtime.interruptTurn(
            { actorId: context.ownerId, commandId: "owner-interrupts-worker" },
            context.runId,
            context.worker.id,
            { turnId: context.workerTurn, reason: "Die Zeitgrenze ist abgelaufen." },
        );

        assert.equal(context.runtime.view(context.runId).inputs.filter((entry) => entry.subscriptionId === subscription.id).length, 0);
    } finally {
        context.journal.close();
    }
});

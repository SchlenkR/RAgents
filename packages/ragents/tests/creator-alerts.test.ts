import assert from "node:assert/strict";
import test from "node:test";

import { manualExecution } from "../src/domain/driver.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { testServices } from "./support.ts";

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

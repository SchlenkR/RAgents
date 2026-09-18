import assert from "node:assert/strict";
import test from "node:test";

import { manualExecution } from "../src/domain/driver.ts";
import type { CapabilityGrant, RunView } from "../src/domain/model.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { testServices } from "./support.ts";

const grant = (capability: CapabilityGrant["capability"]): CapabilityGrant => ({
    capability,
    scope: { kind: "run" },
    delegable: true,
});

const fixture = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const view = runtime.createRun(
        { commandId: "create" },
        { title: "Stop ancestry", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );

    return { journal, runtime, view };
};

const spawn = (
    runtime: Orchestration,
    view: RunView,
    handle: string,
    creatorId = view.ownerId,
    turnId?: string,
    grants: readonly CapabilityGrant[] = [],
) => {
    const current = runtime.spawnAgent(
        { actorId: creatorId, commandId: `spawn-${handle}`, ...(turnId ? { turnId } : {}) },
        view.id,
        {
            handle,
            displayName: handle,
            prompt: "Work.",
            execution: manualExecution(),
            grants,
            toolNames: [],
        },
    );
    const actor = current.actors.find((entry) => entry.handle === handle && entry.kind === "agent");
    assert.ok(actor);

    return actor;
};

const start = (runtime: Orchestration, view: RunView, actorId: string, name: string) => {
    const queued = runtime.enqueueInput(
        { actorId: view.ownerId, commandId: `input-${name}` },
        view.id,
        { actorId, content: name },
    );
    const input = queued.inputs.find((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const running = runtime.startTurn({ actorId, commandId: `turn-${name}` }, view.id, actorId, input.id);
    const actor = running.actors.find((entry) => entry.id === actorId);

    if (!actor || actor.kind === "human" || actor.lifecycle.kind !== "running")
        throw new Error(`Actor ${actorId} did not start.`);

    return actor.lifecycle.turnId;
};

test("stopping a running actor interrupts its turn before actor.stopped", () => {
    const { journal, runtime, view } = fixture();
    const worker = spawn(runtime, view, "worker");
    const turnId = start(runtime, runtime.view(view.id), worker.id, "work");
    const stopped = runtime.stopActor(
        { actorId: view.ownerId, commandId: "stop" },
        view.id,
        worker.id,
        "No longer needed.",
    );

    const current = stopped.actors.find((entry) => entry.id === worker.id);
    if (!current || current.kind === "human")
        throw new Error("Worker is missing.");
    assert.equal(current.lifecycle.kind, "stopped");
    assert.equal(stopped.turns.find((entry) => entry.id === turnId)?.status, "interrupted");
    assert.deepEqual(
        runtime.events(view.id).slice(-2).map((entry) => entry.type),
        ["turn.interrupted", "actor.stopped"],
    );
    journal.close();
});

test("an actor with execution.stopOwned may stop an indirect descendant", () => {
    const { journal, runtime, view } = fixture();
    const branchGrants = [grant("agent.spawn"), grant("execution.stopOwned")];
    const lead = spawn(runtime, view, "lead", view.ownerId, undefined, branchGrants);
    const leadTurn = start(runtime, runtime.view(view.id), lead.id, "lead");
    const child = spawn(runtime, runtime.view(view.id), "child", lead.id, leadTurn, branchGrants);
    const childTurn = start(runtime, runtime.view(view.id), child.id, "child");
    const grandchild = spawn(runtime, runtime.view(view.id), "grandchild", child.id, childTurn);
    const subscribed = runtime.createSubscription(
        { actorId: view.ownerId, commandId: "subscribe-grandchild" },
        view.id,
        { subscriberId: grandchild.id, eventTypes: ["model.output.completed"] },
    );
    const subscription = subscribed.subscriptions.at(-1);
    assert.ok(subscription);

    const stopped = runtime.stopActor(
        { actorId: lead.id, commandId: "stop-grandchild", turnId: leadTurn },
        view.id,
        grandchild.id,
        "Branch complete.",
    );

    const target = stopped.actors.find((entry) => entry.id === grandchild.id);
    const activeChild = stopped.actors.find((entry) => entry.id === child.id);
    if (!target || target.kind === "human" || !activeChild || activeChild.kind === "human")
        throw new Error("Branch actor is missing.");
    assert.equal(target.lifecycle.kind, "stopped");
    assert.notEqual(activeChild.lifecycle.kind, "stopped");
    assert.equal(stopped.subscriptions.find((entry) => entry.id === subscription.id)?.status, "removed");
    assert.deepEqual(
        runtime.events(view.id).slice(-2).map((entry) => entry.type),
        ["actor.stopped", "subscription.removed"],
    );
    journal.close();
});

test("stopping an actor removes its active subscriptions", () => {
    const { journal, runtime, view } = fixture();
    const worker = spawn(runtime, view, "worker");
    const source = spawn(runtime, runtime.view(view.id), "source");
    const subscribed = runtime.createSubscription(
        { actorId: view.ownerId, commandId: "subscribe-worker" },
        view.id,
        {
            subscriberId: worker.id,
            sourceActorIds: [source.id],
            eventTypes: ["model.output.completed"],
        },
    );
    const subscription = subscribed.subscriptions.at(-1);
    assert.ok(subscription);
    const sourceTurn = start(runtime, runtime.view(view.id), source.id, "source-output");
    const delivered = runtime.appendModelOutput(
        { actorId: source.id, commandId: "source-output", turnId: sourceTurn },
        view.id,
        source.id,
        { turnId: sourceTurn, text: "Pending delivery." },
    ).inputs.find((input) => input.subscriptionId === subscription.id);
    assert.ok(delivered);
    runtime.finishTurn(
        { actorId: source.id, commandId: "finish-source-output", turnId: sourceTurn },
        view.id,
        source.id,
        { turnId: sourceTurn, outcome: "completed" },
    );

    const stopped = runtime.stopActor(
        { actorId: view.ownerId, commandId: "stop-worker" },
        view.id,
        worker.id,
        "No longer needed.",
    );

    assert.equal(stopped.subscriptions.find((entry) => entry.id === subscription.id)?.status, "removed");
    const stoppedInput = stopped.inputs.find((input) => input.id === delivered.id);
    assert.ok(stoppedInput && stoppedInput.lifecycle.kind === "discarded");
    assert.equal(stoppedInput.lifecycle.reason, "No longer needed.");
    assert.deepEqual(
        runtime.events(view.id).slice(-2).map((entry) => entry.type),
        ["actor.stopped", "subscription.removed"],
    );
    const removal = runtime.events(view.id).at(-1);
    assert.deepEqual(
        removal?.type === "subscription.removed" ? removal.payload.discardedInputIds : undefined,
        [delivered.id],
    );
    journal.close();
});

test("execution.stopOwned does not allow stopping a foreign branch", () => {
    const { journal, runtime, view } = fixture();
    const stopGrant = [grant("execution.stopOwned")];
    const left = spawn(runtime, view, "left", view.ownerId, undefined, [grant("agent.spawn"), ...stopGrant]);
    const leftTurn = start(runtime, runtime.view(view.id), left.id, "left");
    const child = spawn(runtime, runtime.view(view.id), "left-child", left.id, leftTurn);
    const right = spawn(runtime, runtime.view(view.id), "right", view.ownerId, undefined, stopGrant);
    const rightTurn = start(runtime, runtime.view(view.id), right.id, "right");

    assert.throws(
        () => runtime.stopActor(
            { actorId: right.id, commandId: "foreign-stop", turnId: rightTurn },
            view.id,
            child.id,
            "Not my branch.",
        ),
        /may only stop actors in its own branch/,
    );
    const target = runtime.view(view.id).actors.find((entry) => entry.id === child.id);
    if (!target || target.kind === "human")
        throw new Error("Target actor is missing.");
    assert.notEqual(target.lifecycle.kind, "stopped");
    journal.close();
});

test("an actor without execution.stopOwned cannot stop its descendants", () => {
    const { journal, runtime, view } = fixture();
    const lead = spawn(runtime, view, "lead", view.ownerId, undefined, [grant("agent.spawn")]);
    const leadTurn = start(runtime, runtime.view(view.id), lead.id, "lead");
    const child = spawn(runtime, runtime.view(view.id), "child", lead.id, leadTurn);

    assert.throws(
        () => runtime.stopActor(
            { actorId: lead.id, commandId: "ungranted-stop", turnId: leadTurn },
            view.id,
            child.id,
            "Denied.",
        ),
        /may not use execution.stopOwned/,
    );
    journal.close();
});

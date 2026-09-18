import assert from "node:assert/strict";
import test from "node:test";

import { manualExecution } from "../src/domain/driver.ts";
import { DomainError } from "../src/runtime/domain-error.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { testServices } from "./support.ts";

test("a run forks at an event sequence and then continues independently", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let source = runtime.createRun(
        { commandId: "create-source" },
        { title: "Source", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    source = runtime.spawnAgent({ actorId: source.ownerId, commandId: "spawn" }, source.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Work.",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });
    const worker = source.actors.find((entry) => entry.handle === "worker");
    assert.ok(worker);
    source = runtime.enqueueInput(
        { actorId: source.ownerId, commandId: "source-input" },
        source.id,
        { actorId: worker.id, content: "Before the fork" },
    );
    const sequence = source.revision;

    const fork = runtime.forkRun({ commandId: "fork" }, source.id, sequence);
    runtime.enqueueInput(
        { actorId: source.ownerId, commandId: "source-after" },
        source.id,
        { actorId: worker.id, content: "Source only" },
    );
    runtime.enqueueInput(
        { actorId: fork.ownerId, commandId: "fork-after" },
        fork.id,
        { actorId: worker.id, content: "Fork only" },
    );

    assert.notEqual(fork.id, source.id);
    assert.deepEqual(fork.forkedFrom, { runId: source.id, sequence });
    assert.deepEqual(runtime.view(source.id).inputs.map((entry) => entry.content), ["Before the fork", "Source only"]);
    assert.deepEqual(runtime.view(fork.id).inputs.map((entry) => entry.content), ["Before the fork", "Fork only"]);
    assert.equal(runtime.events(fork.id).every((entry) => entry.runId === fork.id && entry.schemaVersion === 3), true);
    journal.close();
});

test("forking rejects a sequence outside the run", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const source = runtime.createRun(
        { commandId: "create-source" },
        { title: "Source", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );

    assert.throws(() => runtime.forkRun({ commandId: "fork-zero" }, source.id, 0), /has no sequence 0/);
    assert.throws(() => runtime.forkRun({ commandId: "fork-late" }, source.id, source.revision + 1), /has no sequence/);
    journal.close();
});

test("forking rejects a command ID already used by another command", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let source = runtime.createRun(
        { commandId: "create-source" },
        { title: "Source", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    source = runtime.spawnAgent({ actorId: source.ownerId, commandId: "spawn" }, source.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Work.",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });

    assert.throws(
        () => runtime.forkRun({ commandId: "spawn" }, source.id, source.revision),
        (error) => error instanceof DomainError && error.code === "command-id-collision" && error.status === 409,
    );
    assert.deepEqual(journal.runIds(), [source.id]);
    journal.close();
});

test("a fork command ID is idempotent only for the same source and sequence", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let first = runtime.createRun(
        { commandId: "create-first" },
        { title: "First", ownerHandle: "first", ownerDisplayName: "First" },
    );
    first = runtime.spawnAgent({ actorId: first.ownerId, commandId: "spawn-first" }, first.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Work.",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });
    const second = runtime.createRun(
        { commandId: "create-second" },
        { title: "Second", ownerHandle: "second", ownerDisplayName: "Second" },
    );
    const fork = runtime.forkRun({ commandId: "fork" }, first.id, first.revision);

    assert.equal(runtime.forkRun({ commandId: "fork" }, first.id, first.revision).id, fork.id);
    assert.throws(
        () => runtime.forkRun({ commandId: "fork" }, first.id, first.revision - 1),
        (error) => error instanceof DomainError && error.code === "command-id-collision" && error.status === 409,
    );
    assert.throws(
        () => runtime.forkRun({ commandId: "fork" }, second.id, second.revision),
        (error) => error instanceof DomainError && error.code === "command-id-collision" && error.status === 409,
    );
    journal.close();
});

test("forking rejects a sequence inside a multi-event command", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let source = runtime.createRun(
        { commandId: "create-source" },
        { title: "Source", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    source = runtime.spawnAgent({ actorId: source.ownerId, commandId: "spawn" }, source.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Work.",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });
    const worker = source.actors.find((entry) => entry.handle === "worker");
    assert.ok(worker);
    source = runtime.createSubscription(
        { actorId: source.ownerId, commandId: "subscribe" },
        source.id,
        { subscriberId: worker.id, eventTypes: ["model.output.completed"] },
    );
    source = runtime.stopActor(
        { actorId: source.ownerId, commandId: "stop" },
        source.id,
        worker.id,
        "Finished.",
    );
    const stopEvents = runtime.events(source.id).filter((event) => event.commandId === "stop");
    assert.deepEqual(stopEvents.map((event) => event.type), ["actor.stopped", "subscription.removed"]);
    const insideCommand = stopEvents[0]?.sequence;
    const commandBoundary = stopEvents.at(-1)?.sequence;
    assert.ok(insideCommand);
    assert.ok(commandBoundary);

    assert.throws(
        () => runtime.forkRun({ commandId: "fork-inside" }, source.id, insideCommand),
        (error) => error instanceof DomainError
            && error.code === "invalid-sequence"
            && error.status === 400
            && /not a command boundary/.test(error.message),
    );
    const fork = runtime.forkRun({ commandId: "fork-boundary" }, source.id, commandBoundary);
    const forkedWorker = fork.actors.find((actor) => actor.id === worker.id);
    assert.ok(forkedWorker && forkedWorker.kind !== "human");
    assert.deepEqual(fork.forkedFrom, { runId: source.id, sequence: commandBoundary });
    assert.equal(forkedWorker.lifecycle.kind, "stopped");
    journal.close();
});

test("forking rejects a boundary with an open turn", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let source = runtime.createRun(
        { commandId: "create-source" },
        { title: "Source", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    source = runtime.spawnAgent({ actorId: source.ownerId, commandId: "spawn" }, source.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Work.",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });
    const worker = source.actors.find((entry) => entry.handle === "worker");
    assert.ok(worker && worker.kind !== "human");
    source = runtime.enqueueInput({ actorId: source.ownerId, commandId: "input" }, source.id, {
        actorId: worker.id,
        content: "Start",
    });
    const input = source.inputs.find((entry) => entry.actorId === worker.id);
    assert.ok(input);
    source = runtime.startTurn({ actorId: worker.id, commandId: "turn" }, source.id, worker.id, input.id);
    const running = source.actors.find((entry) => entry.id === worker.id);
    assert.ok(running && running.kind !== "human" && running.lifecycle.kind === "running");

    assert.throws(
        () => runtime.forkRun({ commandId: "fork-running" }, source.id, source.revision),
        (error) => error instanceof DomainError
            && error.code === "invalid-sequence"
            && error.status === 400
            && /has an open turn/.test(error.message),
    );

    source = runtime.interruptTurn(
        { actorId: source.ownerId, commandId: "interrupt" },
        source.id,
        worker.id,
        { turnId: running.lifecycle.turnId, reason: "Stop before fork." },
    );
    const fork = runtime.forkRun({ commandId: "fork-interrupted" }, source.id, source.revision);
    assert.equal(fork.turns.at(-1)?.status, "interrupted");
    journal.close();
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { unrestrictedAccess, createAccessContext } from "../src/access.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { journalEventOf } from "../src/domain/event-validation.ts";
import { project } from "../src/domain/projection.ts";
import type { JournalEvent } from "../src/domain/events.ts";
import type { ExecutableActor, RunView } from "../src/domain/model.ts";
import { runContracts } from "../src/http/contracts.ts";
import { runtimeMethods } from "../src/http/methods.ts";
import { DomainError } from "../src/runtime/domain-error.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { RunStopper } from "../src/runtime/stop.ts";
import type { RuntimeServices } from "../src/runtime/services.ts";
import type { MethodContext } from "../src/rpc/contribution.ts";
import { FakeDriver, allGrants, catalog, deferred, executionFor, noUsage, postTo, registryOf, setupRun, testServices } from "./support.ts";

const methodContext = (userId: string | null = null): MethodContext => ({
    access: userId === null ? unrestrictedAccess : createAccessContext({ enabled: true, user: { id: userId, label: userId, rights: ["*"] } }),
    signal: new AbortController().signal,
    progress: () => undefined,
    connection: { id: "test", userId, streamless: true, call: () => Promise.reject(new Error("no client")), onClose: () => () => undefined },
    local: true,
});

const untilAborted = (signal: AbortSignal) => new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
});

const actorOf = (view: RunView, actorId: string): ExecutableActor => {
    const found = view.actors.find((entry) => entry.id === actorId);
    assert.ok(found && found.kind !== "human");
    return found;
};

const settle = async (scheduler: TurnScheduler) => {
    await scheduler.waitForIdle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await scheduler.waitForIdle();
};

const typesOf = (events: readonly JournalEvent[], commandId: string) =>
    events.filter((event) => event.commandId === commandId).map((event) => event.type);

test("a stop interrupts the turns of all actors including sub-agents, holds every later input, and a human input continues it in one turn with the human input last", async () => {
    const setup = setupRun({ grants: allGrants() });
    const runId = setup.view.id;
    const ownerId = setup.view.ownerId;
    const coordinatorId = setup.agent.id;
    setup.runtime.selectPrimaryActor({ actorId: ownerId, commandId: "primary" }, runId, coordinatorId);
    let helperId = "";
    const coordinatorStarted = deferred();
    const helperStarted = deferred();
    const seen: Record<string, string[][]> = {};
    const turnsOf = (actorId: string) => setup.runtime.view(runId).turns.filter((turn) => turn.actorId === actorId);
    const driver = new FakeDriver(async (request, signal) => {
        const count = turnsOf(request.agentId).length;
        const own = { actorId: request.agentId, turnId: request.turnId };
        if (request.agentId === coordinatorId && count === 1) {
            const spawned = setup.runtime.spawnAgent({ ...own, commandId: "spawn-helper" }, runId, {
                handle: "helper", displayName: "Helper", prompt: "Help.", grants: [], toolNames: null,
                execution: executionFor("helper", { profile: "agent", isolateWorkspace: false }),
            });
            helperId = spawned.actors.find((actor) => actor.handle === "helper")!.id;
            setup.runtime.createSubscription({ ...own, commandId: "subscribe-helper" }, runId, {
                subscriberId: coordinatorId, sourceActorIds: [helperId], eventTypes: ["turn.interrupted"],
            });
            setup.runtime.enqueueInput({ ...own, commandId: "input-helper" }, runId, { actorId: helperId, content: "Change the files." });
            coordinatorStarted.resolve();
            await untilAborted(signal);
            return { failure: null, usage: noUsage() };
        }
        if (request.agentId === helperId && count === 1) {
            helperStarted.resolve();
            await untilAborted(signal);
            return { failure: null, usage: noUsage() };
        }
        const contents = [request.input.content, ...request.claimSteering().map((steered) => steered.input.content)];
        (seen[request.agentId] ??= []).push(contents);
        if (request.agentId === coordinatorId)
            setup.runtime.enqueueInput({ ...own, commandId: "address-helper" }, runId, { actorId: helperId, content: "Pick it up again." });
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });
    const stopper = new RunStopper({ runtime: setup.runtime, interruptTurns: async (id, interruption) => {
        assert.ok(setup.runtime.view(id).stopped, "the marker is written before interruption starts");
        const pending = postTo(setup.runtime, setup.view, coordinatorId, "during-stop", "An input during cancellation.").inputs.at(-1)!;
        const turnId = driver.requests[0]!.turnId;
        assert.throws(() => setup.runtime.steerInputs({ actorId: coordinatorId, commandId: "direct-steer", turnId }, id, coordinatorId, { turnId, inputIds: [pending.id] }),
            (error: unknown) => error instanceof DomainError && error.code === "run-stopped" && error.status === 409);
        const events = setup.runtime.events(id);
        const steered = { ...events.at(-1)!, eventId: "event-steering", sequence: events.length + 1, actorId: coordinatorId,
            commandId: "invalid-steer", type: "turn.input-steered", payload: { turnId, inputId: pending.id } } as JournalEvent;
        assert.throws(() => project([...events, steered]), /stopped; inputs cannot join a turn/);
        assert.deepEqual(driver.requests[0]!.claimSteering(), [], "pending inputs cannot join a running turn after the marker");
        await scheduler.interruptRun(id, interruption);
    } });

    try {
        postTo(setup.runtime, setup.view, coordinatorId, "input", "Delegate the work.");
        scheduler.start();
        await Promise.all([coordinatorStarted.promise, helperStarted.promise]);

        await stopper.stop(runId, { commandId: "stop-1", reason: "Stopped in the chat", userId: "alice" });

        const stopped = setup.runtime.view(runId);
        assert.deepEqual(stopped.stopped, { stoppedAt: stopped.stopped?.stoppedAt, reason: "Stopped in the chat", userId: "alice" });
        assert.equal(typeof stopped.stopped?.stoppedAt, "string");
        for (const actorId of [coordinatorId, helperId]) {
            assert.equal(turnsOf(actorId)[0]?.status, "interrupted");
            assert.equal(actorOf(stopped, actorId).lifecycle.kind, "idle");
            assert.equal(actorOf(stopped, actorId).held, true);
        }
        const events = setup.runtime.events(runId);
        const stoppedAt = events.findIndex((event) => event.type === "run.stopped");
        const interruptions = events.filter((event) => event.type === "turn.interrupted");
        assert.equal(interruptions.length, 2);
        assert.ok(interruptions.every((event) => events.indexOf(event) > stoppedAt), "the gate closes before the turns are interrupted");
        assert.ok(interruptions.every((event) => event.type === "turn.interrupted" && event.payload.reason === "Stopped in the chat"));
        assert.equal(events[stoppedAt]!.actorId, ownerId);

        postTo(setup.runtime, setup.view, helperId, "late-helper", "Late work for the helper.");
        postTo(setup.runtime, setup.view, coordinatorId, "late-coordinator", "An automatic notice.");
        await settle(scheduler);
        const afterStop = setup.runtime.events(runId).slice(stoppedAt);
        assert.equal(afterStop.some((event) => event.type === "turn.started"), false, "no turn starts while stopped");
        assert.equal(driver.requests.length, 2);
        const held = setup.runtime.view(runId).inputs.filter((input) => input.lifecycle.kind === "pending");
        assert.ok(held.filter((input) => input.actorId === coordinatorId).length >= 2, "the creator alert and the later input wait");
        assert.equal(held.filter((input) => input.actorId === helperId).length, 1);

        const count = setup.runtime.events(runId).length;
        setup.runtime.stopRun({ actorId: ownerId, commandId: "stop-2" }, runId, { reason: "Again", userId: "alice" });
        assert.equal(setup.runtime.events(runId).length, count, "a second stop writes nothing");

        assert.ok(held.some((input) => input.subscriptionId !== null), "subscription deliveries wait with direct inputs");
        assert.equal(afterStop.some((event) => event.type === "actor.stopped"), false);
        const heldForCoordinator = held.filter((input) => input.actorId === coordinatorId);
        setup.runtime.enqueueInput({ actorId: ownerId, commandId: "human" }, runId, { actorId: coordinatorId, content: "Continue now.", origin: "human", userId: "alice" });
        const continued = setup.runtime.events(runId).filter((event) => event.commandId === "human");
        assert.deepEqual(continued.map((event) => event.type), ["run.continued", "actor.input.enqueued"]);
        assert.deepEqual(continued[0]!.payload, { userId: "alice" });
        await settle(scheduler);

        const received = seen[coordinatorId]![0]!;
        assert.equal(received.length, heldForCoordinator.length + 1);
        for (const [index, input] of heldForCoordinator.entries()) {
            if (input.subscriptionId)
                assert.deepEqual(JSON.parse(received[index]!), JSON.parse(input.content).payload);
            else
                assert.equal(received[index], input.content);
        }
        assert.equal(received.at(-1), "Continue now.", "the human message comes after every waiting input in the same turn");
        assert.equal(actorOf(setup.runtime.view(runId), coordinatorId).held, undefined);
        assert.deepEqual(seen[helperId], [["Late work for the helper.", "Pick it up again."]], "the helper continues only once the coordinator addresses it");
        assert.equal(actorOf(setup.runtime.view(runId), helperId).held, undefined);
        assert.equal(setup.runtime.view(runId).stopped, null);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("after a human continues the run a held sub-agent keeps its automatic inputs until someone addresses it", async () => {
    const setup = setupRun();
    const runId = setup.view.id;
    const ownerId = setup.view.ownerId;
    const helper = setup.runtime.spawnAgent({ actorId: ownerId, commandId: "spawn-helper" }, runId, {
        handle: "helper", displayName: "Helper", prompt: "", grants: [], toolNames: null,
        execution: executionFor("helper", { profile: "agent", isolateWorkspace: false }),
    }).actors.find((actor) => actor.handle === "helper")!;
    setup.runtime.selectPrimaryActor({ actorId: ownerId, commandId: "primary" }, runId, setup.agent.id);
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });

    try {
        setup.runtime.stopRun({ actorId: ownerId, commandId: "stop" }, runId, { reason: "Stopped" });
        postTo(setup.runtime, setup.view, helper.id, "automatic", "A system input.");
        scheduler.start();
        await settle(scheduler);
        assert.equal(driver.requests.length, 0);

        setup.runtime.enqueueInput({ actorId: ownerId, commandId: "human" }, runId, { actorId: setup.agent.id, content: "Continue.", origin: "human" });
        assert.deepEqual(setup.runtime.events(runId).find((event) => event.type === "run.continued")?.payload, {});
        await settle(scheduler);
        assert.deepEqual(driver.requests.map((request) => request.agentId), [setup.agent.id]);
        assert.equal(actorOf(setup.runtime.view(runId), helper.id).held, true);
        assert.equal(actorOf(setup.runtime.view(runId), setup.agent.id).held, undefined);

        postTo(setup.runtime, setup.view, helper.id, "still-automatic", "Another system input.");
        await settle(scheduler);
        assert.equal(driver.requests.length, 1, "a system input under the owner does not address the held actor");

        setup.runtime.enqueueInput({ actorId: ownerId, commandId: "direct" }, runId, { actorId: helper.id, content: "Go on.", origin: "human" });
        await settle(scheduler);
        assert.deepEqual(driver.requests.filter((request) => request.agentId === helper.id).map((request) => request.input.content), ["A system input.", "Another system input.", "Go on."]);
        assert.equal(actorOf(setup.runtime.view(runId), helper.id).held, undefined);
        assert.equal(setup.runtime.events(runId).filter((event) => event.type === "run.continued").length, 1);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("no turn starts in a stopped run or for a held actor, not even by hand", () => {
    const setup = setupRun();
    const runId = setup.view.id;
    const ownerId = setup.view.ownerId;

    try {
        const input = postTo(setup.runtime, setup.view, setup.agent.id, "input", "Work.").inputs.at(-1)!;
        const other = setup.runtime.spawnAgent({ actorId: ownerId, commandId: "spawn-other" }, runId, {
            handle: "other", displayName: "Other", prompt: "", grants: [], toolNames: null,
            execution: executionFor("other", { profile: "agent", isolateWorkspace: false }),
        }).actors.find((actor) => actor.handle === "other")!;
        setup.runtime.stopRun({ actorId: ownerId, commandId: "stop" }, runId, { reason: "Stopped" });
        assert.throws(
            () => setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "start" }, runId, setup.agent.id, input.id),
            (error: unknown) => error instanceof DomainError && error.code === "run-stopped" && error.status === 409,
        );
        setup.runtime.enqueueInput({ actorId: ownerId, commandId: "human" }, runId, { actorId: other.id, content: "Continue.", origin: "human" });
        assert.throws(
            () => setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "start-held" }, runId, setup.agent.id, input.id),
            (error: unknown) => error instanceof DomainError && error.code === "actor-held",
            "without a primary actor the unaddressed actor stays held",
        );
    } finally {
        setup.journal.close();
    }
});

test("the stop and held actors survive replay and a restart; the next human message delivers what waited", async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-run-stop-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const services = testServices();
    const journal = new Journal(directory, services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun({ commandId: "create" }, { title: "Stop", ownerHandle: "owner", ownerDisplayName: "Owner" });
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
        handle: "worker", displayName: "Worker", prompt: "", grants: [], toolNames: null,
        execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }),
    });
    const workerId = view.actors.find((actor) => actor.kind === "agent")!.id;
    runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "primary" }, view.id, workerId);
    runtime.stopRun({ actorId: view.ownerId, commandId: "stop" }, view.id, { reason: "Stopped", userId: "alice" });
    postTo(runtime, view, workerId, "held-1", "First.");
    postTo(runtime, view, workerId, "held-2", "Second.");
    const persisted = readFileSync(join(directory, view.id, "journal.jsonl"));
    assert.ok(persisted.toString().trim().split("\n").every((line) => JSON.parse(line).formatVersion === 16));
    journal.close();

    let next = 0;
    const later: RuntimeServices = { ...testServices(13), newId: (kind) => `${kind}-later-${++next}` };
    const reopened = new Journal(directory, later);
    const restored = new Orchestration(reopened, later);
    const seen: string[][] = [];
    const driver = new FakeDriver(async (request) => {
        seen.push([request.input.content, ...request.claimSteering().map((steered) => steered.input.content)]);
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(restored, reopened, { drivers: registryOf(driver), catalog });

    try {
        const replayed = restored.view(view.id);
        assert.equal(replayed.stopped?.reason, "Stopped");
        assert.equal(replayed.stopped?.userId, "alice");
        assert.equal(actorOf(replayed, workerId).held, true);
        scheduler.start();
        await settle(scheduler);
        assert.equal(driver.requests.length, 0, "after the restart the run is still stopped");
        assert.deepEqual(readFileSync(join(directory, view.id, "journal.jsonl")), persisted);

        restored.enqueueInput({ actorId: view.ownerId, commandId: "human" }, view.id, { actorId: workerId, content: "Continue.", origin: "human", userId: "bob" });
        await settle(scheduler);
        assert.deepEqual(seen, [["First.", "Second.", "Continue."]]);
        assert.deepEqual(restored.events(view.id).find((event) => event.type === "run.continued")?.payload, { userId: "bob" });
    } finally {
        await scheduler.stop();
        reopened.close();
    }
});

test("the journal check accepts a stop only of a running run and a continuation only of a stopped one, both by the owner", () => {
    const setup = setupRun();
    const runId = setup.view.id;
    const ownerId = setup.view.ownerId;

    try {
        const base = { eventId: "event-x", runId, sequence: 1, schemaVersion: 3, occurredAt: "2026-10-12T10:00:00.000Z", actorId: ownerId, commandId: "x", correlationId: null, causationId: null };
        assert.equal(journalEventOf({ ...base, type: "run.stopped", payload: { reason: "Stopped", userId: "alice" } }, "event").type, "run.stopped");
        assert.equal(journalEventOf({ ...base, type: "run.stopped", payload: { reason: "Stopped" } }, "event").type, "run.stopped");
        assert.throws(() => journalEventOf({ ...base, type: "run.stopped", payload: { reason: "" } }, "event"));
        assert.throws(() => journalEventOf({ ...base, type: "run.stopped", payload: { reason: "Stopped", by: "alice" } }, "event"));
        assert.equal(journalEventOf({ ...base, type: "run.continued", payload: {} }, "event").type, "run.continued");
        assert.equal(journalEventOf({ ...base, type: "run.continued", payload: { userId: "alice" } }, "event").type, "run.continued");
        assert.throws(() => journalEventOf({ ...base, type: "run.continued", payload: { trigger: "input" } }, "event"));
        assert.throws(() => journalEventOf({ ...base, type: "run.paused", payload: { reason: "Paused" } }, "event"));
        assert.throws(() => journalEventOf({ ...base, type: "run.resumed", payload: { trigger: "input" } }, "event"));

        const input = postTo(setup.runtime, setup.view, setup.agent.id, "input", "Work.").inputs.at(-1)!;
        const turnId = setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "start" }, runId, setup.agent.id, input.id).turns.at(-1)!.id;
        const agent = { actorId: setup.agent.id, turnId };
        const denied = (error: unknown) => error instanceof DomainError && error.code === "run-stop-denied" && error.status === 403;
        assert.throws(() => setup.runtime.stopRun({ ...agent, commandId: "stop-by-agent" }, runId, { reason: "Stopped" }), denied);
        setup.runtime.stopRun({ actorId: ownerId, commandId: "stop" }, runId, { reason: "Stopped" });
        assert.throws(() => setup.runtime.stopRun({ ...agent, commandId: "stop-again-by-agent" }, runId, { reason: "Stopped" }), denied);

        const events = setup.runtime.events(runId);
        const stopped = events.find((event) => event.type === "run.stopped")!;
        const replayed = (extra: object) => [...events, { ...stopped, ...extra }];
        assert.throws(() => project(replayed({ eventId: "event-again", sequence: events.length + 1, commandId: "again" })), /already stopped/);
        const continued = { ...stopped, eventId: "event-continued", sequence: events.length + 1, commandId: "continued", type: "run.continued", payload: {} } as JournalEvent;
        assert.throws(() => project([...events, continued, { ...continued, eventId: "event-continued-2", sequence: events.length + 2, commandId: "continued-2" } as JournalEvent]), /not stopped/);
        assert.throws(() => project(replayed({ eventId: "event-agent", sequence: events.length + 1, commandId: "agent", actorId: setup.agent.id, type: "run.continued", payload: {} })), /owner/);
    } finally {
        setup.journal.close();
    }
});

test("ragents.runs.stop checks stop rights, names the signed-in user and continues only through human input", async () => {
    const setup = setupRun();
    const runId = setup.view.id;
    const rights: string[] = [];
    const stops: Array<{ runId: string; reason: string; userId: string | undefined }> = [];
    const stopper = new RunStopper({ runtime: setup.runtime, interruptTurns: async () => undefined });
    const methods = runtimeMethods({
        runtime: setup.runtime,
        assertRunRights: (_access, id, kind) => { rights.push(`${id}:${kind}`); },
        interruptTurn: async () => undefined,
        stopRun: async (id, input) => {
            stops.push({ runId: id, reason: input.reason, userId: input.userId });
            return stopper.stop(id, input);
        },
        projectView: (view) => view,
        hasRun: () => true,
    });
    const call = (contract: { id: string }, input: unknown, context: MethodContext) =>
        methods.find((entry) => entry.contract.id === contract.id)!.execute(input as never, context) as Promise<RunView>;

    try {
        assert.equal(methods.some((entry) => ["ragents.runs.pause", "ragents.runs.resume", "ragents.chat.stop"].includes(entry.contract.id)), false);
        const stopped = await call(runContracts.stop, { runId, commandId: "stop" }, methodContext("alice"));
        assert.deepEqual(stops, [{ runId, reason: "Stopped by the operator", userId: "alice" }]);
        assert.equal(stopped.stopped?.userId, "alice");
        assert.equal(setup.runtime.events(runId).find((event) => event.type === "run.stopped")?.actorId, setup.view.ownerId);
        const continued = await call(runContracts.enqueueInput, { runId, commandId: "human", actorId: setup.agent.id, content: "Continue." }, methodContext("bob"));
        assert.equal(continued.stopped, null);
        assert.deepEqual(setup.runtime.events(runId).find((event) => event.type === "run.continued")?.payload, { userId: "bob" });
        assert.deepEqual(rights, [`${runId}:stop`, `${runId}:write-inspect`]);

        await call(runContracts.stop, { runId, commandId: "stop-anonymous", reason: "Stopped from a script" }, methodContext());
        assert.equal(setup.runtime.view(runId).stopped?.reason, "Stopped from a script");
        assert.equal(setup.runtime.view(runId).stopped?.userId, null);
        await call(runContracts.enqueueInput, { runId, commandId: "input", actorId: setup.agent.id, content: "Next." }, methodContext("carol"));
        assert.deepEqual(typesOf(setup.runtime.events(runId), "input"), ["run.continued", "actor.input.enqueued"]);
        const input = setup.runtime.events(runId).find((event) => event.commandId === "input" && event.type === "actor.input.enqueued");
        assert.equal(input?.type === "actor.input.enqueued" ? input.payload.origin : undefined, "human");
    } finally {
        setup.journal.close();
    }
});

for (const formatVersion of [11, 12, 13, 14, 15]) {
    test(`format ${formatVersion} pause journals replay as stopped runs without changing their files`, (t) => {
        const directory = mkdtempSync(join(tmpdir(), "ragents-legacy-stop-"));
        t.after(() => rmSync(directory, { recursive: true, force: true }));
        const services = testServices();
        const original = new Journal(directory, services);
        const runtime = new Orchestration(original, services);
        const run = runtime.createRun({ commandId: "create" }, { title: "Legacy run", ownerHandle: "owner", ownerDisplayName: "Owner" });
        const actor = runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn" }, run.id, {
            handle: "worker", displayName: "Worker", prompt: "", grants: [], toolNames: null,
            execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }),
        }).actors.find((entry) => entry.kind === "agent")!;
        runtime.selectPrimaryActor({ actorId: run.ownerId, commandId: "primary" }, run.id, actor.id);
        runtime.createSubscription({ actorId: run.ownerId, commandId: "subscribe" }, run.id, {
            subscriberId: actor.id, eventTypes: ["turn.finished"],
        });
        runtime.stopRun({ actorId: run.ownerId, commandId: "first-stop" }, run.id, { reason: "First stop", userId: "alice" });
        runtime.enqueueInput({ actorId: run.ownerId, commandId: "human" }, run.id, { actorId: actor.id, content: "Continue.", origin: "human", userId: "bob" });
        runtime.stopRun({ actorId: run.ownerId, commandId: "second-stop" }, run.id, { reason: "Waiting", userId: "bob" });
        postTo(runtime, run, actor.id, "waiting", "A later input.");
        const expected = runtime.view(run.id);
        original.close();
        const journalPath = join(directory, run.id, "journal.jsonl");
        const legacy = readFileSync(journalPath, "utf8").trim().split("\n").map((line) => {
            const record = JSON.parse(line);
            return JSON.stringify({ ...record, formatVersion, command: {
                ...record.command, type: record.command.type === "run.stop" ? "run.pause" : record.command.type,
            }, events: record.events.map((event: { type: string; payload: { eventTypes?: string[] } }) =>
                event.type === "run.stopped" ? { ...event, type: "run.paused" }
                : event.type === "run.continued" ? { ...event, type: "run.resumed", payload: { ...event.payload, trigger: "input" } }
                : event) });
        }).join("\n") + "\n";
        writeFileSync(journalPath, legacy);
        const bytes = readFileSync(journalPath);
        const restored = new Journal(directory, services);
        t.after(() => restored.close());
        const replayed = new Orchestration(restored, services);
        assert.deepEqual(replayed.view(run.id), expected);
        assert.deepEqual(replayed.events(run.id).filter((event) => event.type === "run.continued").map((event) => event.payload), [{ userId: "bob" }]);
        assert.deepEqual(readFileSync(journalPath), bytes);
        assert.equal(restored.loadFailures().length, 0);
        assert.deepEqual(replayed.view(run.id).subscriptions.map((entry) => entry.eventTypes), [["turn.finished"]]);
    });
}

test("old emergency stop journals preserve individually stopped actors without changing their files", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-legacy-actors-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const services = testServices();
    const original = new Journal(directory, services);
    const runtime = new Orchestration(original, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Legacy run", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const actor = runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn" }, run.id, {
        handle: "worker", displayName: "Worker", prompt: "", grants: [], toolNames: null,
        execution: executionFor("worker", { profile: "manual", isolateWorkspace: false }),
    }).actors.find((entry) => entry.kind === "agent")!;
    runtime.createSubscription({ actorId: run.ownerId, commandId: "subscribe" }, run.id, {
        subscriberId: actor.id, eventTypes: ["turn.interrupted", "actor.stopped"],
    });
    const pending = postTo(runtime, run, actor.id, "input", "Work.").inputs.at(-1)!;
    runtime.startTurn({ actorId: actor.id, commandId: "turn" }, run.id, actor.id, pending.id);
    runtime.stopActor({ actorId: run.ownerId, commandId: "legacy-stop" }, run.id, actor.id, "Stopped everything");
    const expected = runtime.view(run.id);
    original.close();
    const journalPath = join(directory, run.id, "journal.jsonl");
    const legacy = readFileSync(journalPath, "utf8").trim().split("\n").map((line) => {
        const record = JSON.parse(line);
        return JSON.stringify({ ...record, formatVersion: 15 });
    }).join("\n") + "\n";
    writeFileSync(journalPath, legacy);
    const bytes = readFileSync(journalPath);
    const restored = new Journal(directory, services);
    t.after(() => restored.close());
    assert.deepEqual(new Orchestration(restored, services).view(run.id), expected);
    assert.deepEqual(restored.load(run.id).slice(-3).map((event) => event.type), ["turn.interrupted", "actor.stopped", "subscription.removed"]);
    assert.deepEqual(readFileSync(journalPath), bytes);
});

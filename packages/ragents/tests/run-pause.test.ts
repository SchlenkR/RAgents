import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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

test("a pause interrupts the turns of all actors including sub-agents, holds every later input, and a human input resumes it in one turn with the human input last", async () => {
    const setup = setupRun({ grants: allGrants() });
    const runId = setup.view.id;
    const ownerId = setup.view.ownerId;
    const coordinatorId = setup.agent.id;
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
                subscriberId: coordinatorId, sourceActorIds: [helperId], eventTypes: ["turn.finished"],
            });
            setup.runtime.enqueueInput({ ...own, commandId: "task-helper" }, runId, { actorId: helperId, content: "Change the files." });
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

    try {
        postTo(setup.runtime, setup.view, coordinatorId, "task", "Delegate the work.");
        scheduler.start();
        await Promise.all([coordinatorStarted.promise, helperStarted.promise]);

        await scheduler.pauseRun(runId, { context: { actorId: ownerId, commandId: "pause-1" }, reason: "Paused in the chat", userId: "alice" });

        const paused = setup.runtime.view(runId);
        assert.deepEqual(paused.pause, { pausedAt: paused.pause?.pausedAt, reason: "Paused in the chat", userId: "alice" });
        assert.equal(typeof paused.pause?.pausedAt, "string");
        for (const actorId of [coordinatorId, helperId]) {
            assert.equal(turnsOf(actorId)[0]?.status, "interrupted");
            assert.equal(actorOf(paused, actorId).lifecycle.kind, "idle");
            assert.equal(actorOf(paused, actorId).held, true);
        }
        const events = setup.runtime.events(runId);
        const pausedAt = events.findIndex((event) => event.type === "run.paused");
        const interruptions = events.filter((event) => event.type === "turn.interrupted");
        assert.equal(interruptions.length, 2);
        assert.ok(interruptions.every((event) => events.indexOf(event) > pausedAt), "the gate closes before the turns are interrupted");
        assert.ok(interruptions.every((event) => event.type === "turn.interrupted" && event.payload.reason === "Paused in the chat"));
        assert.equal(events[pausedAt]!.actorId, ownerId);

        postTo(setup.runtime, setup.view, helperId, "late-helper", "Late work for the helper.");
        postTo(setup.runtime, setup.view, coordinatorId, "late-coordinator", "An automatic notice.");
        await settle(scheduler);
        const afterPause = setup.runtime.events(runId).slice(pausedAt);
        assert.equal(afterPause.some((event) => event.type === "turn.started"), false, "no turn starts while paused");
        assert.equal(driver.requests.length, 2);
        const held = setup.runtime.view(runId).inputs.filter((input) => input.lifecycle.kind === "pending");
        assert.ok(held.filter((input) => input.actorId === coordinatorId).length >= 2, "the creator alert and the later input wait");
        assert.equal(held.filter((input) => input.actorId === helperId).length, 1);

        const count = setup.runtime.events(runId).length;
        await scheduler.pauseRun(runId, { context: { actorId: ownerId, commandId: "pause-2" }, reason: "Again", userId: "alice" });
        assert.equal(setup.runtime.events(runId).length, count, "a second pause writes nothing");

        const heldForCoordinator = held.filter((input) => input.actorId === coordinatorId).map((input) => input.content);
        setup.runtime.enqueueInput({ actorId: ownerId, commandId: "human" }, runId, { actorId: coordinatorId, content: "Continue now.", origin: "human", userId: "alice" });
        const resumed = setup.runtime.events(runId).filter((event) => event.commandId === "human");
        assert.deepEqual(resumed.map((event) => event.type), ["run.resumed", "actor.input.enqueued"]);
        assert.deepEqual(resumed[0]!.payload, { trigger: "input", userId: "alice" });
        await settle(scheduler);

        assert.deepEqual(seen[coordinatorId]?.[0], [...heldForCoordinator, "Continue now."], "the held inputs and the human input arrive in one turn, the human input last");
        assert.equal(actorOf(setup.runtime.view(runId), coordinatorId).held, undefined);
        assert.deepEqual(seen[helperId], [["Late work for the helper.", "Pick it up again."]], "the helper continues only once the coordinator addresses it");
        assert.equal(actorOf(setup.runtime.view(runId), helperId).held, undefined);
        assert.equal(setup.runtime.view(runId).pause, null);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("after a resume a held sub-agent keeps its automatic inputs until someone addresses it", async () => {
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
        setup.runtime.pauseRun({ actorId: ownerId, commandId: "pause" }, runId, { reason: "Paused" });
        postTo(setup.runtime, setup.view, helper.id, "automatic", "A system input.");
        scheduler.start();
        await settle(scheduler);
        assert.equal(driver.requests.length, 0);

        setup.runtime.resumeRun({ actorId: ownerId, commandId: "resume" }, runId, {});
        assert.deepEqual(setup.runtime.events(runId).find((event) => event.type === "run.resumed")?.payload, { trigger: "resume" });
        await settle(scheduler);
        assert.equal(driver.requests.length, 0, "the primary had nothing waiting and the helper stays held");
        assert.equal(actorOf(setup.runtime.view(runId), helper.id).held, true);
        assert.equal(actorOf(setup.runtime.view(runId), setup.agent.id).held, undefined);

        postTo(setup.runtime, setup.view, helper.id, "still-automatic", "Another system input.");
        await settle(scheduler);
        assert.equal(driver.requests.length, 0, "a system input under the owner does not address the held actor");

        setup.runtime.enqueueInput({ actorId: ownerId, commandId: "direct" }, runId, { actorId: helper.id, content: "Go on.", origin: "human" });
        await settle(scheduler);
        assert.deepEqual([...new Set(driver.requests.map((request) => request.agentId))], [helper.id]);
        assert.deepEqual(driver.requests.map((request) => request.input.content), ["A system input.", "Another system input.", "Go on."]);
        assert.equal(actorOf(setup.runtime.view(runId), helper.id).held, undefined);

        const count = setup.runtime.events(runId).length;
        setup.runtime.resumeRun({ actorId: ownerId, commandId: "resume-again" }, runId, {});
        assert.equal(setup.runtime.events(runId).length, count, "resuming a running run writes nothing");
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("no turn starts in a paused run or for a held actor, not even by hand", () => {
    const setup = setupRun();
    const runId = setup.view.id;
    const ownerId = setup.view.ownerId;

    try {
        const input = postTo(setup.runtime, setup.view, setup.agent.id, "input", "Work.").inputs.at(-1)!;
        setup.runtime.pauseRun({ actorId: ownerId, commandId: "pause" }, runId, { reason: "Paused" });
        assert.throws(
            () => setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "start" }, runId, setup.agent.id, input.id),
            (error: unknown) => error instanceof DomainError && error.code === "run-paused" && error.status === 409,
        );
        setup.runtime.resumeRun({ actorId: ownerId, commandId: "resume" }, runId, {});
        assert.throws(
            () => setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "start-held" }, runId, setup.agent.id, input.id),
            (error: unknown) => error instanceof DomainError && error.code === "actor-held",
            "without a primary actor nobody is released by the resume",
        );
    } finally {
        setup.journal.close();
    }
});

test("pause and held actors survive replay and a restart; the resume then delivers what waited", async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-run-pause-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const services = testServices();
    const journal = new Journal(directory, services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun({ commandId: "create" }, { title: "Pause", ownerHandle: "owner", ownerDisplayName: "Owner" });
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
        handle: "worker", displayName: "Worker", prompt: "", grants: [], toolNames: null,
        execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }),
    });
    const workerId = view.actors.find((actor) => actor.kind === "agent")!.id;
    runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "primary" }, view.id, workerId);
    runtime.pauseRun({ actorId: view.ownerId, commandId: "pause" }, view.id, { reason: "Paused", userId: "alice" });
    postTo(runtime, view, workerId, "held-1", "First.");
    postTo(runtime, view, workerId, "held-2", "Second.");
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
        assert.equal(replayed.pause?.reason, "Paused");
        assert.equal(replayed.pause?.userId, "alice");
        assert.equal(actorOf(replayed, workerId).held, true);
        scheduler.start();
        await settle(scheduler);
        assert.equal(driver.requests.length, 0, "after the restart the run is still paused");

        restored.resumeRun({ actorId: view.ownerId, commandId: "resume" }, view.id, { userId: "bob" });
        await settle(scheduler);
        assert.deepEqual(seen, [["First.", "Second."]]);
        assert.deepEqual(restored.events(view.id).find((event) => event.type === "run.resumed")?.payload, { trigger: "resume", userId: "bob" });
    } finally {
        await scheduler.stop();
        reopened.close();
    }
});

test("the journal check accepts a pause only of a running run and a resume only of a paused one, both by the owner", () => {
    const setup = setupRun();
    const runId = setup.view.id;
    const ownerId = setup.view.ownerId;

    try {
        const base = { eventId: "event-x", runId, sequence: 1, schemaVersion: 3, occurredAt: "2026-10-02T10:00:00.000Z", actorId: ownerId, commandId: "x", correlationId: null, causationId: null };
        assert.equal(journalEventOf({ ...base, type: "run.paused", payload: { reason: "Paused", userId: "alice" } }, "event").type, "run.paused");
        assert.equal(journalEventOf({ ...base, type: "run.paused", payload: { reason: "Paused" } }, "event").type, "run.paused");
        assert.throws(() => journalEventOf({ ...base, type: "run.paused", payload: { reason: "" } }, "event"));
        assert.throws(() => journalEventOf({ ...base, type: "run.paused", payload: { reason: "Paused", by: "alice" } }, "event"));
        assert.equal(journalEventOf({ ...base, type: "run.resumed", payload: { trigger: "input" } }, "event").type, "run.resumed");
        assert.throws(() => journalEventOf({ ...base, type: "run.resumed", payload: { trigger: "button" } }, "event"));

        const input = postTo(setup.runtime, setup.view, setup.agent.id, "input", "Work.").inputs.at(-1)!;
        const turnId = setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "start" }, runId, setup.agent.id, input.id).turns.at(-1)!.id;
        const agent = { actorId: setup.agent.id, turnId };
        const denied = (error: unknown) => error instanceof DomainError && error.code === "run-pause-denied" && error.status === 403;
        assert.throws(() => setup.runtime.pauseRun({ ...agent, commandId: "pause-by-agent" }, runId, { reason: "Paused" }), denied);
        setup.runtime.pauseRun({ actorId: ownerId, commandId: "pause" }, runId, { reason: "Paused" });
        assert.throws(() => setup.runtime.resumeRun({ ...agent, commandId: "resume-by-agent" }, runId, {}), denied);

        const events = setup.runtime.events(runId);
        const paused = events.find((event) => event.type === "run.paused")!;
        const replayed = (extra: object) => [...events, { ...paused, ...extra }];
        assert.throws(() => project(replayed({ eventId: "event-again", sequence: events.length + 1, commandId: "again" })), /already paused/);
        const resume = { ...paused, eventId: "event-resume", sequence: events.length + 1, commandId: "resume", type: "run.resumed", payload: { trigger: "resume" } } as JournalEvent;
        assert.throws(() => project([...events, resume, { ...resume, eventId: "event-resume-2", sequence: events.length + 2, commandId: "resume-2" } as JournalEvent]), /not paused/);
        assert.throws(() => project(replayed({ eventId: "event-agent", sequence: events.length + 1, commandId: "agent", actorId: setup.agent.id, type: "run.resumed", payload: { trigger: "resume" } })), /owner/);
    } finally {
        setup.journal.close();
    }
});

test("ragents.runs.pause and ragents.runs.resume check the rights, name the signed-in user and resume like an input", async () => {
    const setup = setupRun();
    const runId = setup.view.id;
    const rights: string[] = [];
    const pauses: Array<{ runId: string; reason: string; userId: string | undefined; actorId: string }> = [];
    const methods = runtimeMethods({
        runtime: setup.runtime,
        assertRunRights: (_access, id, kind) => { rights.push(`${id}:${kind}`); },
        interruptTurn: async () => undefined,
        pauseRun: async (id, pause) => {
            pauses.push({ runId: id, reason: pause.reason, userId: pause.userId, actorId: pause.context.actorId });
            setup.runtime.pauseRun(pause.context, id, { reason: pause.reason, ...(pause.userId ? { userId: pause.userId } : {}) });
        },
        projectView: (view) => view,
        hasRun: () => true,
    });
    const call = (contract: { id: string }, input: unknown, context: MethodContext) =>
        methods.find((entry) => entry.contract.id === contract.id)!.execute(input as never, context) as Promise<RunView>;

    try {
        const paused = await call(runContracts.pause, { runId, commandId: "pause" }, methodContext("alice"));
        assert.deepEqual(pauses, [{ runId, reason: "Paused by the operator", userId: "alice", actorId: setup.view.ownerId }]);
        assert.equal(paused.pause?.userId, "alice");
        const resumed = await call(runContracts.resume, { runId, commandId: "resume" }, methodContext("bob"));
        assert.equal(resumed.pause, null);
        assert.deepEqual(setup.runtime.events(runId).find((event) => event.type === "run.resumed")?.payload, { trigger: "resume", userId: "bob" });
        assert.deepEqual(rights, [`${runId}:stop`, `${runId}:write`]);

        await call(runContracts.pause, { runId, commandId: "pause-anonymous", reason: "Stopped from a script" }, methodContext());
        assert.equal(setup.runtime.view(runId).pause?.reason, "Stopped from a script");
        await call(runContracts.enqueueInput, { runId, commandId: "input", actorId: setup.agent.id, content: "Next." }, methodContext("carol"));
        assert.deepEqual(typesOf(setup.runtime.events(runId), "input"), ["run.resumed", "actor.input.enqueued"]);
        const input = setup.runtime.events(runId).find((event) => event.commandId === "input" && event.type === "actor.input.enqueued");
        assert.equal(input?.type === "actor.input.enqueued" ? input.payload.origin : undefined, "human");
    } finally {
        setup.journal.close();
    }
});

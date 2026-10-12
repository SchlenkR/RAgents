import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { runtimeServices } from "../src/runtime/services.ts";
import { restartInput, type RestartPolicy } from "../src/runtime/decisions/restart.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { ScriptDriver } from "../src/script/driver.ts";
import { FakeDriver, catalog, deferred, executionFor, noUsage, registryOf, textStep } from "./support.ts";

const fixture = async (t: TestContext) => {
    const directory = await mkdtemp(join(tmpdir(), "ragents-restart-"));
    let time = Date.parse("2026-10-12T12:00:00.000Z");
    const services = { ...runtimeServices, now: () => new Date(time).toISOString() };
    let journal = new Journal(directory, services);
    let runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Restart", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const view = runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn" }, run.id, {
        handle: "worker", displayName: "Worker", prompt: "Finish the task.", grants: [], toolNames: [],
        execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }),
    });
    const actorId = view.actors.find((actor) => actor.kind === "agent")!.id;
    t.after(async () => { journal.close(); await rm(directory, { recursive: true, force: true }); });
    return {
        services, runId: run.id, ownerId: run.ownerId, actorId,
        get journal() { return journal; }, get runtime() { return runtime; },
        advance: (ms: number) => { time += ms; },
        post: (content: string, id = services.newId("command")) => runtime.enqueueInput({ actorId: run.ownerId, commandId: id }, run.id, { actorId, content }).inputs.at(-1)!,
        start: (inputId: string) => runtime.startTurn({ actorId, commandId: services.newId("command") }, run.id, actorId, inputId).turns.at(-1)!,
        reopen: (policy?: RestartPolicy) => {
            journal.close();
            journal = new Journal(directory, services);
            runtime = new Orchestration(journal, services, undefined, undefined, policy);
        },
        scheduler: (driver: FakeDriver, options: Partial<ConstructorParameters<typeof TurnScheduler>[2]> = {}) =>
            new TurnScheduler(runtime, journal, { drivers: registryOf(driver), catalog, ...options }),
    };
};

test("a working agent continues once after shutdown with the restart note and repaired tool history", async (t) => {
    const f = await fixture(t);
    const started = deferred();
    const working = new FakeDriver(async (request, signal) => {
        request.recordContext({ kind: "input", inputId: request.input.id, content: request.input.content });
        request.recordContext({ kind: "step", step: { ...textStep("Checked the plan."), content: [
            { type: "text", text: "Checked the plan." },
            { type: "toolCall", id: "done", name: "read", arguments: {} },
            { type: "toolCall", id: "half", name: "write", arguments: {} },
        ] } });
        const context = () => ({ actorId: f.actorId, turnId: request.turnId, commandId: f.services.newId("command") });
        f.runtime.startToolCall(context(), f.runId, f.actorId, { turnId: request.turnId, toolCallId: "done", name: "read", input: {} });
        f.runtime.completeToolCall(context(), f.runId, f.actorId, { turnId: request.turnId, toolCallId: "done", name: "read", output: "Completed result" });
        f.runtime.startToolCall(context(), f.runId, f.actorId, { turnId: request.turnId, toolCallId: "half", name: "write", input: {} });
        started.resolve();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return { failure: null, usage: noUsage() };
    });
    f.post("Finish the project.");
    const first = f.scheduler(working);
    first.start();
    await started.promise;
    await first.stop();
    assert.equal(f.runtime.view(f.runId).turns[0]?.interruptionCause, "server-stop");
    f.reopen();
    const continued = new FakeDriver(async (request) => {
        assert.equal(request.input.content, restartInput);
        const results = request.modelContext().messages.filter((message) => message.role === "toolResult");
        assert.deepEqual(results.map((result) => [result.toolCallId, result.isError]), [["done", false], ["half", true]]);
        assert.match(JSON.stringify(results), /Completed result/);
        assert.match(JSON.stringify(results), /tool call was interrupted/);
        const retained = request.modelContext().entries.filter((entry) => entry.kind === "message" && entry.message.role === "toolResult").map((entry) => entry.id);
        request.recordContext({ kind: "input", inputId: request.input.id, content: request.input.content });
        const kept = f.runtime.events(f.runId).at(-1)!.eventId;
        f.runtime.compactContext({ actorId: f.actorId, turnId: request.turnId, commandId: "compact-recovered" }, f.runId, f.actorId, {
            turnId: request.turnId, summary: "Previous work", firstKeptEventId: kept, retainedToolResultIds: retained,
            tokensBefore: 1000, provider: "test", model: "test", readFiles: [], modifiedFiles: [],
        });
        assert.match(JSON.stringify(request.modelContext().messages), /Completed result/);
        return { failure: null, usage: noUsage() };
    });
    const next = f.scheduler(continued);
    next.start();
    await next.waitForIdle();
    await next.stop();
    const recovered = f.runtime.events(f.runId).find((event) => event.type === "turn.restart-recovered")!;
    assert.equal(recovered.payload.outcome, "continued");
    assert.deepEqual(f.journal.records(f.runId).find((record) => record.command.id === recovered.commandId)?.events.map((event) => event.type),
        ["turn.restart-recovered", "actor.input.enqueued"]);
    assert.equal(continued.requests.length, 1);
    assert.deepEqual(f.runtime.view(f.runId).turns.map((turn) => turn.status), ["interrupted", "completed"]);
    const fork = f.runtime.forkRun({ commandId: "fork-recovered" }, f.runId, f.runtime.view(f.runId).revision);
    assert.deepEqual(f.runtime.modelContext(fork.id, f.actorId).messages, f.runtime.modelContext(f.runId, f.actorId).messages);
    const count = f.runtime.events(f.runId).length;
    f.reopen();
    assert.equal(f.runtime.events(f.runId).length, count);
});

test("crash recovery is atomic, precedes queued inputs and preserves their order", async (t) => {
    const f = await fixture(t);
    f.start(f.post("Original task").id);
    f.post("First queued task");
    f.post("Second queued task");
    f.reopen();
    const recovery = f.runtime.events(f.runId).find((event) => event.type === "turn.restart-recovered")!;
    assert.deepEqual(f.journal.records(f.runId).find((record) => record.command.id === recovery.commandId)?.events.map((event) => event.type),
        ["turn.interrupted", "turn.restart-recovered", "actor.input.enqueued"]);
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = f.scheduler(driver);
    scheduler.start();
    await scheduler.waitForIdle();
    await scheduler.stop();
    assert.ok(driver.requests[0]!.input.content.startsWith(restartInput));
    assert.match(driver.requests[0]!.input.content, /Original task/);
    assert.deepEqual(driver.requests.slice(1).map((request) => request.input.content), ["First queued task", "Second queued task"]);
});

for (const stop of ["user", "failure", "timeout", "pause", "actor-stop", "unavailable", "disabled"] as const) {
    test(`${stop} does not automatically continue on restart`, async (t) => {
        const f = await fixture(t);
        const turn = f.start(f.post("Task").id);
        const context = { actorId: f.ownerId, commandId: "stop" };
        if (stop === "failure") f.runtime.finishTurn({ ...context, actorId: f.actorId, turnId: turn.id }, f.runId, f.actorId,
            { turnId: turn.id, outcome: "failed", reason: "Failed" });
        else if (stop === "user" || stop === "timeout") f.runtime.interruptTurn(context, f.runId, f.actorId, { turnId: turn.id, reason: stop });
        else if (stop === "actor-stop") f.runtime.stopActor(context, f.runId, f.actorId, "Stopped");
        else if (stop === "pause") f.runtime.pauseRun(context, f.runId, { reason: "Paused" });
        f.reopen({ ...(stop === "disabled" ? { enabled: () => false } : {}), ...(stop === "unavailable" ? { available: () => false } : {}) });
        assert.equal(f.runtime.view(f.runId).inputs.filter((input) => typeof input.origin === "object").length, 0);
        const count = f.runtime.events(f.runId).length;
        f.reopen();
        assert.equal(f.runtime.events(f.runId).length, count);
    });
}

for (const age of [59_999, 60_000]) {
    test(`a continuation interrupted after ${age} ms follows the restart guard`, async (t) => {
        const f = await fixture(t);
        f.start(f.post("Task").id);
        f.reopen();
        const continuation = f.runtime.view(f.runId).inputs.find((input) => typeof input.origin === "object")!;
        f.start(continuation.id);
        f.advance(age);
        f.reopen();
        const view = f.runtime.view(f.runId);
        assert.equal(view.turns.at(-1)?.restartRecovery?.outcome, age < 60_000 ? "guarded" : "continued");
        assert.equal(view.inputs.filter((input) => input.lifecycle.kind === "pending").length, age < 60_000 ? 0 : 1);
        if (age < 60_000) {
            f.advance(120_000);
            const count = f.runtime.events(f.runId).length;
            f.reopen();
            assert.equal(f.runtime.events(f.runId).length, count);
        }
    });
}

test("a pending continuation survives another restart without a duplicate", async (t) => {
    const f = await fixture(t);
    f.start(f.post("Task").id);
    f.reopen();
    const count = f.runtime.events(f.runId).length;
    f.reopen();
    assert.equal(f.runtime.events(f.runId).length, count);
    assert.equal(f.runtime.view(f.runId).inputs.filter((input) => typeof input.origin === "object").length, 1);
});

test("recovery keeps unpresented original and steered inputs with their attachments", async (t) => {
    const f = await fixture(t);
    const artifactView = f.runtime.publishArtifact({ actorId: f.ownerId, commandId: "artifact" }, f.runId,
        { title: "Task notes", mediaType: "text/plain", content: "Keep this task", previousVersionId: null });
    const artifactId = artifactView.artifacts.at(-1)!.id;
    const input = f.runtime.enqueueInput({ actorId: f.ownerId, commandId: "with-attachment" }, f.runId,
        { actorId: f.actorId, content: "Original instructions", artifactIds: [artifactId] }).inputs.at(-1)!;
    const turn = f.start(input.id);
    const steering = f.post("Updated instructions");
    f.runtime.steerInputs({ actorId: f.actorId, turnId: turn.id, commandId: "steering" }, f.runId, f.actorId, { turnId: turn.id, inputIds: [steering.id] });
    f.reopen();
    const continuation = f.runtime.view(f.runId).inputs.find((entry) => typeof entry.origin === "object")!;
    assert.ok(continuation.content.indexOf("Original instructions") < continuation.content.indexOf("Updated instructions"));
    assert.deepEqual(continuation.artifactIds, [artifactId]);
});

test("an orderly shutdown uses its interruption time for the guard even after a long outage", async (t) => {
    const f = await fixture(t);
    f.start(f.post("Task").id);
    f.reopen();
    const continuation = f.runtime.view(f.runId).inputs.find((input) => typeof input.origin === "object")!;
    const turn = f.start(continuation.id);
    f.advance(10_000);
    f.runtime.interruptTurn({ actorId: f.actorId, commandId: "shutdown" }, f.runId, f.actorId,
        { turnId: turn.id, reason: "Server stopped", cause: "server-stop" });
    f.advance(120_000);
    f.reopen();
    assert.equal(f.runtime.view(f.runId).turns.at(-1)?.restartRecovery?.outcome, "guarded");
});

test("an operator interruption in progress remains an operator interruption during shutdown", async (t) => {
    const f = await fixture(t);
    const entered = deferred();
    const released = deferred();
    const driver = new FakeDriver(async () => {
        entered.resolve();
        await released.promise;
        return { failure: null, usage: noUsage() };
    });
    const scheduler = f.scheduler(driver);
    f.post("Task");
    scheduler.start();
    await entered.promise;
    const interrupted = scheduler.interruptTurn(f.runId, f.actorId, { context: { actorId: f.ownerId, commandId: "operator-stop" }, reason: "Stopped by the operator" });
    const shutdown = scheduler.stop();
    released.resolve();
    await Promise.all([interrupted, shutdown]);
    f.reopen();
    assert.equal(f.runtime.view(f.runId).turns[0]?.interruptionCause, undefined);
    assert.equal(f.runtime.view(f.runId).inputs.filter((input) => typeof input.origin === "object").length, 0);
});

test("a continuation waits for its workspace before calling a driver", async (t) => {
    const f = await fixture(t);
    f.start(f.post("Task").id);
    f.reopen();
    const waiting = deferred();
    const ready = deferred();
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = f.scheduler(driver, { workspaces: {
        ensure: () => "/home/example/project", description: () => undefined, storeAttachment: async () => "unused",
        waitUntilReady: async () => { waiting.resolve(); await ready.promise; },
    } });
    scheduler.start();
    await waiting.promise;
    assert.equal(driver.requests.length, 0);
    assert.equal(f.runtime.view(f.runId).turns.at(-1)?.status, "running");
    ready.resolve();
    await scheduler.waitForIdle();
    await scheduler.stop();
    assert.equal(driver.requests.length, 1);
});

test("a workspace wait timeout visibly fails the continuation without calling a driver", async (t) => {
    const f = await fixture(t);
    f.start(f.post("Task").id);
    f.reopen();
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = f.scheduler(driver, { workspaces: {
        ensure: () => "/home/example/project", description: () => undefined, storeAttachment: async () => "unused",
        waitUntilReady: async () => { throw new Error("The workstation did not connect within 15 minutes"); },
    } });
    scheduler.start();
    await scheduler.waitForIdle();
    await scheduler.stop();
    assert.equal(driver.requests.length, 0);
    assert.equal(f.runtime.view(f.runId).turns.at(-1)?.status, "failed");
    assert.match(f.runtime.view(f.runId).turns.at(-1)?.reason ?? "", /workstation did not connect/);
});

test("a TypeScript actor re-evaluates its original input and committed state", async (t) => {
    const f = await fixture(t);
    const view = f.runtime.createScriptActor({ actorId: f.ownerId, commandId: "script" }, f.runId, { handle: "program", displayName: "Program", grants: [], toolNames: [] });
    const script = view.actors.find((actor) => actor.kind === "script")!;
    const input = f.runtime.enqueueInput({ actorId: f.ownerId, commandId: "script-input" }, f.runId, { actorId: script.id, content: '{"kind":"wake"}' }).inputs.at(-1)!;
    f.runtime.startTurn({ actorId: script.id, commandId: "script-turn" }, f.runId, script.id, input.id);
    f.runtime.replacePluginState({ actorId: f.ownerId, commandId: "checkpoint" }, f.runId, { pluginId: "test.program", scope: { kind: "actor", actorId: script.id }, state: { step: "complete" } });
    f.reopen();
    let evaluated = 0;
    const driver = { kind: "script" as const, runTurn: async (request: Parameters<ScriptDriver["runTurn"]>[0]) => {
        assert.equal(request.input.content, '{"kind":"wake"}');
        assert.match(JSON.stringify(f.runtime.view(f.runId).pluginStates), /complete/);
        evaluated++;
        return { failure: null, usage: noUsage() };
    } };
    const scheduler = new TurnScheduler(f.runtime, f.journal, { drivers: { script: driver }, catalog });
    scheduler.start();
    await scheduler.waitForIdle();
    await scheduler.stop();
    assert.equal(evaluated, 1);
});

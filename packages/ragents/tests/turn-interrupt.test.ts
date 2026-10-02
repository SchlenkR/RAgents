import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { unrestrictedAccess } from "../src/access.ts";
import { ToolRegistry } from "../src/agents/plugins.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { defineRunFunction } from "../src/agents/tools.ts";
import { runContracts } from "../src/http/contracts.ts";
import { runtimeMethods } from "../src/http/methods.ts";
import type { MethodContext } from "../src/rpc/contribution.ts";
import { FakeDriver, allGrants, catalog, deferred, manualExecution, noUsage, postTo, registryOf, setupRun, textStep } from "./support.ts";

const context: MethodContext = {
    access: unrestrictedAccess,
    signal: new AbortController().signal,
    progress: () => undefined,
    connection: { id: "test", userId: null, streamless: true, call: () => Promise.reject(new Error("no client")), onClose: () => () => undefined },
    local: true,
};

const lifecycleOf = (setup: ReturnType<typeof setupRun>, actorId: string) => {
    const actor = setup.runtime.view(setup.view.id).actors.find((entry) => entry.id === actorId);
    assert.ok(actor && actor.kind !== "human");
    return actor.lifecycle;
};

const interruptMethod = (setup: ReturnType<typeof setupRun>, scheduler: TurnScheduler) => {
    const found = runtimeMethods({
        runtime: setup.runtime,
        assertRunRights: () => undefined,
        projectView: (view) => view,
        hasRun: () => true,
        interruptTurn: (runId, actorId, interruption) => scheduler.interruptTurn(runId, actorId, interruption),
        pauseRun: (runId, pause) => scheduler.pauseRun(runId, pause),
    }).find((entry) => entry.contract.id === runContracts.interruptTurn.id)!;

    return (actorId: string, commandId: string) => found.execute({ runId: setup.view.id, commandId, actorId } as never, context);
};

test("interrupting a turn ends only that turn: the actor, its session and its children stay, its tool call is aborted", async () => {
    const setup = setupRun({ grants: allGrants() });
    const toolStarted = deferred();
    let toolSignal: AbortSignal | undefined;
    let childId = "";
    const waitTool = defineRunFunction({
        name: "wait_tool",
        label: "wait_tool",
        description: "Waits until the turn ends.",
        schema: Type.Object({}),
        resultSchema: Type.Null(),
        available: () => true,
        nativeTool: true,
        run: (scope) => new Promise<null>((_resolve, reject) => {
            toolSignal = scope.signal;
            scope.signal?.addEventListener("abort", () => reject(new Error("Tool cancelled.")), { once: true });
            toolStarted.resolve();
        }),
    });
    const registry = new ToolRegistry().register({ name: "wait", dynamic: true, descriptors: [], tools: () => [waitTool] });
    const driver = new FakeDriver(async (request) => {
        if (driver.requests.length > 1) {
            request.recordContext({ kind: "step", step: textStep("Moving on.") });
            return { failure: null, usage: noUsage() };
        }
        const spawned = setup.runtime.spawnAgent({ actorId: setup.agent.id, commandId: "spawn-child", turnId: request.turnId }, setup.view.id, {
            handle: "child", displayName: "Child", prompt: "", execution: manualExecution(), grants: [], toolNames: [],
        });
        childId = spawned.actors.find((actor) => actor.handle === "child")!.id;
        const input = postTo(setup.runtime, setup.view, childId, "child-input", "Keep working.").inputs.at(-1)!;
        setup.runtime.startTurn({ actorId: childId, commandId: "child-turn" }, setup.view.id, childId, input.id);
        request.publish({ kind: "text", delta: "Visible start" });
        await request.invoke("call-wait", "wait_tool", {}, "context").catch(() => undefined);
        request.emit({ kind: "assistant-interrupted", text: "Visible start" });
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog, registry });
    const interrupt = interruptMethod(setup, scheduler);

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "first-input", "Long work.");
        scheduler.start();
        await toolStarted.promise;
        const childTurn = lifecycleOf(setup, childId);

        const interrupted = await interrupt("worker", "interrupt-1") as { actors: Array<{ id: string; lifecycle: { kind: string } }> };

        assert.equal(interrupted.actors.find((actor) => actor.id === setup.agent.id)?.lifecycle.kind, "idle");
        assert.equal(toolSignal?.aborted, true);
        const view = setup.runtime.view(setup.view.id);
        const turn = view.turns.find((entry) => entry.actorId === setup.agent.id)!;
        assert.equal(turn.status, "interrupted");
        assert.deepEqual(turn.toolCalls.map((call) => call.status), ["interrupted"]);
        assert.equal(childTurn.kind, "running");
        assert.deepEqual(lifecycleOf(setup, childId), childTurn, "the child keeps working untouched");
        const events = setup.runtime.events(setup.view.id);
        assert.equal(events.some((event) => event.type === "actor.stopped"), false);
        assert.deepEqual(events.filter((event) => event.type === "model.output.interrupted" || event.type === "turn.interrupted").map((event) => event.type),
            ["model.output.interrupted", "turn.interrupted"]);
        const end = events.find((event) => event.type === "turn.interrupted")!;
        assert.equal(end.actorId, setup.view.ownerId, "the journal names the operator as the one who interrupted");
        assert.equal(end.type === "turn.interrupted" ? end.payload.reason : "", "Turn interrupted by the operator");

        const count = events.length;
        await interrupt("worker", "interrupt-2");
        assert.equal(setup.runtime.events(setup.view.id).length, count, "without a running turn nothing happens");

        postTo(setup.runtime, setup.view, setup.agent.id, "second-input", "Continue.");
        await scheduler.waitForIdle();
        assert.deepEqual(setup.runtime.view(setup.view.id).turns.filter((entry) => entry.actorId === setup.agent.id).map((entry) => entry.status), ["interrupted", "completed"]);
        assert.equal(lifecycleOf(setup, setup.agent.id).kind, "idle");
        assert.equal(driver.requests.length, 2);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("a driver that ignores the abort is interrupted in the journal after the wait, and the next turn follows its end", async () => {
    const setup = setupRun();
    const started = deferred();
    const release = deferred();
    const driver = new FakeDriver(async () => {
        if (driver.requests.length === 1) {
            started.resolve();
            await release.promise;
        }
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog, interruptWaitMs: 20 });
    const interrupt = interruptMethod(setup, scheduler);

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "stubborn-input", "Work.");
        scheduler.start();
        await started.promise;
        await interrupt(setup.agent.id, "interrupt-stubborn");
        const view = setup.runtime.view(setup.view.id);
        assert.equal(view.turns[0]?.status, "interrupted");
        assert.equal(lifecycleOf(setup, setup.agent.id).kind, "idle");
        assert.equal(setup.runtime.events(setup.view.id).find((event) => event.type === "turn.interrupted")?.actorId, setup.view.ownerId);

        postTo(setup.runtime, setup.view, setup.agent.id, "next-input", "Continue.");
        assert.equal(driver.requests.length, 1, "the next input waits until the old driver returns");
        release.resolve();
        await scheduler.waitForIdle();
        assert.deepEqual(setup.runtime.view(setup.view.id).turns.map((turn) => turn.status), ["interrupted", "completed"]);
    } finally {
        release.resolve();
        await scheduler.stop();
        setup.journal.close();
    }
});

test("a turn this scheduler does not drive is interrupted in the journal alone", async () => {
    const setup = setupRun({ execution: manualExecution() });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: {}, catalog });
    const interrupt = interruptMethod(setup, scheduler);

    try {
        const input = postTo(setup.runtime, setup.view, setup.agent.id, "manual-input", "Von Hand.").inputs.at(-1)!;
        setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "manual-turn" }, setup.view.id, setup.agent.id, input.id);
        await interrupt(setup.agent.id, "interrupt-manual");
        const view = setup.runtime.view(setup.view.id);
        assert.equal(view.turns[0]?.status, "interrupted");
        assert.equal(lifecycleOf(setup, setup.agent.id).kind, "idle");
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

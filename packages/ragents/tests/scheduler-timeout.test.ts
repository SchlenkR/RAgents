import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { ToolRegistry } from "../src/agents/plugins.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { claimTurn } from "../src/agents/turn.ts";
import { defineRunFunction } from "../src/agents/tools.ts";
import { project, viewOf } from "../src/domain/projection.ts";
import type { TurnRequest } from "../src/drivers/types.ts";
import { FakeDriver, catalog, deferred, executionFor, manualExecution, noUsage, postTo, registryOf, setupRun, textStep } from "./support.ts";

type ProgressCase = {
    name: string;
    prepare?: (request: TurnRequest<"agent">) => void;
    advance: (request: TurnRequest<"agent">, index: number) => void;
    finish?: (request: TurnRequest<"agent">) => void;
};

const startCalls = (request: TurnRequest<"agent">) => {
    for (let index = 0; index < 3; index++)
        request.recordTool!({ kind: "started", id: `call-${index}`, name: "probe", input: {} });
};

const finishCalls = (request: TurnRequest<"agent">) => {
    for (let index = 0; index < 3; index++)
        request.recordTool!({ kind: "completed", id: `call-${index}`, name: "probe", output: null });
};

const progressCases: ProgressCase[] = [
    { name: "completed model steps", advance: (request) => request.recordContext({ kind: "step", step: textStep("Progress") }) },
    { name: "streamed text", advance: (request) => request.publish({ kind: "text", delta: "Progress" }) },
    { name: "streamed reasoning", advance: (request) => request.publish({ kind: "thinking", delta: "Checking" }) },
    { name: "streamed tool arguments", advance: (request) => request.publish({ kind: "tool", id: "call", name: "probe", arguments: "{}" }) },
    { name: "live tool results", advance: (request) => request.publish({ kind: "tool-result", id: "call", result: "Done", isError: false }) },
    {
        name: "tool starts",
        advance: (request, index) => request.recordTool!({ kind: "started", id: `call-${index}`, name: "probe", input: {} }),
        finish: finishCalls,
    },
    {
        name: "tool completions",
        prepare: startCalls,
        advance: (request, index) => request.recordTool!({ kind: "completed", id: `call-${index}`, name: "probe", output: null }),
    },
    {
        name: "tool failures",
        prepare: startCalls,
        advance: (request, index) => request.recordTool!({ kind: "failed", id: `call-${index}`, name: "probe", error: "Failed" }),
    },
    {
        name: "presented tool results",
        prepare: (request) => { startCalls(request); finishCalls(request); },
        advance: (request, index) => request.recordContext({
            kind: "tool-result", toolCallId: `call-${index}`, toolName: "probe", isError: false,
            content: [{ type: "text", text: "Done" }],
        }),
    },
    { name: "runtime output", advance: (request) => request.emit({ kind: "runtime", text: "Progress" }) },
    { name: "driver progress", advance: (request) => request.progress!() },
];

for (const progress of progressCases) {
    test(`${progress.name} reset turn inactivity without a live bus`, async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const setup = setupRun({ execution: executionFor("worker", { profile: "agent", turnTimeoutMs: 1_000 }) });
        const signals: AbortSignal[] = [];
        const driver = new FakeDriver(async (request, signal) => {
            signals.push(signal);
            progress.prepare?.(request);
            for (let index = 0; index < 3; index++) {
                t.mock.timers.tick(900);
                assert.equal(signal.aborted, false);
                progress.advance(request, index);
            }
            t.mock.timers.tick(999);
            assert.equal(signal.aborted, false);
            progress.finish?.(request);
            return { failure: null, usage: noUsage() };
        });
        const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });
        try {
            postTo(setup.runtime, setup.view, setup.agent.id, "progress", "Keep working");
            scheduler.start();
            await scheduler.waitForIdle();
            assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "completed");
            t.mock.timers.tick(2_000);
            assert.equal(signals[0]?.aborted, false);
        } finally {
            await scheduler.stop();
            setup.journal.close();
        }
    });
}

test("steering joining a turn resets inactivity", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const setup = setupRun({ execution: executionFor("worker", { profile: "agent", turnTimeoutMs: 1_000 }) });
    const driver = new FakeDriver(async (request, signal) => {
        for (let index = 0; index < 3; index++) {
            t.mock.timers.tick(900);
            assert.equal(signal.aborted, false);
            postTo(setup.runtime, setup.view, setup.agent.id, `steering-${index}`, "Continue");
            assert.equal(request.claimSteering().length, 1);
        }
        t.mock.timers.tick(999);
        assert.equal(signal.aborted, false);
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });
    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "initial", "Start");
        scheduler.start();
        await scheduler.waitForIdle();
        assert.deepEqual(setup.runtime.view(setup.view.id).turns.map((turn) => turn.status), ["completed"]);
        assert.equal(driver.requests.length, 1);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("native tool execution resets inactivity at its start and completion", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const setup = setupRun({ execution: executionFor("worker", { profile: "agent", turnTimeoutMs: 1_000 }) });
    const started = deferred();
    const release = deferred();
    const registry = new ToolRegistry().register({ name: "probe", dynamic: true, descriptors: [], tools: () => [defineRunFunction({
        name: "probe", label: "Probe", description: "Check progress", schema: Type.Object({}), resultSchema: Type.Null(),
        available: () => true,
        run: async () => { started.resolve(); await release.promise; return null; },
    })] });
    const driver = new FakeDriver(async (request, signal) => {
        t.mock.timers.tick(900);
        const invoked = request.invoke("native-call", "probe", {});
        await started.promise;
        t.mock.timers.tick(900);
        assert.equal(signal.aborted, false);
        release.resolve();
        await invoked;
        t.mock.timers.tick(999);
        assert.equal(signal.aborted, false);
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog, registry });
    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "native", "Run probe");
        scheduler.start();
        await scheduler.waitForIdle();
        const turn = setup.runtime.view(setup.view.id).turns[0];
        assert.equal(turn?.status, "completed");
        assert.deepEqual(turn?.toolCalls.map((call) => call.status), ["completed"]);
    } finally {
        release.resolve();
        await scheduler.stop();
        setup.journal.close();
    }
});

for (const throws of [false, true]) {
    test(`a stalled turn records its timeout cause when the driver ${throws ? "throws" : "returns"}`, async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const setup = setupRun({ execution: executionFor("worker", { profile: "agent", turnTimeoutMs: 3_600_000 }) });
        const driver = new FakeDriver(async (request, signal) => {
            request.recordTool!({ kind: "started", id: "stalled-call", name: "probe", input: {} });
            t.mock.timers.tick(3_599_999);
            assert.equal(signal.aborted, false);
            request.publish({ kind: "text", delta: "" });
            request.publish({ kind: "thinking", delta: "" });
            t.mock.timers.tick(1);
            assert.equal(signal.aborted, true);
            assert.ok(signal.reason instanceof Error);
            assert.equal(signal.reason.name, "TurnTimeoutError");
            if (throws) throw new Error("Provider aborted");
            return { failure: null, usage: noUsage() };
        });
        const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });
        try {
            postTo(setup.runtime, setup.view, setup.agent.id, "stalled", "Long work");
            scheduler.start();
            await scheduler.waitForIdle();
            const view = setup.runtime.view(setup.view.id);
            const reason = "The turn made no progress for 60 minutes and was stopped.";
            assert.equal(view.turns[0]?.status, "interrupted");
            assert.equal(view.turns[0]?.reason, reason);
            assert.deepEqual(view.turns[0]?.toolCalls.map((call) => call.status), ["interrupted"]);
            assert.equal(view.inputs[0]?.lifecycle.kind, "claimed");
            assert.equal(driver.requests.length, 1);
            const events = setup.runtime.events(setup.view.id);
            assert.equal(events.find((event) => event.type === "turn.interrupted")?.payload.reason, reason);
            assert.deepEqual(viewOf(project(events)!).turns, view.turns);
        } finally {
            await scheduler.stop();
            setup.journal.close();
        }
    });
}

test("a timeout during toolset preparation records the inactivity cause", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const setup = setupRun({ execution: executionFor("worker", { profile: "agent", turnTimeoutMs: 60_000 }) });
    const preparing = deferred();
    const release = deferred();
    const registry = { resolve: async () => { preparing.resolve(); await release.promise; return []; } };
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog, registry });
    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "preparing", "Start");
        scheduler.start();
        await preparing.promise;
        t.mock.timers.tick(60_000);
        release.resolve();
        await scheduler.waitForIdle();
        assert.equal(driver.requests.length, 0);
        assert.equal(setup.runtime.view(setup.view.id).turns[0]?.reason, "The turn made no progress for 1 minute and was stopped.");
    } finally {
        release.resolve();
        await scheduler.stop();
        setup.journal.close();
    }
});

test("inactivity expires after the last progress, despite another actor's activity", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const setup = setupRun({ execution: executionFor("worker", { profile: "agent", turnTimeoutMs: 1_000 }) });
    const other = setup.runtime.spawnAgent({ actorId: setup.view.ownerId, commandId: "spawn-other" }, setup.view.id, {
        handle: "other", displayName: "Other", prompt: "Work", execution: manualExecution(), grants: [], toolNames: [],
    }).actors.find((actor) => actor.handle === "other")!;
    const inputId = postTo(setup.runtime, setup.view, other.id, "other-input", "Work").inputs.at(-1)!.id;
    const otherTurn = claimTurn(setup.runtime, setup.view.id, other.id, inputId, "other-turn");
    const driver = new FakeDriver(async (request, signal) => {
        t.mock.timers.tick(900);
        request.recordContext({ kind: "step", step: textStep("Progress") });
        t.mock.timers.tick(900);
        setup.runtime.appendRuntimeOutput({ actorId: other.id, commandId: "other-progress", turnId: otherTurn.turnId },
            setup.view.id, other.id, { turnId: otherTurn.turnId, text: "Still working" });
        t.mock.timers.tick(99);
        assert.equal(signal.aborted, false);
        t.mock.timers.tick(1);
        assert.equal(signal.aborted, true);
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });
    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "stall-after-progress", "Work");
        scheduler.start();
        await scheduler.waitForIdle();
        const turn = setup.runtime.view(setup.view.id).turns.find((entry) => entry.actorId === setup.agent.id);
        assert.equal(turn?.reason, "The turn made no progress for 1 second and was stopped.");
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

for (const turnTimeoutMs of [null, 0]) {
    test(`turnTimeoutMs ${turnTimeoutMs} leaves turns unlimited`, async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const setup = setupRun({ execution: { ...executionFor("worker", { profile: "agent" }), turnTimeoutMs } });
        const driver = new FakeDriver(async (_request, signal) => {
            t.mock.timers.tick(7_200_000);
            assert.equal(signal.aborted, false);
            return { failure: null, usage: noUsage() };
        });
        const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });
        try {
            postTo(setup.runtime, setup.view, setup.agent.id, "unlimited", "Continue");
            scheduler.start();
            await scheduler.waitForIdle();
            assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "completed");
        } finally {
            await scheduler.stop();
            setup.journal.close();
        }
    });
}

import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { ToolRegistry } from "../src/agents/plugins.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { defineRunFunction } from "../src/agents/tools.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import {
    FakeDriver,
    catalog,
    deferred,
    executionFor,
    noUsage,
    postTo,
    registryOf,
    setupRun,
} from "./support.ts";

test("the scheduler gives one ActorInput to a turn and records normal model output", async () => {
    const setup = setupRun();
    const driver = new FakeDriver(async (request) => {
        request.emit({ kind: "reasoning", text: "Checking." });
        request.emit({ kind: "assistant", text: "Complete." });

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "input", "Do exactly this.");
        scheduler.start();
        await scheduler.waitForIdle();

        assert.equal(driver.requests.length, 1);
        assert.equal(driver.requests[0]?.input.content, "Do exactly this.");
        assert.equal(driver.requests[0]?.input.actorId, setup.agent.id);
        assert.deepEqual(
            setup.runtime.events(setup.view.id)
                .filter((entry) => entry.type === "model.reasoning.completed" || entry.type === "model.output.completed")
                .map((entry) => entry.type),
            ["model.reasoning.completed", "model.output.completed"],
        );
        assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "completed");
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("tools empty creates a plain model turn without runtime tools", async () => {
    const setup = setupRun({ toolNames: [] });
    const driver = new FakeDriver(async (request) => {
        assert.deepEqual(request.allowedToolNames, []);
        assert.deepEqual(request.tools, []);
        assert.deepEqual(request.workspaceTools, []);
        assert.equal(request.systemPrompt, "Work only on the addressed task.");

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
        basePrompt: () => "Injected product prompt.",
        contract: () => "Injected runtime contract.",
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "plain-input", "Talk normally.");
        scheduler.start();
        await scheduler.waitForIdle();

        assert.equal(driver.requests.length, 1);
        assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "completed");
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

for (const selection of [null, ["counter_read"], []]) {
    test(`function overview follows actor selection ${JSON.stringify(selection)} and refreshes during the turn`, async () => {
        const setup = setupRun({ toolNames: selection });
        const makeFunction = (name: string, available = true) => defineRunFunction({
            name,
            label: "Visible label",
            description: `Short description for ${name}.`,
            longDescription: "Detailed usage instructions belong in API discovery.",
            nativeTool: name.startsWith("typescript_"),
            schema: Type.Object({}),
            resultSchema: Type.Null(),
            available: () => available,
            run: () => null,
        });
        let functions = [
            makeFunction("typescript_api"),
            makeFunction("typescript_eval"),
            makeFunction("counter_read"),
            makeFunction("counter_write"),
            makeFunction("counter_denied", false),
        ];
        const registry = new ToolRegistry().register({
            name: "counter",
            dynamic: true,
            descriptors: [],
            tools: () => functions,
        });
        const driver = new FakeDriver(async (request) => {
            const assertOverview = (prompt: string, refreshed: boolean) => {
                assert.doesNotMatch(prompt, /Detailed usage instructions|counter_denied/);
                if (selection?.length === 0) {
                    assert.equal(prompt, "Work only on the addressed task.");
                    return;
                }
                assert.match(prompt, /- counter_read: Short description for counter_read\./);
                if (selection === null) {
                    assert.match(prompt, refreshed ? /- counter_new:/ : /- counter_write:/);
                    assert.doesNotMatch(prompt, refreshed ? /counter_write/ : /counter_new/);
                } else {
                    assert.doesNotMatch(prompt, /counter_write|counter_new/);
                }
            };
            assertOverview(request.systemPrompt, false);
            assert.deepEqual(request.tools.map((fn) => fn.name), selection?.length === 0 ? [] : ["typescript_api", "typescript_eval"]);
            functions = [...functions.filter((fn) => fn.name !== "counter_write"), makeFunction("counter_new")];
            assert.ok(request.refreshTools);
            const refreshed = await request.refreshTools();
            assertOverview(refreshed.systemPrompt, true);
            assert.deepEqual(refreshed.tools.map((fn) => fn.name), request.tools.map((fn) => fn.name));
            return { failure: null, usage: noUsage() };
        });
        const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog, registry });
        try {
            postTo(setup.runtime, setup.view, setup.agent.id, "overview-input", "Use your functions.");
            scheduler.start();
            await scheduler.waitForIdle();
            assert.equal(driver.requests.length, 1);
            assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "completed");
        } finally {
            await scheduler.stop();
            setup.journal.close();
        }
    });
}

test("tools empty fails closed for a driver with intrinsic tools", async () => {
    const setup = setupRun({
        execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }),
        toolNames: [],
    });
    let calls = 0;
    const driver = {
        kind: "agent" as const,
        async runTurn() {
            calls++;

            return { failure: null, usage: noUsage() };
        },
    };
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "plain-input", "Talk normally.");
        scheduler.start();
        await scheduler.waitForIdle();

        assert.equal(calls, 0);
        assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "failed");
        assert.match(
            setup.runtime.events(setup.view.id)
                .find((event) => event.type === "runtime.output.recorded")?.payload.text ?? "",
            /cannot guarantee a plain LLM/,
        );
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("a rejected tool terminal event fails the turn and closes the recorded call", async () => {
    const setup = setupRun();
    const driver = new FakeDriver(async (request) => {
        request.recordTool?.({ kind: "started", id: "call-1", name: "expected", input: {} });
        request.recordTool?.({ kind: "completed", id: "call-1", name: "wrong", output: null });

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "tool-input", "Use the tool.");
        scheduler.start();
        await scheduler.waitForIdle();

        const events = setup.runtime.events(setup.view.id);
        assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "failed");
        assert.deepEqual(
            events
                .filter((event) => event.type.startsWith("tool.call."))
                .map((event) => event.type),
            ["tool.call.started", "tool.call.failed"],
        );
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("consecutive inputs run serially in enqueue order", async () => {
    const setup = setupRun();
    const firstMayFinish = deferred();
    const firstStarted = deferred();
    const driver = new FakeDriver(async (request) => {
        if (request.input.content === "First") {
            firstStarted.resolve();
            await firstMayFinish.promise;
        }

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "first", "First");
        postTo(setup.runtime, setup.view, setup.agent.id, "second", "Second");
        scheduler.start();
        await firstStarted.promise;
        assert.deepEqual(driver.requests.map((entry) => entry.input.content), ["First"]);

        firstMayFinish.resolve();
        await scheduler.waitForIdle();
        assert.deepEqual(driver.requests.map((entry) => entry.input.content), ["First", "Second"]);
        assert.deepEqual(setup.runtime.view(setup.view.id).turns.map((entry) => entry.status), ["completed", "completed"]);
    } finally {
        firstMayFinish.resolve();
        await scheduler.stop();
        setup.journal.close();
    }
});

test("input arriving during a running turn waits for the next turn", async () => {
    const setup = setupRun();
    const release = deferred();
    const started = deferred();
    const driver = new FakeDriver(async (request) => {
        if (request.input.content === "Running") {
            started.resolve();
            await release.promise;
        }

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "running", "Running");
        scheduler.start();
        await started.promise;
        postTo(setup.runtime, setup.view, setup.agent.id, "waiting", "Waiting");

        assert.equal(driver.requests.length, 1);
        assert.equal(setup.runtime.view(setup.view.id).inputs.filter((entry) => entry.lifecycle.kind === "pending").length, 1);
        release.resolve();
        await scheduler.waitForIdle();
        assert.deepEqual(driver.requests.map((entry) => entry.input.content), ["Running", "Waiting"]);
    } finally {
        release.resolve();
        await scheduler.stop();
        setup.journal.close();
    }
});

test("subscription removal skips queued deliveries and preserves normal FIFO work", async () => {
    const setup = setupRun();
    const release = deferred();
    const deliveryQueued = deferred();
    const driver = new FakeDriver(async (request) => {
        if (request.input.content === "Initial work") {
            request.emit({ kind: "assistant", text: "Observable output." });
            deliveryQueued.resolve();
            await release.promise;
        }

        return { failure: null, usage: noUsage() };
    });
    const subscribed = setup.runtime.createSubscription(
        { actorId: setup.view.ownerId, commandId: "subscribe-self-output" },
        setup.view.id,
        {
            subscriberId: setup.agent.id,
            sourceActorIds: [setup.agent.id],
            eventTypes: ["model.output.completed"],
            includeSelf: true,
        },
    );
    const subscription = subscribed.subscriptions[0];
    assert.ok(subscription);
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "initial", "Initial work");
        scheduler.start();
        await deliveryQueued.promise;
        const delivery = setup.runtime.view(setup.view.id).inputs.find(
            (input) => input.subscriptionId === subscription.id,
        );
        assert.ok(delivery);

        setup.runtime.removeSubscription(
            { actorId: setup.view.ownerId, commandId: "remove-self-output" },
            setup.view.id,
            subscription.id,
            "Output received.",
        );
        postTo(setup.runtime, setup.view, setup.agent.id, "follow-up", "Normal follow-up");
        release.resolve();
        await scheduler.waitForIdle();

        const current = setup.runtime.view(setup.view.id);
        const discarded = current.inputs.find((input) => input.id === delivery.id);
        assert.deepEqual(driver.requests.map((entry) => entry.input.content), ["Initial work", "Normal follow-up"]);
        assert.equal(current.turns.length, 2);
        assert.ok(discarded && discarded.lifecycle.kind === "discarded");
        assert.equal(discarded.lifecycle.reason, "Output received.");
    } finally {
        release.resolve();
        await scheduler.stop();
        setup.journal.close();
    }
});

test("subscription removal between idle scan and claim prevents the turn", async () => {
    const setup = setupRun();
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const subscribed = setup.runtime.createSubscription(
        { actorId: setup.view.ownerId, commandId: "subscribe-claim-race" },
        setup.view.id,
        {
            subscriberId: setup.agent.id,
            sourceActorIds: [setup.agent.id],
            eventTypes: ["model.output.completed"],
            includeSelf: true,
        },
    );
    const subscription = subscribed.subscriptions[0];
    assert.ok(subscription);
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "race-source", "Create delivery");
    const sourceInput = queued.inputs.find(
        (input) => input.actorId === setup.agent.id && input.subscriptionId === null && input.lifecycle.kind === "pending",
    );
    assert.ok(sourceInput);
    const running = setup.runtime.startTurn(
        { actorId: setup.agent.id, commandId: "start-race-source" },
        setup.view.id,
        setup.agent.id,
        sourceInput.id,
    );
    const actor = running.actors.find((entry) => entry.id === setup.agent.id);
    assert.ok(actor && actor.kind !== "human" && actor.lifecycle.kind === "running");
    const delivered = setup.runtime.appendModelOutput(
        { actorId: setup.agent.id, commandId: "race-source-output", turnId: actor.lifecycle.turnId },
        setup.view.id,
        setup.agent.id,
        { turnId: actor.lifecycle.turnId, text: "Observable output." },
    ).inputs.find((input) => input.subscriptionId === subscription.id);
    assert.ok(delivered);
    setup.runtime.finishTurn(
        { actorId: setup.agent.id, commandId: "finish-race-source", turnId: actor.lifecycle.turnId },
        setup.view.id,
        setup.agent.id,
        { turnId: actor.lifecycle.turnId, outcome: "completed" },
    );
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        scheduler.start();
        setup.runtime.removeSubscription(
            { actorId: setup.view.ownerId, commandId: "remove-before-claim" },
            setup.view.id,
            subscription.id,
            "Removed before claim.",
        );
        await scheduler.waitForIdle();

        const current = setup.runtime.view(setup.view.id);
        const discarded = current.inputs.find((input) => input.id === delivered.id);
        assert.equal(driver.requests.length, 0);
        assert.equal(current.turns.length, 1);
        assert.ok(discarded && discarded.lifecycle.kind === "discarded");
        assert.equal(discarded.lifecycle.reason, "Removed before claim.");
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("a failed turn is not retried or requeued and fresh input still runs", async () => {
    const setup = setupRun();
    let calls = 0;
    const driver = new FakeDriver(async () => ({
        failure: ++calls === 1 ? "Expected failure." : null,
        usage: noUsage(),
    }));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "failing", "Fail once");
        postTo(setup.runtime, setup.view, setup.agent.id, "fresh", "Fresh work");
        scheduler.start();
        await scheduler.waitForIdle();

        const view = setup.runtime.view(setup.view.id);
        assert.equal(calls, 2);
        assert.deepEqual(driver.requests.map((entry) => entry.input.content), ["Fail once", "Fresh work"]);
        assert.deepEqual(view.turns.map((entry) => entry.status), ["failed", "completed"]);
        assert.equal(view.inputs.every((entry) => entry.lifecycle.kind === "claimed"), true);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("an aborted turn is interrupted without requeue", async () => {
    const setup = setupRun();
    const started = deferred();
    const driver = new FakeDriver(async (_request, signal) => {
        started.resolve();
        await new Promise<void>((resolve) => {
            if (signal.aborted)
                resolve();
            else
                signal.addEventListener("abort", () => resolve(), { once: true });
        });

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "abort-input", "Long work");
        scheduler.start();
        await started.promise;
        scheduler.abort(setup.view.id, setup.agent.id);
        await scheduler.waitForIdle();

        const view = setup.runtime.view(setup.view.id);
        assert.equal(view.turns[0]?.status, "interrupted");
        assert.equal(view.inputs.length, 1);
        assert.equal(view.inputs[0]?.lifecycle.kind, "claimed");
        assert.equal(driver.requests.length, 1);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("runtime restart interrupts an open turn and never resubmits its input", async () => {
    const setup = setupRun();
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "crash-input", "Started before crash");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    setup.runtime.startTurn(
        { actorId: setup.agent.id, commandId: "crash-turn" },
        setup.view.id,
        setup.agent.id,
        input.id,
    );
    const restarted = new Orchestration(setup.journal, setup.services);
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = new TurnScheduler(restarted, setup.journal, {
        drivers: registryOf(driver),
        catalog,
    });

    try {
        scheduler.start();
        await scheduler.waitForIdle();

        const view = restarted.view(setup.view.id);
        assert.equal(view.turns[0]?.status, "interrupted");
        assert.equal(view.inputs[0]?.lifecycle.kind, "claimed");
        assert.equal(driver.requests.length, 0);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

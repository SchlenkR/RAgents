import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";

import { ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Context } from "@ragents/ai";

import { resolveExecution, StaticModelCatalog, type CatalogModel } from "../src/agents/catalog.ts";
import { ToolRegistry } from "../src/agents/plugins.ts";
import { STEERING_MAX_CHARS, TurnScheduler } from "../src/agents/scheduler.ts";
import { defineRunFunction } from "../src/agents/tools.ts";
import { FixedWorkspaces } from "../src/agents/workspaces.ts";
import { thinkingLevels } from "../src/domain/driver.ts";
import type { JournalEvent } from "../src/domain/events.ts";
import { project } from "../src/domain/projection.ts";
import { AgentSessionDriver } from "../src/drivers/agent.ts";
import type { SteeredInput } from "../src/drivers/types.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import {
    FakeDriver,
    allGrants,
    catalog,
    deferred,
    executionFor,
    noUsage,
    postTo,
    registryOf,
    setupRun,
    testServices,
} from "./support.ts";

const steeredEventsOf = (events: readonly JournalEvent[]) =>
    events.filter((event): event is Extract<JournalEvent, { type: "turn.input-steered" }> => event.type === "turn.input-steered");

test("a message to an actor with a running turn joins that turn in order, and the journal replays it", async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-steering-journal-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const services = testServices();
    const journal = new Journal(directory, services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Steering", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const worker = runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn" }, run.id, {
        handle: "worker", displayName: "Worker", prompt: "Arbeite.",
        execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }), grants: [], toolNames: [],
    }).actors.find((actor) => actor.kind === "agent")!;
    const posted = deferred();
    const claims: (readonly SteeredInput[])[] = [];
    const driver = new FakeDriver(async (request) => {
        await posted.promise;
        claims.push(request.claimSteering(), request.claimSteering());
        request.emit({ kind: "assistant", text: "Beides berücksichtigt." });
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(runtime, journal, { drivers: registryOf(driver), catalog });

    try {
        postTo(runtime, run, worker.id, "first", "Baue die Seite.");
        scheduler.start();
        postTo(runtime, run, worker.id, "second", "Nimm Blau statt Rot.");
        postTo(runtime, run, worker.id, "third", "Und ohne Rahmen.");
        posted.resolve();
        await scheduler.waitForIdle();

        assert.equal(driver.requests.length, 1, "kein eigener Turn für die eingespeisten Nachrichten");
        assert.deepEqual(claims[0]!.map((entry) => entry.input.content), ["Nimm Blau statt Rot.", "Und ohne Rahmen."]);
        assert.deepEqual(claims[0]!.map((entry) => entry.prompt), ["Nimm Blau statt Rot.", "Und ohne Rahmen."]);
        assert.deepEqual(claims[1], [], "ein zweiter Abruf findet nichts mehr");

        const view = runtime.view(run.id);
        const turn = view.turns[0]!;
        assert.equal(turn.status, "completed");
        assert.deepEqual(view.inputs.map((input) => input.lifecycle), [
            { kind: "claimed", turnId: turn.id, steered: false },
            { kind: "claimed", turnId: turn.id, steered: true },
            { kind: "claimed", turnId: turn.id, steered: true },
        ]);
        const events = runtime.events(run.id);
        const steered = steeredEventsOf(events);
        assert.deepEqual(steered.map((event) => event.payload.inputId), view.inputs.slice(1).map((input) => input.id));
        assert.equal(new Set(steered.map((event) => event.commandId)).size, 1, "ein Command speist beide ein");
        assert.ok(steered.every((event) => event.actorId === worker.id && event.payload.turnId === turn.id));
        const output = events.find((event) => event.type === "model.output.completed")!;
        assert.ok(steered.every((event) => event.sequence < output.sequence));
    } finally {
        await scheduler.stop();
        journal.close();
    }

    const before = runtime.view(run.id);
    const restored = new Journal(directory, services);
    try {
        const replayed = new Orchestration(restored, services);
        assert.deepEqual(replayed.events(run.id), runtime.events(run.id));
        assert.deepEqual(replayed.view(run.id).inputs, before.inputs);
    } finally {
        restored.close();
    }
});

test("steering takes pending inputs in journal order and stops at the first one over the length limit", async () => {
    const setup = setupRun();
    const posted = deferred();
    const long = "x".repeat(STEERING_MAX_CHARS + 1);
    const claimed: string[][] = [];
    const driver = new FakeDriver(async (request) => {
        if (driver.requests.length === 1) await posted.promise;
        claimed.push(request.claimSteering().map((entry) => entry.input.content));
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "start", "Los.");
        scheduler.start();
        postTo(setup.runtime, setup.view, setup.agent.id, "short", "Kurz.");
        postTo(setup.runtime, setup.view, setup.agent.id, "long", long);
        postTo(setup.runtime, setup.view, setup.agent.id, "after", "Danach.");
        posted.resolve();
        await scheduler.waitForIdle();

        assert.deepEqual(claimed, [["Kurz."], ["Danach."]]);
        assert.deepEqual(driver.requests.map((request) => request.input.content), ["Los.", long]);
        assert.equal(setup.runtime.view(setup.view.id).turns.length, 2);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("an interrupted turn keeps what it took by steering, and a later message becomes the next turn", async () => {
    const setup = setupRun();
    const steered = deferred();
    const posted = deferred();
    const late: (readonly SteeredInput[])[] = [];
    const driver = new FakeDriver(async (request, signal) => {
        if (driver.requests.length > 1) return { failure: null, usage: noUsage() };
        await posted.promise;
        assert.equal(request.claimSteering().length, 1);
        steered.resolve();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        late.push(request.claimSteering());
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: registryOf(driver), catalog });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "start", "Los.");
        scheduler.start();
        postTo(setup.runtime, setup.view, setup.agent.id, "steer", "Eingespeist.");
        posted.resolve();
        await steered.promise;
        postTo(setup.runtime, setup.view, setup.agent.id, "later", "Nach der Unterbrechung.");
        await scheduler.interruptTurn(setup.view.id, setup.agent.id, {
            context: { actorId: setup.view.ownerId, commandId: "interrupt" },
            reason: "Bediener unterbricht",
        });
        await scheduler.waitForIdle();

        assert.deepEqual(late, [[]], "nach dem Abbruch speist der Turn nichts mehr ein");
        const view = setup.runtime.view(setup.view.id);
        assert.deepEqual(view.turns.map((turn) => turn.status), ["interrupted", "completed"]);
        const [first, second] = view.turns;
        assert.deepEqual(view.inputs.map((input) => input.lifecycle), [
            { kind: "claimed", turnId: first!.id, steered: false },
            { kind: "claimed", turnId: first!.id, steered: true },
            { kind: "claimed", turnId: second!.id, steered: false },
        ]);
        assert.deepEqual(driver.requests.map((request) => request.input.content), ["Los.", "Nach der Unterbrechung."]);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("steering is refused for actors without a model, out of order, and in a replayed journal that skips an input", () => {
    const setup = setupRun({ grants: allGrants() });
    const runId = setup.view.id;
    const script = setup.runtime.createScriptActor({ actorId: setup.view.ownerId, commandId: "script" }, runId, {
        handle: "program", displayName: "Programm", grants: [], toolNames: [],
    }).actors.find((actor) => actor.kind === "script")!;
    const scriptInput = postTo(setup.runtime, setup.view, script.id, "script-first", "eins").inputs.at(-1)!;
    const scriptTurn = setup.runtime.startTurn({ actorId: script.id, commandId: "script-turn" }, runId, script.id, scriptInput.id).turns.at(-1)!;
    const scriptWaiting = postTo(setup.runtime, setup.view, script.id, "script-second", "zwei").inputs.at(-1)!;
    assert.throws(
        () => setup.runtime.steerInputs({ actorId: script.id, commandId: "script-steer", turnId: scriptTurn.id }, runId, script.id, {
            turnId: scriptTurn.id, inputIds: [scriptWaiting.id],
        }),
        (error: Error & { code?: string }) => error.code === "steering-unsupported",
    );

    const first = postTo(setup.runtime, setup.view, setup.agent.id, "agent-first", "eins").inputs.at(-1)!;
    const turn = setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "agent-turn" }, runId, setup.agent.id, first.id).turns.at(-1)!;
    const second = postTo(setup.runtime, setup.view, setup.agent.id, "agent-second", "zwei").inputs.at(-1)!;
    const third = postTo(setup.runtime, setup.view, setup.agent.id, "agent-third", "drei").inputs.at(-1)!;
    const context = { actorId: setup.agent.id, commandId: "agent-steer", turnId: turn.id };
    assert.throws(
        () => setup.runtime.steerInputs(context, runId, setup.agent.id, { turnId: turn.id, inputIds: [third.id] }),
        (error: Error & { code?: string }) => error.code === "steering-order",
    );
    setup.runtime.steerInputs(context, runId, setup.agent.id, { turnId: turn.id, inputIds: [second.id, third.id] });

    const events = setup.runtime.events(runId);
    const steered = steeredEventsOf(events);
    const swapped = events.map((event) => event === steered[0]
        ? { ...event, payload: { ...event.payload, inputId: third.id } }
        : event === steered[1] ? { ...event, payload: { ...event.payload, inputId: second.id } } : event) as JournalEvent[];
    assert.throws(() => project(swapped), /cannot join turn .* before the earlier input/);
    setup.journal.close();
});

const fauxSetup = (directory: string) => {
    const faux = registerFauxProvider({ models: [{ id: "steering-engine", reasoning: false }], tokensPerSecond: 100000 });
    const modelRuntime = ModelRuntime.create();
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id,
            name: entry.name,
            api: entry.api,
            reasoning: entry.reasoning,
            input: entry.input,
            cost: entry.cost,
            contextWindow: entry.contextWindow,
            maxTokens: entry.maxTokens,
            baseUrl: entry.baseUrl,
        })),
    });
    const models: CatalogModel[] = [{
        driver: "agent", provider: model.provider, model: model.id, label: `${model.provider}/${model.id}`, thinking: thinkingLevels,
    }];
    const fauxCatalog = new StaticModelCatalog(models, [{
        name: "agent", description: "Faux", driver: "agent", provider: model.provider, model: model.id,
        turnTimeoutMs: 600_000, isolateWorkspace: false,
    }]);
    const setup = setupRun({
        grants: allGrants(),
        execution: resolveExecution(fauxCatalog, { profile: "agent", isolateWorkspace: false }, "worker", models),
    });
    const driver = new AgentSessionDriver({ modelRuntime });

    return { faux, fauxCatalog, setup, driver, directory };
};

test("with the agent runtime a message sent during a tool call reaches the model after the tool result, in the same turn", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-steering-agent-"));
    const { faux, fauxCatalog, setup, driver } = fauxSetup(directory);
    const toolStarted = deferred();
    const release = deferred();
    let toolSignal: AbortSignal | undefined;
    const waitTool = defineRunFunction({
        name: "wait_tool", label: "wait_tool", description: "Wartet auf den Test.",
        schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.String(),
        available: () => true, nativeTool: true,
        run: async (scope) => {
            toolSignal = scope.signal;
            toolStarted.resolve();
            await release.promise;
            return "Werkzeug fertig";
        },
    });
    const registry = new ToolRegistry().register({ name: "wait", dynamic: true, descriptors: [], tools: () => [waitTool] });
    const contexts: Context[] = [];
    faux.setResponses([
        () => fauxAssistantMessage([fauxToolCall("wait_tool", {}, { id: "call-wait" })]),
        (context) => {
            contexts.push({ messages: structuredClone(context.messages) });
            return fauxAssistantMessage("Umgestellt auf Blau.");
        },
    ]);
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: { agent: driver }, catalog: fauxCatalog, registry, workspaces: new FixedWorkspaces(directory),
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "start", "Baue die Seite.");
        scheduler.start();
        await toolStarted.promise;
        postTo(setup.runtime, setup.view, setup.agent.id, "steer", "Nimm Blau statt Rot.");
        release.resolve();
        await scheduler.waitForIdle();

        assert.equal(toolSignal?.aborted, false, "das Werkzeug läuft zu Ende");
        const users = contexts[0]!.messages.flatMap((message) => message.role === "user"
            ? [typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : "").join("")]
            : []);
        assert.equal(users.at(-1), "Nimm Blau statt Rot.");
        assert.equal(contexts[0]!.messages.at(-1)?.role, "user");
        assert.equal(contexts[0]!.messages.at(-2)?.role, "toolResult");

        const view = setup.runtime.view(setup.view.id);
        assert.equal(view.turns.length, 1);
        assert.equal(view.turns[0]!.status, "completed");
        const events = setup.runtime.events(setup.view.id);
        const sequenceOf = (predicate: (event: JournalEvent) => boolean) => events.find(predicate)!.sequence;
        const completed = sequenceOf((event) => event.type === "tool.call.completed");
        const joined = sequenceOf((event) => event.type === "turn.input-steered");
        const answer = sequenceOf((event) => event.type === "model.output.completed");
        assert.ok(completed < joined && joined < answer, "Werkzeugergebnis, dann Steering, dann Antwort");
    } finally {
        await scheduler.stop();
        await driver.shutdown().catch(() => undefined);
        faux.unregister();
        setup.journal.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

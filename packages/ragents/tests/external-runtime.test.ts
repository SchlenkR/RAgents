import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveExecution, type ModelCatalog } from "../src/agents/catalog.ts";
import { ToolRegistry } from "../src/agents/plugins.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { journalEventOf } from "../src/domain/event-validation.ts";
import { emptyUsage } from "../src/domain/model.ts";
import type { AgentDriver, TurnRequest } from "../src/drivers/types.ts";
import { ActorRuntimeContributionRegistry } from "../src/plugin-host.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { deferred, setupRun, testServices } from "./support.ts";

const runtimes = [{ id: "acme.coder", title: "Example coder" }];
const catalog: ModelCatalog = { models: async () => [], profiles: () => [], runtimes: () => runtimes };

const scenario = (directory = ":memory:") => {
    const services = testServices();
    const journal = new Journal(directory, services);
    const runtime = new Orchestration(journal, services);
    const created = runtime.createRun({ commandId: "create" }, { title: "External runtime", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const view = runtime.spawnAgent({ actorId: created.ownerId, commandId: "spawn" }, created.id, {
        handle: "coder", displayName: "Coder", prompt: "Check the project.", toolNames: null, grants: [],
        execution: resolveExecution(catalog, { runtime: "acme.coder" }, "coder"),
    });
    const actor = view.actors.find((entry) => entry.kind === "external")!;
    return { services, journal, runtime, view, actor };
};

test("external selections require a configured runtime and reject host model settings", () => {
    assert.equal(resolveExecution(catalog, { runtime: "acme.coder" }, "coder").driver.kind, "external");
    for (const selection of [{ runtime: "unknown" }, { driver: "external" as const }, { runtime: "acme.coder", model: "host-model" }, { driver: "manual" as const, runtime: "acme.coder" }])
        assert.throws(() => resolveExecution(catalog, selection, "coder"), /runtime|model selection/);
    const registry = new ActorRuntimeContributionRegistry();
    const driver: AgentDriver<"external"> = { kind: "external", runTurn: async () => ({ failure: null, usage: emptyUsage() }) };
    registry.register("acme.plugin", [{ ...runtimes[0]!, driver }]);
    assert.throws(() => registry.register("acme.other", [{ ...runtimes[0]!, driver }]), /already provided/);
    assert.deepEqual(registry.describe(), runtimes);
});

test("external turns dispatch by runtime, queue later inputs and journal observations without model context", async () => {
    const setup = scenario();
    const entered = deferred();
    const release = deferred();
    const requests: TurnRequest<"external">[] = [];
    const driver: AgentDriver<"external"> = { kind: "external", runTurn: async (request) => {
        requests.push(request);
        if (requests.length === 1) { entered.resolve(); await release.promise; }
        request.emit({ kind: "reasoning-completed", text: "Checked." });
        request.recordTool?.({ kind: "started", id: "local-call", name: "read", input: {} });
        request.recordTool?.({ kind: "completed", id: "local-call", name: "read", output: { text: "Read." } });
        request.emit({ kind: "assistant-completed", text: request.input.content });
        return { failure: null, usage: emptyUsage() };
    } };
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: {}, actorRuntimes: [{ ...runtimes[0]!, driver }], catalog });
    setup.runtime.enqueueInput({ actorId: setup.view.ownerId, commandId: "first" }, setup.view.id, { actorId: setup.actor.id, content: "First" });
    scheduler.start();
    try {
        await entered.promise;
        setup.runtime.enqueueInput({ actorId: setup.view.ownerId, commandId: "second" }, setup.view.id, { actorId: setup.actor.id, content: "Second" });
        assert.equal(setup.runtime.view(setup.view.id).inputs.at(-1)?.lifecycle.kind, "pending");
        assert.throws(() => setup.runtime.steerInputs({ actorId: setup.actor.id, commandId: "steer", turnId: requests[0]!.turnId }, setup.view.id, setup.actor.id, { turnId: requests[0]!.turnId, inputIds: [] }), /takes no steering/);
        release.resolve();
        await scheduler.waitForIdle();
        assert.equal(requests.length, 2);
        assert.equal(requests[0]!.runtime, "acme.coder");
        assert.equal(requests[0]!.instructions, "Check the project.");
        const events = setup.runtime.events(setup.view.id);
        assert.equal(events.filter((event) => event.type === "model.output.completed").length, 2);
        assert.equal(events.some((event) => event.type === "model.step.completed" || event.type === "turn.input-steered"), false);
        assert.equal(setup.runtime.view(setup.view.id).turns.every((turn) => turn.status === "completed"), true);
    } finally { release.resolve(); await scheduler.stop(); }
});

test("external observations and actor kinds survive disk replay and malformed runtime configurations fail validation", () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-external-journal-"));
    try {
        const setup = scenario(directory);
        const view = setup.runtime.enqueueInput({ actorId: setup.view.ownerId, commandId: "input" }, setup.view.id, { actorId: setup.actor.id, content: "Work" });
        const turn = setup.runtime.startTurn({ actorId: setup.actor.id, commandId: "start" }, view.id, setup.actor.id, view.inputs[0]!.id).turns[0]!;
        setup.runtime.appendExternalOutput({ actorId: setup.actor.id, commandId: "output", turnId: turn.id }, view.id, setup.actor.id, { turnId: turn.id, text: "External reply", reasoning: false });
        setup.runtime.finishTurn({ actorId: setup.actor.id, commandId: "finish", turnId: turn.id }, view.id, setup.actor.id, { turnId: turn.id, outcome: "completed" });
        setup.journal.close();
        const reopened = new Journal(directory, setup.services);
        const replay = new Orchestration(reopened, setup.services);
        assert.deepEqual(replay.view(view.id), setup.runtime.view(view.id));
        assert.equal(replay.events(view.id).find((event) => event.type === "model.output.completed")?.payload.text, "External reply");
        const spawn = setup.runtime.events(view.id).find((event) => event.type === "agent.spawned")!;
        assert.throws(() => journalEventOf({ ...spawn, payload: { ...spawn.payload, execution: { ...spawn.payload.execution, driver: { kind: "external", config: {} } } } }, "test"), /runtime/);
        assert.throws(() => journalEventOf({ ...spawn, payload: { ...spawn.payload, execution: { ...spawn.payload.execution, driver: { kind: "external", config: { runtime: "acme.coder", model: "extra" } } } } }, "test"), /model/);
        reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("built-in actors cannot emit external observations and spawn schemas name configured runtimes", async () => {
    const setup = setupRun();
    const registry = new ToolRegistry(() => runtimes);
    const tools = await registry.resolve({ runId: setup.view.id, actorId: setup.agent.id, actor: setup.agent, turnId: null, view: setup.view, workspace: "." });
    assert.equal(tools.some((tool) => tool.description.includes("Example coder")), false, "an actor without spawn capability receives no spawn tool");
    const view = setup.runtime.enqueueInput({ actorId: setup.view.ownerId, commandId: "input" }, setup.view.id, { actorId: setup.agent.id, content: "Work" });
    const turn = setup.runtime.startTurn({ actorId: setup.agent.id, commandId: "start" }, view.id, setup.agent.id, view.inputs[0]!.id).turns[0]!;
    assert.throws(() => setup.runtime.appendExternalOutput({ actorId: setup.agent.id, commandId: "external", turnId: turn.id }, view.id, setup.agent.id, { turnId: turn.id, text: "Invalid", reasoning: false }), /Only an external runtime/);
});

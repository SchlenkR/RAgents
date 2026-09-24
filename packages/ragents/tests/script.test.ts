import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { claimTurn } from "../src/agents/turn.ts";
import { agentTools } from "../src/agents/tools.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { actorStatePluginId, emptyUsage } from "../src/domain/model.ts";
import { capabilityNames } from "../src/domain/vocabulary.ts";
import { ScriptDriver } from "../src/script/driver.ts";
import type { ActorProgramExecutor } from "../src/script/programs.ts";
import { nativeActorPrograms } from "./actor-programs.ts";
import { scriptProgram } from "./native-executor.ts";
import { allGrants, catalog, deferred, postTo, setupRun, testServices } from "./support.ts";

const scriptActor = (setup: ReturnType<typeof setupRun>, handle = "script") => {
    const view = setup.runtime.createScriptActor({actorId: setup.view.ownerId, commandId: `create-${handle}`}, setup.view.id, {
        handle, displayName: handle, grants: [], toolNames: [],
    });
    const actor = view.actors.find((entry) => entry.kind === "script" && entry.handle === handle);
    assert.ok(actor?.kind === "script");
    return actor;
};

const activeContext = (setup: ReturnType<typeof setupRun>, actorId: string) => {
    const queued = postTo(setup.runtime, setup.view, actorId, `input-${actorId}`, "Prepare command");
    const input = queued.inputs.find((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, actorId, input.id, `turn-${actorId}`);
    return {actorId, turnId: turn.turnId};
};

const stateOf = (setup: ReturnType<typeof setupRun>, actorId: string) => setup.runtime.view(setup.view.id).pluginStates.find((entry) =>
    entry.pluginId === actorStatePluginId && entry.scope.kind === "actor" && entry.scope.actorId === actorId)?.state;

test("TypeScript actors journal only identity and execution while preserving delegation", () => {
    const setup = setupRun({grants: allGrants()});
    try {
        const actor = scriptActor(setup);
        assert.deepEqual(Object.keys(actor).sort(), ["kind", "id", "handle", "displayName", "createdBy", "description", "execution", "grants", "toolNames", "createdAt", "lifecycle", "usage", "openedToolNames"].sort());
        assert.equal(setup.runtime.events(setup.view.id).at(-1)?.type, "script.created");
        assert.throws(() => scriptActor(setup, "worker"), /already belongs/);
        const scriptContext = activeContext(setup, actor.id);
        const agentContext = activeContext(setup, setup.agent.id);
        assert.throws(() => setup.runtime.createScriptActor({...scriptContext, commandId: "denied"}, setup.view.id, {
            handle: "denied", displayName: "Denied", grants: [], toolNames: [],
        }), /agent.spawn/);
        const delegated = setup.runtime.createScriptActor({...agentContext, commandId: "delegate"}, setup.view.id, {
            handle: "child", displayName: "Child", grants: [], toolNames: [], turnTimeoutMs: 5_000,
        }).actors.find((entry) => entry.handle === "child");
        assert.ok(delegated && delegated.kind !== "human");
        assert.equal(delegated.createdBy, setup.agent.id);
        assert.equal(delegated.execution.turnTimeoutMs, 5_000);
    } finally { setup.journal.close(); }
});

test("both agent and TypeScript actors own intrinsic state without plugin write grants", () => {
    const setup = setupRun();
    try {
        const script = scriptActor(setup);
        const contexts = new Map([setup.agent, script].map((actor) => [actor.id, activeContext(setup, actor.id)]));
        for (const actor of [setup.agent, script]) {
            setup.runtime.replaceActorState({...contexts.get(actor.id)!, commandId: `self-${actor.id}`}, setup.view.id, actor.id, {count: 1});
            assert.deepEqual(stateOf(setup, actor.id), {count: 1});
            setup.runtime.replaceActorState({actorId: setup.view.ownerId, commandId: `host-${actor.id}`}, setup.view.id, actor.id, {count: 2});
            assert.deepEqual(stateOf(setup, actor.id), {count: 2});
        }
        assert.throws(() => setup.runtime.replaceActorState({...contexts.get(setup.agent.id)!, commandId: "foreign"}, setup.view.id, script.id, null), /only replace its own/);
        assert.throws(() => setup.runtime.replaceActorState({actorId: setup.view.ownerId, commandId: "human"}, setup.view.id, setup.view.ownerId, null), /human and takes no turns/);
        assert.throws(() => setup.runtime.replaceActorState({...contexts.get(script.id)!, commandId: "invalid"}, setup.view.id, script.id, [undefined] as never), /JSON value/);
        setup.runtime.replaceActorState({...contexts.get(script.id)!, commandId: "absent"}, setup.view.id, script.id, {kept: 1, absent: undefined} as never);
        assert.deepEqual(stateOf(setup, script.id), {kept: 1});
        assert.throws(() => setup.runtime.replacePluginState({...contexts.get(script.id)!, commandId: "other-plugin"}, setup.view.id, {
            pluginId: "another.plugin", scope: {kind: "actor", actorId: script.id}, state: {},
        }), /plugin.state.write/);
        assert.throws(() => setup.runtime.replacePluginState({actorId: setup.view.ownerId, commandId: "invalid-scope"}, setup.view.id, {
            pluginId: actorStatePluginId, scope: {kind: "run"}, state: {},
        }), /requires actor scope/);
    } finally { setup.journal.close(); }
});

test("the obsolete build workflow and install grant are absent", () => {
    assert.equal(agentTools.some((tool) => tool.name.startsWith("script_actor_")), false);
    assert.equal((capabilityNames as readonly string[]).includes("script.install"), false);
});

test("the script driver delegates delivered inputs and signals to the program port", async () => {
    const setup = setupRun();
    const actor = scriptActor(setup);
    const calls: string[] = [];
    const settlement = Promise.resolve();
    setup.services.actorPrograms = {
        async runInput(request, signal) {
            assert.equal(request.agentId, actor.id);
            assert.equal(request.input.content, "First input");
            assert.equal(signal.aborted, false);
            request.emit({kind: "runtime", text: "program executed"});
            setup.runtime.replaceActorState({actorId: actor.id, commandId: `${request.turnId}:state`, turnId: request.turnId}, request.runId, actor.id, {received: true});
            calls.push("input");
            return {failure: null, usage: emptyUsage()};
        },
        stopActor: (runId, actorId) => { calls.push(`actor:${runId}:${actorId}`); },
        stopRun: (runId) => { calls.push(`run:${runId}`); },
        waitForRunSettlement: () => settlement,
        disposeRun: (runId) => { calls.push(`dispose:${runId}`); },
        shutdown: () => { calls.push("shutdown"); },
    };
    const driver = new ScriptDriver({runtime: setup.runtime});
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {drivers: {script: driver}, catalog});
    try {
        postTo(setup.runtime, setup.view, actor.id, "input", "First input");
        scheduler.start();
        await scheduler.waitForIdle();
        assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "completed");
        assert.deepEqual(stateOf(setup, actor.id), {received: true});
        setup.runtime.stopActor({actorId: setup.view.ownerId, commandId: "stop-script"}, setup.view.id, actor.id, "Stop script");
        await scheduler.waitForIdle();
        await scheduler.haltRun(setup.view.id);
        await scheduler.stopRun(setup.view.id);
        await scheduler.stop();
        assert.deepEqual(calls, ["input", `actor:${setup.view.id}:${actor.id}`, `run:${setup.view.id}`, `dispose:${setup.view.id}`, "shutdown"]);
    } finally { await scheduler.stop(); setup.journal.close(); }
});

test("native program input persists only explicit state changes, independently from return values", async () => {
    const setup = setupRun();
    const actor = scriptActor(setup);
    const program = scriptProgram([
        "export const initial = {count: 0};",
        "export const handle = (input, context) => {",
        "  if (input.content === 'change') context.state.replace({count: context.state.read().count + 1});",
        "  return {count: 999};",
        "};",
    ].join("\n"));
    setup.services.actorPrograms = nativeActorPrograms(setup.runtime, new Map([[actor.id, program]]));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {drivers: {script: new ScriptDriver({runtime: setup.runtime})}, catalog});
    try {
        postTo(setup.runtime, setup.view, actor.id, "change", "change");
        postTo(setup.runtime, setup.view, actor.id, "return-only", "return only");
        scheduler.start();
        await scheduler.waitForIdle();
        assert.deepEqual(stateOf(setup, actor.id), {count: 1});
        assert.equal(setup.runtime.view(setup.view.id).turns.every((turn) => turn.status === "completed"), true);
    } finally { await scheduler.stop(); setup.journal.close(); }
});

test("a program port failure consumes the input and a stopped turn receives an aborted signal", async () => {
    const setup = setupRun();
    const actor = scriptActor(setup);
    const entered = deferred();
    let receivedSignal: AbortSignal | undefined;
    setup.services.actorPrograms = {
        async runInput(request, signal) {
            if (request.input.content === "fail") throw new Error("Program rejected input");
            receivedSignal = signal;
            entered.resolve();
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), {once: true}));
            return {failure: "Stopped", usage: emptyUsage()};
        },
    } satisfies ActorProgramExecutor;
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {drivers: {script: new ScriptDriver({runtime: setup.runtime})}, catalog});
    try {
        postTo(setup.runtime, setup.view, actor.id, "fail", "fail");
        scheduler.start();
        await scheduler.waitForIdle();
        assert.match(setup.runtime.view(setup.view.id).turns[0]?.reason ?? "", /Program rejected input/);
        postTo(setup.runtime, setup.view, actor.id, "wait", "wait");
        await entered.promise;
        setup.runtime.stopActor({actorId: setup.view.ownerId, commandId: "stop"}, setup.view.id, actor.id, "Stopped by owner");
        await scheduler.waitForIdle();
        assert.equal(receivedSignal?.aborted, true);
        assert.equal(setup.runtime.view(setup.view.id).inputs.some((input) => input.lifecycle.kind === "pending"), false);
    } finally { await scheduler.stop(); setup.journal.close(); }
});


test("actor identity and intrinsic state replay from a file journal without program data", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ragents-actor-journal-"));
    const services = testServices();
    let journal = new Journal(directory, services);
    try {
        const runtime = new Orchestration(journal, services);
        let view = runtime.createRun({commandId: "create"}, {title: "Replay", ownerHandle: "owner", ownerDisplayName: "Owner"});
        view = runtime.createScriptActor({actorId: view.ownerId, commandId: "script"}, view.id, {handle: "worker", displayName: "Worker", grants: [], toolNames: []});
        const actor = view.actors.find((entry) => entry.kind === "script")!;
        view = runtime.replaceActorState({actorId: view.ownerId, commandId: "state"}, view.id, actor.id, {entries: ["kept"]});
        journal.close();
        journal = new Journal(directory, services);
        const replayed = new Orchestration(journal, services).view(view.id);
        assert.deepEqual(replayed, view);
        assert.equal("program" in replayed.actors.find((entry) => entry.id === actor.id)!, false);
    } finally { journal.close(); rmSync(directory, {recursive: true, force: true}); }
});

test("a missing actor program executor is a hard prerequisite failure", async () => {
    const setup = setupRun();
    const actor = scriptActor(setup);
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {drivers: {script: new ScriptDriver({runtime: setup.runtime})}, catalog});
    try {
        assert.throws(() => setup.runtime.actorPrograms, /Actor-Program-Executor/);
        postTo(setup.runtime, setup.view, actor.id, "input", "Missing executor");
        scheduler.start();
        await scheduler.waitForIdle();
        assert.match(setup.runtime.view(setup.view.id).turns[0]?.reason ?? "", /Actor-Program-Executor/);
        setup.services.actorPrograms = {async runInput() { return {failure: null, usage: emptyUsage()}; }};
    } finally { await scheduler.stop(); setup.journal.close(); }
});

test("stopping an LLM actor also waits for its program cleanup and retries a failed cleanup", async () => {
    const setup = setupRun();
    const cleanup = deferred();
    const errors: unknown[] = [];
    let programStops = 0;
    let driverStops = 0;
    setup.services.actorPrograms = {
        async runInput() { return {failure: null, usage: emptyUsage()}; },
        async stopActor(_runId, actorId) {
            assert.equal(actorId, setup.agent.id);
            programStops++;
            if (programStops === 1) throw new Error("First program cleanup failed");
            await cleanup.promise;
        },
    };
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        catalog,
        onError: (error) => errors.push(error),
        drivers: {agent: {kind: "agent", async runTurn() {return {failure: null, usage: emptyUsage()};}, async disposeAgent() {driverStops++;}}},
    });
    try {
        scheduler.start();
        setup.runtime.stopActor({actorId: setup.view.ownerId, commandId: "stop"}, setup.view.id, setup.agent.id, "Stop actor and functions");
        let settled = false;
        const waiting = scheduler.waitForIdle().then(() => {settled = true;});
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(settled, false);
        assert.equal(driverStops, 1);
        assert.equal(programStops, 2);
        cleanup.resolve();
        await waiting;
        assert.equal(errors.length, 1);
        assert.match(String(errors[0]), /First program cleanup failed/);
    } finally {cleanup.resolve(); await scheduler.stop(); setup.journal.close();}
});

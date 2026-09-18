import assert from "node:assert/strict";
import test from "node:test";
import { manualExecution } from "../src/domain/driver.ts";
import { applyJsonChanges, assertJsonChanges, jsonChanges } from "../src/domain/json-patch.ts";
import type { JsonChange } from "../src/domain/json.ts";
import { pluginStateAt } from "../src/domain/plugin-state.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { testServices } from "./support.ts";

test("JSON changes preserve prior values and support array growth, shrinking, nested fields and literal special keys", () => {
    const before = JSON.parse('{"items":[{"value":1,"old":true},2,3],"__proto__":{"safe":true},"constructor":"old"}');
    const after = JSON.parse('{"items":[{"value":2},4],"__proto__":{"safe":false},"constructor":"new"}');
    const original = structuredClone(before);
    const changes = jsonChanges(before, after);
    assertJsonChanges(changes);
    assert.deepEqual(applyJsonChanges(before, changes), after);
    assert.deepEqual(before, original);
    assert.deepEqual(applyJsonChanges(after, jsonChanges(after, before)), before);
    assert.equal(Object.getPrototypeOf(applyJsonChanges(before, changes)), Object.prototype);
    assert.equal(({} as { safe?: boolean }).safe, undefined);
});

test("JSON changes reject malformed operations, missing parents, invalid indices and missing removals", () => {
    for (const changes of [
        [{ op: "remove", path: [] }], [{ op: "set", path: [-1], value: 2 }],
        [{ op: "set", path: [0.5], value: 2 }], [{ op: "set", path: [], value: undefined }],
        [{ op: "remove", path: ["a"], value: 2 }], [{ op: "set", path: [], value: 2, extra: 3 }],
    ]) assert.throws(() => assertJsonChanges(changes));
    for (const change of [
        { op: "set", path: ["missing", "field"], value: 1 },
        { op: "set", path: ["items", 2], value: 1 },
        { op: "set", path: ["items", "0"], value: 1 },
        { op: "remove", path: ["missing"] },
    ] satisfies JsonChange[]) assert.throws(() => applyJsonChanges({ items: [1] }, [change]), /invalid/);
});

test("plugin and actor states journal small changes, reconstruct historical state, and replay identically", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const created = runtime.createRun({ commandId: "create" }, { title: "States", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const context = (commandId: string) => ({ commandId, actorId: created.ownerId });
    const common = { pluginId: "test.calls", scope: { kind: "run" as const } };
    const initial = { calls: Array.from({ length: 20 }, (_, index) => ({ id: index, status: "done", output: "result".repeat(200) })), requestIds: ["a"] };
    runtime.replacePluginState(context("initial"), created.id, { ...common, state: initial });
    const next = structuredClone(initial);
    next.calls[19]!.status = "failed";
    next.requestIds.push("b");
    runtime.replacePluginState(context("next"), created.id, { ...common, state: next });
    const patch = runtime.events(created.id).at(-1)!;
    assert.equal(patch.type, "plugin.state-patched");
    if (patch.type !== "plugin.state-patched") throw new Error("Expected patch.");
    assert.deepEqual(patch.payload.changes, [
        { op: "set", path: ["calls", 19, "status"], value: "failed" },
        { op: "set", path: ["requestIds", 1], value: "b" },
    ]);
    assert.ok(JSON.stringify(patch.payload).length < JSON.stringify(next).length / 20);
    runtime.replacePluginState(context("noop"), created.id, { ...common, state: next });
    assert.deepEqual(runtime.events(created.id).at(-1)!.payload, { ...common, changes: [] });
    runtime.replacePluginState(context("small"), created.id, { ...common, state: null });
    assert.equal(runtime.events(created.id).at(-1)!.type, "plugin.state-replaced");
    assert.deepEqual(pluginStateAt(runtime.events(created.id), patch), next);
    runtime.replacePluginState(context("unicode-initial"), created.id, { ...common, state: { retained: "ä".repeat(15), count: 0 } });
    runtime.replacePluginState(context("unicode-next"), created.id, { ...common, state: { retained: "ä".repeat(15), count: 1 } });
    assert.equal(runtime.events(created.id).at(-1)!.type, "plugin.state-patched");
    const view = runtime.spawnAgent(context("spawn"), created.id, {
        handle: "worker", displayName: "Worker", prompt: "", execution: manualExecution(), grants: [], toolNames: [],
    });
    const worker = view.actors.find((actor) => actor.kind === "agent")!;
    runtime.replaceActorState(context("actor-initial"), created.id, worker.id, initial);
    const pending = runtime.enqueueInput(context("input"), created.id, { actorId: worker.id, content: "Update" });
    const started = runtime.startTurn({ actorId: worker.id, commandId: "start" }, created.id, worker.id, pending.inputs[0]!.id);
    runtime.replaceActorState({ actorId: worker.id, commandId: "actor-next", turnId: started.turns[0]!.id }, created.id, worker.id, next);
    assert.equal(runtime.events(created.id).at(-1)!.type, "plugin.state-patched");
    const restored = new Journal(":memory:", testServices());
    restored.adopt(journal.records(created.id));
    assert.deepEqual(restored.stateOf(created.id), journal.stateOf(created.id));
    journal.close();
    restored.close();
});

test("invalid state patches and unauthorized writers cannot advance the journal", () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const created = runtime.createRun({ commandId: "create" }, { title: "States", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const payload = { pluginId: "test.calls", scope: { kind: "run" as const }, changes: [{ op: "set" as const, path: ["missing", "key"], value: 1 }] };
    const append = (commandId: string) => journal.append(created.id,
        { id: commandId, type: "test.patch", actorId: created.ownerId, requestHash: commandId },
        [{ type: "plugin.state-patched", payload, actorId: created.ownerId, correlationId: null, causationId: null }]);
    assert.throws(() => append("absent"), /must exist/);
    runtime.replacePluginState({ commandId: "initial", actorId: created.ownerId }, created.id, { pluginId: payload.pluginId, scope: payload.scope, state: {} });
    const revision = runtime.view(created.id).revision;
    assert.throws(() => append("missing-parent"), /invalid object path/);
    assert.equal(runtime.view(created.id).revision, revision);
    const view = runtime.spawnAgent({ commandId: "spawn", actorId: created.ownerId }, created.id, {
        handle: "worker", displayName: "Worker", prompt: "", execution: manualExecution(), grants: [], toolNames: [],
    });
    const worker = view.actors.find((actor) => actor.kind === "agent")!;
    const pending = runtime.enqueueInput({ commandId: "input", actorId: created.ownerId }, created.id, { actorId: worker.id, content: "Update" });
    runtime.startTurn({ actorId: worker.id, commandId: "start" }, created.id, worker.id, pending.inputs[0]!.id);
    assert.throws(() => journal.append(created.id,
        { id: "denied", type: "test.patch", actorId: worker.id, requestHash: "denied" },
        [{ type: "plugin.state-patched", payload: { ...payload, changes: [] }, actorId: worker.id, correlationId: null, causationId: null }]), /lacks plugin.state.write/);
    journal.close();
});

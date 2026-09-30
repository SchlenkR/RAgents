import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Journal, Orchestration, type CommandRecord } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { assertCurrentLayoutContract } from "../src/plugin-support/removed-layout.ts";

const error = /removed host layout API.*Start a new run with updated programs; the original files are kept/;
const record = (type: string, payload: unknown) => ({ events: [{ type, payload }] }) as CommandRecord;
const programRecord = (program: unknown) => record("plugin.state-replaced", {
  pluginId: "ragents.actor-programs", scope: { kind: "actor", actorId: "actor" }, state: { version: 1, program },
});

for (const name of ["canvas_layout_replace", "canvas_layout_place"]) {
  test(`rejects persisted ${name} calls, tool selections, capabilities and snippet sources`, () => {
    for (const candidate of [
      record("tool.call.started", { name }),
      record("tool.call.completed", { name }),
      record("agent.created", { toolNames: [name] }),
      record("tool.call.source", { code: `await context.functions.${name}({});` }),
      record("tool.call.started", { name: "typescript_eval", input: { code: `await context.functions["${name}"]({});` } }),
      programRecord({ input: { capabilityIds: [name] }, views: [] }),
      programRecord({ functions: [{ capabilityIds: [name] }], views: [] }),
      record("plugin.state-patched", { pluginId: "ragents.actor-programs", changes: [{ op: "set", path: ["program", "input", "capabilityIds", 0], value: name }] }),
    ]) assert.throws(() => assertCurrentLayoutContract(candidate), error);
  });
}

test("rejects empty placements, hidden views and placement patches without rejecting ordinary app state or prose", () => {
  const view = { id: "board", visible: false, placements: [] };
  assert.throws(() => assertCurrentLayoutContract(programRecord({ views: [view] })), error);
  for (const [keys, value] of [
    [["program", "views", 0, "placements"], []],
    [["program", "views", 0], view],
    [["program", "views"], [view]],
    [["program"], { views: [view] }],
    [[], { version: 1, program: { views: [view] } }],
  ] as const) {
    assert.throws(() => assertCurrentLayoutContract(record("plugin.state-patched", {
      pluginId: "ragents.actor-programs", changes: [{ op: "set", path: keys, value }],
    })), error);
  }
  for (const type of ["plugin.state-replaced", "plugin.state-patched"]) {
    assert.throws(() => assertCurrentLayoutContract(record(type, { pluginId: "ragents.orchestration" })), error);
  }
  assert.doesNotThrow(() => assertCurrentLayoutContract(record("plugin.state-patched", {
    pluginId: "ragents.actor-programs", changes: [{ op: "set", path: ["program", "stateSchema", "properties", "placements"], value: { type: "array" } }],
  })));
  assert.doesNotThrow(() => assertCurrentLayoutContract(programRecord({ input: { capabilityIds: ["actor_input"] }, views: [{ id: "board" }] })));
  assert.doesNotThrow(() => assertCurrentLayoutContract(record("plugin.state-replaced", { pluginId: "ragents.actor-state", state: { placements: [], text: "canvas_layout_place" } })));
  assert.doesNotThrow(() => assertCurrentLayoutContract(record("actor.input.enqueued", { content: "Why was canvas_layout_place removed?" })));
  assert.doesNotThrow(() => assertCurrentLayoutContract(record("tool.call.source", { code: 'console.log("canvas_layout_place"); // canvas_layout_replace' })));
});

const filesIn = (directory: string): Record<string, string> => Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap((entry): [string, string][] => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? Object.entries(filesIn(file)).map(([name, value]) => [`${entry.name}/${name}`, value]) : [[entry.name, readFileSync(file).toString("base64")]];
}));

for (const legacy of ["layout", "placements", "program"]) {
  test(`loading an old ${legacy} locks only its run and preserves its journal, payloads and sources`, (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "ragents-removed-layout-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const services = testServices();
    const original = new Journal(directory, services);
    const runtime = new Orchestration(original, services);
    const old = runtime.createRun({ commandId: "old" }, { title: "Old", ownerHandle: "alice", ownerDisplayName: "Alice" });
    const healthy = runtime.createRun({ commandId: "healthy" }, { title: "Healthy", ownerHandle: "alice", ownerDisplayName: "Alice" });
    runtime.replacePluginState({ actorId: old.ownerId, commandId: "old-state" }, old.id, {
      pluginId: legacy === "layout" ? "ragents.orchestration" : "ragents.actor-programs",
      scope: { kind: "run" },
      state: legacy === "layout" ? { root: null } : { version: 1, program: legacy === "placements"
        ? { views: [{ id: "board", visible: false, placements: [], html: "x".repeat(10_000) }] }
        : { input: { capabilityIds: ["canvas_layout_place"] }, views: [] } },
    });
    original.close();
    const oldDirectory = path.join(directory, old.id);
    writeFileSync(path.join(oldDirectory, "server.ts"), "original program sources");
    const before = filesIn(oldDirectory);
    const loaded = new Journal(directory, services, { validateRecord: assertCurrentLayoutContract, onLoadError: () => {} });
    t.after(() => loaded.close());
    assert.equal(loaded.stateOf(old.id), null);
    assert.deepEqual(loaded.unavailableRuns().map(({ runId }) => runId), [old.id]);
    assert.match(loaded.unavailableRuns()[0]!.message, error);
    assert.throws(() => loaded.assertRunAvailable(old.id), error);
    assert.ok(loaded.stateOf(healthy.id));
    const reopened = new Orchestration(loaded, services);
    reopened.replacePluginState({ actorId: healthy.ownerId, commandId: "healthy-state" }, healthy.id, { pluginId: "demo", scope: { kind: "run" }, state: { usable: true } });
    const created = reopened.createRun({ commandId: "new" }, { title: "New", ownerHandle: "alice", ownerDisplayName: "Alice" });
    assert.ok(loaded.stateOf(created.id));
    assert.deepEqual(filesIn(oldDirectory), before);
  });
}

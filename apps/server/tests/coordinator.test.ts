import assert from "node:assert/strict";
import test from "node:test";
import { Journal, Orchestration, StaticModelCatalog, type CatalogModel } from "@ragents/engine";
import { allGrants, executionFor, testServices } from "../../../packages/ragents/tests/support.ts";
import { coordinatorSelection, isRunCoordinator } from "../src/ragents/coordinator.ts";

const fixture = () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  let view = runtime.createRun({ commandId: "create" }, { title: "Builder roles", ownerHandle: "owner", ownerDisplayName: "Owner" });
  const spawn = (handle: string, commandId: string) => {
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId }, view.id, {
      handle, displayName: handle, prompt: `Own ${handle} prompt.`,
      execution: executionFor(handle, { profile: "agent" }), grants: allGrants(), toolNames: null,
    });
    return view.actors.find((actor) => actor.handle === handle)!;
  };
  const builder = spawn("run-builder", `coordinator:${view.id}:${view.revision}`);
  const specialist = spawn("coordinator", "spawn-specialist");
  view = runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "primary-specialist" }, view.id, specialist.id);
  return { services, journal, runtime, view, builder, specialist };
};

test("the host coordinator marker survives primary handover, forks and journal replay without handle inference", () => {
  const setup = fixture();
  const replay = new Journal(":memory:", setup.services);
  try {
    assert.equal(isRunCoordinator(setup.runtime, setup.view.id, setup.builder.id), true);
    assert.equal(isRunCoordinator(setup.runtime, setup.view.id, setup.specialist.id), false);
    const fork = setup.runtime.forkRun({ commandId: "fork" }, setup.view.id, setup.view.revision);
    const nested = setup.runtime.forkRun({ commandId: "nested-fork" }, fork.id, fork.revision);
    for (const view of [setup.view, fork, nested]) {
      assert.equal(view.primaryActorId, setup.specialist.id);
      assert.equal(isRunCoordinator(setup.runtime, view.id, setup.builder.id), true);
      assert.equal(isRunCoordinator(setup.runtime, view.id, setup.specialist.id), false);
    }
    replay.adopt(setup.journal.records(nested.id));
    const restored = new Orchestration(replay, setup.services);
    assert.equal(isRunCoordinator(restored, nested.id, setup.builder.id), true);
    assert.equal(isRunCoordinator(restored, nested.id, setup.specialist.id), false);
  } finally {
    replay.close();
    setup.journal.close();
  }
});

test("a stored coordinator selection keeps its provider when the profile no longer configures it", () => {
  const modelList: CatalogModel[] = [{ driver: "agent", provider: "current", model: "shared-model", label: "shared-model", thinking: ["off"] }];
  const catalog = Object.assign(new StaticModelCatalog(modelList, [{ name: "coordinator", description: "Coordinator", driver: "agent",
    provider: "current", model: "shared-model", thinking: "off", turnTimeoutMs: null, isolateWorkspace: false }]), { modelList });
  const coordinator = { handle: "coordinator", profile: "coordinator" };
  const spawned = { provider: "removed", model: "shared-model", thinking: "off" as const };
  assert.deepEqual(coordinatorSelection(catalog, coordinator, { model: "shared-model", thinking: "off" }, spawned), spawned);
  assert.deepEqual(coordinatorSelection(catalog, coordinator, { model: "removed-model", thinking: "off" }, spawned), { ...spawned, model: "removed-model" });
});

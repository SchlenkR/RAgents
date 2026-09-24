import assert from "node:assert/strict";
import test from "node:test";
import { manualExecution, setupRun } from "../../../packages/ragents/tests/support.ts";
import { watchableActorOf } from "../../../plugins/ragents.watch/server/observation.ts";

test("a watch finds its actors by ID or handle like the engine, never the human", (t) => {
  const setup = setupRun();
  t.after(() => setup.journal.close());
  const runId = setup.view.id;
  const owner = setup.view.ownerId;
  const view = setup.runtime.spawnAgent({ actorId: owner, commandId: "spawn-reviewer" }, runId, {
    handle: "prüfer", displayName: "Prüfer", prompt: "", execution: manualExecution(), grants: [], toolNames: [],
  });
  const reviewer = view.actors.find((entry) => entry.handle === "prüfer")!;
  assert.equal(watchableActorOf(view, "@Prüfer")?.id, reviewer.id);
  assert.equal(watchableActorOf(view, "WORKER")?.id, setup.agent.id);
  assert.equal(watchableActorOf(view, setup.agent.id)?.id, setup.agent.id);
  assert.equal(watchableActorOf(view, "@owner"), undefined);
});

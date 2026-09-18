import assert from "node:assert/strict";
import test from "node:test";
import { claimTurn } from "../../../packages/ragents/src/agents/turn.ts";
import { allGrants, executionFor, postTo } from "../../../packages/ragents/tests/support.ts";
import { actorProgramFixture, counterFiles, setupPackageFiles } from "./actor-programs-fixture.ts";
import { writeAppFiles } from "./actor-runtime-fixture.ts";

test("a builder can install a participant view or a persistent input program through the same functions", async (t) => {
  const f = await actorProgramFixture(t);
  const view = f.setup.runtime.spawnAgent({ actorId: f.setup.view.ownerId, commandId: `coordinator:${f.runId}:1` }, f.runId, {
    handle: "builder", displayName: "Builder", prompt: "Build", execution: executionFor("builder", { profile: "agent", isolateWorkspace: false }), grants: allGrants(), toolNames: null,
  });
  const builder = view.actors.find((actor) => actor.handle === "builder")!;
  const input = postTo(f.setup.runtime, view, builder.id, "build-input", "Build").inputs.at(-1)!;
  const turn = claimTurn(f.setup.runtime, f.runId, builder.id, input.id, "build-turn");
  const context = { actorId: builder.id, commandId: "bootstrap", turnId: turn.turnId };
  await writeAppFiles(f.directory, "counter", counterFiles({ views: true }));
  const before = f.setup.runtime.view(f.runId).actors.length;
  assert.equal((await f.runtime.activate(context, f.runId, "counter", undefined, "@worker")).active, true);
  assert.equal(f.setup.runtime.view(f.runId).actors.length, before);
  assert.equal(f.runtime.programs(f.runId)[0]?.actorHandle, "worker");
  await writeAppFiles(f.directory, "setup", Object.fromEntries(setupPackageFiles().map((file) => [file.path, file.content])));
  const result = await f.runtime.activate(context, f.runId, "setup");
  assert.equal(result.active, true);
  const setup = f.runtime.programs(f.runId).find((program) => program.name === "setup")!;
  assert.ok(setup.input);
  assert.equal(f.setup.runtime.view(f.runId).actors.find((actor) => actor.id === setup.actorId)?.kind, "script");
});

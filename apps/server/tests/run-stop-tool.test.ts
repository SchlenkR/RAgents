import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { RunStopper, type ToolScope } from "@aicontainer/ragents";
import { allGrants, deferred, setupRun } from "../../../packages/ragents/tests/support.ts";
import { createRunStopContributor } from "../../../plugins/ragents.orchestration/server/run-stop-tool.ts";

const fixture = async (stop: (runId: string) => Promise<void>, onError: (error: unknown) => void = assert.fail) => {
  const setup = setupRun({ grants: allGrants() });
  const view = setup.runtime.selectPrimaryActor({ actorId: setup.view.ownerId, commandId: "select-primary" }, setup.view.id, setup.agent.id);
  const contributor = createRunStopContributor(stop, onError);
  const tools = await contributor.tools({
    runId: view.id,
    actorId: setup.agent.id,
    turnId: null,
    actor: setup.agent,
    view,
    workspace: "/private/tmp",
  });
  assert.equal(tools.length, 1);
  const tool = tools[0]!;
  const scope = { caller: { runId: view.id, actorId: setup.agent.id, turnId: null } } as ToolScope;
  return { ...setup, view, contributor, tool, scope };
};

test("run_stop addresses the caller's run and accepts no supplied run identifier", async (context) => {
  const calls: string[] = [];
  const f = await fixture(async (runId) => { calls.push(runId); });
  context.after(() => f.journal.close());
  assert.equal(f.tool.name, "run_stop");
  assert.equal(Value.Check(f.tool.schema, {}), true);
  assert.equal(Value.Check(f.tool.schema, { runId: "foreign-run" }), false);
  assert.equal(Value.Check(f.tool.schema, { id: "foreign-run" }), false);
  const result = await f.tool.run(f.scope, "stop-call", {} as never);
  assert.deepEqual(result, { requested: true });
  assert.equal(Value.Check(f.tool.resultSchema, result), true);
  assert.deepEqual(calls, [f.view.id]);
});

test("run_stop is available only to the primary actor holding the stop capability", async (context) => {
  const f = await fixture(async () => {});
  context.after(() => f.journal.close());
  assert.equal(f.tool.available(f.agent, f.view), true);
  assert.equal(f.tool.available(f.agent, { ...f.view, primaryActorId: null }), false);
  assert.equal(f.tool.available(f.agent, { ...f.view, primaryActorId: "another-actor" }), false);
  assert.equal(f.tool.available({ ...f.agent, grants: [] }, f.view), false);
  const owner = f.view.actors.find((actor) => actor.id === f.view.ownerId)!;
  assert.equal(f.tool.available(owner, { ...f.view, primaryActorId: owner.id }), false);
  assert.deepEqual(f.contributor.descriptors[0]?.requiredCapabilities, ["execution.stopOwned"]);
});

test("run_stop returns before shared stop cleanup waiting for the calling tool", { timeout: 2000 }, async (context) => {
  const toolReturned = deferred();
  const cleanupCompleted = deferred();
  const errors: unknown[] = [];
  const f = await fixture(async (runId) => {
    await stopper.stop(runId, { commandId: "stop-from-tool", reason: "Requested stop" });
    cleanupCompleted.resolve();
  }, (error) => { errors.push(error); });
  context.after(() => f.journal.close());
  context.after(() => toolReturned.resolve());
  const view = f.runtime.createScriptActor({ actorId: f.view.ownerId, commandId: "create-worker" }, f.view.id, {
    handle: "worker-script", displayName: "Worker", grants: [], toolNames: [],
  });
  const worker = view.actors.find((actor) => actor.kind === "script")!;
  const stopper = new RunStopper({
    runtime: f.runtime,
    stopExternal: async (runId, stopJournal) => {
      assert.equal(runId, f.view.id);
      await stopJournal(toolReturned.promise);
    },
  });
  try {
    const result = await f.tool.run(f.scope, "stop-call", {} as never);
    assert.deepEqual(result, { requested: true });
    assert.equal(f.runtime.view(f.view.id).actors.find((actor) => actor.id === worker.id)?.lifecycle?.kind, "stopped");
    toolReturned.resolve();
    await cleanupCompleted.promise;
    assert.deepEqual(errors, []);
  } finally {
    toolReturned.resolve();
  }
});

test("run_stop reports asynchronous cleanup failures through onError", async (context) => {
  const failure = new Error("Cleanup failed");
  const errors: unknown[] = [];
  const reported = deferred();
  const f = await fixture(async () => { throw failure; }, (error) => { errors.push(error); reported.resolve(); });
  context.after(() => f.journal.close());
  assert.deepEqual(await f.tool.run(f.scope, "stop-call", {} as never), { requested: true });
  await reported.promise;
  assert.deepEqual(errors, [failure]);
});

test("run_stop does not begin cleanup for an already aborted invocation", async (context) => {
  const calls: string[] = [];
  const errors: unknown[] = [];
  const f = await fixture(async (runId) => { calls.push(runId); }, (error) => { errors.push(error); });
  context.after(() => f.journal.close());
  const reason = new Error("Tool invocation aborted");
  const scope = { ...f.scope, signal: AbortSignal.abort(reason) };
  await assert.rejects(async () => f.tool.run(scope, "stop-call", {} as never), (error) => error === reason);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, []);
});

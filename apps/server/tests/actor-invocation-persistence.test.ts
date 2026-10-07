import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Journal, Orchestration } from "@ragents/engine";
import { allGrants, executionFor, testServices } from "../../../packages/ragents/tests/support.ts";
import { ACTOR_INVOCATIONS_STATE_ID } from "../src/plugin-support/actor-programs/contract.ts";
import { runtimeFor, writeAppFiles } from "./actor-runtime-fixture.ts";
import { actorProgramFixture, counterFiles } from "./actor-programs-fixture.ts";

const diskFixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-invocation-persistence-"));
  const services = testServices();
  const journal = new Journal(path.join(directory, "journal"), services);
  const orchestration = new Orchestration(journal, services);
  const created = orchestration.createRun({commandId: "create"}, {title: "Counter", ownerHandle: "owner", ownerDisplayName: "Owner"});
  const view = orchestration.spawnAgent({actorId: created.ownerId, commandId: "spawn"}, created.id, {
    handle: "worker", displayName: "Worker", prompt: "Count", execution: executionFor("worker", {profile: "agent"}), grants: allGrants(), toolNames: null,
  });
  const setup = {services, journal, runtime: orchestration, view, agent: view.actors.find((actor) => actor.kind === "agent")!};
  const runtime = runtimeFor(setup, directory);
  const other = orchestration.createRun({commandId: "other"}, {title: "Other", ownerHandle: "owner", ownerDisplayName: "Owner"});
  t.after(async () => {
    await runtime.shutdown();
    await services.nativeTypeScriptExecutor!.shutdown();
    journal.close();
    await rm(directory, {recursive: true, force: true});
  });
  const files = counterFiles();
  files["src/server.ts"] = files["src/server.ts"].replace("    calls++;", '    calls++;\n    if (input.amount < 0) throw new Error("Counter execution failed");');
  await writeAppFiles(directory, "counter", files);
  await runtime.activate({actorId: view.ownerId, commandId: "activate"}, view.id, "counter");
  return {directory, setup, runtime, other, program: runtime.programs(view.id)[0]!};
};

for (const status of ["queued", "running", "succeeded", "failed", "cancelled"] as const) {
  test(`a ${status} invocation journal failure stays in its run and preserves the journal`, {timeout: 40_000}, async (t) => {
    const f = await diskFixture(t);
    const runId = f.setup.view.id;
    const journalPath = path.join(f.directory, "journal", runId, "journal.jsonl");
    const originalOpen = fs.openSync;
    const originalReplace = f.setup.runtime.replacePluginState.bind(f.setup.runtime);
    let failAppend = false;
    let beforeFailure: string | undefined;
    let entered = false;
    const errors: Error[] = [];
    const executor = f.setup.services.nativeTypeScriptExecutor!;
    const originalExecute = executor.execute.bind(executor);
    try {
      t.mock.method(console, "error", (_label: string, error: Error) => { errors.push(error); });
      t.mock.method(executor, "execute", (...args: Parameters<typeof executor.execute>) => { entered = true; return originalExecute(...args); });
      t.mock.method(f.setup.runtime, "replacePluginState", (...args: Parameters<typeof originalReplace>) => {
        const state = args[2].state as {invocations?: {status: string}[]};
        if (args[2].pluginId === ACTOR_INVOCATIONS_STATE_ID && state.invocations?.at(-1)?.status === status) {
          beforeFailure = fs.readFileSync(journalPath, "utf8");
          failAppend = true;
        }
        return originalReplace(...args);
      });
      t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
        if (failAppend && args[0] === journalPath && args[1] === "a") throw new Error("Injected journal append failure");
        return originalOpen(...args);
      });
      syncBuiltinESMExports();
      const start = () => f.runtime.startFunctionInvocation(runId, f.program.actorHandle, f.program.revision, "add", "request", {
        amount: status === "failed" ? -1 : 1, ...(status === "cancelled" ? {delay: 60_000} : {}),
      });
      if (status === "queued") {
        assert.throws(start, /Could not persist queued actor function invocation.*actor.*run/);
      } else {
        assert.equal(start().status, "queued");
        if (status === "cancelled") {
          const deadline = Date.now() + 10_000;
          while (!entered) {
            if (Date.now() > deadline) throw new Error("The counter did not enter execution");
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          await f.runtime.stopRun(runId);
        }
        await f.runtime.waitForRunSettlement(runId);
        assert.equal(errors.length, 1);
        assert.match(errors[0]!.message, new RegExp(`Could not persist ${status} actor function invocation.*${f.program.actorId}.*${runId}`));
        assert.match(String(errors[0]!.cause), /Journal write failed/);
      }
      assert.ok(beforeFailure);
      assert.equal(await readFile(journalPath, "utf8"), beforeFailure);
      assert.throws(() => f.setup.runtime.view(runId), /Journal write failed/);
      assert.deepEqual(f.setup.journal.unavailableRuns().map((run) => run.runId), [runId]);
      f.setup.runtime.replacePluginState({actorId: f.other.ownerId, commandId: "other-write"}, f.other.id, {
        pluginId: "fixture", scope: {kind: "run"}, state: {available: true},
      });
      assert.equal(f.setup.runtime.view(f.other.id).pluginStates[0]?.pluginId, "fixture");
      assert.equal(errors.length, status === "queued" ? 0 : 1);
      if (status === "queued" || status === "running") assert.equal(entered, false);
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

test("failed background persistence releases every active invocation slot", {timeout: 40_000}, async (t) => {
  const f = await actorProgramFixture(t);
  await writeAppFiles(f.directory, "counter", counterFiles());
  await f.runtime.activate(f.context, f.runId, "counter");
  const program = f.runtime.programs(f.runId)[0]!;
  const originalReplace = f.setup.runtime.replacePluginState.bind(f.setup.runtime);
  const errors: Error[] = [];
  const replacement = t.mock.method(f.setup.runtime, "replacePluginState", (...args: Parameters<typeof originalReplace>) => {
    const state = args[2].state as {invocations?: {status: string}[]};
    if (args[2].pluginId === ACTOR_INVOCATIONS_STATE_ID && state.invocations?.at(-1)?.status === "running") throw new Error("Injected transition failure");
    return originalReplace(...args);
  });
  t.mock.method(console, "error", (_label: string, error: Error) => { errors.push(error); });
  for (let index = 0; index < 10; index++) {
    f.runtime.startFunctionInvocation(f.runId, program.actorHandle, program.revision, "add", `request-${index}`, {amount: 1});
    await f.runtime.waitForRunSettlement(f.runId);
  }
  assert.equal(errors.length, 10);
  replacement.mock.restore();
  await f.runtime.remove({...f.context, commandId: "remove"}, f.runId, "counter");
  assert.deepEqual(f.runtime.programs(f.runId), []);
});

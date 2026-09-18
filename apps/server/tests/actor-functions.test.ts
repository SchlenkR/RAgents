import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ToolRegistry, TurnToolset, type ToolScope } from "@aicontainer/ragents";
import { catalog, executionFor } from "../../../packages/ragents/tests/support.ts";
import { createActorProgramToolContributors } from "../../../plugins/ragents.actor-programs/server/tool-contributor.ts";
import { actorProgramFixture, counterFiles, invokeActorFunction } from "./actor-programs-fixture.ts";
import { writeAppFiles } from "./actor-runtime-fixture.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";

const toolsFor = async (f: Awaited<ReturnType<typeof actorProgramFixture>>, actorId: string, label: string) => {
  const registry = new ToolRegistry();
  for (const contributor of createActorProgramToolContributors(f.runtime, {latest: () => ""})) registry.register(contributor);
  const turn = enqueueAndClaim(f.setup.runtime, f.setup.runtime.view(f.runId), actorId, `${label}:input`, "Use function", `${label}:turn`);
  return await TurnToolset.create({runtime: f.setup.runtime, turn, catalog, registry});
};

test("parallel actor tools share one actor state without plugin-state grants on their callers", async (t) => {
  const f = await actorProgramFixture(t);
  await writeAppFiles(f.directory, "counter", counterFiles());
  await f.runtime.activate(f.context, f.runId, "counter");
  const callers: string[] = [];
  for (const handle of ["left", "right"]) {
    const view = f.setup.runtime.spawnAgent({...f.context, commandId: handle}, f.runId, {
      handle, displayName: handle, prompt: "Use the counter", execution: executionFor(handle, {profile: "agent", isolateWorkspace: false}), grants: [], toolNames: null,
    });
    callers.push(view.actors.find((actor) => actor.handle === handle)!.id);
  }
  const left = await toolsFor(f, callers[0]!, "left");
  const right = await toolsFor(f, callers[1]!, "right");
  const results = await Promise.all([
    left.invokeFunction("left:add", "counter_add", {amount: 1, delay: 60}),
    right.invokeFunction("right:add", "counter_add", {amount: 1}),
  ]) as Array<{count: number; pid: number}>;
  assert.deepEqual(results.map((result) => result.count), [1, 2]);
  assert.equal(results[0]?.pid, results[1]?.pid);
  const program = f.runtime.programs(f.runId)[0]!;
  assert.deepEqual(f.runtime.data(f.runId, program.actorId).values, {count: 2});
});

test("busy programs reject replacement while turn tools refresh and raw stale handlers remain invalid", async (t) => {
  const f = await actorProgramFixture(t);
  const marker = path.join(f.directory, "entered");
  const release = path.join(f.directory, "release");
  const files = counterFiles();
  files["src/server.ts"] = 'import {access, writeFile} from "node:fs/promises";\n' + files["src/server.ts"].replace(
    "    calls++;", `    calls++;
    if (input.amount === 99) {
      await writeFile(${JSON.stringify(marker)}, "entered");
      while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await new Promise((resolve) => setTimeout(resolve, 10));
    }`,
  );
  await writeAppFiles(f.directory, "counter", files);
  await f.runtime.activate(f.context, f.runId, "counter");
  const oldTools = await toolsFor(f, f.setup.agent.id, "old");
  const staleHandler = oldTools.functions.find((tool) => tool.name === "counter_add")!;
  const rawScope: ToolScope = {
    runtime: f.setup.runtime,
    caller: {runId: f.runId, actorId: f.setup.agent.id, turnId: null},
    catalog, signal: undefined,
    context: (commandId) => ({actorId: f.setup.agent.id, commandId}),
    eventsFor: () => [],
    availableFunctions: () => oldTools.functions,
    invokeFunction: (id, name, input) => oldTools.invokeFunction(id, name, input),
    functionGuidance: async () => "",
    resolveToolsFor: async () => oldTools.functions,
  };
  const running = invokeActorFunction(f, "counter", {amount: 99}, "blocked");
  try {
    const deadline = Date.now() + 10_000;
    while (!await access(marker).then(() => true, () => false)) {
      if (Date.now() > deadline) throw new Error("Function did not enter its native process");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await assert.rejects(f.runtime.remove({...f.context, commandId: "remove-busy"}, f.runId, "counter"), /laufende Funktionen/);
    await assert.rejects(f.runtime.activate({...f.context, commandId: "replace-busy"}, f.runId, "counter"), /laufende Funktionen/);
  } finally {await writeFile(release, "released");}
  const completed = await running;
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  await writeAppFiles(f.directory, "counter", counterFiles());
  await f.runtime.activate({...f.context, commandId: "replace"}, f.runId, "counter");
  await assert.rejects(async () => staleHandler.run(rawScope, "stale", {amount: 1} as never), /ersetzt/);
  const refreshed = await oldTools.invokeFunction("refreshed", "counter_add", {amount: 1}) as {count: number; calls: number; pid: number};
  assert.equal(refreshed.count, 100);
  assert.equal(refreshed.calls, 1);
  if (completed.status === "succeeded") assert.notEqual(refreshed.pid, (completed.result as {pid: number}).pid);
  const after = await invokeActorFunction(f, "counter", {amount: 1}, "current");
  assert.equal(after.status, "succeeded", JSON.stringify(after));
  if (after.status === "succeeded") assert.equal((after.result as {count: number}).count, 101);
  await f.runtime.remove({...f.context, commandId: "remove"}, f.runId, "counter");
  await assert.rejects(oldTools.invokeFunction("removed", "counter_add", {amount: 1}), /not available/);
  assert.equal(oldTools.functions.some((tool) => tool.name === "counter_add"), false);
});

test("stopping a run rejects queued actor tools before they can restart a backend or change state", async (t) => {
  const f = await actorProgramFixture(t);
  const marker = path.join(f.directory, "entered");
  const files = counterFiles();
  files["src/server.ts"] = 'import {writeFile} from "node:fs/promises";\n' + files["src/server.ts"].replace(
    "    calls++;", `    calls++;
    if (input.amount === 99) {
      await writeFile(${JSON.stringify(marker)}, String(process.pid));
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }`,
  );
  await writeAppFiles(f.directory, "counter", files);
  await f.runtime.activate(f.context, f.runId, "counter", undefined, "@worker");
  const warm = await invokeActorFunction(f, "counter", {amount: 0}, "warm");
  assert.equal(warm.status, "succeeded", JSON.stringify(warm));
  if (warm.status !== "succeeded") throw new Error("Counter warmup failed");
  const pid = (warm.result as {pid: number}).pid;
  assert.ok(Number.isInteger(pid) && pid > 0);
  const callers: string[] = [];
  for (const handle of ["first", "second"]) {
    const view = f.setup.runtime.spawnAgent({...f.context, commandId: handle}, f.runId, {
      handle, displayName: handle, prompt: "Use the counter", execution: executionFor(handle, {profile: "agent", isolateWorkspace: false}), grants: [], toolNames: null,
    });
    callers.push(view.actors.find((actor) => actor.handle === handle)!.id);
  }
  const first = await toolsFor(f, callers[0]!, "first");
  const second = await toolsFor(f, callers[1]!, "second");
  const interrupted = assert.rejects(first.invokeFunction("first:add", "counter_add", {amount: 99}), /beendet|abgebrochen|gestoppt/);
  const deadline = Date.now() + 10_000;
  while (!await access(marker).then(() => true, () => false)) {
    if (Date.now() > deadline) throw new Error("Function did not enter its native process");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const queued = assert.rejects(second.invokeFunction("second:add", "counter_add", {amount: 1}), /gestoppt/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await f.runtime.stopRun(f.runId);
  await Promise.all([interrupted, queued]);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.deepEqual(f.runtime.data(f.runId, f.setup.agent.id).values, {count: 0});
});

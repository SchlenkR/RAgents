import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { OperationContributionRegistry } from "@ragents/engine";
import { setupRun } from "../../../packages/ragents/tests/support.ts";
import type { ActorProgramRuntimeOptions } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { appFiles, pingOperations, runtimeFor, sourcesOf, writeAppFiles, invocationResult } from "./actor-runtime-fixture.ts";

const fixture = async (t: Parameters<Parameters<typeof test>[1]>[0], operations: OperationContributionRegistry, scriptSources?: ActorProgramRuntimeOptions["scriptSources"]) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-contract-drift-"));
  const setup = setupRun({ runId: path.basename(directory).toLowerCase() });
  const runtime = runtimeFor(setup, directory, operations, undefined, scriptSources);
  t.after(async () => { await runtime.shutdown(); await rm(directory, { recursive: true, force: true }); });
  return { directory, setup, runtime, runId: setup.view.id, context: { actorId: setup.view.ownerId, commandId: "activate" } };
};
const call = async (f: Awaited<ReturnType<typeof fixture>>, requestId: string, name = "rpc") => {
  const app = f.runtime.apps(f.runId).find((entry) => entry.id === `${name}--main`)!;
  const invocation = f.runtime.startInvocation(f.runId, app.id, app.revision, "run", requestId, {}, f.runtime.invocationPermit(f.runId));
  return invocationResult(f.runtime, f.runId, `${name}--main`, invocation.id);
};
const program = (f: Awaited<ReturnType<typeof fixture>>, name = "rpc") => f.runtime.programs(f.runId).find((entry) => entry.name === name)!;

test("a compatible contract change re-activates the package before the call and keeps its build", async (t) => {
  const ping = pingOperations();
  const f = await fixture(t, ping.operations);
  await writeAppFiles(f.directory, "rpc", appFiles('return context.functions.native_ping({value: "ping"});'));
  await f.runtime.activate(f.context, f.runId, "rpc");
  const before = program(f);
  ping.widenInput();
  const result = await call(f, "widened");
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.deepEqual(ping.calls, [{value: "ping"}]);
  const after = program(f);
  assert.equal(after.revision, before.revision);
  assert.notEqual(after.functions[0]!.capabilityContractHash, before.functions[0]!.capabilityContractHash);
  assert.equal((await call(f, "settled")).status, "succeeded");
  assert.equal(program(f).revision, before.revision);
});

test("a breaking contract change fails the call with the build error and keeps the old package", async (t) => {
  const ping = pingOperations();
  const f = await fixture(t, ping.operations);
  await writeAppFiles(f.directory, "rpc", appFiles('return context.functions.native_ping({value: "ping"});'));
  await f.runtime.activate(f.context, f.runId, "rpc");
  const before = program(f);
  ping.breakResult();
  const result = await call(f, "broken");
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.match(result.error, /capability contract of rpc has changed and the reactivation failed/);
  assert.match(result.error, /src\/server\.ts:\d+:\d+ TS\d+/);
  assert.deepEqual(ping.calls, []);
  assert.deepEqual(program(f), before);
});

test("a run script package is rebuilt from the plugin's current sources when its contract drifts", async (t) => {
  const ping = pingOperations();
  const v1 = appFiles('return "v1:" + await context.functions.native_ping({value: "ping"});');
  const v2 = appFiles('return "v2:" + await context.functions.native_ping({value: "ping"});');
  let current = v1;
  const f = await fixture(t, ping.operations, (entryId, name) => entryId === "test.rpc" && name === "rpc" ? sourcesOf(current) : undefined);
  await f.runtime.installScript(f.context, f.runId, {entryId: "test.rpc", handle: "rpc", files: sourcesOf(v1), programs: [], sharedPrograms: []}, null);
  const before = program(f, "rpc.rpc");
  current = v2;
  const unchanged = await call(f, "unchanged", "rpc.rpc");
  assert.equal(unchanged.status, "succeeded", JSON.stringify(unchanged));
  assert.equal(unchanged.result, "v1:pong");
  assert.equal(program(f, "rpc.rpc").revision, before.revision);
  ping.widenInput();
  const rebuilt = await call(f, "rebuilt", "rpc.rpc");
  assert.equal(rebuilt.status, "succeeded", JSON.stringify(rebuilt));
  assert.equal(rebuilt.result, "v2:pong");
  assert.notEqual(program(f, "rpc.rpc").revision, before.revision);
  assert.equal(program(f, "rpc.rpc").actorId, before.actorId);
  assert.equal(f.runtime.apps(f.runId).find((entry) => entry.id === "rpc.rpc--main")?.revision, program(f, "rpc.rpc").revision);
});

test("a package without a run script origin is rebuilt from its own workspace files", async (t) => {
  const ping = pingOperations();
  const asked: string[] = [];
  const f = await fixture(t, ping.operations, (entryId, name) => { asked.push(`${entryId}/${name}`); return undefined; });
  await f.runtime.importPackage(f.context, f.runId, "rpc", sourcesOf(appFiles('return context.functions.native_ping({value: "ping"});')));
  ping.widenInput();
  assert.equal((await call(f, "rebuilt")).status, "succeeded");
  assert.deepEqual(asked, []);
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { OperationContributionRegistry } from "@ragents/engine";
import { setupRun } from "../../../packages/ragents/tests/support.ts";
import type { ActorProgramRuntimeOptions } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { runtimeFor, writeAppFiles, invocationResult } from "./actor-runtime-fixture.ts";

const pingOperations = () => {
  const calls: unknown[] = [];
  const operation = { id: "native_ping", label: "Ping", description: "Test operation", schema: Type.Object({value: Type.String()}), resultSchema: Type.String(), operator: "direct" as const,
    execute: (_context: unknown, input: unknown) => { calls.push(input); return "pong"; } };
  const operations = new OperationContributionRegistry();
  operations.register("test", [operation]);
  const widenInput = () => { operation.schema = Type.Object({value: Type.String(), verbose: Type.Optional(Type.Boolean())}) as never; };
  const breakResult = () => { operation.resultSchema = Type.Integer() as never; };
  return { operations, calls, widenInput, breakResult };
};
const fixture = async (t: Parameters<Parameters<typeof test>[1]>[0], operations: OperationContributionRegistry, scriptSources?: ActorProgramRuntimeOptions["scriptSources"]) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-contract-drift-"));
  const setup = setupRun();
  const runtime = runtimeFor(setup, directory, operations, undefined, scriptSources);
  t.after(async () => { await runtime.shutdown(); await rm(directory, { recursive: true, force: true }); });
  return { directory, setup, runtime, runId: setup.view.id, context: { actorId: setup.view.ownerId, commandId: "activate" } };
};
const appFiles = (body: string) => ({
  "package.json": JSON.stringify({ name: "rpc", private: true, type: "module", ragents: { title: "Rpc", views: [{id: "main", client: "src/client.tsx"}], backend: "src/server.ts" } }),
  "src/client.tsx": 'document.body.dataset.ready = "true"; export {};',
  "src/server.ts": `import {Type} from "typebox"; import {defineActor} from "@ragents/server";
export default defineActor({state: Type.Object({}, {additionalProperties: false}), functions: {run: {label: "Run", input: Type.Object({}), output: Type.String(), capabilities: ["native_ping"]}}}, {functions: {
run: async (_input, context) => {${body}}
}});`,
});
const sourcesOf = (files: Record<string, string>) => Object.entries(files).map(([file, content]) => ({path: file, content}));
const call = async (f: Awaited<ReturnType<typeof fixture>>, requestId: string) => {
  const app = f.runtime.apps(f.runId).find((entry) => entry.id === "rpc--main")!;
  const invocation = f.runtime.startInvocation(f.runId, app.id, app.revision, "run", requestId, {}, f.runtime.invocationPermit(f.runId));
  return invocationResult(f.runtime, f.runId, "rpc--main", invocation.id);
};
const program = (f: Awaited<ReturnType<typeof fixture>>) => f.runtime.programs(f.runId).find((entry) => entry.name === "rpc")!;

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
  assert.match(result.error, /Capability-Vertrag von rpc hat sich geändert und die Neuaktivierung scheiterte/);
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
  await f.runtime.importPackage(f.context, f.runId, "rpc", sourcesOf(v1), undefined, "test.rpc");
  const before = program(f);
  current = v2;
  const unchanged = await call(f, "unchanged");
  assert.equal(unchanged.status, "succeeded", JSON.stringify(unchanged));
  assert.equal(unchanged.result, "v1:pong");
  assert.equal(program(f).revision, before.revision);
  ping.widenInput();
  const rebuilt = await call(f, "rebuilt");
  assert.equal(rebuilt.status, "succeeded", JSON.stringify(rebuilt));
  assert.equal(rebuilt.result, "v2:pong");
  assert.notEqual(program(f).revision, before.revision);
  assert.equal(program(f).actorId, before.actorId);
  assert.equal(f.runtime.apps(f.runId).find((entry) => entry.id === "rpc--main")?.revision, program(f).revision);
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

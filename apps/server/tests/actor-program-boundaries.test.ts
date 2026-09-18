import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { OperationContributionRegistry } from "@aicontainer/ragents";
import { setupRun } from "../../../packages/ragents/tests/support.ts";
import { runtimeFor, writeAppFiles, invocationResult } from "./actor-runtime-fixture.ts";

const fixture = async (t: Parameters<Parameters<typeof test>[1]>[0], operations = new OperationContributionRegistry()) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-native-hardening-"));
  const setup = setupRun();
  const runtime = runtimeFor(setup, directory, operations);
  t.after(async () => { await runtime.shutdown(); await rm(directory, { recursive: true, force: true }); });
  return { directory, setup, runtime, runId: setup.view.id, context: { actorId: setup.view.ownerId, commandId: "activate" } };
};
const appFiles = (body: string, contract = 'input: Type.Object({}), output: Type.Integer()', capabilities: string[] = []) => ({
  "package.json": JSON.stringify({ name: "test-app", private: true, type: "module", ragents: { title: "Test", views:[{id:"main",client:"src/client.tsx"}], backend: "src/server.ts" } }),
  "src/client.tsx": 'document.body.dataset.ready = "true"; export {};',
  "src/server.ts": `import {Type} from "typebox"; import {defineActor} from "@ragents/server";
export default defineActor({state: Type.Object({count:Type.Optional(Type.Integer())},{additionalProperties:false}), functions:{run:{label:"Run", ${contract}, capabilities:${JSON.stringify(capabilities)}}}}, {functions:{
run: async (input,context)=>{${body}}
}});`,
});
const start = (f: Awaited<ReturnType<typeof fixture>>, appId: string, input: unknown = {}, requestId = `${appId}-request`) => {
  const app = f.runtime.apps(f.runId).find((app) => app.id === `${appId}--main`)!;
  return f.runtime.startInvocation(f.runId, app.id, app.revision, "run", requestId, input, f.runtime.invocationPermit(f.runId));
};
const finish = (f: Awaited<ReturnType<typeof fixture>>, appId: string, id: string) => invocationResult(f.runtime, f.runId, `${appId}--main`, id);
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for native backend");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("nested input, output and state contracts are validated at native boundaries", async (t) => {
  const f = await fixture(t);
  await writeAppFiles(f.directory, "input", appFiles('return input.details.quantity;', 'input:Type.Object({details:Type.Object({quantity:Type.Integer()},{additionalProperties:false})},{additionalProperties:false}),output:Type.Integer()'));
  await f.runtime.activate(f.context, f.runId, "input");
  assert.throws(() => start(f, "input", { details: { quantity: "wrong" } }), /Funktionseingabe/);
  const valid = start(f, "input", { details: { quantity: 3 } });
  const result = await finish(f, "input", valid.id);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") assert.equal(result.result, 3);
  await writeAppFiles(f.directory, "output", appFiles('context.state.replace({count:5}); return "wrong" as never;'));
  await f.runtime.activate({ ...f.context, commandId: "output" }, f.runId, "output");
  const invalid = await finish(f, "output", start(f, "output").id);
  assert.equal(invalid.status, "failed");
  assert.deepEqual(f.runtime.data(f.runId, f.runtime.programs(f.runId).find(p=>p.name==="output")!.actorId).values, {});
  await writeAppFiles(f.directory, "state", appFiles('context.state.replace({count:"wrong"} as never); return 1;'));
  await f.runtime.activate({ ...f.context, commandId: "state" }, f.runId, "state");
  const invalidState = await finish(f, "state", start(f, "state").id);
  assert.equal(invalidState.status, "failed");
  assert.deepEqual(f.runtime.data(f.runId, f.runtime.programs(f.runId).find(p=>p.name==="state")!.actorId).values, {});
});

test("an app process can be killed independently and cannot commit unfinished state", async (t) => {
  const f = await fixture(t);
  await writeAppFiles(f.directory, "blocked", appFiles('context.state.replace({count:9}); while(true) {}'));
  await writeAppFiles(f.directory, "working", appFiles('return 42;'));
  await f.runtime.activate(f.context, f.runId, "blocked");
  await f.runtime.activate({ ...f.context, commandId: "working" }, f.runId, "working");
  const pending = start(f, "blocked");
  await until(() => f.runtime.invocation(f.runId, "blocked--main", pending.id).status === "running");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const healthy = await finish(f, "working", start(f, "working").id);
  assert.equal(healthy.status, "succeeded");
  const revision = f.runtime.apps(f.runId).find((app) => app.id === "blocked--main")!.revision;
  await f.setup.runtime.nativeTypeScriptExecutor.stopInstance(f.runId, `actor:${f.runtime.programs(f.runId).find(p=>p.name==="blocked")!.actorId}:${revision}`);
  assert.equal((await finish(f, "blocked", pending.id)).status, "failed");
  assert.deepEqual(f.runtime.data(f.runId, f.runtime.programs(f.runId).find(p=>p.name==="blocked")!.actorId).values, {});

});

test("capability calls cross IPC with bound identity and retain the declared contracts", async (t) => {
  const operations = new OperationContributionRegistry();
  const calls: unknown[] = [];
  const operation = { id: "native_ping", label: "Ping", description: "Test operation", schema: Type.Object({value:Type.String()}), resultSchema: Type.String(), operator: "direct" as const,
    execute: (context: unknown, input: unknown) => { calls.push({ context, input }); return "pong"; } };
  operations.register("test", [operation]);
  const f = await fixture(t, operations);
  await writeAppFiles(f.directory, "rpc", appFiles('return context.functions.native_ping({value:"ping"});', 'input:Type.Object({}),output:Type.String()', ["native_ping"]));
  await f.runtime.activate(f.context, f.runId, "rpc");
  const result = await finish(f, "rpc", start(f, "rpc").id);
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  const call = calls[0] as { context: { runId: string; principal: { actorId: string } }; input: unknown };
  assert.equal(call.context.runId, f.runId); assert.equal(call.context.principal.actorId, f.setup.view.ownerId);
  assert.deepEqual(call.input, { value: "ping" });
  operation.resultSchema = Type.Integer() as never;
  const drift = await finish(f, "rpc", start(f, "rpc", {}, "drift").id);
  assert.equal(drift.status, "failed"); assert.equal(calls.length, 1);
});

test("active calls prevent replacement and removal; old permits and request IDs stay invalid", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered = false;
  const operations = new OperationContributionRegistry();
  operations.register("test", [{ id: "native_wait", label: "Wait", description: "Wait", schema: Type.Object({}), resultSchema: Type.Integer(), operator: "direct",
    execute: async () => { entered = true; await gate; return 1; } }]);
  const f = await fixture(t, operations);
  t.after(() => release());
  await writeAppFiles(f.directory, "waiting", appFiles('return context.functions.native_wait({});', undefined, ["native_wait"]));
  await f.runtime.activate(f.context, f.runId, "waiting");
  const pending = start(f, "waiting");
  await until(() => entered);
  await assert.rejects(f.runtime.remove({ ...f.context, commandId: "remove" }, f.runId, "waiting"), /laufende/);
  await assert.rejects(f.runtime.activate({ ...f.context, commandId: "replace" }, f.runId, "waiting"), /laufende/);
  release();
  assert.equal((await finish(f, "waiting", pending.id)).status, "succeeded");
  assert.equal(start(f, "waiting").id, pending.id);
  const permit = f.runtime.invocationPermit(f.runId);
  await f.runtime.stopSession(f.runId);
  const revision = f.runtime.apps(f.runId)[0]!.revision;
  assert.throws(() => f.runtime.startInvocation(f.runId, "waiting--main", revision, "run", "old-permit", {}, permit), /inzwischen gestoppt/);
});

test("backend logs are bounded and a failed new state contract leaves the old app active", async (t) => {
  const f = await fixture(t);
  const directory = await writeAppFiles(f.directory, "logs", appFiles('for(let i=0;i<250;i++) context.log("x".repeat(6000)); context.state.replace({count:1}); return 1;'));
  await f.runtime.activate(f.context, f.runId, "logs");
  const completed = await finish(f, "logs", start(f, "logs").id);
  assert.equal(completed.status, "succeeded");
  assert.ok(completed.output.length <= 200); assert.ok(completed.output.every((line) => line.length <= 4000));
  const before = f.runtime.apps(f.runId)[0]!.revision;
  const file = path.join(directory, "src/server.ts");
  await writeFile(file, (await readFile(file, "utf8")).replace('Type.Optional(Type.Integer())', 'Type.Optional(Type.Literal(2))').replace('context.state.replace({count:1})', 'context.state.replace({count:2})'));
  await assert.rejects(f.runtime.activate({ ...f.context, commandId: "invalid-state" }, f.runId, "logs"), /Actor-Zustand/);
  assert.equal(f.runtime.apps(f.runId)[0]!.revision, before);
});

test("package metadata rejects removed dialogs and paths outside the app", async (t) => {
  const f = await fixture(t);
  f.context = {...f.context,actorId:f.setup.agent.id};
  const directory = await f.runtime.scaffold(f.runId, "blank", "blank");
  const file = path.join(await f.runtime.workspaceDirectory(f.runId), "blank", "package.json");
  const pkg = JSON.parse(await readFile(file, "utf8"));
  pkg.ragents.dialog = true;
  await writeFile(file, JSON.stringify(pkg));
  await assert.rejects(f.runtime.activate(f.context, f.runId, "blank"), /package.json.ragents/);
  delete pkg.ragents.dialog; pkg.ragents.views[0].styles = "../../outside.css";
  await writeFile(file, JSON.stringify(pkg));
  await assert.rejects(f.runtime.activate(f.context, f.runId, "blank"), /pfad|außerhalb|ENOENT/i);
});

test("simultaneous activations retain both independent actors", async (t) => {
  const f = await fixture(t);
  await writeAppFiles(f.directory, "first", appFiles("return 1;"));
  await writeAppFiles(f.directory, "second", appFiles("return 2;"));
  await Promise.all([
    f.runtime.activate(f.context,f.runId,"first"),
    f.runtime.activate({...f.context,commandId:"second"},f.runId,"second"),
  ]);
  assert.deepEqual(f.runtime.apps(f.runId).map(app=>app.id).sort(),["first--main","second--main"]);
  assert.equal((await finish(f,"first",start(f,"first").id)).status,"succeeded");
  assert.equal((await finish(f,"second",start(f,"second").id)).status,"succeeded");
});

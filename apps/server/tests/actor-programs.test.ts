import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Value } from "typebox/value";
import { ChannelContributionRegistry, MethodContributionRegistry, RpcError, ScriptDriver, TurnScheduler, actorStatePluginId, createAccessContext, type MethodContext, type MethodContribution, type OperationContract, type OperationInput, type OperationResult } from "@ragents/engine";
import { catalog, postTo } from "../../../packages/ragents/tests/support.ts";
import { actorProgramContracts } from "../../../apps/server/src/plugin-support/actor-programs/contract.ts";
import { createActorProgramMethods } from "../../../plugins/ragents.actor-programs/server/methods.ts";
import { RpcClient } from "../../web/src/rpc/client.ts";
import { RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { RpcHttpTransport } from "../src/rpc/http-transport.ts";
import { actorProgramFixture, counterFiles, invokeActorFunction } from "./actor-programs-fixture.ts";
import { invocationResult, writeAppFiles } from "./actor-runtime-fixture.ts";

type ProgramFixture = Awaited<ReturnType<typeof actorProgramFixture>>;

const methodsOf = (f: ProgramFixture) =>
  createActorProgramMethods({runtime: f.runtime, ensureSession: (runId) => { f.setup.runtime.view(runId); }});

const restrictedClient = async (t: TestContext, f: ProgramFixture) => {
  const methods = new MethodContributionRegistry();
  methods.register("ragents.actor-programs", methodsOf(f));
  const access = createAccessContext({enabled: false, user: {id: "operator", label: "Operator", rights: ["runs.read", "runs.write"]}});
  const transport = new RpcHttpTransport({dispatcher: new RpcDispatcher({methods, channels: new ChannelContributionRegistry()})});
  const server = createServer((request, response) => {
    void transport.handle(request, response, new URL(request.url ?? "/", "http://host"), access, true);
  });
  t.after(() => { transport.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Testserver ohne Port");
  const client = new RpcClient({baseUrl: `http://127.0.0.1:${address.port}`});
  t.after(() => client.close());
  return client;
};

const methodFor = <C extends OperationContract>(methods: readonly MethodContribution[], contract: C) =>
  methods.find((entry) => entry.contract.id === contract.id)!.execute as
    (input: OperationInput<C>, context: MethodContext) => Promise<OperationResult<C>>;

const denied = (error: unknown): boolean => error instanceof RpcError && error.domainCode === "access-denied" && error.status === 403;

const fakeContext = (rights: readonly string[]) => ({
  access: createAccessContext({enabled: false, user: {id: "operator", label: "Operator", rights: [...rights]}}),
  signal: new AbortController().signal,
  progress: () => undefined,
  connection: {id: "t", userId: null, streamless: true, call: () => Promise.reject(new Error("kein Client")), onClose: () => () => undefined},
  local: true,
});

test("restricted operators can poll mini-app actions while actor function methods stay protected", async (t) => {
  const f = await actorProgramFixture(t);
  await writeAppFiles(f.directory, "counter", counterFiles({views: true}));
  await f.runtime.activate(f.context, f.runId, "counter");
  const app = f.runtime.apps(f.runId)[0]!;
  const client = await restrictedClient(t, f);
  const started = await client.call(actorProgramContracts.action, {
    runId: f.runId, appId: app.id, revision: app.revision, actionId: "add", requestId: "restricted-rpc-add", input: {amount: 4, delay: 100},
  });
  assert.equal(started.appId, app.id);
  assert.equal((await client.call(actorProgramContracts.invocation, {runId: f.runId, appId: app.id, invocationId: started.id})).id, started.id);
  await assert.rejects(client.call(actorProgramContracts.functionInvocation, {runId: f.runId, actorHandle: app.actorHandle, invocationId: started.id}), denied);
  await assert.rejects(client.call(actorProgramContracts.function, {
    runId: f.runId, actorHandle: app.actorHandle, revision: app.revision, functionId: "add", requestId: "restricted-rpc-direct", input: {amount: 4},
  }), denied);
  assert.deepEqual((await client.call(actorProgramContracts.apps, {runId: f.runId})).tools, []);
  const result = await invocationResult(f.runtime, f.runId, app.id, started.id);
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.deepEqual(await client.call(actorProgramContracts.invocation, {runId: f.runId, appId: app.id, invocationId: started.id}), result);
  assert.equal(f.runtime.apps(f.runId)[0]!.state.values.count, 4);
});

test("mini-app actions dispatch camelCase functions and preserve their results", async (t) => {
  const f = await actorProgramFixture(t);
  const files = Object.fromEntries(Object.entries(counterFiles({views: true})).map(([name, content]) =>
    [name, content.replace(/\badd\b/g, "addEntry")]));
  await writeAppFiles(f.directory, "counter", files);
  await f.runtime.activate(f.context, f.runId, "counter");
  const app = f.runtime.apps(f.runId)[0]!;
  const methods = methodsOf(f);
  const action = methodFor(methods, actorProgramContracts.action);
  const context = fakeContext(["runs.read", "runs.write"]);
  const input = {runId: f.runId, appId: app.id, revision: app.revision, actionId: "addEntry", requestId: "rpc-add-entry", input: {amount: 4}};
  assert.ok(Value.Check(actorProgramContracts.action.input, input));
  const accepted = await action(input, context);
  const result = await invocationResult(f.runtime, f.runId, app.id, accepted.id);
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  if (result.status === "succeeded") assert.equal((result.result as {count: number}).count, 4);
  assert.equal(f.runtime.apps(f.runId)[0]!.state.values.count, 4);
  const lookup = methodFor(methods, actorProgramContracts.invocation);
  assert.deepEqual(await lookup({runId: f.runId, appId: app.id, invocationId: result.id}, context), result);
  for (const name of ["AddEntry", "a".repeat(64), "add_entry-2"]) {
    assert.ok(Value.Check(actorProgramContracts.action.input, {...input, actionId: name}), name);
  }
  for (const name of ["", "1addEntry", "_addEntry", "add.entry", "add Entry", "add/entry", "a".repeat(65)]) {
    assert.equal(Value.Check(actorProgramContracts.action.input, {...input, actionId: name}), false, name);
  }
});

test("a headless TypeScript actor shares native module scope and state between input and functions", async (t) => {
  const f = await actorProgramFixture(t);
  await writeAppFiles(f.directory, "counter", counterFiles({input: true}));
  const activated = await f.runtime.activate(f.context, f.runId, "counter");
  assert.deepEqual(activated, {name: "counter", actor: "@counter", views: 0, active: true});
  const program = f.runtime.programs(f.runId)[0]!;
  const actor = f.setup.runtime.view(f.runId).actors.find((entry) => entry.id === program.actorId)!;
  assert.equal(actor.kind, "script");
  assert.equal("source" in actor, false);
  assert.deepEqual(f.runtime.apps(f.runId), []);
  const scheduler = new TurnScheduler(f.setup.runtime, f.setup.journal, {catalog, drivers: {script: new ScriptDriver({runtime: f.setup.runtime})}});
  try {
    postTo(f.setup.runtime, f.setup.view, actor.id, "input", "3");
    scheduler.start();
    await scheduler.waitForIdle();
    const view = f.setup.runtime.view(f.runId);
    assert.equal(view.turns.at(-1)?.status, "completed", view.turns.at(-1)?.reason ?? "");
    const result = await invokeActorFunction(f, "counter", {amount: 2}, "add");
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    if (result.status !== "succeeded") return;
    assert.deepEqual({...result.result as object, pid: 0}, {count: 5, pid: 0, calls: 2, actor: actor.id});
    assert.notEqual((result.result as {pid: number}).pid, process.pid);
    assert.deepEqual(f.setup.runtime.view(f.runId).pluginStates.find((state) => state.pluginId === actorStatePluginId)?.state, {count: 5});
  } finally {await scheduler.stop();}
});

test("an LLM actor keeps its behavior while several views and functions share its identity and state", async (t) => {
  const f = await actorProgramFixture(t);
  await writeAppFiles(f.directory, "counter", counterFiles({views: true}));
  await f.runtime.activate(f.context, f.runId, "counter", undefined, "@worker");
  const program = f.runtime.programs(f.runId)[0]!;
  assert.equal(program.actorId, f.setup.agent.id);
  assert.equal(f.setup.runtime.view(f.runId).actors.filter((actor) => actor.kind === "script").length, 0);
  assert.equal(f.setup.runtime.view(f.runId).actors.find((actor) => actor.id === program.actorId)?.kind, "agent");
  const views = f.runtime.apps(f.runId);
  assert.equal(views.length, 2);
  assert.equal(views.every((view) => view.actorId === f.setup.agent.id && view.placements[0]?.anchorActorId === f.setup.agent.id), true);
  const first = views[0]!;
  const invocation = f.runtime.startInvocation(f.runId, first.id, first.revision, "add", "view-add", {amount: 4});
  const {invocationResult} = await import("./actor-runtime-fixture.ts");
  const result = await invocationResult(f.runtime, f.runId, first.id, invocation.id);
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.equal(f.runtime.apps(f.runId).every((view) => view.state.values.count === 4), true);
  f.runtime.setVisibility({...f.context, commandId: "hide"}, f.runId, "counter/compact", false);
  assert.deepEqual(f.runtime.apps(f.runId).map((view) => view.visible), [true, false]);
  assert.deepEqual(f.runtime.setVisibility({...f.context, commandId: "show-by-handle"}, f.runId, " @WORKER/COMPACT ", true),
    {view: "counter/compact", visible: true});
  assert.deepEqual(f.runtime.apps(f.runId).map((view) => view.visible), [true, true]);
  f.runtime.setVisibility({...f.context, commandId: "hide-by-title"}, f.runId, "Compact Counter", false);
  assert.deepEqual(f.runtime.apps(f.runId).map((view) => view.visible), [true, false]);
  assert.throws(() => f.runtime.setVisibility({...f.context, commandId: "unknown-view"}, f.runId, "@worker/missing", false),
    /keine aktive Actor-Ansicht.*counter\/main \(@worker\/main\).*counter\/compact \(@worker\/compact\)/);
  assert.deepEqual(f.runtime.apps(f.runId).map((view) => view.visible), [true, false]);
  const pid = result.status === "succeeded" ? (result.result as {pid: number}).pid : 0;
  await f.runtime.remove({...f.context, commandId: "remove"}, f.runId, "counter");
  assert.ok(pid);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.equal(f.setup.runtime.view(f.runId).actors.find((actor) => actor.id === f.setup.agent.id)?.kind, "agent");
  assert.equal(f.setup.runtime.view(f.runId).actors.find((actor) => actor.id === f.setup.agent.id)?.lifecycle.kind, "idle");
  assert.deepEqual(f.runtime.data(f.runId, f.setup.agent.id).values, {count: 4});
});

test("failed TypeScript builds and Node tests preserve the active program and its state", async (t) => {
  const f = await actorProgramFixture(t);
  const files = counterFiles();
  const directory = await writeAppFiles(f.directory, "counter", files);
  await f.runtime.activate(f.context, f.runId, "counter");
  const before = f.runtime.programs(f.runId)[0]!;
  await invokeActorFunction(f, "counter", {amount: 1}, "before");
  await writeFile(path.join(directory, "src/lib/increment.ts"), 'export const increment: number = "invalid";');
  await assert.rejects(f.runtime.activate({...f.context, commandId: "bad-build"}, f.runId, "counter"), /TS2322|not callable/);
  assert.equal(f.runtime.programs(f.runId)[0]!.revision, before.revision);
  await writeAppFiles(f.directory, "counter", files);
  await writeFile(path.join(directory, "tests/counter.test.ts"), 'import test from "node:test"; test("rejected", () => {throw new Error("expected rejection");});');
  await assert.rejects(f.runtime.activate({...f.context, commandId: "bad-test"}, f.runId, "counter"), /Tests.*fehlgeschlagen/);
  assert.equal(f.runtime.programs(f.runId)[0]!.revision, before.revision);
  const next = await invokeActorFunction(f, "counter", {amount: 1}, "after");
  assert.equal(next.status, "succeeded", JSON.stringify(next));
  if (next.status === "succeeded") assert.equal((next.result as {count: number}).count, 2);
});

test("input handlers cannot replace an LLM actor's behavior and packages cannot multiply an actor identity", async (t) => {
  const f = await actorProgramFixture(t);
  await writeAppFiles(f.directory, "input-handler", counterFiles({input: true}));
  await assert.rejects(f.runtime.activate(f.context, f.runId, "input-handler", undefined, "@worker"), /onInput.*TypeScript|LLM-Actor/);
  await writeAppFiles(f.directory, "first", counterFiles());
  await f.runtime.activate({...f.context, commandId: "first"}, f.runId, "first", undefined, "@worker");
  await writeAppFiles(f.directory, "second", { ...counterFiles(), "src/server.ts": counterFiles()["src/server.ts"].replace('name: "counter_add"', 'name: "counter_other"') });
  await assert.rejects(f.runtime.activate({...f.context, commandId: "second"}, f.runId, "second", undefined, "@worker"), /besitzt bereits das Paket/);
  assert.equal(f.runtime.programs(f.runId).length, 1);
});

test("a view without a backend keeps existing actor state and compiles imported DOM helpers", async (t) => {
  const f = await actorProgramFixture(t);
  const state = {count: 4, note: "Already present"};
  f.setup.runtime.replaceActorState({...f.context, commandId: "initial-state"}, f.runId, f.setup.agent.id, state);
  await writeAppFiles(f.directory, "dashboard", {
    "package.json": JSON.stringify({name: "dashboard", private: true, type: "module", ragents: {
      title: "Dashboard", views: [{id: "main", client: "src/client.tsx"}],
    }}),
    "src/client.tsx": 'import {context} from "@ragents/client"; import {title} from "./view-data.js"; document.body.textContent = `${title}: ${context.actor.handle}`;',
    "src/view-data.ts": 'export const title: string = document.title;',
  });
  const activated = await f.runtime.activate(f.context, f.runId, "dashboard", undefined, "@worker");
  assert.deepEqual(activated, {name: "dashboard", actor: "@worker", views: 1, active: true});
  const program = f.runtime.programs(f.runId)[0]!;
  assert.equal(program.backendFile, undefined);
  assert.equal(program.actorId, f.setup.agent.id);
  assert.deepEqual(program.functions, []);
  assert.deepEqual(f.runtime.apps(f.runId)[0]!.state.values, state);
  assert.deepEqual(f.runtime.data(f.runId, f.setup.agent.id).values, state);
  assert.match(f.runtime.frame(f.runId, "dashboard--main", program.revision).clientJavaScript, /document\.title/);
});

test("a function cannot overwrite actor state patched while its native invocation is running", async (t) => {
  const f = await actorProgramFixture(t);
  const entered = path.join(f.directory, "state-entered");
  const release = path.join(f.directory, "state-release");
  const files = counterFiles();
  files["src/server.ts"] = 'import {access, writeFile} from "node:fs/promises";\n' + files["src/server.ts"].replace(
    "    calls++;", `    calls++;
    if (input.amount === 99) {
      await writeFile(${JSON.stringify(entered)}, "entered");
      while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await new Promise((resolve) => setTimeout(resolve, 10));
    }`,
  );
  await writeAppFiles(f.directory, "counter", files);
  await f.runtime.activate(f.context, f.runId, "counter");
  const program = f.runtime.programs(f.runId)[0]!;
  const retained = "existing actor data".repeat(100);
  f.setup.runtime.replaceActorState({...f.context, commandId: "retained-state"}, f.runId, program.actorId, {count: 0, retained});
  const work = invokeActorFunction(f, "counter", {amount: 99}, "conflict");
  const {access} = await import("node:fs/promises");
  try {
    const deadline = Date.now() + 10_000;
    while (!await access(entered).then(() => true, () => false)) {
      if (Date.now() > deadline) throw new Error("The function did not enter its native process");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    f.setup.runtime.replaceActorState({...f.context, commandId: "independent-state"}, f.runId, program.actorId, {count: 55, retained});
    assert.equal(f.setup.runtime.events(f.runId).at(-1)!.type, "plugin.state-patched");
  } finally {await writeFile(release, "released");}
  const result = await work;
  assert.equal(result.status, "failed", JSON.stringify(result));
  if (result.status === "failed") assert.match(result.error, /Zustand.*geändert|State.*changed/);
  assert.deepEqual(f.runtime.data(f.runId, program.actorId).values, {count: 55, retained});
});

test("preparing a new run does not require its run journal to exist yet", async (t) => {
  const f = await actorProgramFixture(t);
  await f.runtime.prepareSession("new-conversation");
  assert.deepEqual(f.runtime.programs("new-conversation"), []);
  assert.deepEqual(f.runtime.apps("new-conversation"), []);
  assert.deepEqual(f.runtime.runLocalTools("new-conversation"), []);
});

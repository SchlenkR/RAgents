import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { PluginHost, ScriptDriver, TurnScheduler, actorStatePluginId, createAccessContext } from "@aicontainer/ragents";
import { catalog, postTo } from "../../../packages/ragents/tests/support.ts";
import { createMiniAppRoutes, miniAppsApiPrefix } from "../../../plugins/ragents.actor-programs/server/routes.ts";
import { actorProgramFixture, counterFiles, invokeActorFunction } from "./actor-programs-fixture.ts";
import { invocationResult, writeAppFiles } from "./actor-runtime-fixture.ts";
import { capturedJson } from "./runtime-fixture.ts";

test("restricted operators can poll mini-app actions over HTTP while actor function routes stay protected", async (t) => {
  const f = await actorProgramFixture(t);
  await writeAppFiles(f.directory, "counter", counterFiles({views: true}));
  await f.runtime.activate(f.context, f.runId, "counter");
  const app = f.runtime.apps(f.runId)[0]!;
  const access = createAccessContext({enabled: false, user: {id: "operator", label: "Operator", rights: ["runs.read", "runs.write"]}});
  const host = new PluginHost({product: {id: "test", title: "Test"}, dataDirectory: f.directory});
  host.register({manifest: {id: "ragents.actor-programs"}, register: (registration) => {
    registration.http(...createMiniAppRoutes({runtime: f.runtime, ensureSession: (runId) => { f.setup.runtime.view(runId); }}));
  }});
  const server = createServer(async (request, response) => {
    if (!await host.dispatchHttp(request, response, new URL(request.url!, "http://localhost"), access)) response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}${miniAppsApiPrefix}/runs/${f.runId}`;
  const input = {requestId: "restricted-http-add", revision: app.revision, input: {amount: 4, delay: 100}};
  const post = {method: "POST", headers: {"Content-Type": "application/json", "X-RAgents-App-Bridge": "1"}, body: JSON.stringify(input)};
  try {
    const accepted = await fetch(`${base}/apps/${app.id}/actions/add`, post);
    assert.equal(accepted.status, 202);
    const invocation = await accepted.json() as {id: string; appId: string};
    assert.equal(invocation.appId, app.id);
    const pollUrl = `${base}/apps/${invocation.appId}/invocations/${invocation.id}`;
    assert.equal((await fetch(pollUrl)).status, 200);
    const denied = await fetch(`${base}/actors/${app.actorHandle}/invocations/${invocation.id}`);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as {right: string}).right, "runs.inspect");
    assert.equal((await fetch(`${base}/actors/${app.actorHandle}/functions/add`, post)).status, 403);
    const result = await invocationResult(f.runtime, f.runId, app.id, invocation.id);
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    const returned = await fetch(pollUrl);
    assert.equal(returned.status, 200);
    assert.deepEqual(await returned.json(), result);
    assert.equal(f.runtime.apps(f.runId)[0]!.state.values.count, 4);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("mini-app HTTP actions dispatch camelCase functions and preserve their results", async (t) => {
  const f = await actorProgramFixture(t);
  const files = Object.fromEntries(Object.entries(counterFiles({views: true})).map(([name, content]) =>
    [name, content.replace(/\badd\b/g, "addEntry")]));
  await writeAppFiles(f.directory, "counter", files);
  await f.runtime.activate(f.context, f.runId, "counter");
  const app = f.runtime.apps(f.runId)[0]!;
  const routes = createMiniAppRoutes({runtime: f.runtime, ensureSession: (runId) => { f.setup.runtime.view(runId); }});
  const base = `${miniAppsApiPrefix}/runs/${f.runId}/apps/${app.id}`;
  const request = Object.assign(Readable.from([JSON.stringify({
    requestId: "http-add-entry", revision: app.revision, input: {amount: 4},
  })]), {method: "POST", headers: {"x-ragents-app-bridge": "1"}, aborted: false}) as unknown as IncomingMessage;
  const url = new URL(`${base}/actions/addEntry`, "http://host");
  const route = routes.find((entry) => entry.matches(request, url));
  assert.ok(route, "A valid camelCase action must match its HTTP route instead of returning 404");
  const accepted = capturedJson();
  await route.handle({request, response: accepted.response, url});
  assert.equal(accepted.captured.status, 202, JSON.stringify(accepted.captured.body));
  const result = await invocationResult(f.runtime, f.runId, app.id, (accepted.captured.body as {id: string}).id);
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  if (result.status === "succeeded") assert.equal((result.result as {count: number}).count, 4);
  assert.equal(f.runtime.apps(f.runId)[0]!.state.values.count, 4);
  const resultRequest = Object.assign(Readable.from([]), {method: "GET", headers: {}}) as unknown as IncomingMessage;
  const resultUrl = new URL(`${base}/invocations/${result.id}`, "http://host");
  const resultRoute = routes.find((entry) => entry.matches(resultRequest, resultUrl));
  assert.ok(resultRoute);
  const returned = capturedJson();
  await resultRoute.handle({request: resultRequest, response: returned.response, url: resultUrl});
  assert.equal(returned.captured.status, 200);
  assert.deepEqual(returned.captured.body, result);
  for (const name of ["AddEntry", "a".repeat(64), "add_entry-2"]) {
    assert.ok(route.matches(request, new URL(`${base}/actions/${name}`, "http://host")), name);
  }
  for (const name of ["", "1addEntry", "_addEntry", "add.entry", "add%20Entry", "add/entry", "a".repeat(65)]) {
    const invalidUrl = new URL(`${base}/actions/${name}`, "http://host");
    assert.equal(routes.some((entry) => entry.matches(request, invalidUrl)), false, name);
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

test("preparing a new conversation does not require its run journal to exist yet", async (t) => {
  const f = await actorProgramFixture(t);
  await f.runtime.prepareSession("new-conversation");
  assert.deepEqual(f.runtime.programs("new-conversation"), []);
  assert.deepEqual(f.runtime.apps("new-conversation"), []);
  assert.deepEqual(f.runtime.runLocalTools("new-conversation"), []);
});

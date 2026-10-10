import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { agentTools, createAccessContext, defineRunFunction, defineToolAvailability, holdsUsable, Orchestration, ScriptDriver, ToolRegistry, TurnScheduler, type AccessContext, type Actor, type CapabilityGrant, type JsonValue, type RunFunction } from "@ragents/engine";
import { toolDescriptorFrom } from "../src/plugin-support/agent-tool.ts";
import { allGrants, catalog, setupRun } from "../../../packages/ragents/tests/support.ts";
import { globalAppsFunctions } from "../../../plugins/ragents.global-apps/server/functions.ts";
import { GlobalAppsService, globalAppsRunId, type GlobalAppsServiceOptions } from "../../../plugins/ragents.global-apps/server/service.ts";
import { appDetailsSchema, type GlobalAppPermissions, type GlobalAppRegister } from "../../../plugins/ragents.global-apps/contract.ts";
import { runtimeFor, writeAppFiles } from "./actor-runtime-fixture.ts";

const access = createAccessContext({ enabled: false, user: null });
const until = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 20000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("The app did not settle.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const files = (body: string, capabilities = ["global_app_trigger"], imports = "") => ({
  "package.json": JSON.stringify({ name: "source", private: true, type: "module", ragents: { title: "Check", backend: "src/server.ts" } }),
  "src/server.ts": `import { Type } from "typebox";
import { defineActor } from "@ragents/server";
${imports}
export default defineActor({
  state: Type.Object({ count: Type.Optional(Type.Integer()), pid: Type.Optional(Type.Integer()), key: Type.Optional(Type.String()) }),
  functions: {}, input: { capabilities: ${JSON.stringify(capabilities)} },
}, { functions: {}, onInput: async (_input, context) => {
  const tick = await context.functions.global_app_trigger({});
  ${body}
} });`,
});
const count = 'context.state.replace({ count: (context.state.read().count ?? 0) + 1, pid: process.pid, key: tick.key }); context.log(tick.reason);';

const fixture = async (t: TestContext, extraTools: readonly RunFunction[] = [], grants: CapabilityGrant[] = allGrants(), overrides: Pick<GlobalAppsServiceOptions, "watch"> = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-global-apps-"));
  const setup = setupRun({ grants });
  let time = Date.parse("2026-08-16T12:00:00.000Z");
  setup.services.now = () => new Date(time).toISOString();
  const directoryFor = (runId: string) => path.join(directory, runId);
  let service: GlobalAppsService;
  const contributed = () => [...globalAppsFunctions(service, () => access).tools({} as never) as RunFunction[], ...extraTools];
  const programs = runtimeFor(setup, directory, undefined, undefined, undefined, contributed, undefined, directoryFor);
  const registry = new ToolRegistry();
  registry.register({ name: "test.apps", descriptors: contributed().map((fn) => toolDescriptorFrom(fn, fn.available)), tools: contributed });
  const scheduler = new TurnScheduler(setup.runtime, setup.journal, { catalog, registry, drivers: { script: new ScriptDriver({ runtime: setup.runtime }) } });
  let wake: (() => void) | undefined;
  let ownerAccess: AccessContext = access;
  const options = {
    runtime: () => setup.runtime, programs, userAccess: () => ownerAccess,
    ensureRun: (runId: string) => { setup.runtime.state(runId); },
    prepareRun: async (runId: string) => { await programs.workspaceDirectory(runId); },
    interrupt: async (runId: string, actorId: string, reason: string) => {
      await scheduler.interruptTurn(runId, actorId, { context: { actorId: setup.runtime.state(runId).ownerId, commandId: `interrupt:${runId}:${setup.runtime.view(runId).revision}` }, reason });
      if (scheduler.isRunning(runId, actorId)) throw new Error("The interrupted turn is still cleaning up.");
    },
    functionsFor: async (runId: string, actor: Actor) => [...agentTools, ...contributed()].filter((fn) => fn.available(actor, setup.runtime.view(runId)) && (actor.kind === "human" || actor.toolNames === null || actor.toolNames.includes(fn.name))),
    sourceRoots: async () => ({ read: [directory], write: [directory] }),
    sandboxFor: async () => false,
    now: () => time,
    wake: (callback: () => void) => { wake = callback; return () => { if (wake === callback) wake = undefined; }; },
    ...overrides,
  };
  service = new GlobalAppsService(options);
  await service.ready();
  const sourceRunId = setup.view.id;
  const caller = { runId: sourceRunId, actorId: setup.agent.id, turnId: null };
  const register = async (body = count, permissions: GlobalAppPermissions = {}, capabilities = ["global_app_trigger"], imports = "", name = "check", triggers: GlobalAppRegister["triggers"] = { interval: { everySeconds: 60 } }) => {
    await writeAppFiles(directoryFor(sourceRunId), "source", files(body, capabilities, imports));
    return service.register(access, caller, { name, description: "A scheduled check", program: "source", triggers, permissions });
  };
  t.after(async () => {
    await service.shutdown();
    await scheduler.stop();
    await programs.shutdown();
    await setup.services.nativeTypeScriptExecutor!.shutdown();
    setup.journal.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory, setup, programs, scheduler, caller, register,
    get service() { return service; },
    advance: (milliseconds: number) => { time += milliseconds; const callback = wake; wake = undefined; callback?.(); },
    restart: async () => { await service.shutdown(); service = new GlobalAppsService(options); await service.ready(); },
    setAccess: (value: AccessContext) => { ownerAccess = value; },
    settled: async (outcome = "completed", name = "check") => {
      await until(() => { const app = service.read(access, name).app; return app.lastResult !== null && !["queued", "running"].includes(app.status); });
      assert.equal(service.read(access, name).app.lastResult?.outcome, outcome, JSON.stringify(service.read(access, name)));
    },
  };
};

test("registration is paused; checks use an independent Node process and private state survives restart", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.register(), { registered: true, paused: true });
  assert.doesNotThrow(() => f.service.forget("unavailable-ordinary-run"));
  const runId = globalAppsRunId(null);
  assert.equal(f.setup.runtime.view(runId).primaryActorId, f.programs.programs(runId)[0]!.actorId);
  assert.equal(f.service.read(access, "check").app.status, "paused");
  await f.service.run(access, "check");
  await assert.rejects(f.service.run(access, "check"), /already has accepted/);
  f.scheduler.start();
  await f.settled();
  const state = f.service.read(access, "check").state as { count: number; pid: number; key: string };
  assert.equal(Value.Check(appDetailsSchema, f.service.read(access, "check")), true);
  assert.equal(state.count, 1);
  assert.notEqual(state.pid, process.pid);
  assert.match(state.key, /:check:1$/);
  assert.equal(f.service.read(access, "check").log.at(-1)?.text, "manual");
  assert.equal(f.service.read(access, "check").app.nextRunAt, null);
  await f.restart();
  assert.deepEqual(f.service.read(access, "check").state, state);
  assert.equal(f.setup.runtime.listRuns().filter((run) => run.id === runId).length, 1);
  await f.service.run(access, "check");
  await until(() => (f.service.read(access, "check").state as { count?: number }).count === 2);
});

test("one overdue check after restart uses fixed delay; pause finishes accepted work and removal stops it", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.register(count + ' await new Promise((resolve) => setTimeout(resolve, 80));');
  await f.service.pause(access, "check", false);
  await f.service.shutdown();
  f.advance(600000);
  await f.restart();
  assert.equal(f.service.read(access, "check").app.status, "queued");
  assert.equal(f.setup.runtime.view(globalAppsRunId(null)).inputs.length, 1);
  f.scheduler.start();
  await f.settled();
  assert.equal((f.service.read(access, "check").state as { count: number }).count, 1);
  assert.equal(f.service.read(access, "check").app.nextRunAt, new Date(Date.parse(f.setup.services.now()) + 60000).toISOString());
  f.advance(60000);
  await until(() => f.service.read(access, "check").app.status === "running");
  await f.service.pause(access, "check", true);
  await until(() => f.service.read(access, "check").app.status === "paused");
  assert.equal((f.service.read(access, "check").state as { count: number }).count, 2);
  await f.service.remove(access, "check");
  assert.deepEqual(f.service.list(access), { apps: [], errors: [], hasMore: false });
  assert.deepEqual(f.programs.programs(globalAppsRunId(null)), []);
  assert.ok(f.setup.runtime.events(globalAppsRunId(null)).length > 0);
});

test("failed checks retain logs but discard staged state; the log ring and registration errors stay bounded", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.register('context.state.replace({ count: 99 }); for (const index of Array.from({ length: 110 }, (_, index) => index)) context.log("line " + index); throw new Error("Expected failure.");');
  f.scheduler.start();
  await f.service.run(access, "check");
  await f.settled("failed");
  const details = f.service.read(access, "check", 100);
  assert.deepEqual(details.state, {});
  assert.equal(details.log.length, 100);
  assert.ok(details.droppedLogLines >= 1);
  assert.equal(details.log.at(-1)?.level, "error");
  assert.match(details.app.lastResult!.summary, /Expected failure/);
  await assert.rejects(f.register('const value: number = "wrong"; context.log(value);'), /src\/server.ts:\d+:\d+ TS2322/);
  assert.equal(f.service.read(access, "check").app.lastResult?.outcome, "failed");
  await assert.rejects(f.register("const broken = ;"), /Build of check:.*errors/);
  await assert.rejects(f.register(count, {}, []), /Missing input capabilities: global_app_trigger/);
  await f.register();
  await f.service.run(access, "check");
  await f.settled();
  assert.equal((f.service.read(access, "check").state as { count: number }).count, 1);
});

test("file and HTTP capabilities enforce declared paths, symlinks, hosts and redirects outside the app code", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const allowed = path.join(f.directory, "allowed");
  const outside = path.join(f.directory, "outside");
  await mkdir(allowed);
  await mkdir(outside);
  await writeFile(path.join(allowed, "input.txt"), "allowed input");
  await writeFile(path.join(outside, "private.txt"), "outside input");
  await symlink(path.join(outside, "private.txt"), path.join(allowed, "link.txt"));
  const server = createServer((request, response) => {
    if (request.url === "/redirect") { response.writeHead(302, { location: "/ok" }); response.end(); }
    else response.end("HTTP result");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const host = `127.0.0.1:${address.port}`;
  const capabilities = ["global_app_trigger", "global_app_file_read", "global_app_file_write", "global_app_http_request"];
  const permissions = { files: { read: [allowed], write: [allowed] }, http: [host] };
  await f.register(`
    const text = await context.functions.global_app_file_read({ path: ${JSON.stringify(path.join(allowed, "input.txt"))} });
    await context.functions.global_app_file_write({ path: ${JSON.stringify(path.join(allowed, "output.txt"))}, content: text });
    const response = await context.functions.global_app_http_request({ url: "http://${host}/ok" });
    context.log(response.body);`, permissions, capabilities);
  f.scheduler.start();
  await f.service.run(access, "check");
  await f.settled();
  assert.equal(await readFile(path.join(allowed, "output.txt"), "utf8"), "allowed input");
  assert.equal(f.service.read(access, "check").log.at(-1)?.text, "HTTP result");
  for (const body of [
    `await context.functions.global_app_file_read({ path: ${JSON.stringify(path.join(outside, "private.txt"))} });`,
    `await context.functions.global_app_file_read({ path: ${JSON.stringify(path.join(allowed, "link.txt"))} });`,
    `await context.functions.global_app_http_request({ url: "http://localhost:${address.port}/ok" });`,
    `await context.functions.global_app_http_request({ url: "http://${host}/redirect" });`,
    `await context.functions.global_app_http_request({ url: "http://${host}/ok", headers: { Host: "another.example" } });`,
  ]) {
    await f.register(body, permissions, capabilities);
    await f.service.run(access, "check");
    await f.settled("failed");
    assert.match(f.service.read(access, "check").app.lastResult!.summary, /outside|not permitted|redirect|override/);
  }
});

test("current owner rights and delegable grants bound app functions; ordinary inputs cannot acquire app capabilities", { timeout: 60000 }, async (t) => {
  const notify = defineRunFunction({ name: "test_notify", label: "Notify", description: "Send a test notification.", schema: Type.Object({}), resultSchema: Type.String(),
    available: defineToolAvailability({ availability: "conditional", availabilityDetail: "With actor.input." }, (actor) => holdsUsable(actor, "actor.input")), run: () => "notification" });
  const f = await fixture(t, [notify]);
  await f.register('context.log(await context.functions.test_notify({}));', { functions: ["test_notify"] }, ["global_app_trigger", "test_notify"]);
  f.scheduler.start();
  await f.service.run(access, "check");
  await f.settled();
  assert.equal(f.service.read(access, "check").log.at(-1)?.text, "notification");
  await assert.rejects(f.register(count, { functions: ["typescript_eval"] }), /not available and delegable/);
  const limited = createAccessContext({ enabled: false, user: { id: "guest", label: "Guest", rights: ["runs.read", "ragents.global-apps.read"] } });
  await assert.rejects(f.service.run(limited, "check"), /Missing permission/);
  assert.deepEqual(f.service.list(limited), { apps: [], errors: [], hasMore: false });
  assert.throws(() => f.service.trigger(f.caller), /not an accepted app occurrence/);
  f.setAccess(createAccessContext({ enabled: false, user: { id: "limited", label: "Limited", rights: ["runs.read"] } }));
  await assert.rejects(f.service.run(access, "check"), /Missing permission/);
  const registration: GlobalAppRegister = { name: "foreign", description: "Foreign package", program: "source", triggers: { interval: { everySeconds: 60 } }, permissions: {} };
  await assert.rejects(f.service.register(limited, f.caller, registration), /Missing permission/);
  const foreign = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["*"] } });
  await assert.rejects(f.service.register(foreign, f.caller, registration), /package must belong to your user/);
  const restricted = await fixture(t, [notify], allGrants().map((grant) => grant.capability === "actor.input" ? { ...grant, delegable: false } : grant));
  await assert.rejects(restricted.register(count, { functions: ["test_notify"] }), /not available and delegable/);
  const scoped = await fixture(t, [], [
    ...allGrants().map((grant) => grant.capability === "workspace.use" ? { ...grant, usable: false } : grant),
    { capability: "workspace.use", scope: { kind: "workspace", path: "/home/user/allowed" }, usable: true, delegable: true },
  ]);
  await scoped.register();
  const appActor = scoped.setup.runtime.view(globalAppsRunId(null)).actors.find((actor) => actor.kind === "script")!;
  const workspaceGrants = appActor.grants.filter((grant) => grant.capability === "workspace.use");
  assert.equal(workspaceGrants.length, 1);
  assert.deepEqual(workspaceGrants[0]!.scope, { kind: "workspace", path: "/home/user/allowed" });
});

test("accepted work recovers its missing enqueue exactly once before the scheduler starts", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.register();
  await f.service.shutdown();
  const runId = globalAppsRunId(null);
  const state = f.setup.runtime.view(runId).pluginStates.find((entry) => entry.pluginId === "ragents.global-apps" && entry.scope.kind === "actor")!;
  const key = `${runId}:check:1`;
  f.setup.runtime.replacePluginState({ actorId: f.setup.runtime.state(runId).ownerId, commandId: "accepted-before-crash" }, runId, {
    pluginId: state.pluginId, scope: state.scope,
    state: { ...state.state as Record<string, JsonValue>, occurrence: 1, phase: { kind: "accepted", tick: { number: 1, key, commandId: `global-apps-input:${key}`, scheduledAt: f.setup.services.now(), reason: "manual" } } },
  });
  await f.restart();
  await f.restart();
  assert.equal(f.setup.runtime.view(runId).inputs.length, 1);
  f.scheduler.start();
  await f.settled();
  assert.equal((f.service.read(access, "check").state as { count: number }).count, 1);
});

test("engine restart interrupts a claimed check and global apps finalize its journal without replay", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.register();
  await f.service.run(access, "check");
  await f.service.shutdown();
  const runId = globalAppsRunId(null);
  const input = f.setup.runtime.view(runId).inputs[0]!;
  const actorId = input.actorId;
  f.setup.runtime.startTurn({ actorId, commandId: "started-before-crash" }, runId, actorId, input.id);
  const turn = f.setup.runtime.view(runId).turns[0]!;
  f.setup.runtime.appendRuntimeOutput({ actorId, turnId: turn.id, commandId: "output-before-crash" }, runId, actorId, { turnId: turn.id, text: "Before restart" });
  f.setup.runtime = new Orchestration(f.setup.journal, f.setup.services);
  await f.restart();
  const interrupted = f.service.read(access, "check");
  assert.equal(interrupted.app.lastResult?.outcome, "interrupted");
  assert.match(interrupted.app.lastResult!.summary, /restart of the runtime/);
  assert.deepEqual(interrupted.state, {});
  assert.ok(interrupted.log.some((line) => line.text === "Before restart"));
  await f.restart();
  assert.deepEqual(f.service.read(access, "check"), interrupted);
  assert.equal(f.setup.runtime.view(runId).inputs.length, 1);
  await f.service.run(access, "check");
  f.scheduler.start();
  await f.settled();
  assert.equal((f.service.read(access, "check").state as { count: number }).count, 1);
});

test("a deadline kills a stuck Node process without committing its state or overlapping the next check", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.register('context.log("Before timeout"); context.state.replace({ count: 99 }); for (;;) {}');
  f.scheduler.start();
  await f.service.run(access, "check");
  const runId = globalAppsRunId(null);
  await until(() => f.setup.runtime.events(runId).some((event) => event.type === "tool.call.completed" && event.payload.name === "global_app_trigger"));
  f.advance(31000);
  await f.settled("timeout");
  assert.deepEqual(f.service.read(access, "check").state, {});
  assert.ok(f.service.read(access, "check").log.some((line) => line.text === "Before timeout"));
  await f.register();
  await f.service.run(access, "check");
  await f.settled();
});

test("a user has four concurrent checks; a busy occurrence cannot overlap", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  for (const index of [0, 1, 2, 3, 4]) await f.register(count, {}, ["global_app_trigger"], "", `check-${index}`);
  for (const index of [0, 1, 2, 3]) await f.service.run(access, `check-${index}`);
  await assert.rejects(f.service.run(access, "check-4"), /Four global apps are already active/);
  await assert.rejects(f.service.run(access, "check-0"), /already has accepted/);
  f.scheduler.start();
  await Promise.all([0, 1, 2, 3].map((index) => f.settled("completed", `check-${index}`)));
  const pids = [0, 1, 2, 3].map((index) => (f.service.read(access, `check-${index}`).state as { pid: number }).pid);
  assert.equal(new Set(pids).size, 4);
  await f.service.run(access, "check-4");
  await f.settled("completed", "check-4");
});

test("manual-only apps have no timer and file triggers cannot exceed their folder permissions", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.register(count, {}, ["global_app_trigger"], "", "manual", {});
  await f.service.pause(access, "manual", false);
  f.advance(600000);
  assert.equal(f.service.read(access, "manual").app.nextRunAt, null);
  assert.equal(f.setup.runtime.view(globalAppsRunId(null)).inputs.length, 0);
  await assert.rejects(f.register(count, {}, ["global_app_trigger"], "", "denied-watch", { fileChange: { folders: [f.directory] } }), /outside the working directory/);
  f.scheduler.start();
  await f.service.run(access, "manual");
  await f.settled("completed", "manual");
  assert.equal(f.service.read(access, "manual").log.at(-1)?.text, "manual");
});

test("file triggers combine with intervals, coalesce during work and stop on pause or removal", { timeout: 60000 }, async (t) => {
  const listeners = new Map<string, Parameters<NonNullable<GlobalAppsServiceOptions["watch"]>>[1]>();
  const stopped: string[] = [];
  const watch: NonNullable<GlobalAppsServiceOptions["watch"]> = async (folder, listener) => {
    listeners.set(folder, listener);
    return () => { stopped.push(folder); listeners.delete(folder); };
  };
  const f = await fixture(t, [], allGrants(), { watch });
  const requestedFolder = path.join(f.directory, "watched");
  await mkdir(requestedFolder);
  const folder = await realpath(requestedFolder);
  await f.register(count, { files: { read: [folder] } }, ["global_app_trigger"], "", "check", {
    interval: { everySeconds: 60 }, fileChange: { folders: [folder] },
  });
  assert.equal(listeners.size, 0, "registration stays paused");
  await f.service.pause(access, "check", false);
  const listener = listeners.get(folder)!;
  listener.onChange();
  listener.onChange();
  listener.onChange();
  await until(() => f.setup.runtime.view(globalAppsRunId(null)).inputs.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  f.scheduler.start();
  await until(() => (f.service.read(access, "check").state as { count?: number }).count === 2);
  await f.settled();
  assert.equal(f.setup.runtime.view(globalAppsRunId(null)).inputs.length, 2, "one occurrence and one pending occurrence");
  assert.equal(f.service.read(access, "check").log.at(-1)?.text, "file-change");
  assert.equal(f.service.read(access, "check").app.nextRunAt, new Date(Date.parse(f.setup.services.now()) + 60000).toISOString());
  f.advance(60000);
  await until(() => (f.service.read(access, "check").state as { count?: number }).count === 3);
  await f.settled();
  assert.equal(f.service.read(access, "check").log.at(-1)?.text, "interval");
  await f.service.pause(access, "check", true);
  assert.equal(listeners.size, 0);
  listener.onChange();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.setup.runtime.view(globalAppsRunId(null)).inputs.length, 3);
  await f.service.pause(access, "check", false);
  await f.service.remove(access, "check");
  assert.equal(listeners.size, 0);
  assert.equal(stopped.length, 2);
});

test("a watcher failure blocks only its app and remains visible across restart", { timeout: 60000 }, async (t) => {
  const watch: NonNullable<GlobalAppsServiceOptions["watch"]> = async () => { throw new Error("The folder cannot be watched."); };
  const f = await fixture(t, [], allGrants(), { watch });
  await f.register(count, { files: { read: [f.directory] } }, ["global_app_trigger"], "", "watcher", { fileChange: { folders: [f.directory] } });
  await f.register(count, {}, ["global_app_trigger"], "", "healthy", {});
  await f.service.pause(access, "watcher", false);
  assert.equal(f.service.read(access, "watcher").app.status, "blocked");
  assert.match(f.service.read(access, "watcher").app.problem!, /folder cannot be watched/);
  await f.restart();
  f.scheduler.start();
  await f.service.run(access, "healthy");
  await f.settled("completed", "healthy");
  assert.equal(f.service.snapshot(access).problem, null);
  assert.equal(f.service.read(access, "watcher").app.status, "blocked");
});

test("a failed build is a visible removable error and never prevents another app or server recovery", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.register('const invalid: number = "bad";', {}, ["global_app_trigger"], "", "broken"), /TS2322/);
  const failure = f.service.read(access, "broken");
  assert.equal(Value.Check(appDetailsSchema, failure), true);
  assert.match(failure.log[0]!.text, /TS2322/);
  assert.equal(failure.sandbox, "unavailable");
  assert.equal(f.service.list(access).errors[0]?.name, "broken");
  await f.register(count, {}, ["global_app_trigger"], "", "healthy", {});
  await f.restart();
  assert.equal(f.service.snapshot(access).problem, null);
  assert.equal(f.service.snapshot(access).errors[0]?.name, "broken");
  f.scheduler.start();
  await f.service.run(access, "healthy");
  await f.settled("completed", "healthy");
  await f.service.remove(access, "broken");
  assert.deepEqual(f.service.list(access).errors, []);
});

test("damaged definitions are skipped with an error while healthy apps still recover and run", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.register(count, {}, ["global_app_trigger"], "", "broken", {});
  await f.register(count, {}, ["global_app_trigger"], "", "healthy", {});
  const runId = globalAppsRunId(null);
  const stored = f.setup.runtime.view(runId).pluginStates.find((entry) => entry.pluginId === "ragents.global-apps" && entry.scope.kind === "actor" && (entry.state as { definition?: { name?: string } }).definition?.name === "broken")!;
  f.setup.runtime.replacePluginState({ actorId: f.setup.runtime.state(runId).ownerId, commandId: "damage-app-definition" }, runId, {
    pluginId: stored.pluginId, scope: stored.scope, state: { definition: { name: "broken" }, version: 99 },
  });
  await f.restart();
  const snapshot = f.service.snapshot(access);
  assert.equal(snapshot.problem, null);
  assert.deepEqual(snapshot.apps.map((app) => app.name), ["healthy"]);
  assert.match(snapshot.errors[0]!.problem, /definition is damaged/);
  assert.equal(snapshot.errors[0]!.name, "broken");
  assert.throws(() => f.service.read(access, "broken"), /definition is damaged/);
  f.scheduler.start();
  await f.service.run(access, "healthy");
  await f.settled("completed", "healthy");
  await assert.rejects(f.register('const invalid: number = "bad";', {}, ["global_app_trigger"], "", "broken"), /TS2322/);
  const errors = f.service.snapshot(access).errors;
  assert.equal(errors.length, 2);
  assert.equal(new Set(errors.map((error) => error.id)).size, errors.length, "a failed repair cannot duplicate widget IDs");
  await f.service.remove(access, "broken");
  assert.deepEqual(f.service.snapshot(access).errors, []);
});

test("a runtime failure does not prevent a healthy app from finishing or its state from committing", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.register('context.log("Before failure"); context.state.replace({ count: 99 }); throw new Error("App execution failed.");', {}, ["global_app_trigger"], "", "broken", {});
  await f.register(count, {}, ["global_app_trigger"], "", "healthy", {});
  await f.service.run(access, "broken");
  await f.service.run(access, "healthy");
  f.scheduler.start();
  await Promise.all([f.settled("failed", "broken"), f.settled("completed", "healthy")]);
  assert.deepEqual(f.service.read(access, "broken").state, {});
  assert.equal((f.service.read(access, "healthy").state as { count: number }).count, 1);
  assert.ok(f.service.read(access, "broken").log.some((line) => line.text === "Before failure"));
  assert.equal(f.service.snapshot(access).problem, null);
});

test("view packages are copied globally; a missing frame stays local to its app", { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const client = 'import { createRoot } from "react-dom/client"; import { useAppState } from "@ragents/client"; function App() { const state = useAppState(); return <p>{state.count ?? 0}</p>; } const root = document.getElementById("root"); if (!root) throw new Error("Missing root"); createRoot(root).render(<App />);';
  const viewed = { ...files(count), "package.json": JSON.stringify({ name: "source", private: true, type: "module", ragents: { title: "Global counter", backend: "src/server.ts", views: [{ id: "main", client: "src/client.tsx" }] } }), "src/client.tsx": client };
  await writeAppFiles(path.join(f.directory, f.caller.runId), "source", viewed);
  for (const name of ["broken-view", "healthy-view"]) await f.service.register(access, f.caller, { name, description: "A global view", program: "source", permissions: {} });
  const runId = globalAppsRunId(null);
  const broken = f.service.read(access, "broken-view").app.views[0]!;
  const healthy = f.service.read(access, "healthy-view").app.views[0]!;
  assert.equal(f.service.view(access, "healthy-view", healthy.id).id, healthy.id);
  assert.throws(() => f.service.view(access, "healthy-view", broken.id), /does not belong/);
  const brokenProgram = f.programs.programs(runId).find((program) => program.name === "broken-view")!;
  await rm(path.join(brokenProgram.directory, brokenProgram.views[0]!.clientFile));
  await f.restart();
  assert.throws(() => f.service.view(access, "broken-view", broken.id), /ENOENT/);
  assert.equal(f.service.view(access, "healthy-view", healthy.id).id, healthy.id);
  assert.equal(f.service.snapshot(access).problem, null);
  f.scheduler.start();
  await f.service.run(access, "healthy-view");
  await f.settled("completed", "healthy-view");
  assert.equal((f.service.view(access, "healthy-view", healthy.id).state.values as { count: number }).count, 1);
});

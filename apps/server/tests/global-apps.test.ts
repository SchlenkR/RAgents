import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createAccessContext, defineRunFunction, defineToolAvailability, OperationContributionRegistry, type AccessContext, type JsonValue, type RunFunction } from "@ragents/engine";
import { allGrants } from "../../../packages/ragents/tests/support.ts";
import { globalAppsFunctions } from "../../../plugins/ragents.global-apps/server/functions.ts";
import { GlobalAppsService } from "../../../plugins/ragents.global-apps/server/service.ts";
import { globalAppsSnapshotSchema } from "../../../plugins/ragents.global-apps/contract.ts";
import { coordinatorRunId, isCoordinatorRunId } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { coordinatorNotifications } from "../../../plugins/ragents.overseer/server/notify.ts";
import { runListing } from "../../../plugins/ragents.overseer/server/run-list.ts";
import type { ListedSession } from "../src/chat-handler.ts";
import type { RunManagement } from "../src/ragents/global-chat.ts";
import { invocationResult } from "./actor-runtime-fixture.ts";
import { count, openAccess, programFiles, triggerFixture, until, type TriggerFixtureOptions } from "./program-triggers-fixture.ts";

const G = coordinatorRunId(null);
const app = (name = "check") => `${name}.${name}`;

const globalFixture = async (t: TestContext, options: TriggerFixtureOptions & { readonly extraTools?: (access: () => AccessContext) => readonly RunFunction[] } = {}) => {
  let service: GlobalAppsService;
  let access: AccessContext = openAccess;
  const tools = () => [...globalAppsFunctions(service, () => access).tools({} as never) as RunFunction[], ...options.extraTools?.(() => access) ?? []];
  const f = await triggerFixture(t, { ...options, tools });
  const create = () => new GlobalAppsService({
    runtime: () => f.setup.runtime, programs: f.programs, userAccess: () => access,
    globalRunIdFor: coordinatorRunId,
    isGlobalRun: isCoordinatorRunId,
    ensureGlobalRun: async (userAccess: AccessContext) => {
      const runId = coordinatorRunId(userAccess.user?.id ?? null);
      if (!f.setup.runtime.listRuns().some((run) => run.id === runId)) {
        const view = f.setup.runtime.createRun({ commandId: `global-space:${runId}` }, { runId, title: "Global coordinator", ownerHandle: "owner", ownerDisplayName: "Owner" });
        const created = f.setup.runtime.spawnAgent({ actorId: view.ownerId, commandId: "global-coordinator" }, runId, { handle: "coordinator", displayName: "Coordinator", prompt: "Coordinate", execution: f.setup.agent.execution, grants: allGrants(), toolNames: null });
        f.setup.runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "global-primary" }, runId, created.actors.find((actor) => actor.kind === "agent")!.id);
      }
      return runId;
    },
    ensureRun: (runId: string) => { f.setup.runtime.state(runId); },
    interrupt: f.interrupt,
  });
  service = create();
  service.ready();
  t.after(() => service.shutdown());
  const caller = { runId: f.runId, actorId: f.setup.agent.id, turnId: null };
  const restartPrograms = f.restart;
  const extended = Object.assign(f, {
    caller,
    setAccess: (value: AccessContext) => { access = value; },
    create: async (body = count, ragents: Record<string, unknown> = {}, capabilities: readonly string[] = [], name = "check") => {
      await f.write("source", programFiles(body, ragents, capabilities));
      return service.create(access, caller, { name, program: "source" });
    },
    restart: async () => { await service.shutdown(); await restartPrograms(); service = create(); service.ready(); },
  });
  return Object.defineProperty(extended, "service", { get: () => service }) as typeof extended & { readonly service: GlobalAppsService };
};

test("creation copies the package into its own room of the global run, where a manual trigger runs it and its state survives a restart", { timeout: 60000 }, async (t) => {
  const f = await globalFixture(t);
  assert.deepEqual(await f.create(), { program: app() });
  const global = f.setup.runtime.view(G);
  assert.equal(global.actors.find((actor) => actor.id === global.primaryActorId)?.kind, "agent");
  const actorId = f.actorOf(app(), G);
  assert.equal(global.actors.find((actor) => actor.id === actorId)?.room, "check");
  assert.equal(global.rooms[0]?.origin, null);
  assert.equal(f.setup.runtime.listRuns().length, 2, "source and coordinator are the only runs");
  const listed = f.service.list(openAccess);
  assert.deepEqual(listed.apps.map(({ name, program, input, status }) => ({ name, program, input, status })), [{ name: "check", program: app(), input: true, status: "ready" }]);
  assert.equal(Value.Check(globalAppsSnapshotSchema, f.service.snapshot(openAccess)), true);
  assert.deepEqual(f.service.named(openAccess), [{ name: "check", runId: G, actorId }], "displays in runs address the app by its name");
  assert.deepEqual(f.service.named(createAccessContext({ enabled: true, user: { id: "reader", label: "Reader", rights: ["runs.read"] } })), [], "without the read right no app is named");
  await f.trigger(app(), G);
  await assert.rejects(f.trigger(app(), G), /already has an accepted/);
  f.scheduler.start();
  await f.settled(app(), "completed", G);
  const state = f.state(app(), G);
  assert.equal(state.count, 1);
  assert.notEqual(state.pid, process.pid);
  assert.match(state.key!, new RegExp(`:${actorId}:1$`));
  assert.equal((await f.status(app(), G)).sandbox, "disabled", "a global app is an isolated package");
  await f.restart();
  assert.deepEqual(f.state(app(), G), state);
  assert.equal(f.setup.runtime.listRuns().filter((run) => run.id === G).length, 1);
  await f.trigger(app(), G);
  await until(() => f.state(app(), G).count === 2);
});

test("an app's triggers come from its package and removal ends them while the journal stays", { timeout: 60000 }, async (t) => {
  const f = await globalFixture(t);
  await f.create(count, { triggers: { interval: { everySeconds: 60 } } });
  await until(() => f.service.list(openAccess).apps[0]?.nextRunAt !== null);
  assert.deepEqual(f.service.list(openAccess).apps[0]?.triggers, { interval: { everySeconds: 60 } });
  f.scheduler.start();
  f.advance(60000);
  await until(() => f.state(app(), G).count === 1);
  await f.settled(app(), "completed", G);
  assert.deepEqual(f.state(app(), G).reasons, ["interval"]);
  assert.deepEqual(await f.service.remove(openAccess, "check"), { removed: true });
  assert.deepEqual(f.service.list(openAccess), { apps: [], errors: [], hasMore: false });
  assert.deepEqual(f.programs.programs(G), []);
  f.advance(600000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.inputs(G), 1);
  assert.ok(f.setup.runtime.events(G).length > 0);
});

test("an explicitly declared notification reaches the current coordinator after its replacement", { timeout: 60000 }, async (t) => {
  const notifications = (access: () => AccessContext) => coordinatorNotifications(() => f.setup.runtime, access).tools({} as never) as RunFunction[];
  const f = await globalFixture(t, { extraTools: notifications });
  await f.create(`${count} await context.functions.overseer_notify({ message: "Today is the test date." });`, {}, ["overseer_notify"]);
  const before = f.setup.runtime.view(G);
  f.setup.runtime.stopActors({ actorId: before.ownerId, commandId: "stop-old-coordinator" }, G, [before.primaryActorId!], "Reset");
  const spawned = f.setup.runtime.spawnAgent({ actorId: before.ownerId, commandId: "new-coordinator" }, G, { handle: "coordinator", displayName: "Coordinator", prompt: "Fresh", execution: f.setup.agent.execution, grants: allGrants(), toolNames: null });
  const replacement = spawned.actors.find((actor) => actor.kind === "agent" && actor.lifecycle.kind !== "stopped")!;
  f.setup.runtime.selectPrimaryActor({ actorId: before.ownerId, commandId: "new-primary" }, G, replacement.id);
  await f.trigger(app(), G);
  f.scheduler.start();
  await f.settled(app(), "completed", G);
  const notification = f.setup.runtime.view(G).inputs.find((input) => input.content === "Today is the test date.");
  assert.equal(notification?.actorId, replacement.id);
  assert.equal(notification?.enqueuedBy, f.actorOf(app(), G));
  const restricted = await globalFixture(t, { extraTools: notifications, grants: allGrants().map((grant) => grant.capability === "actor.input" ? { ...grant, delegable: false } : grant) });
  await assert.rejects(restricted.create(count, {}, ["overseer_notify"]), /capability overseer_notify is not available/i);
});

const listed = (id: string, title: string, updatedAt: number, state: ListedSession["state"]): ListedSession =>
  ({ id, title, updatedAt, state, running: state === "running", pendingActions: 0, workspaceAccessible: true, operable: true });

const latestRunApp = {
  "package.json": JSON.stringify({ name: "source", private: true, type: "module", ragents: {
    title: "Latest run", backend: "src/server.ts", views: [{ id: "main", client: "src/client.tsx" }], triggers: { interval: { everySeconds: 60 } },
  } }),
  "src/server.ts": `import { Type } from "typebox";
import { defineActor } from "@ragents/server";

const run = Type.Object({ title: Type.String(), status: Type.String(), lastActivity: Type.String() });

export default defineActor({
  state: Type.Object({ latest: Type.Optional(Type.Union([run, Type.Null()])) }),
  functions: {},
  input: { capabilities: ["run_list"] },
}, {
  functions: {},
  onInput: async (_input, context) => {
    const { runs } = await context.functions.run_list({ limit: 1 });
    context.state.replace({ latest: runs[0] ?? null });
  },
});`,
  "src/client.tsx": `import { createRoot } from "react-dom/client";
import { useAppState } from "@ragents/client";

function App() {
  const { latest } = useAppState();
  return <main>{latest ? <p>{latest.title}: {latest.status} since {latest.lastActivity}</p> : <p>No run yet.</p>}</main>;
}

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);`,
};

test("a global app that always shows the latest run reads run_list on its interval", { timeout: 60000 }, async (t) => {
  let runs = [listed("run-b", "Report", Date.parse("2026-08-16T11:00:00.000Z"), "running"), listed("run-a", "Notes", Date.parse("2026-08-16T10:00:00.000Z"), "idle")];
  const askedWith: AccessContext[] = [];
  const management = { list: async (access?: AccessContext) => { askedWith.push(access!); return runs; } } as Pick<RunManagement, "list"> as RunManagement;
  const tools = (access: () => AccessContext) => runListing(() => management, () => access()).tools({} as never) as RunFunction[];
  const f = await globalFixture(t, { extraTools: tools });
  await f.write("source", latestRunApp);
  assert.deepEqual(await f.service.create(openAccess, f.caller, { name: "latest-run", program: "source" }), { program: app("latest-run") });
  const latest = () => (f.programs.data(G, f.actorOf(app("latest-run"), G)).values as { latest?: unknown }).latest;
  f.scheduler.start();
  await f.trigger(app("latest-run"), G);
  await f.settled(app("latest-run"), "completed", G);
  assert.deepEqual(latest(), { title: "Report", status: "running", lastActivity: "2026-08-16T11:00:00.000Z" });
  runs = [listed("run-c", "Release", Date.parse("2026-08-16T12:00:30.000Z"), "waiting"), ...runs];
  f.advance(60000);
  await until(() => (latest() as { title?: string } | null)?.title === "Release");
  assert.ok(askedWith.length >= 2 && askedWith.every((access) => access === openAccess), "the list is always the one of the global space's owner");
  const [runList] = tools(() => openAccess);
  const coordinator = f.setup.runtime.view(G).actors.find((actor) => actor.kind === "agent")!;
  assert.equal(runList!.available(coordinator, f.setup.runtime.view(G)), true);
  assert.equal(runList!.available(f.setup.view.actors.find((actor) => actor.id === f.setup.agent.id)!, f.setup.runtime.view(f.runId)), false, "not in an ordinary run");
  const result = await runList!.run({ caller: { runId: G, actorId: coordinator.id, turnId: null } } as never, "list", { limit: 2 } as never);
  assert.deepEqual(result, { runs: [{ title: "Release", status: "waiting", lastActivity: "2026-08-16T12:00:30.000Z" }, { title: "Report", status: "running", lastActivity: "2026-08-16T11:00:00.000Z" }], hasMore: true });
  assert.doesNotMatch(JSON.stringify(result), /run-[abc]/, "no identifier for a model to copy");
  await assert.rejects(runList!.run({ caller: { runId: f.runId, actorId: f.setup.agent.id, turnId: null } } as never, "list", {} as never), /only in your own global space/);
});

test("an app may not declare isolation-breaking tools, and the global app tools stay with agents", { timeout: 60000 }, async (t) => {
  const f = await globalFixture(t);
  await assert.rejects(f.create(count, {}, ["typescript_eval"]), /isolated package may not declare typescript_eval/);
  await assert.rejects(f.create(count, {}, ["read", "bash"]), /isolated package may not declare read, bash/);
  await assert.rejects(f.create(count, {}, ["global_app_create"]), /capability global_app_create is not available/i);
  await f.create();
  const view = f.setup.runtime.view(G);
  const script = view.actors.find((actor) => actor.id === f.actorOf(app(), G))!;
  const tools = globalAppsFunctions(f.service, () => openAccess).tools({} as never) as RunFunction[];
  assert.equal(tools.find((tool) => tool.name === "global_app_create")!.available(script, view), false);
  assert.equal(tools.find((tool) => tool.name === "global_app_create")!.available(f.setup.view.actors.find((actor) => actor.id === f.setup.agent.id)!, f.setup.runtime.view(f.runId)), true);
});

test("copied view actions use the app's grants and capability-bearing tools cannot borrow a different actor", { timeout: 60000 }, async (t) => {
  const schema = Type.Object({});
  const tool = defineRunFunction({ name: "test_action", label: "Test action", description: "Test an app action.", schema, resultSchema: Type.String(), available: defineToolAvailability({ availability: "always", availabilityDetail: "Always available." }, () => true), run: () => "unused" });
  const operations = new OperationContributionRegistry();
  const principals: string[] = [];
  operations.register("test", [{ id: tool.name, label: tool.label, description: tool.description, schema, resultSchema: Type.String(), operator: "direct", execute: async (context) => {
    assert.equal(context.principal.kind, "agent");
    principals.push(context.principal.actorId);
    return "App action";
  } }]);
  const f = await globalFixture(t, { extraTools: () => [tool], operations });
  const sources = programFiles(count);
  const fn = 'action: { label: "Action", input: Type.Object({}), output: Type.String(), capabilities: ["test_action"], tool: { name: "app_action", targets: ["@coordinator"] } }';
  const implementation = 'action: async (_input, context) => context.functions.test_action({})';
  const server = sources["src/server.ts"].replace('functions: {}, input:', `functions: { ${fn} }, input:`).replace('functions: {}, onInput:', `functions: { ${implementation} }, onInput:`);
  await f.write("source", { ...sources, "src/server.ts": server });
  await f.service.create(openAccess, f.caller, { name: "check", program: "source" });
  const program = f.programs.programs(G)[0]!;
  assert.equal(program.capabilitiesAsActor, true);
  const started = f.programs.startFunctionInvocation(G, program.actorHandle, program.revision, "action", "action-1", {});
  const completed = await invocationResult(f.programs, G, program.actorHandle, started.id);
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  assert.deepEqual(principals, [program.actorId]);
  const view = f.setup.runtime.view(G);
  const actor = view.actors.find((entry) => entry.id === view.primaryActorId)!;
  const published = f.programs.installedTools({ runId: G, view, actorId: actor.id, actor } as never).find((entry) => entry.name === "app_action")!;
  assert.ok(published);
  await assert.rejects(published.run({ caller: { runId: G, actorId: actor.id, turnId: null }, signal: undefined } as never, "foreign-call", {}), /require the app actor/);
});

test("current owner rights bound app management, and the app actor gets only delegated workspace grants", { timeout: 60000 }, async (t) => {
  const f = await globalFixture(t);
  await f.create();
  const limited = createAccessContext({ enabled: false, user: { id: "guest", label: "Guest", rights: ["runs.read", "ragents.global-apps.read"] } });
  await assert.rejects(f.service.create(limited, f.caller, { name: "other", program: "source" }), /Missing permission/);
  await assert.rejects(f.service.remove(limited, "check"), /Missing permission/);
  assert.deepEqual(f.service.list(limited), { apps: [], errors: [], hasMore: false });
  const foreign = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["*"] } });
  await assert.rejects(f.service.create(foreign, f.caller, { name: "foreign", program: "source" }), /package must belong to your user/);
  const scoped = await globalFixture(t, { grants: [
    ...allGrants().map((grant) => grant.capability === "workspace.use" ? { ...grant, usable: false } : grant),
    { capability: "workspace.use", scope: { kind: "workspace", path: "/home/user/allowed" }, usable: true, delegable: true },
  ] });
  await scoped.create();
  const appActor = scoped.setup.runtime.view(G).actors.find((actor) => actor.kind === "script")!;
  const workspaceGrants = appActor.grants.filter((grant) => grant.capability === "workspace.use");
  assert.equal(workspaceGrants.length, 1);
  assert.deepEqual(workspaceGrants[0]!.scope, { kind: "workspace", path: "/home/user/allowed" });
});

test("a failed build reports its cause and never prevents another app or a restart", { timeout: 60000 }, async (t) => {
  const f = await globalFixture(t);
  await assert.rejects(f.create('const invalid: number = "bad";', {}, [], "broken"), /TS2322/);
  assert.deepEqual(f.service.list(openAccess), { apps: [], errors: [], hasMore: false });
  await f.create(count, {}, [], "healthy");
  await f.restart();
  assert.equal(f.service.snapshot(openAccess).problem, null);
  f.scheduler.start();
  await f.trigger(app("healthy"), G);
  await f.settled(app("healthy"), "completed", G);
  await f.create('const invalid: number = "bad";', {}, [], "healthy").catch(() => undefined);
  assert.equal(f.service.list(openAccess).apps[0]?.status, "ready", "a failed replacement keeps the previous package");
});

test("damaged records and inactive programs are errors of their own while healthy apps still run", { timeout: 60000 }, async (t) => {
  const f = await globalFixture(t);
  await f.create(count, {}, [], "broken");
  await f.create(count, {}, [], "healthy");
  await f.create(count, {}, [], "stopped");
  const stored = f.setup.runtime.view(G).pluginStates.find((entry) => entry.pluginId === "ragents.global-apps" && entry.scope.kind === "actor" && (entry.state as { app?: string }).app === "broken")!;
  f.setup.runtime.replacePluginState(f.ownerContext(G), G, { pluginId: stored.pluginId, scope: stored.scope, state: { definition: { name: "broken" }, version: 1 } as JsonValue });
  await f.programs.remove(f.ownerContext(G), G, app("stopped"));
  await f.restart();
  const snapshot = f.service.snapshot(openAccess);
  assert.equal(snapshot.problem, null);
  assert.deepEqual(snapshot.apps.map((entry) => entry.name), ["healthy"]);
  assert.deepEqual(snapshot.errors.map((error) => [error.name, /damaged/.test(error.problem) ? "damaged" : /not active/.test(error.problem) ? "inactive" : error.problem]), [["broken", "damaged"], ["stopped", "inactive"]]);
  assert.equal(new Set(snapshot.errors.map((error) => error.id)).size, snapshot.errors.length);
  f.scheduler.start();
  await f.trigger(app("healthy"), G);
  await f.settled(app("healthy"), "completed", G);
  await f.service.remove(openAccess, "broken");
  await f.service.remove(openAccess, "stopped");
  assert.deepEqual(f.service.snapshot(openAccess).errors, []);
  assert.deepEqual(f.programs.programs(G).map((program) => program.name), [app("healthy")]);
});

test("view packages are copied globally; a missing frame stays local to its app", { timeout: 60000 }, async (t) => {
  const f = await globalFixture(t);
  const client = 'import { createRoot } from "react-dom/client"; import { useAppState } from "@ragents/client"; function App() { const state = useAppState(); return <p>{state.count ?? 0}</p>; } const root = document.getElementById("root"); if (!root) throw new Error("Missing root"); createRoot(root).render(<App />);';
  await f.write("source", { ...programFiles(count, { title: "Global counter", views: [{ id: "main", client: "src/client.tsx" }] }), "src/client.tsx": client });
  for (const name of ["broken-view", "healthy-view"]) await f.service.create(openAccess, f.caller, { name, program: "source" });
  const apps = f.service.list(openAccess).apps;
  const broken = apps.find((entry) => entry.name === "broken-view")!.views[0]!;
  const healthy = apps.find((entry) => entry.name === "healthy-view")!;
  assert.equal(f.programs.apps(G, healthy.actorId)[0]!.id, healthy.views[0]!.id);
  assert.equal(f.programs.apps(G, healthy.actorId).some((entry) => entry.id === broken.id), false);
  const brokenProgram = f.programs.programs(G).find((program) => program.name === app("broken-view"))!;
  await rm(path.join(brokenProgram.directory, brokenProgram.views[0]!.clientFile));
  await f.restart();
  assert.throws(() => f.programs.frame(G, broken.id, broken.revision), /ENOENT/);
  assert.equal(f.programs.apps(G, healthy.actorId)[0]!.id, healthy.views[0]!.id);
  assert.equal(f.service.snapshot(openAccess).problem, null);
  f.scheduler.start();
  await f.trigger(app("healthy-view"), G);
  await f.settled(app("healthy-view"), "completed", G);
  assert.equal((f.programs.apps(G, healthy.actorId)[0]!.state.values as { count: number }).count, 1);
});

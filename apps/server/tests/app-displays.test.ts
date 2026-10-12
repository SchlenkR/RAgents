import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Value } from "typebox/value";
import { ChannelContributionRegistry, createAccessContext, DomainError, MethodContributionRegistry, RPC_METHODS, RpcPeer, type AccessContext, type JsonValue, type RunFunction } from "@ragents/engine";
import { assertRunAccess, assertRunRights, runIdInPath, runReachable, runVisible, type RunAccessPolicy } from "../src/api/rights.ts";
import { runOwnerOf, runSharingOf } from "../src/ragents/run-owner.ts";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import type { NamedAppSource } from "../src/plugin-support/actor-programs/service.ts";
import { APP_DISPLAYS_STATE_ID, appDisplayContracts, appDisplaySnapshotSchema, type AppDisplaySnapshot } from "../../../plugins/ragents.actor-programs/contract.ts";
import { AppDisplays, appDisplaysProjection, createAppDisplayChannel, createAppDisplayMethods, createAppDisplayTools } from "../../../plugins/ragents.actor-programs/server/displays.ts";
import { createActorProgramMethods } from "../../../plugins/ragents.actor-programs/server/methods.ts";
import { miniAppsApiPrefix } from "../../../plugins/ragents.actor-programs/server/routes.ts";
import { invocationResult } from "./actor-runtime-fixture.ts";
import { triggerFixture, until } from "./program-triggers-fixture.ts";

const SOURCE = "source-run";
const DISPLAY = "display-run";
const VIEW = "board--main";
const rights = ["runs.read", "runs.write"];
const alice = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights } });
const bob = createAccessContext({ enabled: true, user: { id: "bob", label: "Bob", rights } });
const admin = createAccessContext({ enabled: true, user: { id: "root", label: "Root", rights: ["*"] } });

const boardFiles = {
  "package.json": JSON.stringify({ name: "board", private: true, type: "module", ragents: { title: "Board", backend: "src/server.ts",
    views: [{ id: "main", title: "Board", client: "src/client.tsx" }, { id: "detail", title: "Details", client: "src/client.tsx" }] } }),
  "src/server.ts": `import { Type } from "typebox";
import { defineActor } from "@ragents/server";
export default defineActor({
  state: Type.Object({ count: Type.Optional(Type.Integer()) }),
  functions: { add: { label: "Add", input: Type.Object({}), output: Type.Integer(), capabilities: [] } },
}, { functions: { add(_input, context) {
  const count = (context.state.read().count ?? 0) + 1;
  context.state.replace({ count });
  return count;
} } });`,
  "src/client.tsx": 'document.body.dataset.board = "ready"; export {};',
};

/** Alice owns the app's run and the displaying run, which she shares with Bob for reading. */
const displayFixture = async (t: TestContext, persistent = false) => {
  const f = await triggerFixture(t, { persistent });
  const create = (runId: string, title: string, shared: boolean) => f.setup.runtime.createRun({ commandId: `create-${runId}` }, {
    runId, title, ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice", ...shared ? { sharing: { everyone: null, users: [{ userId: "bob", access: "read" as const }] } } : {},
  });
  create(SOURCE, "Planning", false);
  create(DISPLAY, "Workflow", true);
  await f.activate("board", boardFiles, SOURCE);
  const policy = (): RunAccessPolicy => ({ global: undefined, ownerOf: (runId) => runOwnerOf(f.setup.journal, runId), ownerOnly: () => false, sharing: (runId) => runSharingOf(f.setup.journal, runId) });
  const deleted = new Set<string>();
  const sources: NamedAppSource[] = [];
  const open = () => {
    const displays = new AppDisplays({
      runtime: () => f.setup.runtime,
      programs: { programs: (runId) => f.programs.programs(runId), apps: (runId, actorId) => f.programs.apps(runId, actorId), namedAppSources: () => sources },
      readable: (access, runId) => {
        assertRunRights(access, runId, "read", policy());
        if (deleted.has(runId)) throw new DomainError("run-deleting", "The run is being deleted", 409);
      },
      runs: async (access) => f.setup.runtime.listRuns().filter((run) => runVisible(access, run.id, policy())).map(({ id, title }) => ({ id, title })),
      ownerAccess: () => alice,
    });
    t.after(() => displays.shutdown());
    return displays;
  };
  const displays = open();
  /** A client of the real message layer: rights and the displaying run are checked as on the server. */
  const client = (access: AccessContext) => {
    const methods = new MethodContributionRegistry();
    methods.register("ragents.actor-programs", [...createActorProgramMethods({ ensureSession: () => undefined, runtime: f.programs }), ...createAppDisplayMethods(displays)]);
    const channels = new ChannelContributionRegistry();
    channels.register("ragents.actor-programs", [createAppDisplayChannel(displays)]);
    const dispatcher = new RpcDispatcher({ methods, channels, assertRunReachable: (context, runId, operates) => assertRunAccess(context, runId, operates, policy()) });
    const received: AppDisplaySnapshot[] = [];
    const peer = new RpcPeer({ send: (message) => {
      const notification = message as { method?: string; params?: { message?: AppDisplaySnapshot } };
      if (notification.method === RPC_METHODS.event && notification.params?.message) received.push(notification.params.message);
    } });
    const connection = new RpcConnection({ id: `client-${access.user?.id}`, access, local: true, peer }, dispatcher);
    const call = (method: string, params: unknown) => dispatcher.dispatch(connection, method, params, { id: 1, signal: new AbortController().signal, progress: () => undefined });
    return {
      call, received,
      latest: () => received.at(-1),
      watch: (display: string) => call(RPC_METHODS.subscribe, { channel: appDisplayContracts.display.id, params: { runId: DISPLAY, display } }),
    };
  };
  const pluginStateEvents = (runId: string) => f.setup.runtime.events(runId).filter((event) => event.type === "plugin.state-replaced" && event.payload.pluginId === APP_DISPLAYS_STATE_ID);
  return { f, displays, open, client, sources, deleted, policy, pluginStateEvents };
};

const ready = (snapshot: AppDisplaySnapshot | undefined) => {
  assert.equal(snapshot?.status, "ready", JSON.stringify(snapshot));
  return snapshot as Extract<AppDisplaySnapshot, { status: "ready" }>;
};
const failure = (error: unknown): string => error instanceof DomainError ? error.code : String(error);

test("a display is an event of the displaying run that replay restores, and its removal is journaled too", { timeout: 120000 }, async (t) => {
  const { f, displays, open, pluginStateEvents } = await displayFixture(t, true);
  const added = await displays.add(alice, DISPLAY, { runId: SOURCE, view: VIEW });
  assert.match(added.elementId, /^display-[a-f0-9]{12}$/);
  assert.equal(pluginStateEvents(DISPLAY).length, 1);
  assert.deepEqual(await displays.add(alice, DISPLAY, { runId: SOURCE, view: VIEW }), added, "showing the same view again returns its display");
  assert.equal(pluginStateEvents(DISPLAY).length, 1);
  assert.equal(pluginStateEvents(SOURCE).length, 0, "the app's run is not touched");
  const pinned = displays.displays(DISPLAY);
  assert.deepEqual(pinned.map(({ title, from, source }) => ({ title, from, source })), [{ title: "Board", from: 'Run "Planning"', source: { runId: SOURCE, actorId: f.actorOf("board", SOURCE), view: "main" } }]);
  await f.reopen();
  const restarted = open();
  assert.deepEqual(restarted.displays(DISPLAY), pinned);
  assert.equal(ready(restarted.snapshot(alice, DISPLAY, pinned[0]!.id)).app.id, VIEW);
  assert.deepEqual(restarted.remove(DISPLAY, pinned[0]!.id), {});
  assert.equal(pluginStateEvents(DISPLAY).length, 2);
  assert.deepEqual(restarted.snapshot(alice, DISPLAY, pinned[0]!.id), { status: "removed", title: "App display", from: null, message: "This display was removed from the run." });
  await f.reopen();
  assert.deepEqual(open().displays(DISPLAY), []);
  await assert.rejects(Promise.resolve().then(() => restarted.remove(DISPLAY, pinned[0]!.id)), (error: unknown) => failure(error) === "app-display-not-found");
});

test("every viewer is checked against the app's run on every subscription and change, and a display runs nothing", { timeout: 120000 }, async (t) => {
  const { f, displays, client, deleted, policy } = await displayFixture(t);
  const owner = client(alice);
  const { elementId } = await owner.call(appDisplayContracts.add.id, { runId: DISPLAY, source: { runId: SOURCE, view: VIEW } }) as { elementId: string };
  const id = elementId.slice("display-".length);

  await t.test("the owner sees the live state of the app, without functions or calls", async () => {
    await owner.watch(id);
    await until(() => owner.latest() !== undefined);
    const first = ready(owner.latest());
    assert.ok(Value.Check(appDisplaySnapshotSchema, first));
    assert.deepEqual(first.app.actions, []);
    assert.deepEqual(first.app.invocations, []);
    assert.equal(first.runId, SOURCE);
    assert.equal(first.from, 'Run "Planning"');
    const program = f.programs.programs(SOURCE).find((entry) => entry.name === "board")!;
    const invocation = f.programs.startInvocation(SOURCE, VIEW, program.revision, "add", "in-source", {});
    assert.equal((await invocationResult(f.programs, SOURCE, VIEW, invocation.id)).status, "succeeded");
    await until(() => (owner.latest() as Extract<AppDisplaySnapshot, { status: "ready" }>).app.state.values.count === 1, "The display did not follow the app's state.");
    assert.deepEqual(ready(owner.latest()).app.invocations, [], "the app's calls stay in its own run");
  });

  await t.test("the displaying run offers no path to the app's functions or frame", async () => {
    const revision = f.programs.programs(SOURCE).find((entry) => entry.name === "board")!.revision;
    await assert.rejects(owner.call("ragents.actor-programs.action", { runId: DISPLAY, appId: VIEW, revision, actionId: "add", requestId: "through-display", input: {} }),
      (error: unknown) => failure(error) === "action-rejected" && /not active/.test((error as Error).message));
    assert.throws(() => f.programs.frame(DISPLAY, VIEW, revision), /not active/);
    assert.equal(f.programs.data(SOURCE, f.actorOf("board", SOURCE)).values.count, 1);
    const frame = `${miniAppsApiPrefix}/runs/${SOURCE}/apps/${VIEW}/frame`;
    assert.equal(runIdInPath(frame), SOURCE, "the frame names the app's run, so every load checks the viewer against it");
    assert.equal(runReachable(bob, SOURCE, policy()), false);
  });

  await t.test("a reader of the shared run who cannot read the app's run learns only that it is not available", async () => {
    const reader = client(bob);
    await reader.watch(id);
    await until(() => reader.latest() !== undefined);
    assert.deepEqual(reader.latest(), { status: "denied", title: "Board", from: null, message: "This app is not available to you." });
    await assert.rejects(reader.call(appDisplayContracts.remove.id, { runId: DISPLAY, display: id }), (error: unknown) => failure(error) === "run-read-only");
    await assert.rejects(reader.call(appDisplayContracts.add.id, { runId: DISPLAY, source: { runId: SOURCE, view: VIEW } }), (error: unknown) => failure(error) === "run-read-only");
    assert.deepEqual(await reader.call(appDisplayContracts.sources.id, { runId: DISPLAY }), { groups: [] }, "nothing of the owner's runs is offered");
    const state = f.setup.runtime.view(DISPLAY).pluginStates.find((entry) => entry.pluginId === APP_DISPLAYS_STATE_ID)!;
    assert.deepEqual(appDisplaysProjection.state(state), { version: 1, displays: [{ id, title: "Board" }] }, "without runs.inspect the source stays on the server");
    const owner = f.setup.runtime.state(SOURCE).ownerId;
    f.setup.runtime.shareRun({ actorId: owner, commandId: "share-source" }, SOURCE, { sharing: { everyone: null, users: [{ userId: "bob", access: "read" }] }, changedBy: "alice" });
    await until(() => reader.latest()?.status === "ready", "Sharing the app's run did not reach the open display.");
    f.setup.runtime.shareRun({ actorId: owner, commandId: "unshare-source" }, SOURCE, { sharing: { everyone: null, users: [] }, changedBy: "alice" });
    await until(() => reader.latest()?.status === "denied", "Unsharing the app's run did not reach the open display.");
    const administrator = client(admin);
    await administrator.watch(id);
    await until(() => administrator.latest() !== undefined);
    ready(administrator.latest());
  });

  await t.test("the picker offers the owner's other runs, never the displaying run itself", async () => {
    const { groups } = await owner.call(appDisplayContracts.sources.id, { runId: DISPLAY }) as { groups: { label: string; apps: { title: string; detail: string | null; view: string; shown: boolean }[] }[] };
    assert.deepEqual(groups, [{ label: "Planning", apps: [
      { title: "Board", detail: null, runId: SOURCE, view: VIEW, shown: true },
      { title: "Details", detail: "Board", runId: SOURCE, view: "board--detail", shown: false },
    ] }]);
    await assert.rejects(owner.call(appDisplayContracts.add.id, { runId: SOURCE, source: { runId: SOURCE, view: VIEW } }), (error: unknown) => failure(error) === "app-display-own-run");
  });

  await t.test("a removed app and a deleted run say so in the window, and the displaying run stays usable", async () => {
    await f.programs.remove(f.ownerContext(SOURCE), SOURCE, "board");
    await until(() => owner.latest()?.status === "removed");
    assert.deepEqual(owner.latest(), { status: "removed", title: "Board", from: 'Run "Planning"', message: "The app was removed from its run." });
    deleted.add(SOURCE);
    displays.deleted(SOURCE);
    await until(() => (owner.latest() as { message?: string }).message === "The app's run was deleted.");
    f.setup.runtime.replacePluginState(f.ownerContext(DISPLAY), DISPLAY, { pluginId: APP_DISPLAYS_STATE_ID, scope: { kind: "run" }, state: { version: 1, displays: [{ id: "damaged" }] } as JsonValue });
    await until(() => owner.latest()?.status === "failed");
    assert.match((owner.latest() as { message: string }).message, /damaged/);
    assert.equal(f.setup.runtime.view(DISPLAY).id, DISPLAY, "the run itself stays readable");
    await assert.rejects(owner.call(appDisplayContracts.sources.id, { runId: DISPLAY }), /damaged/);
  });
});

test("agents show and remove a named app by its name, never by an ID, with lean results", { timeout: 120000 }, async (t) => {
  const { f, displays, sources } = await displayFixture(t);
  const actorId = f.actorOf("board", SOURCE);
  const tools = createAppDisplayTools(displays, () => sources.length > 0).tools({} as never) as RunFunction[];
  const agent = f.setup.agent;
  const call = (name: string, input: Record<string, unknown>) => tools.find((tool) => tool.name === name)!.run({ caller: { runId: DISPLAY, actorId: agent.id, turnId: null } } as never, "call", input as never);
  assert.equal(tools[0]!.available(agent as never, f.setup.runtime.view(DISPLAY)), false, "without a plugin that names apps there is nothing to address");
  sources.push({ label: "Global apps", apps: (access) => access.user?.id === "alice" ? [{ name: "board", runId: SOURCE, actorId }] : [] });
  assert.equal(tools[0]!.available(agent as never, f.setup.runtime.view(DISPLAY)), true);
  await assert.rejects(Promise.resolve().then(() => call("app_display_add", { app: "chart" })), /chart is no named app. Named apps: board\./);
  await assert.rejects(Promise.resolve().then(() => call("app_display_add", { app: "board" })), /Name one view of board: main, detail\./);
  assert.equal(await call("app_display_add", { app: "board", view: "Details" }), null);
  assert.equal(await call("app_display_add", { app: "Board", view: "detail" }), null, "a second request for the same view changes nothing");
  assert.deepEqual(displays.displays(DISPLAY).map(({ title, from, name, source }) => ({ title, from, name, view: source.view })), [{ title: "Details", from: "Global apps: board", name: "board", view: "detail" }]);
  const programs = t.mock.method(f.programs, "programs");
  const { groups } = await displays.sources(alice, DISPLAY);
  assert.equal(programs.mock.calls.filter((call) => call.arguments[0] === SOURCE).length, 1);
  programs.mock.restore();
  assert.deepEqual(groups[0], { label: "Global apps", apps: [
    { title: "Board", detail: "board", runId: SOURCE, view: VIEW, shown: false },
    { title: "Details", detail: "board", runId: SOURCE, view: "board--detail", shown: true },
  ] });
  await assert.rejects(Promise.resolve().then(() => call("app_display_remove", { app: "chart" })), /This run shows no display of chart\. Named apps shown: board\./);
  assert.equal(await call("app_display_remove", { app: "board" }), null);
  assert.deepEqual(displays.displays(DISPLAY), []);
});

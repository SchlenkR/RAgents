import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { Type } from "typebox";
import {
  ChannelContributionRegistry,
  DomainError,
  MethodContributionRegistry,
  PluginHost,
  RPC_METHODS,
  RpcPeer,
  createAccessContext,
  defineChannel,
  defineOperation,
  implement,
  implementChannel,
  notShared,
  unrestrictedAccess,
  type AccessContext,
  type MethodContribution,
  type RunSharing,
} from "@ragents/engine";
import { runContracts } from "@ragents/engine/src/http/contracts";
import { plugin } from "../../../plugins/ragents.overseer/server/index.ts";
import { overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { coordinatorRunId, isCoordinatorRunId } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreChannels, coreMethods } from "../src/api/core-methods.ts";
import {
  assertRunAccess,
  assertRunDeletable,
  assertRunRights,
  assertRunWorkspaceAccess,
  runListScope,
  runReachable,
  runSharedAccess,
  runSharer,
  runVisible,
  type RunAccessPolicy,
} from "../src/api/rights.ts";
import { configuredUsers, loadConfigFile } from "../src/config-file.ts";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { runManagementToken, type RunManagement } from "../src/ragents/global-chat.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { sandboxServicesToken } from "../src/plugin-support/workspace-sandbox-host.ts";
import { checkedProfileSharing, sharingResultOf } from "../src/run-sharing.ts";
import { coreSources } from "./rpc-fixture.ts";

const root = await mkdtemp(path.join(tmpdir(), "ragents-run-sharing-"));
const dataDirectory = path.join(root, "data");
const operator = ["runs.read", "runs.write", "runs.create", "runs.inspect", "runs.delete", "ragents.overseer.read", "ragents.overseer.write"];
await writeFile(path.join(root, "ragents.config.sharing.ts"), `export const config = {};
export const users = [
  { id: "alice", label: "Alice", password: "alice-password", rights: ${JSON.stringify(operator)} },
  { id: "bob", label: "Bob", password: "bob-password", rights: ${JSON.stringify(operator)} },
  { id: "carol", label: "Carol", password: "carol-password", rights: ${JSON.stringify(operator)} },
  { id: "admin", label: "Admin", password: "admin-password", rights: ["*"] },
];
`);
process.env.DATA_DIR = dataDirectory;
process.env.PRODUCT_PROFILE = "sharing";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.COMPACTION_MODEL = "";
await loadConfigFile(root);
const { RunSessionProvider } = await import("../src/provider.ts");
after(() => rm(root, { recursive: true, force: true }));

const OWN = "own-run";
const READ = "read-run";
const WRITE = "write-run";
const EVERYONE = "everyone-run";
const BOUND = "bound-run";
const BOUND_READ = "bound-read-run";
const LEGACY = "legacy-run";
const FRESH = "fresh-run";

const sharings: Readonly<Record<string, RunSharing>> = {
  [READ]: { everyone: null, users: [{ userId: "bob", access: "read" }] },
  [WRITE]: { everyone: null, users: [{ userId: "bob", access: "write" }] },
  [EVERYONE]: { everyone: "read", users: [{ userId: "carol", access: "write" }] },
  [BOUND]: { everyone: "write", users: [] },
  [BOUND_READ]: { everyone: null, users: [{ userId: "bob", access: "read" }] },
};

const global = { isCoordinator: isCoordinatorRunId, runIdFor: coordinatorRunId, read: "ragents.overseer.read", write: "ragents.overseer.write" };

const policy: RunAccessPolicy = {
  global,
  ownerOf: (runId) => runId === LEGACY ? null : runId === FRESH ? undefined : "alice",
  ownerOnly: (runId) => runId === BOUND || runId === BOUND_READ,
  sharing: (runId) => sharings[runId] ?? notShared(),
};

const user = (id: string, rights: readonly string[]): AccessContext =>
  createAccessContext({ enabled: true, user: { id, label: id, rights: [...rights] } });

const alice = user("alice", operator);
const bob = user("bob", operator);
const carol = user("carol", operator);
const dave = user("dave", operator);
const admin = user("admin", ["*"]);
const reader = user("bob", ["runs.read"]);
const anonymous = createAccessContext({ enabled: false, user: { id: "anonymous", label: "Guest", rights: ["*"] } });

const code = (expected: string, status: number) => (error: unknown): boolean => {
  assert.ok(error instanceof DomainError, String(error));
  assert.deepEqual({ code: error.code, status: error.status }, { code: expected, status });
  return true;
};

test("a share makes a run visible to its users with the higher of everyone's and their own access", () => {
  assert.deepEqual([OWN, READ, WRITE, EVERYONE].map((runId) => runVisible(bob, runId, policy)), [false, true, true, true]);
  assert.deepEqual([OWN, READ, WRITE, EVERYONE].map((runId) => runVisible(carol, runId, policy)), [false, false, false, true]);
  assert.equal(runSharedAccess(bob, READ, policy), "read");
  assert.equal(runSharedAccess(bob, WRITE, policy), "write");
  assert.equal(runSharedAccess(carol, EVERYONE, policy), "write", "the own write beats everyone's read");
  assert.equal(runSharedAccess(dave, EVERYONE, policy), "read", "everyone means every user of the profile");
  assert.equal(runReachable(bob, OWN, policy), false, "an unshared run stays as unknown as before");
  for (const runId of [OWN, READ, EVERYONE]) {
    assert.equal(runSharedAccess(alice, runId, policy), undefined, "the owner holds the run, not a share");
    assert.equal(runSharedAccess(admin, runId, policy), undefined, "runs.read.all holds every run");
    assert.equal(runSharedAccess(anonymous, runId, policy), undefined, "without sign-in there is no share");
    assert.equal(runVisible(anonymous, runId, policy), true);
  }
});

test("a read share reads but never operates or stops; a write share operates as far as the user's rights go", () => {
  for (const kind of ["read", "inspect"] as const) assert.doesNotThrow(() => assertRunRights(bob, READ, kind, policy), kind);
  for (const kind of ["write", "write-inspect", "stop"] as const) assert.throws(() => assertRunRights(bob, READ, kind, policy), code("run-read-only", 403), kind);
  assert.throws(() => assertRunAccess(bob, READ, true, policy), code("run-read-only", 403));
  assert.doesNotThrow(() => assertRunAccess(bob, READ, false, policy));
  assert.doesNotThrow(() => assertRunWorkspaceAccess(bob, READ, policy), "the workspace of an ordinary run is readable");
  for (const kind of ["read", "inspect", "write", "write-inspect", "stop"] as const) assert.doesNotThrow(() => assertRunRights(bob, WRITE, kind, policy), kind);
  assert.doesNotThrow(() => assertRunRights(carol, EVERYONE, "write", policy));
  assert.throws(() => assertRunRights(dave, EVERYONE, "write", policy), code("run-read-only", 403));
  assert.throws(() => assertRunRights(reader, WRITE, "write", policy), code("access-denied", 403), "a share gives no rights the user lacks");
  assert.doesNotThrow(() => assertRunRights(admin, READ, "write", policy), "runs.read.all is not lowered by a share");
});

test("a run only its owner operates stays the owner's for sharees: write reads and stops, read only reads, the workspace stays closed", () => {
  for (const kind of ["read", "inspect", "stop"] as const) assert.doesNotThrow(() => assertRunRights(bob, BOUND, kind, policy), kind);
  assert.throws(() => assertRunRights(bob, BOUND, "write", policy), code("run-owner-only", 403));
  assert.throws(() => assertRunWorkspaceAccess(bob, BOUND, policy), code("run-workspace-owner-only", 403));
  assert.throws(() => assertRunRights(bob, BOUND_READ, "write", policy), code("run-read-only", 403), "the read share explains itself first");
  assert.throws(() => assertRunRights(bob, BOUND_READ, "stop", policy), code("run-read-only", 403));
  assert.doesNotThrow(() => assertRunRights(alice, BOUND, "write", policy));
});

test("only the owner and runs.read.all delete; a share never does, whatever rights it carries", () => {
  for (const access of [alice, admin, anonymous]) assert.doesNotThrow(() => assertRunDeletable(access, READ, policy));
  assert.throws(() => assertRunDeletable(bob, READ, policy), code("run-delete-denied", 403));
  assert.throws(() => assertRunDeletable(carol, EVERYONE, policy), code("run-delete-denied", 403));
  assert.doesNotThrow(() => assertRunDeletable(bob, FRESH, policy), "an id without a run keeps its earlier answer");
});

test("the owner and runs.read.all change the sharing, with sign-in only, never for a coordinator or a run without an owner", () => {
  assert.equal(runSharer(alice, READ, policy), "alice");
  assert.equal(runSharer(admin, READ, policy), "admin");
  assert.equal(runSharer(carol, FRESH, policy), "carol", "whoever creates the run under a free id owns it");
  assert.throws(() => runSharer(bob, WRITE, policy), code("run-sharing-denied", 403));
  assert.throws(() => runSharer(user("alice", ["runs.read"]), READ, policy), code("access-denied", 403));
  assert.throws(() => runSharer(anonymous, READ, policy), code("sharing-unavailable", 409));
  assert.throws(() => runSharer(unrestrictedAccess, READ, policy), code("sharing-unavailable", 409));
  assert.throws(() => runSharer(alice, coordinatorRunId("alice"), policy), code("run-not-shareable", 409));
  assert.throws(() => runSharer(admin, LEGACY, policy), code("run-not-shareable", 409));
});

test("the run list tells each caller what it may do with the sharing and what it operates", () => {
  const listed = (access: AccessContext, runId: string) => {
    const scope = runListScope(access, policy);
    return { operable: scope.operable(runId), ...scope.sharing(runId) };
  };
  assert.deepEqual(listed(alice, READ), { operable: true, canShare: true, shared: true });
  assert.deepEqual(listed(alice, OWN), { operable: true, canShare: true });
  assert.deepEqual(listed(admin, READ), { operable: true, canShare: true, shared: true });
  assert.deepEqual(listed(bob, READ), { operable: false, sharedAccess: "read" });
  assert.deepEqual(listed(bob, WRITE), { operable: true, sharedAccess: "write" });
  assert.deepEqual(listed(bob, BOUND), { operable: false, sharedAccess: "write" });
  assert.deepEqual(listed(anonymous, READ), { operable: true });
});

test("the sharing result names users with their labels and refuses users the profile does not have", () => {
  const users = [{ id: "alice", label: "Alice" }, { id: "bob", label: "Bob" }];
  const stale: RunSharing = { everyone: null, users: [{ userId: "gone", access: "read" }] };
  assert.deepEqual(sharingResultOf({ everyone: "read", users: [{ userId: "bob", access: "write" }, { userId: "gone", access: "read" }] }, "alice", users), {
    sharing: { everyone: "read", users: [{ userId: "bob", label: "Bob", access: "write" }, { userId: "gone", label: "gone", access: "read" }] },
    users: [{ id: "bob", label: "Bob" }],
  });
  assert.throws(() => checkedProfileSharing({ everyone: null, users: [{ userId: "zoe", access: "read" }] }, "alice", notShared(), users),
    (error: unknown) => code("share-user-unknown", 400)(error) && /users to share with: bob/.test((error as Error).message));
  assert.deepEqual(checkedProfileSharing(stale, "alice", stale, users), stale, "a user the profile lost may stay until the next change");
  assert.throws(() => checkedProfileSharing({ everyone: null, users: [{ userId: "alice", access: "read" }] }, "alice", notShared(), users), code("share-owner", 400));
});

test("every operating method, plugin contribution and stop refuses a read share through the message layer; reading still works", async () => {
  const reached: string[] = [];
  const session = {
    running: false,
    subscribe: () => () => undefined,
    send: () => { reached.push("send"); },
    sendToActor: async () => { reached.push("sendToActor"); },
    capabilities: async () => ({ input: ["text"], model: "test/example" }),
    actorConversations: () => ({ revision: 1, actors: {} }),
    start: () => { reached.push("start"); },
    stop: () => { reached.push("stop"); },
  };
  const answer = defineOperation({
    id: "example.extension.answer",
    description: "Answer a question of a plugin.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({ runId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    result: Type.Null(),
  });
  const watch = defineChannel({
    id: "example.extension",
    description: "An event channel of a plugin related to a run.",
    rights: ["runs.read"],
    params: Type.Object({ runId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    message: Type.Object({ changed: Type.Literal(true) }),
  });
  const sources = coreSources({
    get: async () => session,
    hasRun: () => true,
    delete: async (runId: string) => { reached.push(`delete:${runId}`); },
    subscribeRun: () => () => undefined,
  } as never, { global, runOwner: policy.ownerOf, runOwnerOnly: policy.ownerOnly, runSharing: policy.sharing });
  const methods = new MethodContributionRegistry();
  methods.register("host", [...coreMethods(sources), implement(answer, ({ runId }) => { reached.push(`answer:${runId}`); return null; })] as MethodContribution[]);
  const channels = new ChannelContributionRegistry();
  channels.register("host", [...coreChannels(sources), implementChannel(watch, () => () => undefined)]);
  const dispatcher = new RpcDispatcher({ methods, channels, assertRunReachable: (access, runId, operates) => assertRunAccess(access, runId, operates, policy) });
  const call = (access: AccessContext, method: string, params: unknown) => {
    const connection = new RpcConnection({ id: "test", access, local: true, peer: new RpcPeer({ send: () => undefined }) }, dispatcher);
    return dispatcher.dispatch(connection, method, params, { id: 1, signal: new AbortController().signal, progress: () => undefined });
  };
  const operating: Array<[string, unknown]> = [
    [coreContracts.chat.send.id, { runId: READ, text: "Hello" }],
    [coreContracts.chat.sendToActor.id, { runId: READ, actorId: "helper", text: "Hello" }],
    [coreContracts.chat.start.id, { runId: READ, entry: "example.allowed" }],
    [coreContracts.chat.stop.id, { runId: READ }],
    [coreContracts.runs.scripts.id, { runId: READ }],
    [coreContracts.startOptions.select.id, { runId: READ, optionId: "example", value: null }],
    [answer.id, { runId: READ }],
  ];
  for (const [method, params] of operating) await assert.rejects(call(bob, method, params), code("run-read-only", 403), method);
  await assert.rejects(call(bob, coreContracts.runs.delete.id, { runId: READ }), code("run-delete-denied", 403));
  await assert.rejects(call(bob, coreContracts.runs.share.id, { runId: READ, sharing: notShared() }), code("run-sharing-denied", 403));
  await call(bob, coreContracts.chat.capabilities.id, { runId: READ });
  await call(bob, coreContracts.chat.actorHistory.id, { runId: READ });
  await call(bob, RPC_METHODS.subscribe, { channel: coreContracts.channels.run.id, params: { runId: READ } });
  await call(bob, RPC_METHODS.subscribe, { channel: watch.id, params: { runId: READ } });
  assert.deepEqual(reached, [], "nothing operated the run");
  for (const [method, params] of operating.slice(0, 3)) await call(bob, method, { ...params as object, runId: WRITE });
  await call(bob, coreContracts.chat.stop.id, { runId: WRITE });
  assert.deepEqual(reached, ["send", "sendToActor", "start", "stop"], "a write share operates");
});

/** A server with users, the core methods and channels, the overseer and a manual coordinator; the dispatcher watches run access like the real one. */
const startServer = async () => {
  let management!: RunManagement;
  const provider = new RunSessionProvider((bridges) => {
    management = bridges.sessions!();
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory });
    host.provideHost(runManagementToken, () => management);
    host.register({
      manifest: { id: "test.product" },
      register: (registration) => {
        registration.provide(productRuntimeToken, {
          coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "manual", runTitle: "New run", ownerHandle: "owner", ownerDisplayName: "Owner" },
          roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
          contract: () => "", promptComposition: "test",
          systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
        });
        registration.provide(workspaceRuntimeToken, {
          describe: () => ({ mode: "test", directoryPattern: dataDirectory }),
          resolve: async () => ({ cwd: dataDirectory, currentRoot: async () => dataDirectory, runOperation: (operation) => operation() }),
        });
        registration.provide(sandboxServicesToken, {
          serverProcessContextFor: async (runId) => ({ runId, cwd: dataDirectory, root: dataDirectory, home: dataDirectory, env: { ...process.env } }),
          registerWorkspaceRoot: () => {}, execute: async () => null, shutdown: async () => {},
        });
        registration.profiles({
          id: "test.profiles", models: () => [],
          profiles: () => [{ name: "manual", description: "Manual", driver: "manual", turnTimeoutMs: null, isolateWorkspace: false }],
        });
      },
    });
    host.register(plugin.create(host));
    host.seal();
    return host;
  }, "http://127.0.0.1:51236");
  await provider.init();
  const sources = {
    sessions: provider,
    plugins: provider.plugins,
    version: "1.0.0",
    global: provider.globalPolicy(),
    runOwner: (runId: string) => provider.runOwner(runId),
    runOwnerOnly: (runId: string) => provider.runOwnerOnly(runId),
    runSharing: (runId: string) => provider.runSharing(runId),
    settingsGuarded: () => false,
    external: { open: () => false, set: async () => undefined },
  };
  provider.plugins.methods.register("host", [...provider.engineMethods(), ...coreMethods(sources)]);
  provider.plugins.channels.register("host", coreChannels(sources));
  const dispatcher = new RpcDispatcher({
    methods: provider.plugins.methods,
    channels: provider.plugins.channels,
    assertRunReachable: (access, runId, operates) => assertRunAccess(access, runId, operates, provider.runAccess()),
    watchRunAccess: (runId, listener) => provider.watchRunAccess(runId, listener),
  });
  const connectionOf = (access: AccessContext) => new RpcConnection({ id: `test-${access.user?.id}`, access, local: true, peer: new RpcPeer({ send: () => undefined }) }, dispatcher);
  const call = (access: AccessContext, method: string, params: unknown, connection = connectionOf(access)) =>
    dispatcher.dispatch(connection, method, params, { id: 1, signal: new AbortController().signal, progress: () => undefined });
  return { provider, management, call, connectionOf };
};

const signedIn = (userId: string): AccessContext => {
  const { id, label, rights } = configuredUsers()!.find((entry) => entry.id === userId)!;
  return createAccessContext({ enabled: true, user: { id, label, rights } });
};

type Listed = { id: string; operable: boolean; canShare?: true; shared?: true; sharedAccess?: string };

test("sharing before the start, at creation, after it, in the run list, in the channels and from the global coordinator", async (t) => {
  const { provider, management, call, connectionOf } = await startServer();
  t.after(() => provider.shutdown());
  const [owner, sharee, other, administrator] = ["alice", "bob", "carol", "admin"].map(signedIn) as [AccessContext, AccessContext, AccessContext, AccessContext];
  const RUN = "shared-run";
  const listed = async (access: AccessContext): Promise<Listed | undefined> =>
    (await call(access, coreContracts.runs.list.id, {}) as Listed[]).find((entry) => entry.id === RUN);
  const share = (access: AccessContext, runId: string, sharing: RunSharing) => call(access, coreContracts.runs.share.id, { runId, sharing });

  await t.test("before the start the choice waits per user and the creation writes it in the same record", async () => {
    assert.deepEqual(await call(owner, coreContracts.runs.sharing.id, { runId: RUN }), {
      sharing: { everyone: null, users: [] },
      users: [{ id: "bob", label: "Bob" }, { id: "carol", label: "Carol" }, { id: "admin", label: "Admin" }],
    });
    assert.deepEqual(await share(owner, RUN, { everyone: null, users: [{ userId: "bob", access: "read" }] }), {
      sharing: { everyone: null, users: [{ userId: "bob", label: "Bob", access: "read" }] },
      users: [{ id: "bob", label: "Bob" }, { id: "carol", label: "Carol" }, { id: "admin", label: "Admin" }],
    });
    assert.deepEqual((await call(other, coreContracts.runs.sharing.id, { runId: RUN }) as { sharing: RunSharing }).sharing, notShared(), "another user's choice is not carol's");
    assert.equal(provider.hasRun(RUN), false);
    await call(owner, coreContracts.chat.send.id, { runId: RUN, text: "Build" });
    const events = management.events(RUN);
    const created = events.find((event) => event.type === "run.created")!;
    const shared = events.find((event) => event.type === "run.sharing-changed")!;
    assert.equal(shared.commandId, created.commandId, "created and shared in one record");
    assert.deepEqual(shared.payload, { everyone: null, users: [{ userId: "bob", access: "read" }], changedBy: "alice" });
    assert.deepEqual(provider.runSharing(RUN), { everyone: null, users: [{ userId: "bob", access: "read" }] });
  });

  await t.test("each caller sees its own part of the sharing in the list, and a read share operates nothing", async () => {
    assert.deepEqual(await listed(owner), { ...await listed(owner), operable: true, canShare: true, shared: true });
    assert.equal((await listed(owner))?.sharedAccess, undefined);
    assert.deepEqual(await listed(administrator), { ...await listed(administrator), canShare: true, shared: true });
    const bob = await listed(sharee);
    assert.deepEqual([bob?.operable, bob?.sharedAccess, bob?.canShare], [false, "read", undefined]);
    assert.equal(await listed(other), undefined, "carol does not see the run");
    await assert.rejects(call(other, runContracts.view.id, { runId: RUN }), code("run-not-found", 404));
    assert.ok(await call(sharee, runContracts.view.id, { runId: RUN }));
    await assert.rejects(call(sharee, coreContracts.chat.send.id, { runId: RUN, text: "Mine now" }), code("run-read-only", 403));
    await assert.rejects(call(sharee, runContracts.stopAll.id, { runId: RUN, commandId: "stop-1", reason: "Stop" }), code("run-read-only", 403));
    await assert.rejects(call(sharee, overseerContracts.stopRun.id, { run: RUN }), code("run-read-only", 403));
    await assert.rejects(call(sharee, coreContracts.runs.delete.id, { runId: RUN }), code("run-delete-denied", 403));
    await assert.rejects(call(sharee, coreContracts.runs.sharing.id, { runId: RUN }), code("run-sharing-denied", 403));
    assert.ok(!management.view(RUN).inputs.some((input) => input.content === "Mine now"));
  });

  await t.test("a writing request on a delivery route refuses a read share before any plugin sees it", async () => {
    const answered: { status?: number; body?: string } = {};
    const response = {
      writeHead: (status: number) => { answered.status = status; return response; },
      end: (body: string) => { answered.body = body; },
    } as unknown as ServerResponse;
    const handled = await provider.pluginRoutes({ method: "POST", headers: {} } as IncomingMessage, response, new URL(`http://localhost/api/plugins/example/runs/${RUN}/notes`), sharee);
    assert.equal(handled, true);
    assert.equal(answered.status, 403);
    assert.equal(JSON.parse(answered.body!).code, "run-read-only");
  });

  await t.test("a change replaces the sharing, reaches the list listeners and an unchanged one writes nothing", async () => {
    const heard: string[] = [];
    const unsubscribe = provider.subscribeList(() => heard.push("changed"), null);
    t.after(unsubscribe);
    await share(administrator, RUN, { everyone: "write", users: [{ userId: "bob", access: "read" }] });
    assert.ok(heard.length > 0, "the list channel hears of the new sharing");
    assert.equal(management.events(RUN).filter((event) => event.type === "run.sharing-changed").at(-1)!.payload.changedBy, "admin");
    assert.deepEqual([(await listed(sharee))?.sharedAccess, (await listed(sharee))?.operable], ["write", true], "everyone's write beats bob's read");
    assert.deepEqual([(await listed(other))?.sharedAccess, (await listed(other))?.operable], ["write", true]);
    await call(other, coreContracts.chat.send.id, { runId: RUN, text: "Carol helps" });
    await assert.rejects(call(other, coreContracts.runs.delete.id, { runId: RUN }), code("run-delete-denied", 403));
    const revision = management.view(RUN).revision;
    await share(owner, RUN, { everyone: "write", users: [{ userId: "bob", access: "read" }] });
    assert.equal(management.view(RUN).revision, revision, "unchanged writes no event");
  });

  await t.test("unknown users, the owner and a user twice are refused, as is a coordinator", async () => {
    await assert.rejects(share(owner, RUN, { everyone: null, users: [{ userId: "zoe", access: "read" }] }), code("share-user-unknown", 400));
    await assert.rejects(share(owner, RUN, { everyone: null, users: [{ userId: "alice", access: "read" }] }), code("share-owner", 400));
    await assert.rejects(share(owner, RUN, { everyone: null, users: [{ userId: "bob", access: "read" }, { userId: "bob", access: "write" }] }), code("share-user-duplicate", 400));
    await assert.rejects(share(owner, coordinatorRunId("alice"), notShared()), code("run-not-shareable", 409));
  });

  await t.test("taking a share back ends that user's run channels at once, other subscribers keep theirs", async () => {
    const carolConnection = connectionOf(other);
    const bobConnection = connectionOf(sharee);
    await call(other, RPC_METHODS.subscribe, { channel: coreContracts.channels.run.id, params: { runId: RUN } }, carolConnection);
    await call(other, RPC_METHODS.subscribe, { channel: coreContracts.channels.chat.id, params: { runId: RUN } }, carolConnection);
    await call(sharee, RPC_METHODS.subscribe, { channel: coreContracts.channels.run.id, params: { runId: RUN } }, bobConnection);
    assert.deepEqual([carolConnection.subscriptions.size, bobConnection.subscriptions.size], [2, 1]);
    await share(owner, RUN, { everyone: null, users: [{ userId: "bob", access: "read" }] });
    assert.deepEqual([carolConnection.subscriptions.size, bobConnection.subscriptions.size], [0, 1]);
    assert.equal(await listed(other), undefined);
    await assert.rejects(call(other, RPC_METHODS.subscribe, { channel: coreContracts.channels.run.id, params: { runId: RUN } }, carolConnection), code("run-not-found", 404));
  });

  await t.test("a pending choice of another user does not travel into the run someone else creates", async () => {
    const FOREIGN = "carol-run";
    await share(owner, FOREIGN, { everyone: "read", users: [] });
    await call(other, coreContracts.chat.send.id, { runId: FOREIGN, text: "Mine" });
    assert.equal(provider.runOwner(FOREIGN), "carol");
    assert.deepEqual(provider.runSharing(FOREIGN), notShared());
  });

  await t.test("the global coordinator shares a run it creates from the start", async () => {
    const created = await call(owner, overseerContracts.createRun.id, {
      title: "Shared from the coordinator", message: "Build", sharing: { everyone: null, users: [{ userId: "carol", access: "write" }] },
    }) as { runId: string };
    assert.deepEqual(provider.runSharing(created.runId), { everyone: null, users: [{ userId: "carol", access: "write" }] });
    await assert.rejects(call(owner, overseerContracts.createRun.id, {
      title: "Not shared", message: "Build", sharing: { everyone: null, users: [{ userId: "zoe", access: "read" }] },
    }), code("share-user-unknown", 400));
    assert.ok(!(await provider.list()).some((entry) => entry.title === "Not shared"), "a refused sharing creates no run");
  });
});

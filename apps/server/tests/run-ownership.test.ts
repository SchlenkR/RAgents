import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ChannelContributionRegistry,
  DomainError,
  Journal,
  MethodContributionRegistry,
  Orchestration,
  RPC_METHODS,
  RpcPeer,
  StartOptionContributionRegistry,
  createAccessContext,
  defineChannel,
  defineOperation,
  implement,
  implementChannel,
  notShared,
  runtimeMethods,
  unrestrictedAccess,
  type AccessContext,
  type MethodContribution,
} from "@ragents/engine";
import { Type } from "typebox";
import { PluginHost } from "@ragents/engine";
import { overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { managementMethods } from "../../../plugins/ragents.overseer/server/api.ts";
import { RunDirectory } from "../../../plugins/ragents.overseer/server/run-directory.ts";
import { coordinatorRunId, isCoordinatorRunId, SHARED_OVERSEER_RUN_ID } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import type { RunManagement } from "../src/ragents/global-chat.ts";
import type { RunListScope } from "../src/chat-handler.ts";
import { artifactContentRoute } from "@ragents/engine/src/http/methods";
import { runContracts } from "@ragents/engine/src/http/contracts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreChannels, coreMethods } from "../src/api/core-methods.ts";
import { attachmentContentRoute } from "../src/api/delivery.ts";
import { assertRunAccess, assertRunRights, runIdInPath, runOwned, runReachable, runVisible, type RunAccessPolicy } from "../src/api/rights.ts";
import { runOwnerOf, runOwnerOnly, runSharingOf } from "../src/ragents/run-owner.ts";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract.ts";
import { workspaceBindingOption } from "../../../plugins/ragents.workspace/server/binding.ts";
import { WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { coreSources, startRpcServer } from "./rpc-fixture.ts";
import { testServices } from "@ragents/engine/tests/support.ts";

const OWN = "own-run";
const FOREIGN = "foreign-run";
const LEGACY = "legacy-run";
const FRESH = "fresh-run";
const GLOBAL = coordinatorRunId("alice");
const BOB_COORDINATOR = coordinatorRunId("bob");
const SINGLE = coordinatorRunId(null);
const BOUND = "bound-run";

const owners: Record<string, string | null | undefined> = { [OWN]: "alice", [FOREIGN]: "bob", [LEGACY]: null, [GLOBAL]: "alice", [BOB_COORDINATOR]: "bob", [SHARED_OVERSEER_RUN_ID]: "alice", [BOUND]: "alice" };

const policy: RunAccessPolicy = {
  global: { isCoordinator: isCoordinatorRunId, runIdFor: coordinatorRunId, read: "ragents.overseer.read", write: "ragents.overseer.write" },
  ownerOf: (runId) => owners[runId],
  ownerOnly: (runId) => runId === BOUND,
  sharing: () => notShared(),
};

const operatorRights = ["runs.read", "runs.write", "runs.create", "runs.inspect", "runs.delete", "ragents.overseer.read", "ragents.overseer.write"];
const alice = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: operatorRights } });
const bob = createAccessContext({ enabled: true, user: { id: "bob", label: "Bob", rights: operatorRights } });
const admin = createAccessContext({ enabled: true, user: { id: "root", label: "Root", rights: ["*"] } });
const anonymous = createAccessContext({ enabled: false, user: { id: "anonymous", label: "Guest", rights: ["*"] } });

const failure = (error: unknown): { code: string; status: number } =>
  error instanceof DomainError ? { code: error.code, status: error.status } : { code: String(error), status: 0 };

const runAccessOf = (journal: Journal, startOptions = new StartOptionContributionRegistry()): RunAccessPolicy => ({
  global: undefined,
  ownerOf: (runId) => runOwnerOf(journal, runId),
  ownerOnly: (runId) => runOwnerOnly(journal, startOptions, runId),
  sharing: (runId) => runSharingOf(journal, runId),
});

/** A call through the real dispatcher: rights, contract and run ownership as in the server. */
const dispatcher = (methods: MethodContributionRegistry, channels: ChannelContributionRegistry, access: AccessContext, runAccess = policy) => {
  const target = new RpcDispatcher({
    methods,
    channels,
    assertRunReachable: (context, runId, operates) => assertRunAccess(context, runId, operates, runAccess),
  });
  const connection = new RpcConnection({ id: "test", access, local: true, peer: new RpcPeer({ send: () => undefined }) }, target);
  return (method: string, params: unknown) =>
    target.dispatch(connection, method, params, { id: 1, signal: new AbortController().signal, progress: () => undefined });
};

test("the owner of a run is stored in its journal and survives a restart", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-run-owner-"));
  try {
    const first = new Journal(path.join(directory, "runs"), testServices());
    const runtime = new Orchestration(first, testServices());
    runtime.createRun({ commandId: "create-own" }, { runId: OWN, title: "Own", ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice" });
    runtime.createRun({ commandId: "create-legacy" }, { runId: LEGACY, title: "Legacy", ownerHandle: "owner", ownerDisplayName: "Owner" });
    assert.equal("ownerUserId" in runtime.view(OWN), false, "the run view for clients does not name the user");
    first.close();
    const ownRecord = JSON.parse(readFileSync(path.join(directory, "runs", OWN, "journal.jsonl"), "utf8").split("\n")[0]!);
    mkdirSync(path.join(directory, "runs", "locked-run"));
    writeFileSync(path.join(directory, "runs", "locked-run", "journal.jsonl"), JSON.stringify({ ...ownRecord, runId: "locked-run", formatVersion: 3 }) + "\n");

    const second = new Journal(path.join(directory, "runs"), testServices());
    try {
      assert.equal(runOwnerOf(second, OWN), "alice");
      assert.equal(runOwnerOf(second, LEGACY), null);
      assert.equal(runOwnerOf(second, FRESH), undefined);
      assert.equal(runOwnerOf(second, "locked-run"), null, "a locked journal names no owner, the run belongs to no operator like a legacy run");
      assert.equal(second.stateOf(OWN)?.actors.get(second.stateOf(OWN)!.ownerId)?.displayName, "Alice");
    } finally { second.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the rule per run: own run, foreign run, legacy run, free id, global chat and operation without sign-in", () => {
  assert.equal(runOwned(alice, OWN, policy), true);
  assert.equal(runOwned(alice, FOREIGN, policy), false);
  assert.equal(runReachable(alice, FOREIGN, policy), false);
  assert.equal(runOwned(alice, LEGACY, policy), false, "a run without an owner belongs to no operator");
  assert.equal(runReachable(alice, LEGACY, policy), false);
  assert.equal(runOwned(alice, FRESH, policy), false);
  assert.equal(runReachable(alice, FRESH, policy), true, "an id without a run belongs to whoever creates it");
  assert.equal(runOwned(alice, GLOBAL, policy), true, "every user has their own coordinator");
  assert.equal(runReachable(alice, BOB_COORDINATOR, policy), false, "nobody reaches someone else's coordinator");
  assert.equal(runReachable(admin, GLOBAL, policy), false, "not even with runs.read.all");
  assert.equal(runReachable(bob, coordinatorRunId("carol"), policy), false, "a free coordinator id does not belong to whoever names it first");
  assert.equal(runReachable(alice, SHARED_OVERSEER_RUN_ID, policy), false, "the former shared coordinator belongs to nobody, not even its first writer");
  assert.equal(runReachable(anonymous, SINGLE, policy), true, "exactly one coordinator without sign-in");
  assert.equal(runReachable(unrestrictedAccess, SINGLE, policy), true);
  for (const runId of [GLOBAL, BOB_COORDINATOR, SHARED_OVERSEER_RUN_ID]) assert.equal(runReachable(anonymous, runId, policy), false, runId);
  for (const runId of [OWN, FOREIGN, LEGACY, FRESH]) {
    assert.equal(runOwned(admin, runId, policy), true);
    assert.equal(runOwned(anonymous, runId, policy), true, "without sign-in there is exactly one access");
    assert.equal(runOwned(unrestrictedAccess, runId, policy), true);
  }
  assert.equal(runIdInPath("/files/runs/own-run/artifacts/a1"), OWN);
  assert.equal(runIdInPath("/api/plugins/ragents.documents/runs/own-run/raw/%40documents/report.md"), OWN);
  assert.equal(runIdInPath("/api/plugins/ragents.overseer/settings"), undefined);
});

test("the rights check per run rejects a foreign run like a nonexistent one and lets the administrator through", () => {
  for (const kind of ["read", "inspect", "write", "write-inspect"] as const) {
    assert.doesNotThrow(() => assertRunRights(alice, OWN, kind, policy));
    assert.doesNotThrow(() => assertRunRights(admin, FOREIGN, kind, policy));
    assert.doesNotThrow(() => assertRunRights(anonymous, FOREIGN, kind, policy));
    assert.throws(() => assertRunRights(alice, FOREIGN, kind, policy), (error: unknown) => {
      assert.deepEqual(failure(error), { code: "run-not-found", status: 404 });
      return true;
    });
    assert.throws(() => assertRunRights(alice, LEGACY, kind, policy), /does not exist/);
  }
  // Missing rights stay a rights error, also for an own run.
  const reader = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read"] } });
  assert.throws(() => assertRunRights(reader, OWN, "write", policy), (error: unknown) => {
    assert.deepEqual(failure(error), { code: "access-denied", status: 403 });
    return true;
  });
});

/** The contract of a plugin: every contribution with runId falls under the same rule, without its own code. */
const extensionContracts = {
  method: defineOperation({
    id: "example.extension.read",
    description: "A plugin contribution related to a run.",
    rights: ["runs.read"],
    input: Type.Object({ runId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    result: Type.Object({ seen: Type.String() }),
  }),
  channel: defineChannel({
    id: "example.extension",
    description: "An event channel of a plugin related to a run.",
    rights: ["runs.read"],
    params: Type.Object({ runId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    message: Type.Object({ changed: Type.Literal(true) }),
  }),
};

test("every core method, every channel and every plugin contribution with runId rejects a foreign run", async (t) => {
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
  const sources = coreSources({
    get: async (runId: string) => { reached.push(`get:${runId}`); return session; },
    hasRun: () => true,
    list: async () => [{ id: OWN, title: "Own", updatedAt: 2 }, { id: FOREIGN, title: "Foreign", updatedAt: 1 }, { id: LEGACY, title: "Legacy", updatedAt: 0 }],
    delete: async (runId: string) => { reached.push(`delete:${runId}`); },
    subscribeRun: () => () => undefined,
    startOptions: () => [],
    selectStartOption: async () => ({ id: "example", owner: "test", value: null, presentation: { kind: "text", text: "" }, selectable: true, locked: false }),
    prepareRunMessage: async () => ({ messages: [], done: false }),
    exportRun: async () => ({ runId: OWN, archive: "", format: 1 }),
  } as never, { runOwner: (runId) => owners[runId] });

  const methods = new MethodContributionRegistry();
  methods.register("host", [
    ...coreMethods(sources),
    implement(extensionContracts.method, ({ runId }) => { reached.push(`extension:${runId}`); return { seen: runId }; }),
  ] as MethodContribution[]);
  const channels = new ChannelContributionRegistry();
  channels.register("host", [
    ...coreChannels(sources),
    implementChannel(extensionContracts.channel, ({ runId }, emit) => { reached.push(`channel:${runId}`); emit({ changed: true }); return () => undefined; }),
  ]);

  const calls = (runId: string): Array<[string, unknown]> => [
    [coreContracts.runs.delete.id, { runId }],
    [coreContracts.chat.send.id, { runId, text: "Hello" }],
    [coreContracts.chat.sendToActor.id, { runId, actorId: "helper", text: "Hello" }],
    [coreContracts.chat.start.id, { runId, entry: "example.allowed" }],
    [coreContracts.chat.stop.id, { runId }],
    [coreContracts.chat.capabilities.id, { runId }],
    [coreContracts.chat.actorHistory.id, { runId }],
    [coreContracts.startOptions.list.id, { runId }],
    [coreContracts.startOptions.select.id, { runId, optionId: "example", value: null }],
    [coreContracts.prepare.id, { runId, messages: [{ role: "user", text: "Task" }] }],
    [coreContracts.transfer.export.id, { runId }],
    [extensionContracts.method.id, { runId }],
  ];
  const subscriptions = (runId: string): Array<[string, unknown]> => [
    [coreContracts.channels.run.id, { runId }],
    [coreContracts.channels.chat.id, { runId }],
    [extensionContracts.channel.id, { runId }],
  ];

  await t.test("a second user reaches none of the contributions", async () => {
    const call = dispatcher(methods, channels, bob);
    for (const [method, params] of [...calls(OWN), ...calls(LEGACY)]) {
      await assert.rejects(call(method, params), (error: unknown) => {
        assert.deepEqual(failure(error), { code: "run-not-found", status: 404 }, method);
        return true;
      });
    }
    for (const [channel, params] of [...subscriptions(OWN), ...subscriptions(LEGACY)]) {
      await assert.rejects(call(RPC_METHODS.subscribe, { channel, params }), (error: unknown) => {
        assert.deepEqual(failure(error), { code: "run-not-found", status: 404 }, channel);
        return true;
      });
    }
    assert.deepEqual(reached, [], "no contribution opened the foreign run at all");
  });

  await t.test("the owner and the administrator get through", async () => {
    for (const [access, runId] of [[alice, OWN], [admin, FOREIGN], [admin, LEGACY]] as const) {
      const call = dispatcher(methods, channels, access);
      for (const [method, params] of calls(runId)) await call(method, params);
      for (const [channel, params] of subscriptions(runId)) await call(RPC_METHODS.subscribe, { channel, params });
    }
    assert.ok(reached.includes(`delete:${OWN}`) && reached.includes(`extension:${OWN}`) && reached.includes(`channel:${OWN}`));
    assert.ok(reached.includes(`delete:${FOREIGN}`) && reached.includes(`delete:${LEGACY}`));
  });
});

test("the run list shows only own runs, legacy runs only to the administrator and everything without sign-in", async () => {
  const listed = [
    { id: OWN, title: "Own", updatedAt: 3 },
    { id: FOREIGN, title: "Foreign", updatedAt: 2 },
    { id: LEGACY, title: "Legacy", updatedAt: 1 },
  ];
  const sources = coreSources({ list: async (scope?: RunListScope) => listed.filter((entry) => scope!.visible(entry.id)) }, { runOwner: (runId) => owners[runId], global: policy.global });
  const list = coreMethods(sources).find((entry) => entry.contract.id === coreContracts.runs.list.id)!;
  const titles = async (access: AccessContext) =>
    ((await list.execute({} as never, { access, signal: new AbortController().signal, progress: () => undefined, connection: undefined as never, local: true })) as typeof listed)
      .map((entry) => entry.id);
  assert.deepEqual(await titles(alice), [OWN]);
  assert.deepEqual(await titles(bob), [FOREIGN]);
  assert.deepEqual(await titles(admin), [OWN, FOREIGN, LEGACY]);
  assert.deepEqual(await titles(anonymous), [OWN, FOREIGN, LEGACY]);
});

test("the runtime methods of the engine reject foreign runs and keep working for the administrator", async () => {
  const journal = new Journal(":memory:", testServices());
  try {
    const runtime = new Orchestration(journal, testServices());
    const access = runAccessOf(journal);
    runtime.createRun({ commandId: "create-own" }, { runId: OWN, title: "Own", ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice" });
    const methods = runtimeMethods({
      runtime,
      assertRunRights: (context, runId, kind) => assertRunRights(context, runId, kind, access),
      projectView: (view) => view,
      hasRun: (runId) => journal.stateOf(runId) !== null,
      interruptTurn: async () => undefined,
      pauseRun: async () => undefined,
    });
    const call = async (id: string, input: unknown, context: AccessContext) => {
      const found = methods.find((entry) => entry.contract.id === id)!;
      return await found.execute(input as never, { access: context, signal: new AbortController().signal, progress: () => undefined, connection: undefined as never, local: true });
    };
    const inputs = [
      [runContracts.view.id, { runId: OWN }],
      [runContracts.events.id, { runId: OWN }],
      [runContracts.enqueueInput.id, { runId: OWN, commandId: "c1", actorId: "helper", content: "Hello" }],
      [runContracts.restartActor.id, { runId: OWN, commandId: "c2", actorId: "helper" }],
      [runContracts.stopActor.id, { runId: OWN, commandId: "c3", actorId: "helper", reason: "End" }],
      [runContracts.resolveAction.id, { runId: OWN, commandId: "c4", actionId: "a1", decision: "approved" }],
      [runContracts.stopAll.id, { runId: OWN, commandId: "c5", reason: "End" }],
      [runContracts.interruptTurn.id, { runId: OWN, commandId: "c6", actorId: "helper" }],
    ] as const;
    for (const [id, input] of inputs) {
      await assert.rejects(call(id, input, bob), (error: unknown) => {
        assert.deepEqual(failure(error), { code: "run-not-found", status: 404 }, id);
        return true;
      });
      // The administrator passes the ownership check; whatever fails afterwards is domain logic of this empty run.
      const reached = await call(id, input, admin).then(() => undefined, (error: unknown) => failure(error).code);
      assert.notEqual(reached, "run-not-found", id);
    }
    assert.equal((await call(runContracts.view.id, { runId: OWN }, alice) as { id: string }).id, OWN);
  } finally { journal.close(); }
});

test("artifacts and attachments of a foreign run cannot be fetched", async (t) => {
  const journal = new Journal(":memory:", testServices());
  t.after(() => journal.close());
  const runtime = new Orchestration(journal, testServices());
  runtime.createRun({ commandId: "create-own" }, { runId: OWN, title: "Own", ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice" });
  const access = runAccessOf(journal);
  const provider = {
    get: async () => ({
      running: false,
      subscribe: () => () => undefined,
      send: () => undefined,
      start: () => undefined,
      stop: () => undefined,
      attachment: () => ({ attachment: { name: "image.png", mediaType: "image/png", size: 3, id: "a1" }, content: new Uint8Array([1, 2, 3]) }),
    }),
    list: async () => [],
    delete: async () => undefined,
  };
  const identities: Record<string, AccessContext> = { alice, bob, admin };
  const server = await startRpcServer(t, {
    routes: [
      attachmentContentRoute(provider as never, access),
      artifactContentRoute({
        runtime,
        assertRunRights: (context, runId, kind) => assertRunRights(context, runId, kind, access),
      }),
    ],
    accessFor: (request) => identities[request.headers["x-test-identity"] as string] ?? bob,
  });
  const fetchAs = (identity: string, url: string) => fetch(`${server.url}${url}`, { headers: { "x-test-identity": identity } });
  for (const url of [`/files/runs/${OWN}/attachments/a1`, `/files/runs/${OWN}/artifacts/a1`]) {
    const refused = await fetchAs("bob", url);
    assert.equal(refused.status, 404, url);
    assert.equal(((await refused.json()) as { code: string }).code, "run-not-found");
  }
  const delivered = await fetchAs("alice", `/files/runs/${OWN}/attachments/a1`);
  assert.equal(delivered.status, 200);
  await delivered.arrayBuffer();
  const admins = await fetchAs("admin", `/files/runs/${OWN}/attachments/a1`);
  assert.equal(admins.status, 200);
  await admins.arrayBuffer();
});

test("the UI context of a message cannot name a foreign run", async () => {
  const locations: unknown[] = [];
  const sources = coreSources({
    get: async () => ({ running: false, subscribe: () => () => undefined, send: (_text: string, _attachments: unknown, location: unknown) => { locations.push(location); }, start: () => undefined, stop: () => undefined }),
    hasRun: () => true,
  } as never, { runOwner: (runId) => owners[runId], global: policy.global });
  const send = coreMethods(sources).find((entry) => entry.contract.id === coreContracts.chat.send.id)!;
  const call = (access: AccessContext, userLocation: unknown, runId = coordinatorRunId(access.user!.id)) =>
    send.execute({ runId, text: "Hello", userLocation } as never,
      { access, signal: new AbortController().signal, progress: () => undefined, connection: undefined as never, local: true });
  await assert.rejects(call(alice, { page: "run", runId: FOREIGN, tab: null, selection: null }), (error: unknown) => {
    assert.deepEqual(failure(error), { code: "run-not-found", status: 404 });
    return true;
  });
  await call(alice, { page: "run", runId: OWN, tab: null, selection: null });
  await call(admin, { page: "run", runId: FOREIGN, tab: null, selection: null });
  for (const runId of [BOB_COORDINATOR, SHARED_OVERSEER_RUN_ID]) {
    await assert.rejects(call(alice, { page: "run", runId: OWN, tab: null, selection: null }, runId), (error: unknown) => {
      assert.deepEqual(failure(error), { code: "run-not-found", status: 404 }, runId);
      return true;
    });
  }
  await assert.rejects(call(admin, { page: "home", runId: null, tab: null, selection: null }, GLOBAL), /does not exist/);
  assert.equal(locations.length, 2);
});

test("the global coordinator resolves runs only among the caller's runs", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-run-owner-overseer-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runs = [{ id: OWN, title: "Own", updatedAt: 2 }, { id: FOREIGN, title: "Foreign", updatedAt: 1 }];
  const read: string[] = [];
  const management: RunManagement = {
    list: async (access) => access ? runs.filter((entry) => runVisible(access, entry.id, policy)) : runs,
    view: (runId) => {
      read.push(runId);
      return { id: runId, revision: 1, title: runId, ownerId: "owner", primaryActorId: null, createdAt: "2026-09-22T00:00:00Z", forkedFrom: null,
        actors: [], inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [] };
    },
    events: () => [],
    create: async () => OWN,
    send: async () => undefined,
    stop: async () => undefined,
    resetGlobal: async () => undefined,
  };
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
  host.register({ manifest: { id: "test" }, register: () => undefined });
  const methods = managementMethods({
    root: host,
    management: () => management,
    directory: new RunDirectory(path.join(directory, "references.json")),
    authentication: { kind: "open" },
  });
  const registry = new MethodContributionRegistry();
  registry.register("ragents.overseer", methods);
  const channels = new ChannelContributionRegistry();
  const listed = async (access: AccessContext) =>
    ((await dispatcher(registry, channels, access)(overseerContracts.listRuns.id, {})) as Array<{ runId: string }>).map((entry) => entry.runId);
  assert.deepEqual(await listed(alice), [OWN]);
  assert.deepEqual(await listed(admin), [OWN, FOREIGN]);
  for (const reference of [FOREIGN, "Foreign"]) {
    await assert.rejects(dispatcher(registry, channels, alice)(overseerContracts.readRun.id, { run: reference }), /unknown/i, reference);
  }
  assert.deepEqual(read, [], "no foreign run was opened");
  await dispatcher(registry, channels, admin)(overseerContracts.readRun.id, { run: FOREIGN });
  assert.deepEqual(read, [FOREIGN]);
});

const hostService = createAccessContext({
  enabled: true,
  user: { id: "host-service", label: "Host", rights: ["runs.read", "runs.read.all", "runs.write", "runs.create", "runs.inspect"] },
});

test("a run that only its owner operates can be read and stopped by everyone with runs.read.all, but operated only by the owner", () => {
  for (const access of [admin, hostService]) {
    for (const kind of ["read", "inspect", "stop"] as const) assert.doesNotThrow(() => assertRunRights(access, BOUND, kind, policy), kind);
    for (const kind of ["write", "write-inspect"] as const) {
      assert.throws(() => assertRunRights(access, BOUND, kind, policy), (error: unknown) => {
        assert.deepEqual(failure(error), { code: "run-owner-only", status: 403 }, kind);
        return true;
      });
    }
    assert.doesNotThrow(() => assertRunRights(access, FOREIGN, "write", policy), "without a declaration from a plugin runs.read.all keeps operating");
  }
  for (const kind of ["read", "inspect", "stop", "write", "write-inspect"] as const) {
    assert.doesNotThrow(() => assertRunRights(alice, BOUND, kind, policy), kind);
    assert.doesNotThrow(() => assertRunRights(anonymous, BOUND, kind, policy), "without sign-in there is exactly one access");
    assert.throws(() => assertRunRights(bob, BOUND, kind, policy), /does not exist/);
  }
});

test("a run bound to a workstation is only readable and stoppable for someone else through the runtime methods", async () => {
  const journal = new Journal(":memory:", testServices());
  try {
    const runtime = new Orchestration(journal, testServices());
    const startOptions = new StartOptionContributionRegistry();
    startOptions.register("ragents.workspace", [workspaceBindingOption(new WorkspaceClientRegistry([]), () => undefined)]);
    const workstation = { kind: "client", client: "client-00000001", label: "Laptop", path: "/home/alice/project" };
    runtime.createRun({ commandId: "create-bound" }, {
      runId: BOUND, title: "Bound", ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice",
      initialPluginStates: [{ pluginId: WORKSPACE_BINDING_OPTION_ID, state: workstation }],
    });
    runtime.createRun({ commandId: "create-own" }, {
      runId: OWN, title: "Own", ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice",
      initialPluginStates: [{ pluginId: WORKSPACE_BINDING_OPTION_ID, state: { kind: "fresh" } }],
    });
    const access = runAccessOf(journal, startOptions);
    assert.deepEqual([access.ownerOnly(BOUND), access.ownerOnly(OWN), access.ownerOnly(FRESH)], [true, false, false]);
    const methods = runtimeMethods({
      runtime,
      assertRunRights: (context, runId, kind) => assertRunRights(context, runId, kind, access),
      projectView: (view) => view,
      hasRun: (runId) => journal.stateOf(runId) !== null,
      interruptTurn: async () => undefined,
      pauseRun: async () => undefined,
    });
    const outcome = async (id: string, input: unknown, context: AccessContext): Promise<string> => {
      const found = methods.find((entry) => entry.contract.id === id)!;
      try {
        await found.execute(input as never, { access: context, signal: new AbortController().signal, progress: () => undefined, connection: undefined as never, local: true });
        return "ok";
      } catch (error) {
        return failure(error).code;
      }
    };
    const operating = (runId: string) => [
      [runContracts.enqueueInput.id, { runId, commandId: `i-${runId}`, actorId: "helper", content: "Build the project" }],
      [runContracts.restartActor.id, { runId, commandId: `r-${runId}`, actorId: "helper" }],
      [runContracts.resolveAction.id, { runId, commandId: `a-${runId}`, actionId: "a1", decision: "approved" }],
    ] as const;
    for (const [id, input] of operating(BOUND)) {
      assert.equal(await outcome(id, input, admin), "run-owner-only", id);
      assert.notEqual(await outcome(id, input, alice), "run-owner-only", id);
    }
    for (const [id, input] of operating(OWN)) assert.notEqual(await outcome(id, input, admin), "run-owner-only", id);
    for (const [id, input] of [
      [runContracts.view.id, { runId: BOUND }],
      [runContracts.events.id, { runId: BOUND }],
      [runContracts.stopActor.id, { runId: BOUND, commandId: "s1", actorId: "helper", reason: "End" }],
      [runContracts.stopAll.id, { runId: BOUND, commandId: "s2", reason: "End" }],
      [runContracts.interruptTurn.id, { runId: BOUND, commandId: "s3", actorId: "helper" }],
    ] as const) {
      assert.notEqual(await outcome(id, input, admin), "run-owner-only", id);
    }
  } finally { journal.close(); }
});

test("chat, templates and plugins with runs.write operate such a run only for its owner", async () => {
  const reached: string[] = [];
  const session = {
    running: false,
    subscribe: () => () => undefined,
    send: () => { reached.push("send"); },
    sendToActor: async () => { reached.push("sendToActor"); },
    capabilities: async () => ({ input: ["text"], model: "test/example" }),
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
  const sources = coreSources({ get: async () => session, hasRun: () => true } as never, { runOwner: (runId) => owners[runId], runOwnerOnly: policy.ownerOnly });
  const methods = new MethodContributionRegistry();
  methods.register("host", [
    ...coreMethods(sources),
    implement(extensionContracts.method, ({ runId }) => { reached.push(`extension:${runId}`); return { seen: runId }; }),
    implement(answer, ({ runId }) => { reached.push(`answer:${runId}`); return null; }),
  ] as MethodContribution[]);
  const channels = new ChannelContributionRegistry();
  channels.register("host", [
    implementChannel(extensionContracts.channel, ({ runId }, emit) => { reached.push(`channel:${runId}`); emit({ changed: true }); return () => undefined; }),
  ]);
  const operating: Array<[string, unknown]> = [
    [coreContracts.chat.send.id, { runId: BOUND, text: "Hello" }],
    [coreContracts.chat.sendToActor.id, { runId: BOUND, actorId: "helper", text: "Hello" }],
    [coreContracts.chat.start.id, { runId: BOUND, entry: "example.allowed" }],
    [answer.id, { runId: BOUND }],
  ];
  for (const access of [admin, hostService]) {
    const call = dispatcher(methods, channels, access);
    for (const [method, params] of operating) {
      await assert.rejects(call(method, params), (error: unknown) => {
        assert.deepEqual(failure(error), { code: "run-owner-only", status: 403 }, method);
        return true;
      });
    }
    await call(coreContracts.chat.stop.id, { runId: BOUND });
    await call(coreContracts.chat.capabilities.id, { runId: BOUND });
    await call(extensionContracts.method.id, { runId: BOUND });
    await call(RPC_METHODS.subscribe, { channel: extensionContracts.channel.id, params: { runId: BOUND } });
  }
  const observed = ["stop", `extension:${BOUND}`, `channel:${BOUND}`];
  assert.deepEqual(reached, [...observed, ...observed], "reading and stopping reach the run, operating never does");
  const call = dispatcher(methods, channels, alice);
  for (const [method, params] of operating) await call(method, params);
  assert.deepEqual(reached.slice(observed.length * 2), ["send", "sendToActor", "start", `answer:${BOUND}`]);
});

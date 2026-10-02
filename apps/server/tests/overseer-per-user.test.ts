import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ChannelContributionRegistry, DomainError, Journal, Orchestration, PluginHost, RpcPeer, createAccessContext, type AccessContext,
} from "@ragents/engine";
import { runContracts } from "@ragents/engine/src/http/contracts";
import { manualExecution, testServices } from "@ragents/engine/tests/support.ts";
import { plugin } from "../../../plugins/ragents.overseer/server/index.ts";
import { overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { coordinatorRunId, SHARED_OVERSEER_RUN_ID } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { coordinatorRequestUser } from "../src/access-service.ts";
import { createAccessSessionManager } from "../src/access-session.ts";
import { assertRunAccess } from "../src/api/rights.ts";
import { configuredUsers, loadConfigFile } from "../src/config-file.ts";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { globalChatToken, runManagementToken, type RunManagement } from "../src/ragents/global-chat.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken, type SessionWorkspace } from "../src/ragents/workspace-runtime.ts";
import { sandboxServicesToken } from "../src/plugin-support/workspace-sandbox-host.ts";

const root = await mkdtemp(path.join(tmpdir(), "ragents-overseer-users-"));
const dataDirectory = path.join(root, "data");
const operator = ["runs.read", "runs.write", "runs.create", "runs.inspect", "ragents.overseer.read", "ragents.overseer.write"];
await writeFile(path.join(root, "ragents.config.per-user.ts"), `export const config = {};
export const users = [
  { id: "alice", password: "alice-password", rights: ${JSON.stringify(operator)} },
  { id: "bob", password: "bob-password", rights: ${JSON.stringify(operator)} },
];
`);
process.env.DATA_DIR = dataDirectory;
process.env.PRODUCT_PROFILE = "per-user";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.COMPACTION_MODEL = "";
await loadConfigFile(root);
const { RunSessionProvider } = await import("../src/provider.ts");

const alice = { id: "alice", label: "alice" };
const bob = { id: "bob", label: "bob" };

/** The former shared coordinator with a message from alice and an open input, as an older version leaves it behind. */
const writeSharedCoordinator = () => {
  const journal = new Journal(path.join(dataDirectory, "runs"), testServices());
  try {
    const runtime = new Orchestration(journal, testServices());
    const created = runtime.createRun({ commandId: "shared-create" }, {
      runId: SHARED_OVERSEER_RUN_ID, title: "Top-level coordinator", ownerHandle: "alice", ownerDisplayName: "alice", ownerUserId: "alice",
    });
    const spawned = runtime.spawnAgent({ actorId: created.ownerId, commandId: "shared-spawn" }, SHARED_OVERSEER_RUN_ID, {
      handle: "coordinator", displayName: "Coordinator", prompt: "", execution: manualExecution(), grants: [], toolNames: ["read", "write", "edit", "bash"],
    });
    const coordinator = spawned.actors.find((actor) => actor.kind === "agent")!;
    runtime.enqueueInput({ actorId: created.ownerId, commandId: "shared-input" }, SHARED_OVERSEER_RUN_ID, { actorId: coordinator.id, content: "Message from bob in the shared conversation" });
  } finally { journal.close(); }
};

test("every user has their own coordinator whose tools act only with that user's access", async (t) => {
  t.after(() => rm(root, { recursive: true, force: true }));
  writeSharedCoordinator();
  const sharedJournal = await readFile(path.join(dataDirectory, "runs", SHARED_OVERSEER_RUN_ID, "journal.jsonl"), "utf8");
  let management!: RunManagement;
  let workspaceFor!: (runId: string) => Promise<SessionWorkspace>;
  const provider = new RunSessionProvider((bridges) => {
    management = bridges.sessions!();
    workspaceFor = bridges.sessionWorkspaceFor;
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
  }, "http://127.0.0.1:51235");
  t.after(() => provider.shutdown());
  await provider.init();
  provider.plugins.methods.register("host", provider.engineMethods());

  const sessions = createAccessSessionManager({ users: configuredUsers(), cookieName: "test-user" });
  const dispatcher = new RpcDispatcher({
    methods: provider.plugins.methods,
    channels: new ChannelContributionRegistry(),
    assertRunReachable: (access, runId, operates) => assertRunAccess(access, runId, operates, provider.runAccess()),
  });
  const call = (access: AccessContext, method: string, params: unknown) => {
    const connection = new RpcConnection({ id: `test-${access.user?.id}`, access, local: true, peer: new RpcPeer({ send: () => undefined }) }, dispatcher);
    return dispatcher.dispatch(connection, method, params, { id: 1, signal: new AbortController().signal, progress: () => undefined });
  };
  const signedIn = (userId: string) => {
    const { id, label, rights } = configuredUsers()!.find((user) => user.id === userId)!;
    return createAccessContext({ enabled: true, user: { id, label, rights } });
  };
  const notFound = (error: unknown) => error instanceof DomainError && error.code === "run-not-found" && error.status === 404;

  const aliceCoordinator = coordinatorRunId("alice");
  const bobCoordinator = coordinatorRunId("bob");
  assert.notEqual(aliceCoordinator, bobCoordinator);
  assert.deepEqual(await call(signedIn("alice"), overseerContracts.coordinator.id, {}), { runId: aliceCoordinator });
  assert.deepEqual(await call(signedIn("bob"), overseerContracts.coordinator.id, {}), { runId: bobCoordinator });

  await (await provider.get(aliceCoordinator)).send("What is running for me?", [], undefined, alice);
  await (await provider.get(bobCoordinator)).send("What is running for me?", [], undefined, bob);
  assert.equal(provider.runOwner(aliceCoordinator), "alice");
  assert.equal(provider.runOwner(bobCoordinator), "bob");
  assert.deepEqual(await provider.list(), [], "no coordinator is in the run list");

  const toolAccess = async (coordinator: string) => {
    const workspace = await workspaceFor(coordinator);
    assert.deepEqual(workspace.hostSandbox?.readOnlyRoots, [], "with users no coordinator reads the shared journal folder");
    const token = workspace.extraEnv?.RAGENTS_API_TOKEN;
    assert.ok(token);
    const request = { socket: { remoteAddress: "127.0.0.1" }, headers: { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const user = coordinatorRequestUser(request, new URL("/rpc", "http://localhost"));
    assert.ok(user);
    return createAccessContext(sessions.coordinatorSnapshot(user.userId));
  };
  const policy = provider.plugins.service(globalChatToken);
  assert.deepEqual(policy.toolNames, ["read", "write", "edit"], "with users the coordinator has no host shell");
  assert.match(policy.prompt, /you have no shell/);
  assert.match(policy.prompt, /JSON-RPC calls via fetch in a snippet/);
  assert.doesNotMatch(policy.prompt, /read, write, edit and bash|bash function|bash and curl/);
  const aliceTools = await toolAccess(aliceCoordinator);
  const bobTools = await toolAccess(bobCoordinator);
  assert.equal(aliceTools.user?.id, "alice");
  assert.equal(bobTools.user?.id, "bob");
  assert.equal(aliceTools.can("runs.read.all"), false, "no service identity with more rights");

  const own = await call(aliceTools, overseerContracts.createRun.id, { title: "From Alice's coordinator", message: "Build" }) as { runId: string };
  assert.equal(provider.runOwner(own.runId), "alice", "a run the coordinator creates belongs to its user");
  const foreign = await call(bobTools, overseerContracts.createRun.id, { title: "From Bob's coordinator", message: "Build" }) as { runId: string };
  assert.equal(provider.runOwner(foreign.runId), "bob");
  const listed = async (access: AccessContext) => (await call(access, overseerContracts.listRuns.id, {}) as Array<{ runId: string }>).map((entry) => entry.runId);
  assert.deepEqual(await listed(aliceTools), [own.runId]);
  assert.deepEqual(await listed(bobTools), [foreign.runId]);
  for (const reference of [foreign.runId, "From Bob's coordinator"]) {
    await assert.rejects(call(aliceTools, overseerContracts.readRun.id, { run: reference }), /unknown/i, reference);
    await assert.rejects(call(aliceTools, overseerContracts.sendMessage.id, { run: reference, message: "Foreign task" }), /unknown/i, reference);
    await assert.rejects(call(aliceTools, overseerContracts.stopRun.id, { run: reference }), /unknown/i, reference);
  }
  assert.ok(!management.view(foreign.runId).inputs.some((input) => input.content === "Foreign task"));
  for (const runId of [foreign.runId, bobCoordinator, SHARED_OVERSEER_RUN_ID]) {
    await assert.rejects(call(aliceTools, runContracts.view.id, { runId }), notFound, runId);
    await assert.rejects(call(signedIn("alice"), runContracts.view.id, { runId }), notFound, runId);
  }
  assert.ok(await call(signedIn("alice"), runContracts.view.id, { runId: aliceCoordinator }));

  const bobConversation = management.view(bobCoordinator).inputs.length;
  assert.equal(await call(signedIn("alice"), overseerContracts.reset.id, { confirm: true }), null);
  assert.equal(provider.hasRun(aliceCoordinator), false, "the reset hits the own coordinator");
  assert.equal(management.view(bobCoordinator).inputs.length, bobConversation, "and not that of another user");
  assert.ok(provider.hasRun(own.runId));

  assert.equal((provider as unknown as { sessions: Map<string, unknown> }).sessions.has(SHARED_OVERSEER_RUN_ID), false, "the former shared coordinator is not opened");
  await assert.rejects(workspaceFor(SHARED_OVERSEER_RUN_ID), (error: unknown) => error instanceof DomainError && error.code === "coordinator-without-access");
  assert.equal(await readFile(path.join(dataDirectory, "runs", SHARED_OVERSEER_RUN_ID, "journal.jsonl"), "utf8"), sharedJournal, "and stays unchanged");
});

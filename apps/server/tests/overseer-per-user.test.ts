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

/** Der frühere gemeinsame Koordinator mit einer Nachricht von alice und einer offenen Eingabe, wie ihn ein älterer Stand hinterlässt. */
const writeSharedCoordinator = () => {
  const journal = new Journal(path.join(dataDirectory, "runs"), testServices());
  try {
    const runtime = new Orchestration(journal, testServices());
    const created = runtime.createRun({ commandId: "shared-create" }, {
      runId: SHARED_OVERSEER_RUN_ID, title: "Übergeordneter Koordinator", ownerHandle: "alice", ownerDisplayName: "alice", ownerUserId: "alice",
    });
    const spawned = runtime.spawnAgent({ actorId: created.ownerId, commandId: "shared-spawn" }, SHARED_OVERSEER_RUN_ID, {
      handle: "coordinator", displayName: "Koordinator", prompt: "", execution: manualExecution(), grants: [], toolNames: ["read", "write", "edit", "bash", "quick_answer"],
    });
    const coordinator = spawned.actors.find((actor) => actor.kind === "agent")!;
    runtime.enqueueInput({ actorId: created.ownerId, commandId: "shared-input" }, SHARED_OVERSEER_RUN_ID, { actorId: coordinator.id, content: "Nachricht von bob im gemeinsamen Gespräch" });
  } finally { journal.close(); }
};

test("jeder Benutzer hat seinen eigenen Koordinator, dessen Werkzeuge nur mit seinem Zugang handeln", async (t) => {
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
          coordinator: { handle: "coordinator", displayName: "Koordinator", profile: "manual", runTitle: "Neuer Run", ownerHandle: "owner", ownerDisplayName: "Owner" },
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

  await (await provider.get(aliceCoordinator)).send("Was läuft bei mir?", [], undefined, alice);
  await (await provider.get(bobCoordinator)).send("Was läuft bei mir?", [], undefined, bob);
  assert.equal(provider.runOwner(aliceCoordinator), "alice");
  assert.equal(provider.runOwner(bobCoordinator), "bob");
  assert.deepEqual(await provider.list(), [], "kein Koordinator steht in der Run-Liste");

  const toolAccess = async (coordinator: string) => {
    const workspace = await workspaceFor(coordinator);
    assert.deepEqual(workspace.hostSandbox?.readOnlyRoots, [], "mit Benutzern liest kein Koordinator den gemeinsamen Journalordner");
    const token = workspace.extraEnv?.RAGENTS_API_TOKEN;
    assert.ok(token);
    const request = { socket: { remoteAddress: "127.0.0.1" }, headers: { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const user = coordinatorRequestUser(request, new URL("/rpc", "http://localhost"));
    assert.ok(user);
    return createAccessContext(sessions.coordinatorSnapshot(user.userId));
  };
  const policy = provider.plugins.service(globalChatToken);
  assert.deepEqual(policy.toolNames, ["read", "write", "edit", "quick_answer"], "mit Benutzern hat der Koordinator keine Host-Shell");
  assert.match(policy.prompt, /eine Shell hast du nicht/);
  assert.match(policy.prompt, /JSON-RPC-Aufrufe über fetch in einem Snippet/);
  assert.doesNotMatch(policy.prompt, /read, write, edit und bash|bash-Funktion|bash und curl/);
  const aliceTools = await toolAccess(aliceCoordinator);
  const bobTools = await toolAccess(bobCoordinator);
  assert.equal(aliceTools.user?.id, "alice");
  assert.equal(bobTools.user?.id, "bob");
  assert.equal(aliceTools.can("runs.read.all"), false, "keine Dienstidentität mit mehr Rechten");

  const own = await call(aliceTools, overseerContracts.createRun.id, { title: "Von Alices Koordinator", message: "Baue" }) as { runId: string };
  assert.equal(provider.runOwner(own.runId), "alice", "ein Run, den der Koordinator anlegt, gehört seinem Benutzer");
  const foreign = await call(bobTools, overseerContracts.createRun.id, { title: "Von Bobs Koordinator", message: "Baue" }) as { runId: string };
  assert.equal(provider.runOwner(foreign.runId), "bob");
  const listed = async (access: AccessContext) => (await call(access, overseerContracts.listRuns.id, {}) as Array<{ runId: string }>).map((entry) => entry.runId);
  assert.deepEqual(await listed(aliceTools), [own.runId]);
  assert.deepEqual(await listed(bobTools), [foreign.runId]);
  for (const reference of [foreign.runId, "Von Bobs Koordinator"]) {
    await assert.rejects(call(aliceTools, overseerContracts.readRun.id, { run: reference }), /unbekannt/i, reference);
    await assert.rejects(call(aliceTools, overseerContracts.sendMessage.id, { run: reference, message: "Fremder Auftrag" }), /unbekannt/i, reference);
    await assert.rejects(call(aliceTools, overseerContracts.stopRun.id, { run: reference }), /unbekannt/i, reference);
  }
  assert.ok(!management.view(foreign.runId).inputs.some((input) => input.content === "Fremder Auftrag"));
  for (const runId of [foreign.runId, bobCoordinator, SHARED_OVERSEER_RUN_ID]) {
    await assert.rejects(call(aliceTools, runContracts.view.id, { runId }), notFound, runId);
    await assert.rejects(call(signedIn("alice"), runContracts.view.id, { runId }), notFound, runId);
  }
  assert.ok(await call(signedIn("alice"), runContracts.view.id, { runId: aliceCoordinator }));

  const bobConversation = management.view(bobCoordinator).inputs.length;
  assert.equal(await call(signedIn("alice"), overseerContracts.reset.id, { confirm: true }), null);
  assert.equal(provider.hasRun(aliceCoordinator), false, "der Reset trifft den eigenen Koordinator");
  assert.equal(management.view(bobCoordinator).inputs.length, bobConversation, "und nicht den eines anderen");
  assert.ok(provider.hasRun(own.runId));

  assert.equal((provider as unknown as { sessions: Map<string, unknown> }).sessions.has(SHARED_OVERSEER_RUN_ID), false, "der frühere gemeinsame Koordinator wird nicht geöffnet");
  await assert.rejects(workspaceFor(SHARED_OVERSEER_RUN_ID), (error: unknown) => error instanceof DomainError && error.code === "coordinator-without-access");
  assert.equal(await readFile(path.join(dataDirectory, "runs", SHARED_OVERSEER_RUN_ID, "journal.jsonl"), "utf8"), sharedJournal, "und bleibt unverändert liegen");
});

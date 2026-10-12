import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { AgentLoopDriver, PluginHost, type MethodConnection, type TurnRequest } from "@ragents/engine";
import { FILE_OPERATIONS, WORKSPACE_EXECUTOR_VERSION } from "@ragents/workspace-executor";
import { deferred, executionFor, noUsage } from "../../../packages/ragents/tests/support.ts";
import { WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";
import { RunWorkspaceRuntime } from "../../../plugins/ragents.workspace/server/runtime.ts";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { restartStartOptionId } from "../src/plugin-support/start-options-contract.ts";
import { actorChatHistoryOf } from "../src/ragents/actor-chat-history.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-server-restart-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.RESUME_AFTER_RESTART = "true";
const { createEngine, SessionWorkspaces } = await import("../src/ragents/engine.ts");
after(() => rm(directory, { recursive: true, force: true }));

const open = async (runId: string, clients = new WorkspaceClientRegistry([])) => {
  const plugins = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
  plugins.provideHost(productRuntimeToken, {
    coordinator: { handle: "primary", displayName: "Primary", profile: "unused", runTitle: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" },
    roleFor: () => "worker", contract: () => "", promptComposition: "",
    systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
  });
  let engine: Awaited<ReturnType<typeof createEngine>>;
  const workspace = new RunWorkspaceRuntime({
    globalDirectory: path.join(directory, "global"),
    sessionDirectory: (id, ...segments) => path.join(directory, "workspaces", id, ...segments),
    storageRootFor: (id) => path.join(directory, "workspaces", id),
    sessionsDirectoryPattern: path.join(directory, "workspaces", "{runId}"),
    sessionWorkspaceFor: (id) => workspace.resolve(id, () => {}),
    clients, contributions: [], skillPaths: async () => [], resolver: () => undefined,
    runState: (id) => engine.runtime.state(id), administratorFor: () => true,
    storeBinding: () => { throw new Error("Unexpected rebinding"); },
  });
  plugins.provideHost(workspaceRuntimeToken, workspace);
  const workspaces = new SessionWorkspaces(() => workspace.sandbox, (id, signal) => workspace.waitUntilReady(id, signal));
  workspaces.remember(runId, directory);
  engine = await createEngine({ plugins, workspaces, assertAvailable: () => {}, assertRunUsable: () => {} });
  return { engine, workspace, clients, close: async () => { await engine.shutdown(); await workspace.shutdown(); clients.shutdown(); } };
};

const create = (engine: Awaited<ReturnType<typeof createEngine>>, runId: string) => {
  const run = engine.runtime.createRun({ commandId: `create:${runId}` }, { runId, title: "Test", ownerHandle: "owner", ownerDisplayName: "Owner", ownerUserId: "alice" });
  const view = engine.runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn" }, runId, {
    handle: "worker", displayName: "Worker", prompt: "Finish the task.", toolNames: [], grants: [],
    execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }),
  });
  const actorId = view.actors.find((actor) => actor.kind === "agent")!.id;
  const input = engine.runtime.enqueueInput({ actorId: run.ownerId, commandId: "task" }, runId, { actorId, content: "Finish the task" }).inputs.at(-1)!;
  return { ownerId: run.ownerId, actorId, input };
};

test("server engine shutdown and startup continue an agent once and show the system line after replay", async (t) => {
  const requests: TurnRequest<"agent">[] = [];
  const started = deferred();
  t.mock.method(AgentLoopDriver.prototype, "runTurn", async (request: TurnRequest<"agent">, signal: AbortSignal) => {
    requests.push(request);
    if (requests.length === 1) {
      started.resolve();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    }
    return { failure: null, usage: noUsage() };
  });
  const runId = "server-restart";
  const first = await open(runId);
  const { actorId } = create(first.engine, runId);
  first.engine.start();
  await started.promise;
  await first.close();
  const second = await open(runId);
  try {
    second.engine.start();
    await second.engine.scheduler.waitForIdle();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1]!.input.origin, { kind: "restart", turnId: requests[0]!.turnId });
    assert.match(requests[1]!.input.content, /files may have been partly written/);
    const history = actorChatHistoryOf(second.engine.runtime.view(runId), second.engine.runtime.events(runId));
    assert.equal(history.actors[actorId].filter((message) => message.text === "Server restarted. Continuing the interrupted task.").length, 1);
    assert.ok(!history.actors[actorId].some((message) => message.text === requests[1]!.input.content));
  } finally { await second.close(); }
});

test("the stored per-run off setting suppresses recovery through the server engine", async () => {
  const runId = "server-restart-off";
  const first = await open(runId);
  const { actorId, input, ownerId } = create(first.engine, runId);
  first.engine.runtime.replacePluginState({ actorId: ownerId, commandId: "off" }, runId,
    { pluginId: restartStartOptionId, scope: { kind: "run" }, state: "off" });
  first.engine.runtime.startTurn({ actorId, commandId: "open-turn" }, runId, actorId, input.id);
  await first.close();
  const second = await open(runId);
  try {
    assert.equal(second.engine.runtime.view(runId).turns[0]?.restartRecovery?.outcome, "disabled");
    assert.equal(second.engine.runtime.view(runId).inputs.filter((entry) => typeof entry.origin === "object").length, 0);
  } finally { await second.close(); }
});

const description = { label: "Laptop", hostname: "laptop", platform: "darwin", folders: ["/home/example/project"],
  runsDirectory: "/home/example/runs", ripgrep: true };

const connection = (owner: string, calls: string[]): MethodConnection => ({
  id: owner, userId: owner, streamless: false, onClose: () => () => {},
  call: async (_contract, input) => {
    const operation = (input as { operation: string }).operation;
    calls.push(operation);
    assert.equal(operation, FILE_OPERATIONS.list);
    assert.equal((input as { cwd: string }).cwd, "/home/example/project");
    return { value: [] } as never;
  },
});

test("a recovered workstation turn waits for its own owner's connection and checks the workspace before the model", async (t) => {
  const runId = "server-workstation-restart";
  const first = await open(runId);
  const { ownerId, actorId, input } = create(first.engine, runId);
  first.engine.runtime.replacePluginState({ actorId: ownerId, commandId: "binding" }, runId, {
    pluginId: WORKSPACE_BINDING_OPTION_ID, scope: { kind: "run" },
    state: { machine: { client: "client-00000001", label: "Laptop" }, folder: { path: "/home/example/project" } },
  });
  first.engine.runtime.startTurn({ actorId, commandId: "open-turn" }, runId, actorId, input.id);
  await first.close();
  const second = await open(runId);
  const waiting = deferred();
  const completed = deferred();
  const checks: string[] = [];
  let turns = 0;
  const wait = second.clients.waitUntilConnected.bind(second.clients);
  t.mock.method(second.clients, "waitUntilConnected", (...args: Parameters<WorkspaceClientRegistry["waitUntilConnected"]>) => {
    waiting.resolve();
    return wait(...args);
  });
  t.mock.method(AgentLoopDriver.prototype, "runTurn", async () => {
    assert.deepEqual(checks, [FILE_OPERATIONS.list]);
    turns++;
    completed.resolve();
    return { failure: null, usage: noUsage() };
  });
  try {
    second.engine.start();
    await waiting.promise;
    assert.equal(turns, 0);
    assert.deepEqual(checks, []);
    await second.clients.register("client-00000001", description, WORKSPACE_EXECUTOR_VERSION, [], connection("bob", checks));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(turns, 0);
    await second.clients.register("client-00000001", description, WORKSPACE_EXECUTOR_VERSION, [], connection("alice", checks));
    await completed.promise;
    await second.engine.scheduler.waitForIdle();
    assert.equal(turns, 1);
  } finally { await second.close(); }
});

test("workstation reconnect waits obey the existing timeout and abort cleanly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const clients = new WorkspaceClientRegistry([]);
  const timed = clients.waitUntilConnected("alice", "client-00000001", "Laptop", new AbortController().signal);
  const rejected = assert.rejects(timed, /did not connect within 15 minutes/);
  t.mock.timers.tick(15 * 60 * 1000);
  await rejected;
  const abort = new AbortController();
  const cancelled = clients.waitUntilConnected("alice", "client-00000001", "Laptop", abort.signal);
  const stopped = assert.rejects(cancelled, /cancelled/);
  abort.abort(new Error("cancelled"));
  await stopped;
  clients.shutdown();
});

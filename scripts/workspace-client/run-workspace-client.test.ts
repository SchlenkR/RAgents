import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { claimTurn, DomainError, implement, pluginStateKey, ToolRegistry, TurnToolset, type HttpRouteContribution, type Orchestration, type RunState } from "@ragents/engine";
import {
  EXECUTOR_CONTRIBUTION_FILE,
  FILE_OPERATIONS,
  PROCESS_OPERATIONS,
  WORKSPACE_EXECUTOR_VERSION,
  bytesOf,
  loadExecutorContribution,
  openTunnelLeg,
  tunnelAddress,
  type ExecutorContributionRevision,
  type FileListing,
  type FileWatchProgress,
  type WorkspaceProcessSnapshot,
} from "@ragents/workspace-executor";
import { workspaceContracts, type WorkspaceBinding } from "../../plugins/ragents.workspace/contract.ts";
import { WORKSPACE_BINDING_OPTION_ID } from "../../plugins/ragents.workspace/contract.ts";
import { workspaceBindingOption } from "../../plugins/ragents.workspace/server/binding.ts";
import { clientMethods, WorkspaceClientRegistry, type WorkstationSignIn } from "../../plugins/ragents.workspace/server/clients.ts";
import { RunWorkspaceRuntime } from "../../plugins/ragents.workspace/server/runtime.ts";
import { workspaceClientTransport } from "../../plugins/ragents.workspace/client/transport.ts";
import { TunnelStreams } from "../../plugins/ragents.processes/server/tunnel-streams.ts";
import { WorkspaceClient } from "../../plugins/ragents.workspace/client/workspace-client.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { hostRoot } from "../../apps/server/src/host-version.ts";
import { startRpcServer } from "../../apps/server/tests/rpc-fixture.ts";
import { allGrants, catalog, postTo, setupRun } from "../../packages/ragents/tests/support.ts";
import { parseArguments, resolvedFolders, workspaceClientId } from "./run-workspace-client.ts";

const CLIENT = "cli-00000001";

/** The tests that do not look at the background commands of a sign-in. */
const ignoreSignIn = (): void => undefined;

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

const until = async (condition: () => boolean, timeoutMs = 5000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("the command line names server, folders, id and label", () => {
  assert.deepEqual(parseArguments(["http://127.0.0.1:3000", "/work/project"]), {
    serverUrl: "http://127.0.0.1:3000", folders: ["/work/project"], id: undefined, label: undefined, detached: false,
  });
  assert.deepEqual(parseArguments(["http://x", "--id", "cli-12345678", "--label", "Notebook"]), {
    serverUrl: "http://x", folders: [], id: "cli-12345678", label: "Notebook", detached: false,
  });
  assert.throws(() => parseArguments([]), /server address is missing/);
  assert.throws(() => parseArguments(["http://x", "--unknown"]), /Unknown argument/);
  assert.throws(() => parseArguments(["http://x", "--id"]), /needs a value/);
  assert.throws(() => parseArguments(["http://x", "--id", "short"]), /8 to 64 characters/);
  assert.equal(workspaceClientId("laptop", ["/work"]), workspaceClientId("laptop", ["/work"]));
  assert.notEqual(workspaceClientId("laptop", ["/work"]), workspaceClientId("laptop", ["/elsewhere"]));
  assert.match(workspaceClientId("laptop", ["/work"]), /^[A-Za-z0-9_-]{8,64}$/);
});

test("without folders the current directory applies, a missing folder is an error", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-folders-")));
  try {
    assert.deepEqual(resolvedFolders([], directory), [directory]);
    assert.deepEqual(resolvedFolders(["."], directory), [directory]);
    assert.throws(() => resolvedFolders(["missing"], directory), /Not a directory/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("without an explicit folder the caller from RAGENTS_CWD applies, not the script's working directory", async (t) => {
  const caller = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-caller-")));
  await mkdir(path.join(caller, "project"));
  const previous = process.env.RAGENTS_CWD;
  process.env.RAGENTS_CWD = caller;
  t.after(async () => {
    if (previous === undefined) delete process.env.RAGENTS_CWD;
    else process.env.RAGENTS_CWD = previous;
    await rm(caller, { recursive: true, force: true });
  });
  assert.notEqual(process.cwd(), caller);
  assert.deepEqual(resolvedFolders([]), [caller]);
  assert.deepEqual(resolvedFolders(["project"]), [path.join(caller, "project")]);
});

/** The headless workspace against real server methods: registration, executor and unregistration without VS Code. */
const started = async (t: TestContext, contributions: readonly ExecutorContributionRevision[] = [], routes: readonly HttpRouteContribution[] = []) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-client-")));
  const runs = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-runs-")));
  const registry = new WorkspaceClientRegistry(contributions);
  const { url } = await startRpcServer(t, { methods: clientMethods(registry, ignoreSignIn), routes });
  const transport = workspaceClientTransport(url, undefined);
  const client = new WorkspaceClient(transport, {
    id: CLIENT,
    label: "Headless",
    hostname: "cli-host",
    platform: process.platform,
    folders: [directory],
    runsDirectory: runs,
  }, { hostRoot });
  t.after(async () => {
    transport.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
  });
  return { directory, runs, registry, client, transport };
};

test("the headless workspace registers and executes the server's tools", async (t) => {
  const { directory, registry, client } = await started(t);
  await client.register();
  assert.deepEqual(client.status, { kind: "registered" });
  assert.deepEqual(registry.list(null).map((entry) => entry.id), [CLIENT]);
  assert.deepEqual(client.binding(directory), { machine: { client: CLIENT, label: "Headless" }, folder: { path: directory } });

  const executor = registry.executorFor(null, CLIENT, "Headless", directory);
  assert.equal(executor.version, WORKSPACE_EXECUTOR_VERSION);
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(path.join(directory, "src", "app.ts"), "const a = 1;\n", "utf8");
  assert.match(textOf(await executor.execute("run-1", "read", { file_path: "src/app.ts" })), /const a = 1/);
  await executor.execute("run-1", "edit", { file_path: "src/app.ts", old_string: "1", new_string: "2" });
  assert.equal(await readFile(path.join(directory, "src", "app.ts"), "utf8"), "const a = 2;\n");
  await executor.execute("run-1", "write", { file_path: "src/new.ts", content: "export {};\n" });
  assert.equal(await readFile(path.join(directory, "src", "new.ts"), "utf8"), "export {};\n");

  const progress: string[] = [];
  const bash = await executor.execute("run-1", "bash", { command: "pwd; printf marker-$RAGENTS_RUN_ID" }, {
    onProgress: (value) => progress.push((value as { text: string }).text),
  });
  assert.match(textOf(bash), /marker-run-1/);
  await until(() => progress.some((text) => text.includes("marker-run-1")));

  await assert.rejects(executor.execute("run-1", "read", { file_path: "/etc/hosts" }), /outside/);
  await executor.stopRun("run-1");

  await client.unregister();
  assert.deepEqual(client.status, { kind: "idle" });
  assert.deepEqual(registry.list(null), []);
});

test("the headless workspace loads the contributions the server requires from its host's bundles and serves their operations", async (t) => {
  const typescript = await loadExecutorContribution("ragents.lsp-typescript", path.join(hostRoot(), "bundles", "ragents.lsp-typescript", EXECUTOR_CONTRIBUTION_FILE));
  const { directory, registry, client } = await started(t, [{ plugin: typescript.plugin, revision: typescript.revision }]);
  await client.register();
  assert.deepEqual(client.status, { kind: "registered" });
  const executor = registry.executorFor(null, CLIENT, "Headless", directory);
  assert.deepEqual(await executor.execute("run-1", "typescript_snapshot", null), { instances: [] });
  await assert.rejects(executor.execute("run-1", "roslyn_snapshot", null), /The executor does not know the operation roslyn_snapshot/);
  await client.unregister();
});

test("an older server without the question about contributions does not accept the workspace, and the message says who needs updating", async (t) => {
  const registry = new WorkspaceClientRegistry([]);
  const older = clientMethods(registry, ignoreSignIn).filter((method) => method.contract.id !== workspaceContracts.clients.contributions.id);
  const { url } = await startRpcServer(t, { methods: older });
  const transport = workspaceClientTransport(url, undefined);
  t.after(() => transport.rpc.close());
  const client = new WorkspaceClient(transport, {
    id: CLIENT, label: "Headless", hostname: "cli-host", platform: process.platform, folders: [tmpdir()], runsDirectory: path.join(tmpdir(), "runs"),
  }, { hostRoot });
  await client.register();
  assert.equal(client.status.kind, "failed");
  assert.match((client.status as { message: string }).message,
    new RegExp(`The server does not know ragents\\.workspace\\.clients\\.contributions; it is older than this workstation with executor ${WORKSPACE_EXECUTOR_VERSION}\\. Update the server to the workstation's version`));
  assert.deepEqual(registry.list(null), []);
});

test("a run with a new folder per run works in the runs folder of the headless workspace, and deleting removes it", async (t) => {
  const { runs, registry, client } = await started(t);
  await client.register();
  const runId = "new-folder";
  const binding = workspaceBindingOption(registry, () => undefined)
    .accept({ machine: { client: CLIENT, label: "" }, folder: "fresh" }, { runId, userId: null });
  const folder = path.join(runs, runId);
  assert.deepEqual(binding, { machine: { client: CLIENT, label: "Headless" }, folder: { path: folder, fresh: true } });
  const state = {
    ownerUserId: null,
    pluginStates: new Map([[pluginStateKey(WORKSPACE_BINDING_OPTION_ID, { kind: "run" }),
      { pluginId: WORKSPACE_BINDING_OPTION_ID, scope: { kind: "run" }, state: binding, updatedAt: "2026-09-24T00:00:00.000Z" }]]),
  } as unknown as RunState;
  const server = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-server-")));
  const runtime: RunWorkspaceRuntime = new RunWorkspaceRuntime({
    globalDirectory: path.join(server, "global"),
    sessionDirectory: (id, ...segments) => path.join(server, "sessions", id, ...segments),
    storageRootFor: (id) => path.join(server, "sessions", id),
    sessionsDirectoryPattern: path.join(server, "sessions", "{runId}"),
    sessionWorkspaceFor: (id) => runtime.resolve(id, () => undefined),
    skillPaths: async () => [],
    resolver: () => undefined,
    runState: () => state,
    storeBinding: () => { throw new Error("not asked"); },
    clients: registry,
    contributions: [],
  });
  t.after(async () => {
    await runtime.shutdown();
    await rm(server, { recursive: true, force: true });
  });
  assert.equal((await runtime.resolve(runId, () => undefined)).cwd, folder);
  await assert.rejects(readFile(path.join(folder, "note.md"), "utf8"), /ENOENT/, "resolving creates nothing");
  await runtime.sandbox.execute(runId, "write", { file_path: "note.md", content: "on the workspace" });
  assert.equal(await readFile(path.join(folder, "note.md"), "utf8"), "on the workspace");
  assert.match(textOf(await runtime.sandbox.execute(runId, "bash", { command: "pwd" })), new RegExp(runId));
  await runtime.deleteSession(runId);
  await assert.rejects(readFile(path.join(folder, "note.md"), "utf8"), /ENOENT/);
});

test("unregistering succeeds even if the server has already removed the entry", async (t) => {
  const { registry, client } = await started(t);
  await client.register();
  registry.shutdown();
  assert.deepEqual(registry.list(null), []);

  await client.unregister();
  assert.deepEqual(client.status, { kind: "idle" });
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const detachedServer = [
  "const { spawn } = require(\"node:child_process\");",
  "const child = spawn(process.execPath, [\"-e\", \"require('node:net').createServer().listen(0, '127.0.0.1'); setTimeout(() => {}, 30000)\"], { detached: true, stdio: \"ignore\", env: process.env });",
  "child.unref();",
  "process.stdout.write(String(child.pid));",
].join("\n");

test("the headless workspace provides files, watching and processes of its machine", { timeout: 60_000 }, async (t) => {
  const { directory, registry, client } = await started(t);
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Headless", directory);
  const runId = `cli-files-${process.pid}`;
  t.after(() => executor.stopRun(runId));
  await mkdir(path.join(directory, "docs"), { recursive: true });
  await writeFile(path.join(directory, "docs", "note.md"), "Hello from the workspace\n", "utf8");

  const listing = await executor.execute(runId, FILE_OPERATIONS.list, { path: "docs" }) as FileListing;
  assert.equal(listing.location, directory);
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["note.md"]);
  assert.deepEqual(await executor.execute(runId, FILE_OPERATIONS.read, { path: "docs/note.md" }), {
    path: "docs/note.md", size: Buffer.byteLength("Hello from the workspace\n"), previewable: true, content: "Hello from the workspace\n",
  });
  await assert.rejects(executor.execute(runId, FILE_OPERATIONS.read, { path: "../secret" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-invalid" && error.status === 400);
  await assert.rejects(executor.execute(runId, FILE_OPERATIONS.read, { path: "setup.ts", alias: "@actors" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-alias-unknown" && /known: none/.test(error.message));

  const controller = new AbortController();
  const progress: FileWatchProgress[] = [];
  const watching = executor.execute(runId, FILE_OPERATIONS.watch, {}, {
    signal: controller.signal,
    untilAborted: true,
    onProgress: (value) => progress.push(value as FileWatchProgress),
  });
  await until(() => progress.length === 1);
  assert.deepEqual(progress, [{ kind: "ready" }]);
  await writeFile(path.join(directory, "docs", "new.md"), "new\n", "utf8");
  await until(() => progress.some((entry) => entry.kind === "changed"));
  controller.abort();
  await watching.catch(() => undefined);

  await writeFile(path.join(directory, "start.cjs"), detachedServer, "utf8");
  const startServer = async (): Promise<number> => {
    const output = await executor.execute(runId, "bash", { command: "node start.cjs" }, { toolCallId: "start" });
    return Number(textOf(output).trim().split("\n")[0]);
  };
  const first = await startServer();
  const second = await startServer();
  t.after(() => {
    for (const pid of [first, second]) if (alive(pid)) process.kill(pid, "SIGKILL");
  });
  let snapshot: WorkspaceProcessSnapshot | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    snapshot = await executor.execute(runId, PROCESS_OPERATIONS.snapshot, {}) as WorkspaceProcessSnapshot;
    if (snapshot.processes.filter((entry) => entry.ports.length > 0).length === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const firstProcess = snapshot?.processes.find((entry) => entry.pid === first);
  assert.ok(firstProcess, JSON.stringify(snapshot));
  assert.equal(firstProcess.origin, "background");
  assert.equal(firstProcess.ports.length, 1);
  assert.equal(await executor.execute(runId, PROCESS_OPERATIONS.stop, { processId: firstProcess.id }), null);
  await until(() => !alive(first));
  assert.equal(alive(second), true);
  await executor.stopRun(runId);
  await until(() => !alive(second));
  await client.unregister();
});

const echoServer = [
  "const { spawn } = require(\"node:child_process\");",
  "const child = spawn(process.execPath, [\"-e\", \"require('node:net').createServer((socket) => socket.pipe(socket)).listen(0, '127.0.0.1'); setTimeout(() => {}, 30000)\"], { detached: true, stdio: \"ignore\", env: process.env });",
  "child.unref();",
  "process.stdout.write(String(child.pid));",
].join("\n");

test("the headless workspace dials back to its server for a service of a run, and its legs close when it unregisters", { timeout: 60_000 }, async (t) => {
  const dialing = { executor: undefined as ReturnType<WorkspaceClientRegistry["executorFor"]> | undefined };
  const streams = new TunnelStreams({
    dial: async (runId, port, stream, signal) => { await dialing.executor!.execute(runId, PROCESS_OPERATIONS.dial, { port, stream }, { signal }); },
  });
  t.after(() => streams.shutdown());
  const { directory, registry, client, transport } = await started(t, [], [streams.route()]);
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Headless", directory);
  dialing.executor = executor;
  const runId = `cli-tunnel-${process.pid}`;
  await writeFile(path.join(directory, "echo.cjs"), echoServer, "utf8");
  const output = await executor.execute(runId, "bash", { command: "node echo.cjs" }, { toolCallId: "echo" });
  const pid = Number(textOf(output).trim().split("\n")[0]);
  t.after(() => { if (alive(pid)) process.kill(pid, "SIGKILL"); });
  let port: number | undefined;
  for (let attempt = 0; attempt < 50 && port === undefined; attempt++) {
    const snapshot = await executor.execute(runId, PROCESS_OPERATIONS.snapshot, {}) as WorkspaceProcessSnapshot;
    port = snapshot.processes.find((entry) => entry.pid === pid)?.ports[0]?.port;
    if (port === undefined) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(port, "the echo service of the run listens");

  const { path: stream } = await streams.open(runId, port, new AbortController().signal);
  const leg = await openTunnelLeg(tunnelAddress(transport.origin, stream));
  const echoed: Buffer[] = [];
  const closed = new Promise<{ code: number; reason: string }>((resolve) => leg.on("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") })));
  leg.on("message", (data, binary) => { if (binary) echoed.push(bytesOf(data)); });
  leg.resume();
  leg.send(Buffer.from([0, 1, 254, 255]), { binary: true });
  await until(() => Buffer.concat(echoed).length === 4);
  assert.deepEqual([...Buffer.concat(echoed)], [0, 1, 254, 255], "the workstation's executor reached the server under the address of its own connection");

  await client.unregister();
  assert.deepEqual(await closed, { code: 1001, reason: "The executor ends" }, "unregistering ends the workstation's legs, and the server closes the other one");
});

/** A watch on the workspace that ends only when its executor ends it. */
const watching = async (executor: ReturnType<WorkspaceClientRegistry["executorFor"]>, runId: string) => {
  const progress: FileWatchProgress[] = [];
  const ended = executor.execute(runId, FILE_OPERATIONS.watch, {}, {
    signal: new AbortController().signal,
    untilAborted: true,
    onProgress: (value) => progress.push(value as FileWatchProgress),
  }).then(() => "ended", (error: unknown) => `failed: ${error instanceof Error ? error.message : String(error)}`);
  await until(() => progress.length === 1);
  return { ended };
};

test("stopping a run succeeds even if its folder is no longer offered", async (t) => {
  const { directory, registry, client } = await started(t);
  const other = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-other-")));
  t.after(() => rm(other, { recursive: true, force: true }));
  await client.update([directory, other]);
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Headless", directory);
  const { ended } = await watching(executor, "run-stop");

  await client.update([other]);
  assert.deepEqual(registry.info(null, CLIENT)?.folders, [other]);
  await executor.stopRun("run-stop");
  assert.equal(await ended, "ended");
  assert.deepEqual(registry.pendingStops(null, CLIENT), []);
  await client.unregister();
});

test("a workspace with the folder / executes tasks in every folder below it", async (t) => {
  const { directory, registry, client } = await started(t);
  await writeFile(path.join(directory, "below.txt"), "below the root\n", "utf8");
  await client.update([path.parse(directory).root]);
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Headless", directory);
  const listing = await executor.execute("run-root", FILE_OPERATIONS.list, { path: "" }) as FileListing;
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["below.txt"]);
  await client.unregister();
});

test("unregistering waits only a limited time for the server and ends the executor anyway", { timeout: 30_000 }, async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-hang-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = new WorkspaceClientRegistry([]);
  const methods = [
    ...clientMethods(registry, ignoreSignIn).filter((method) => method.contract.id !== workspaceContracts.clients.unregister.id),
    implement(workspaceContracts.clients.unregister, () => new Promise<null>(() => undefined)),
  ];
  const { url } = await startRpcServer(t, { methods });
  const transport = workspaceClientTransport(url, undefined);
  t.after(() => transport.rpc.close());
  const client = new WorkspaceClient(transport, { id: CLIENT, label: "Headless", hostname: "cli-host", platform: process.platform, folders: [directory], runsDirectory: path.join(directory, "runs") }, { hostRoot });
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Headless", directory);
  const { ended } = await watching(executor, "run-hang");

  const begun = Date.now();
  await client.unregister();
  assert.ok(Date.now() - begun < 6_000, `unregistering took ${Date.now() - begun} ms`);
  assert.equal(client.status.kind === "failed" && /No response/.test(client.status.message), true, JSON.stringify(client.status));
  assert.match(await ended, /ended|failed/);
});

const exists = (file: string): Promise<boolean> => access(file).then(() => true, () => false);

const untilAsync = async (condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> => {
  const started = Date.now();
  while (!await condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("after a server restart the workstation names its background commands at sign-in, and each end reaches the actor that started it once", { skip: process.platform === "win32", timeout: 60_000 }, async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-restart-")));
  const storage = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-restart-server-")));
  const setup = setupRun({ grants: allGrants(), toolNames: null });
  t.after(async () => {
    setup.journal.close();
    await rm(directory, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  });
  const runId = setup.view.id;
  const binding: WorkspaceBinding = { machine: { client: CLIENT, label: "Headless" }, folder: { path: directory } };
  const state = {
    ownerUserId: null,
    pluginStates: new Map([[pluginStateKey(WORKSPACE_BINDING_OPTION_ID, { kind: "run" }),
      { pluginId: WORKSPACE_BINDING_OPTION_ID, scope: { kind: "run" }, state: binding, updatedAt: "2026-10-04T00:00:00.000Z" }]]),
  } as unknown as RunState;
  /** One life of the server: its registry, its workspace runtime and its methods, gone with its stop. */
  const serverLife = async (port: number | undefined) => {
    const registry = new WorkspaceClientRegistry([]);
    const runtime: RunWorkspaceRuntime = new RunWorkspaceRuntime({
      globalDirectory: path.join(storage, "global"),
      sessionDirectory: (id, ...segments) => path.join(storage, "sessions", id, ...segments),
      storageRootFor: (id) => path.join(storage, "sessions", id),
      sessionsDirectoryPattern: path.join(storage, "sessions", "{runId}"),
      sessionWorkspaceFor: (id) => runtime.resolve(id, () => undefined),
      skillPaths: async () => [],
      resolver: () => undefined,
      runState: (id) => id === runId ? state : null,
      storeBinding: () => { throw new Error("not asked"); },
      clients: registry,
      contributions: [],
    });
    const signIns: WorkstationSignIn[] = [];
    const server = await startRpcServer(t, {
      ...(port === undefined ? {} : { port }),
      methods: clientMethods(registry, (signIn) => {
        signIns.push(signIn);
        runtime.resumeBackgroundTasks(setup.runtime, signIn);
      }),
    });
    const stop = async (): Promise<void> => {
      await runtime.shutdown();
      await server.close();
    };
    t.after(stop);
    return { runtime, signIns, url: server.url, stop };
  };
  const first = await serverLife(undefined);
  const rpc = new RpcClient({ baseUrl: first.url, retryDelayMs: 50 });
  const client = new WorkspaceClient({ origin: first.url, rpc }, {
    id: CLIENT, label: "Headless", hostname: "cli-host", platform: process.platform, folders: [directory], runsDirectory: path.join(storage, "runs"),
  }, { hostRoot });
  t.after(async () => {
    await client.unregister();
    rpc.close();
  });
  await client.register();
  assert.deepEqual(client.status, { kind: "registered" });

  const queued = postTo(setup.runtime, setup.view, setup.agent.id, "restart-input", "Start the services.");
  const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
  assert.ok(input);
  const turn = claimTurn(setup.runtime, runId, setup.agent.id, input.id, "restart-turn");
  const toolsOf = (life: Awaited<ReturnType<typeof serverLife>>) =>
    TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry: new ToolRegistry().register(life.runtime.sandbox.workspaceTools()), workspace: directory });
  const before = await toolsOf(first);
  const start = async (id: string, flag: string, code: number): Promise<string> => {
    const text = String((await before.invoke(id, "bash", { command: `while [ ! -e ${flag} ]; do sleep 0.05; done; rm ${flag}; exit ${code}`, run_in_background: true } as never)).output);
    const task = /with ID: (b[0-9a-f]{6})\./.exec(text)?.[1];
    assert.ok(task, text);
    return task;
  };
  const meanwhile = await start("start-meanwhile", "meanwhile.flag", 3);
  const later = await start("start-later", "later.flag", 4);
  const notices = () => setup.runtime.view(runId).inputs
    .filter((entry) => entry.actorId === setup.agent.id && entry.presentation === "background")
    .map((entry) => entry.content);

  const port = Number(new URL(first.url).port);
  await first.stop();
  await writeFile(path.join(directory, "meanwhile.flag"), "");
  await untilAsync(async () => !await exists(path.join(directory, "meanwhile.flag")));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(notices(), [], "nobody observes while the server is down");

  const second = await serverLife(port);
  await until(() => second.signIns.length === 1, 10_000);
  const named = [...second.signIns[0]!.backgroundTasks].sort((left, right) => left.taskId.localeCompare(right.taskId));
  assert.deepEqual(named, [
    { runId, taskId: meanwhile, startedBy: setup.agent.id },
    { runId, taskId: later, startedBy: setup.agent.id },
  ].sort((left, right) => left.taskId.localeCompare(right.taskId)), "the sign-in names both commands with the actor that started them");
  await until(() => notices().length >= 1, 10_000);
  assert.deepEqual(notices(), [`Background command ${meanwhile} exited with code 3. task_output reads what it wrote last.`], "an end while the server was down arrives after the sign-in");
  const after = await toolsOf(second);
  assert.equal(String((await after.invoke("read-meanwhile", "task_output", { task_id: meanwhile } as never)).output), "(no new output)\n\nStatus: exited with code 3");

  await client.update([directory, storage]);
  await until(() => second.signIns.length === 2, 10_000);
  assert.deepEqual(second.signIns[1]!.backgroundTasks.map((task) => task.taskId), [later], "a reported end is not named again, a running command is");
  await writeFile(path.join(directory, "later.flag"), "");
  await until(() => notices().length >= 2, 10_000);
  assert.equal(notices()[1], `Background command ${later} exited with code 4. task_output reads what it wrote last.`);
  await client.update([directory]);
  await until(() => second.signIns.length === 3, 10_000);
  assert.deepEqual(second.signIns[2]!.backgroundTasks, []);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(notices().length, 2, "a second sign-in during an observation adds no second observation");
});

test("after a server restart the workstation's background commands of a run the server no longer has end there with their output, those of a run bound elsewhere keep running", { skip: process.platform === "win32", timeout: 60_000 }, async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-absent-")));
  const storage = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-absent-server-")));
  const gone = `cli-gone-${process.pid}`;
  const kept = `cli-kept-${process.pid}`;
  const outputOf = (runId: string, taskId: string): string => path.join(tmpdir(), "ragents-workspace-logs", runId, "background", `${taskId}.log`);
  const pids: number[] = [];
  t.after(async () => {
    for (const pid of pids) if (alive(pid)) process.kill(-pid, "SIGKILL");
    await rm(directory, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  });
  const elsewhere: WorkspaceBinding = { machine: { client: "cli-00000002", label: "Other" }, folder: { path: directory } };
  const keptState = {
    ownerUserId: null,
    pluginStates: new Map([[pluginStateKey(WORKSPACE_BINDING_OPTION_ID, { kind: "run" }),
      { pluginId: WORKSPACE_BINDING_OPTION_ID, scope: { kind: "run" }, state: elsewhere, updatedAt: "2026-10-04T00:00:00.000Z" }]]),
  } as unknown as RunState;
  const firstRegistry = new WorkspaceClientRegistry([]);
  const first = await startRpcServer(t, { methods: clientMethods(firstRegistry, ignoreSignIn) });
  const rpc = new RpcClient({ baseUrl: first.url, retryDelayMs: 50 });
  const client = new WorkspaceClient({ origin: first.url, rpc }, {
    id: CLIENT, label: "Headless", hostname: "cli-host", platform: process.platform, folders: [directory], runsDirectory: path.join(storage, "runs"),
  }, { hostRoot });
  t.after(async () => {
    await client.unregister();
    rpc.close();
  });
  await client.register();
  assert.deepEqual(client.status, { kind: "registered" });
  const executor = firstRegistry.executorFor(null, CLIENT, "Headless", directory);
  const start = async (runId: string): Promise<{ task: string; pid: number }> => {
    const pidFile = path.join(directory, `${runId}.pid`);
    const command = `echo started; printf %s $$ > ${runId}.pid; while :; do sleep 0.05; done`;
    const text = textOf(await executor.execute(runId, "bash", { command, run_in_background: true, startedBy: "agent-1" }, { toolCallId: `start-${runId}` }));
    const task = /with ID: (b[0-9a-f]{6})\./.exec(text)?.[1];
    assert.ok(task, text);
    await untilAsync(() => exists(pidFile));
    await untilAsync(async () => (await readFile(pidFile, "utf8")).length > 0);
    const pid = Number(await readFile(pidFile, "utf8"));
    pids.push(pid);
    return { task, pid };
  };
  const goneTask = await start(gone);
  const keptTask = await start(kept);
  assert.ok(alive(goneTask.pid) && alive(keptTask.pid));
  assert.ok(await exists(outputOf(gone, goneTask.task)) && await exists(outputOf(kept, keptTask.task)));

  const port = Number(new URL(first.url).port);
  firstRegistry.shutdown();
  await first.close();
  const warnings: string[] = [];
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  const registry = new WorkspaceClientRegistry([]);
  const runtime: RunWorkspaceRuntime = new RunWorkspaceRuntime({
    globalDirectory: path.join(storage, "global"),
    sessionDirectory: (id, ...segments) => path.join(storage, "sessions", id, ...segments),
    storageRootFor: (id) => path.join(storage, "sessions", id),
    sessionsDirectoryPattern: path.join(storage, "sessions", "{runId}"),
    sessionWorkspaceFor: (id) => runtime.resolve(id, () => undefined),
    skillPaths: async () => [],
    resolver: () => undefined,
    runState: (id) => id === kept ? keptState : null,
    storeBinding: () => { throw new Error("not asked"); },
    clients: registry,
    contributions: [],
  });
  const signIns: WorkstationSignIn[] = [];
  const second = await startRpcServer(t, {
    port,
    methods: clientMethods(registry, (signIn) => {
      signIns.push(signIn);
      runtime.resumeBackgroundTasks({} as Orchestration, signIn);
    }),
  });
  t.after(async () => {
    await runtime.shutdown();
    await second.close();
  });
  await until(() => signIns.length === 1, 10_000);
  assert.deepEqual(signIns[0]!.backgroundTasks.map((task) => task.runId).sort(), [gone, kept].sort());
  await untilAsync(async () => !alive(goneTask.pid) && !await exists(outputOf(gone, goneTask.task)));
  await until(() => warnings.some((warning) => warning.includes(goneTask.task)), 10_000);
  assert.deepEqual(warnings.filter((warning) => warning.includes(goneTask.task)), [
    `The workstation Headless names background command ${goneTask.task} of run ${gone}, which this server does not have; the server stopped it there and removed its output.`,
  ]);
  assert.deepEqual(warnings.filter((warning) => warning.includes(keptTask.task)), [
    `The workstation Headless names background command ${keptTask.task} of run ${kept}, which is not bound to it on this server; it keeps running there until the workstation ends it.`,
  ]);
  assert.equal(alive(keptTask.pid), true, "a command of a run that exists stays, even when the run is bound elsewhere");
  assert.equal(await exists(outputOf(kept, keptTask.task)), true);
  assert.deepEqual(registry.pendingStops(null, CLIENT), []);

  await registry.executorFor(null, CLIENT, "Headless", directory).stopRun(kept);
  await untilAsync(async () => !alive(keptTask.pid) && !await exists(outputOf(kept, keptTask.task)));
});

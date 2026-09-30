import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { DomainError, implement, pluginStateKey, type RunState } from "@ragents/engine";
import {
  EXECUTOR_CONTRIBUTION_FILE,
  FILE_OPERATIONS,
  PROCESS_OPERATIONS,
  WORKSPACE_EXECUTOR_VERSION,
  loadExecutorContribution,
  type ExecutorContributionRevision,
  type FileListing,
  type FileWatchProgress,
  type WorkspaceProcessSnapshot,
} from "@ragents/workspace-executor";
import { workspaceContracts } from "../../plugins/ragents.workspace/contract.ts";
import { WORKSPACE_BINDING_OPTION_ID } from "../../plugins/ragents.workspace/contract.ts";
import { workspaceBindingOption } from "../../plugins/ragents.workspace/server/binding.ts";
import { clientMethods, WorkspaceClientRegistry } from "../../plugins/ragents.workspace/server/clients.ts";
import { RunWorkspaceRuntime } from "../../plugins/ragents.workspace/server/runtime.ts";
import { workspaceClientTransport } from "../../plugins/ragents.workspace/client/transport.ts";
import { WorkspaceClient } from "../../plugins/ragents.workspace/client/workspace-client.ts";
import { hostRoot } from "../../apps/server/src/host-version.ts";
import { startRpcServer } from "../../apps/server/tests/rpc-fixture.ts";
import { parseArguments, resolvedFolders, workspaceClientId } from "./run-workspace-client.ts";

const CLIENT = "cli-00000001";

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
const started = async (t: TestContext, contributions: readonly ExecutorContributionRevision[] = []) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-client-")));
  const runs = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-runs-")));
  const registry = new WorkspaceClientRegistry(contributions);
  const { url } = await startRpcServer(t, { methods: clientMethods(registry) });
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
  assert.match(textOf(await executor.execute("run-1", "read", { path: "src/app.ts" })), /const a = 1/);
  await executor.execute("run-1", "edit", { path: "src/app.ts", edits: [{ oldText: "1", newText: "2" }] });
  assert.equal(await readFile(path.join(directory, "src", "app.ts"), "utf8"), "const a = 2;\n");
  await executor.execute("run-1", "write", { path: "src/new.ts", content: "export {};\n" });
  assert.equal(await readFile(path.join(directory, "src", "new.ts"), "utf8"), "export {};\n");

  const progress: string[] = [];
  const bash = await executor.execute("run-1", "bash", { command: "pwd; printf marker-$RAGENTS_RUN_ID" }, {
    onProgress: (value) => progress.push((value as { text: string }).text),
  });
  assert.match(textOf(bash), /marker-run-1/);
  await until(() => progress.some((text) => text.includes("marker-run-1")));

  await assert.rejects(executor.execute("run-1", "read", { path: "/etc/hosts" }), /outside/);
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
  const older = clientMethods(registry).filter((method) => method.contract.id !== workspaceContracts.clients.contributions.id);
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
  await runtime.sandbox.execute(runId, "write", { path: "note.md", content: "on the workspace" });
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
    ...clientMethods(registry).filter((method) => method.contract.id !== workspaceContracts.clients.unregister.id),
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

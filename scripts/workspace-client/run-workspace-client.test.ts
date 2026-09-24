import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { DomainError, implement } from "@ragents/engine";
import {
  FILE_OPERATIONS,
  PROCESS_OPERATIONS,
  WORKSPACE_EXECUTOR_VERSION,
  type FileListing,
  type FileWatchProgress,
  type WorkspaceProcessSnapshot,
} from "@ragents/workspace-executor";
import { workspaceContracts } from "../../plugins/ragents.workspace/contract.ts";
import { clientMethods, WorkspaceClientRegistry } from "../../plugins/ragents.workspace/server/clients.ts";
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
    if (Date.now() - started > timeoutMs) throw new Error("Bedingung wurde nicht erfüllt.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("die Kommandozeile nennt Server, Ordner, Kennung und Label", () => {
  assert.deepEqual(parseArguments(["http://127.0.0.1:3000", "/work/projekt"]), {
    serverUrl: "http://127.0.0.1:3000", folders: ["/work/projekt"], id: undefined, label: undefined,
  });
  assert.deepEqual(parseArguments(["http://x", "--id", "cli-12345678", "--label", "Notebook"]), {
    serverUrl: "http://x", folders: [], id: "cli-12345678", label: "Notebook",
  });
  assert.throws(() => parseArguments([]), /Serveradresse fehlt/);
  assert.throws(() => parseArguments(["http://x", "--unbekannt"]), /Unbekanntes Argument/);
  assert.throws(() => parseArguments(["http://x", "--id"]), /braucht einen Wert/);
  assert.throws(() => parseArguments(["http://x", "--id", "kurz"]), /8 bis 64 Zeichen/);
  assert.equal(workspaceClientId("laptop", ["/work"]), workspaceClientId("laptop", ["/work"]));
  assert.notEqual(workspaceClientId("laptop", ["/work"]), workspaceClientId("laptop", ["/anderswo"]));
  assert.match(workspaceClientId("laptop", ["/work"]), /^[A-Za-z0-9_-]{8,64}$/);
});

test("ohne Ordner gilt das aktuelle Verzeichnis, ein fehlender Ordner ist ein Fehler", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-folders-")));
  try {
    assert.deepEqual(resolvedFolders([], directory), [directory]);
    assert.deepEqual(resolvedFolders(["."], directory), [directory]);
    assert.throws(() => resolvedFolders(["fehlt"], directory), /Kein Verzeichnis/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ohne ausdrücklichen Ordner gilt der Aufrufer aus RAGENTS_CWD, nicht das Arbeitsverzeichnis des Skripts", async (t) => {
  const caller = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-caller-")));
  await mkdir(path.join(caller, "projekt"));
  const previous = process.env.RAGENTS_CWD;
  process.env.RAGENTS_CWD = caller;
  t.after(async () => {
    if (previous === undefined) delete process.env.RAGENTS_CWD;
    else process.env.RAGENTS_CWD = previous;
    await rm(caller, { recursive: true, force: true });
  });
  assert.notEqual(process.cwd(), caller);
  assert.deepEqual(resolvedFolders([]), [caller]);
  assert.deepEqual(resolvedFolders(["projekt"]), [path.join(caller, "projekt")]);
});

/** Der kopflose Arbeitsplatz gegen echte Server-Methoden: Anmeldung, Executor und Abmeldung ohne VS Code. */
const started = async (t: TestContext) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-client-")));
  const registry = new WorkspaceClientRegistry();
  const { url } = await startRpcServer(t, { methods: clientMethods(registry) });
  const transport = workspaceClientTransport(url, undefined);
  const client = new WorkspaceClient(transport, {
    id: CLIENT,
    label: "Kopflos",
    hostname: "cli-host",
    platform: process.platform,
    folders: [directory],
  }, { hostRoot });
  t.after(async () => {
    transport.rpc.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, registry, client, transport };
};

test("der kopflose Arbeitsplatz meldet sich an und führt die Werkzeuge des Servers aus", async (t) => {
  const { directory, registry, client } = await started(t);
  await client.register();
  assert.deepEqual(client.status, { kind: "registered" });
  assert.deepEqual(registry.list(null).map((entry) => entry.id), [CLIENT]);
  assert.deepEqual(client.binding(directory), { kind: "client", client: CLIENT, label: "Kopflos", path: directory });

  const executor = registry.executorFor(null, CLIENT, "Kopflos", directory);
  assert.equal(executor.version, WORKSPACE_EXECUTOR_VERSION);
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(path.join(directory, "src", "app.ts"), "const a = 1;\n", "utf8");
  assert.match(textOf(await executor.execute("run-1", "read", { path: "src/app.ts" })), /const a = 1/);
  await executor.execute("run-1", "edit", { path: "src/app.ts", edits: [{ oldText: "1", newText: "2" }] });
  assert.equal(await readFile(path.join(directory, "src", "app.ts"), "utf8"), "const a = 2;\n");
  await executor.execute("run-1", "write", { path: "src/neu.ts", content: "export {};\n" });
  assert.equal(await readFile(path.join(directory, "src", "neu.ts"), "utf8"), "export {};\n");

  const progress: string[] = [];
  const bash = await executor.execute("run-1", "bash", { command: "pwd; printf marker-$RAGENTS_RUN_ID" }, {
    onProgress: (value) => progress.push((value as { text: string }).text),
  });
  assert.match(textOf(bash), /marker-run-1/);
  await until(() => progress.some((text) => text.includes("marker-run-1")));

  await assert.rejects(executor.execute("run-1", "read", { path: "/etc/hosts" }), /außerhalb/);
  await executor.stopRun("run-1");

  await client.unregister();
  assert.deepEqual(client.status, { kind: "idle" });
  assert.deepEqual(registry.list(null), []);
});

test("die Abmeldung gelingt auch, wenn der Server den Eintrag schon entfernt hat", async (t) => {
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

test("der kopflose Arbeitsplatz liefert Dateien, Beobachtung und Prozesse seines Rechners", { timeout: 60_000 }, async (t) => {
  const { directory, registry, client } = await started(t);
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Kopflos", directory);
  const runId = `cli-files-${process.pid}`;
  t.after(() => executor.stopRun(runId));
  await mkdir(path.join(directory, "docs"), { recursive: true });
  await writeFile(path.join(directory, "docs", "notiz.md"), "Hallo vom Arbeitsplatz\n", "utf8");

  const listing = await executor.execute(runId, FILE_OPERATIONS.list, { path: "docs" }) as FileListing;
  assert.equal(listing.location, directory);
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["notiz.md"]);
  assert.deepEqual(await executor.execute(runId, FILE_OPERATIONS.read, { path: "docs/notiz.md" }), {
    path: "docs/notiz.md", size: Buffer.byteLength("Hallo vom Arbeitsplatz\n"), previewable: true, content: "Hallo vom Arbeitsplatz\n",
  });
  await assert.rejects(executor.execute(runId, FILE_OPERATIONS.read, { path: "../geheim" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-invalid" && error.status === 400);
  await assert.rejects(executor.execute(runId, FILE_OPERATIONS.read, { path: "setup.ts", alias: "@actors" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-alias-unknown" && /bekannt: keine/.test(error.message));

  const controller = new AbortController();
  const progress: FileWatchProgress[] = [];
  const watching = executor.execute(runId, FILE_OPERATIONS.watch, {}, {
    signal: controller.signal,
    untilAborted: true,
    onProgress: (value) => progress.push(value as FileWatchProgress),
  });
  await until(() => progress.length === 1);
  assert.deepEqual(progress, [{ kind: "ready" }]);
  await writeFile(path.join(directory, "docs", "neu.md"), "neu\n", "utf8");
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

/** Eine Beobachtung auf dem Arbeitsplatz, die erst endet, wenn ihr Executor sie beendet. */
const watching = async (executor: ReturnType<WorkspaceClientRegistry["executorFor"]>, runId: string) => {
  const progress: FileWatchProgress[] = [];
  const ended = executor.execute(runId, FILE_OPERATIONS.watch, {}, {
    signal: new AbortController().signal,
    untilAborted: true,
    onProgress: (value) => progress.push(value as FileWatchProgress),
  }).then(() => "beendet", (error: unknown) => `gescheitert: ${error instanceof Error ? error.message : String(error)}`);
  await until(() => progress.length === 1);
  return { ended };
};

test("der Stopp eines Runs gelingt auch, wenn sein Ordner nicht mehr angeboten wird", async (t) => {
  const { directory, registry, client } = await started(t);
  const other = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-other-")));
  t.after(() => rm(other, { recursive: true, force: true }));
  await client.update([directory, other]);
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Kopflos", directory);
  const { ended } = await watching(executor, "run-stop");

  await client.update([other]);
  assert.deepEqual(registry.info(null, CLIENT)?.folders, [other]);
  await executor.stopRun("run-stop");
  assert.equal(await ended, "beendet");
  assert.deepEqual(registry.pendingStops(null, CLIENT), []);
  await client.unregister();
});

test("ein Arbeitsplatz mit dem Ordner / führt Aufträge in jedem Ordner darunter aus", async (t) => {
  const { directory, registry, client } = await started(t);
  await writeFile(path.join(directory, "unten.txt"), "unter der Wurzel\n", "utf8");
  await client.update([path.parse(directory).root]);
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Kopflos", directory);
  const listing = await executor.execute("run-root", FILE_OPERATIONS.list, { path: "" }) as FileListing;
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["unten.txt"]);
  await client.unregister();
});

test("die Abmeldung wartet nur begrenzt auf den Server und beendet den Executor trotzdem", { timeout: 30_000 }, async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-cli-hang-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = new WorkspaceClientRegistry();
  const methods = [
    ...clientMethods(registry).filter((method) => method.contract.id !== workspaceContracts.clients.unregister.id),
    implement(workspaceContracts.clients.unregister, () => new Promise<null>(() => undefined)),
  ];
  const { url } = await startRpcServer(t, { methods });
  const transport = workspaceClientTransport(url, undefined);
  t.after(() => transport.rpc.close());
  const client = new WorkspaceClient(transport, { id: CLIENT, label: "Kopflos", hostname: "cli-host", platform: process.platform, folders: [directory] }, { hostRoot });
  await client.register();
  const executor = registry.executorFor(null, CLIENT, "Kopflos", directory);
  const { ended } = await watching(executor, "run-hang");

  const begun = Date.now();
  await client.unregister();
  assert.ok(Date.now() - begun < 6_000, `die Abmeldung dauerte ${Date.now() - begun} ms`);
  assert.equal(client.status.kind === "failed" && /Keine Antwort/.test(client.status.message), true, JSON.stringify(client.status));
  assert.match(await ended, /beendet|gescheitert/);
});

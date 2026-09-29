import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  EXECUTOR_CONTRIBUTION_FILE,
  RUN_MARKER_ENV,
  languageServerOpenOperation,
  languageServerSnapshotOperation,
  loadExecutorContribution,
  ripgrepAvailable,
  type ExecutorContributionStand,
  type LanguageServerSnapshot,
} from "@ragents/workspace-executor";
import { runContracts } from "../../../packages/ragents/src/http/contracts";
import { coreContracts } from "../../server/src/api/contracts";
import { workspaceClientContracts } from "../../../plugins/ragents.workspace/contract";
import { WorkspaceClient } from "../../../plugins/ragents.workspace/client/workspace-client";
import { typescriptLanguageServer } from "../../../plugins/ragents.lsp-typescript/executor";
import { ServerClient } from "../src/server-client";
import { startStubServer, waitFor, type StubServer } from "./fixtures";

const CLIENT_ID = "vscode-notebook";
const RUN = "run-a";

const folder = async (): Promise<string> => mkdtemp(join(tmpdir(), "ragents-workspace-"));

const textOf = (value: unknown): string =>
  ((value as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

const started = async (server: StubServer, rg?: string) => {
  const client = new ServerClient(server.url, undefined);
  const directory = await folder();
  const runs = await folder();
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID,
    label: "Notebook",
    hostname: "notebook.local",
    platform: process.platform,
    folders: [directory],
    runsDirectory: runs,
  }, { hostRoot: () => undefined, rg });
  await workspace.register();
  assert.deepEqual(workspace.status, { kind: "registered" });
  const connection = server.workspaceConnection(CLIENT_ID);
  assert.ok(connection);
  const call = (
    operation: string,
    input: unknown,
    cwd: string,
    options: { onProgress?: (value: unknown) => void; signal?: AbortSignal } = {},
  ) => connection.call(
    workspaceClientContracts.execute,
    { runId: RUN, operation, toolCallId: `call-${operation}`, cwd, env: { [RUN_MARKER_ENV]: RUN, CI: "true" }, input },
    options,
  );
  return {
    client,
    directory,
    runs,
    workspace,
    call,
    execute: (operation: string, input: unknown, options?: { onProgress?: (value: unknown) => void; signal?: AbortSignal }) =>
      call(operation, input, directory, options ?? {}),
  };
};

test("der Arbeitsplatz meldet sich an und führt die Werkzeuge in seinem Ordner aus", async () => {
  const server = await startStubServer();
  const { client, directory, runs, workspace, call, execute } = await started(server);
  try {
    assert.deepEqual(server.workspaceClients().get(CLIENT_ID), {
      label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [directory], runsDirectory: runs,
      ripgrep: ripgrepAvailable(undefined, process.env),
    });
    await writeFile(join(directory, "notiz.md"), "Grüße\n", "utf8");
    assert.match(textOf((await execute("read", { path: "notiz.md" })).value), /Grüße/);
    await execute("write", { path: "neu/datei.txt", content: "inhalt" });
    assert.equal(await readFile(join(directory, "neu/datei.txt"), "utf8"), "inhalt");
    await execute("edit", { path: "neu/datei.txt", edits: [{ oldText: "inhalt", newText: "geändert" }] });
    assert.equal(await readFile(join(directory, "neu/datei.txt"), "utf8"), "geändert");
    await assert.rejects(execute("read", { path: "/etc/hosts" }), /außerhalb des Arbeitsverzeichnisses/);
    await assert.rejects(call("read", { path: "hosts" }, "/etc"), /Pfad außerhalb des angebotenen Ordners: \/etc/);
    const listing = (await execute("files.list", { path: "neu" })).value as { entries: Array<{ name: string }> };
    assert.deepEqual(listing.entries.map((entry) => entry.name), ["datei.txt"]);
    assert.deepEqual((await execute("files.read", { path: "neu/datei.txt" })).value, { path: "neu/datei.txt", size: Buffer.byteLength("geändert"), previewable: true, content: "geändert" });
    await assert.rejects(execute("files.read", { path: "../geheim" }), /Ungültiger Pfad: \.\.\/geheim/);
    await assert.rejects(execute("grep", {}), /Der Executor kennt die Operation grep nicht/);
    assert.deepEqual(workspace.binding(directory), { machine: { client: CLIENT_ID, label: "Notebook" }, folder: { path: directory } });
    await execute("stop", null);
    await workspace.unregister();
    assert.deepEqual(workspace.status, { kind: "idle" });
    assert.equal(server.workspaceClients().has(CLIENT_ID), false);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
    await server.close();
  }
});

test("die Bash des Arbeitsplatzes erbt die Umgebung dieses Rechners, ohne VS-Code-Variablen und ohne BASH_ENV", async () => {
  const server = await startStubServer();
  const { client, directory, runs, execute } = await started(server);
  const startup = join(directory, "startup.sh");
  const names = ["RAGENTS_TEST_OWN_TOOL", "VSCODE_RAGENTS_TEST", "ELECTRON_RAGENTS_TEST", "BASH_ENV"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    await writeFile(startup, "echo startdatei-gelesen\n", "utf8");
    process.env.RAGENTS_TEST_OWN_TOOL = "vom-benutzer";
    process.env.VSCODE_RAGENTS_TEST = "editor";
    process.env.ELECTRON_RAGENTS_TEST = "editor";
    process.env.BASH_ENV = startup;
    const output = textOf((await execute("bash", {
      command: 'printf "%s|%s|%s|%s|%s" "$RAGENTS_TEST_OWN_TOOL" "${VSCODE_RAGENTS_TEST-leer}" "${ELECTRON_RAGENTS_TEST-leer}" "${BASH_ENV-leer}" "$CI"',
    })).value);
    assert.equal(output.trim(), "vom-benutzer|leer|leer|leer|true");
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
    await server.close();
  }
});

test("mit mitgebrachtem rg meldet der Arbeitsplatz rg an und seine Bash findet genau dieses zuerst", async () => {
  const tools = await folder();
  const rg = join(tools, "rg", process.platform === "win32" ? "rg.exe" : "rg");
  await mkdir(join(tools, "rg"), { recursive: true });
  await writeFile(rg, "#!/bin/sh\necho rg-mitgebracht\n", "utf8");
  await chmod(rg, 0o755);
  const server = await startStubServer();
  const { client, directory, runs, execute } = await started(server, rg);
  try {
    assert.equal(server.workspaceClients().get(CLIENT_ID)?.ripgrep, true);
    const output = textOf((await execute("bash", { command: "command -v rg; rg --version" })).value);
    assert.deepEqual(output.trim().split("\n"), [rg, "rg-mitgebracht"]);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
    await rm(tools, { recursive: true, force: true });
    await server.close();
  }
});

test("ein genanntes rg, das fehlt, lässt die Anmeldung mit Ursache scheitern", async () => {
  const server = await startStubServer();
  const client = new ServerClient(server.url, undefined);
  const missing = join(tmpdir(), "ragents-kein-rg", "rg");
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [tmpdir()], runsDirectory: join(tmpdir(), "ragents-runs"),
  }, { hostRoot: () => undefined, rg: missing });
  try {
    await workspace.register();
    assert.equal(workspace.status.kind, "failed");
    assert.match(workspace.status.kind === "failed" ? workspace.status.message : "", /Das rg dieses Executors fehlt: .*ragents-kein-rg/);
    assert.equal(server.workspaceClients().has(CLIENT_ID), false);
  } finally {
    await workspace.unregister();
    client.rpc.close();
    await server.close();
  }
});

test("der neue Ordner eines Runs entsteht im Ordner für Runs des Arbeitsplatzes, und nur dieser eine ist neben den angebotenen erlaubt", async () => {
  const server = await startStubServer();
  const { client, directory, runs, call } = await started(server);
  const own = join(runs, RUN);
  try {
    assert.deepEqual((await call("runFolder.create", null, own)).value, { created: true });
    assert.deepEqual((await call("runFolder.create", null, own)).value, { created: false }, "ein vorhandener Ordner bleibt, wie er ist");
    await call("write", { path: "notiz.md", content: "im Ordner des Runs" }, own);
    assert.equal(await readFile(join(own, "notiz.md"), "utf8"), "im Ordner des Runs");
    await assert.rejects(call("read", { path: "notiz.md" }, join(runs, "anderer-run")), /Pfad außerhalb des angebotenen Ordners/,
      "der Ordner eines anderen Runs ist kein Ordner dieses Auftrags");
    await assert.rejects(call("read", { path: "x" }, runs), /Pfad außerhalb des angebotenen Ordners/, "der Ordner für Runs selbst ist keiner");
    assert.deepEqual((await call("runFolder.remove", null, own)).value, { removed: true });
    await assert.rejects(readFile(join(own, "notiz.md"), "utf8"), /ENOENT/);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
    await server.close();
  }
});

test("bash liefert Ausgabe als Fortschritt, Exit-Code, Teilergebnis bei Abbruch und Zeitüberschreitung", async () => {
  const server = await startStubServer();
  const { client, directory, execute } = await started(server);
  try {
    const greeting: string[] = [];
    const finished = await execute("bash", { command: "printf hallo-$RAGENTS_RUN_ID; exit 3" }, {
      onProgress: (value) => greeting.push((value as { text: string }).text),
    });
    assert.match(textOf(finished.value), /hallo-run-a/);
    assert.match(textOf(finished.value), /Command exited with code 3/);
    await waitFor(() => greeting.some((text) => text.includes("hallo-run-a")));

    const long: string[] = [];
    const controller = new AbortController();
    const pending = execute("bash", { command: "printf gestartet; sleep 30" }, {
      onProgress: (value) => long.push((value as { text: string }).text),
      signal: controller.signal,
    });
    await waitFor(() => long.some((text) => text.includes("gestartet")));
    controller.abort();
    assert.match(textOf((await pending).value), /gestartet/);

    await assert.rejects(execute("bash", { command: "sleep 30", timeout: 1 }), /Command stopped after 1 seconds \(timeout\)/);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await server.close();
  }
});

test("ein Stopp über dieselbe Verbindung läuft durch, während ein Auftrag des Arbeitsplatzes offen ist", async () => {
  const server = await startStubServer();
  const { client, directory, execute } = await started(server);
  try {
    const output: string[] = [];
    const running = execute("bash", { command: "printf gestartet; sleep 30" }, {
      onProgress: (value) => output.push((value as { text: string }).text),
    });
    await waitFor(() => output.some((text) => text.includes("gestartet")));
    await client.rpc.call(runContracts.stopAll, { runId: RUN, commandId: "stop-1", reason: "Test" }, { timeoutMs: 5000 });
    await running.catch(() => undefined);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await server.close();
  }
});

const HOST_ROOT = resolve(import.meta.dirname, "../../..");

/** Der TypeScript-Beitrag aus den gebauten Bundles dieses Checkouts, so wie ein Server ihn verlangt. */
const typescriptContribution = async (): Promise<ExecutorContributionStand> => {
  const { plugin, stand } = await loadExecutorContribution("ragents.lsp-typescript", join(HOST_ROOT, "bundles", "ragents.lsp-typescript", EXECUTOR_CONTRIBUTION_FILE));
  return { plugin, stand };
};

/** Ein Arbeitsplatz mit dem TypeScript-Sprachserver aus dem Host dieses Checkouts; der Sprachserver-Host hält Zustand über Aufrufe hinweg. */
const withLanguageServer = async (server: StubServer) => {
  const client = new ServerClient(server.url, undefined);
  const directory = await folder();
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [directory], runsDirectory: join(directory, "..", "runs"),
  }, { hostRoot: () => HOST_ROOT });
  const execute = (operation: string, input: unknown) => {
    const connection = server.workspaceConnection(CLIENT_ID);
    assert.ok(connection, "der Arbeitsplatz ist beim Server angemeldet");
    return connection.call(workspaceClientContracts.execute, { runId: RUN, operation, cwd: directory, env: { [RUN_MARKER_ENV]: RUN }, input });
  };
  return {
    client,
    directory,
    workspace,
    open: async () => (await execute(languageServerOpenOperation(typescriptLanguageServer.id), { root: "." })).value as string,
    states: async () => ((await execute(languageServerSnapshotOperation(typescriptLanguageServer.id), null)).value as LanguageServerSnapshot)
      .instances.map((instance) => instance.state),
    close: async () => {
      await workspace.unregister();
      client.rpc.close();
      await rm(directory, { recursive: true, force: true });
      await server.close();
    },
  };
};

test("nach leeren Ordnern und erneutem Angebot öffnet der Arbeitsplatz wieder Sprachserver", { timeout: 120_000 }, async () => {
  const server = await startStubServer({ contributions: [await typescriptContribution()] });
  const { directory, workspace, open, states, close } = await withLanguageServer(server);
  try {
    await workspace.register();
    assert.match(await open(), /1 offene Instanz von TypeScript/);

    await workspace.update([]);
    assert.deepEqual(workspace.status, { kind: "idle" });
    assert.equal(server.workspaceClients().has(CLIENT_ID), false);

    await workspace.update([directory]);
    await workspace.register();
    assert.deepEqual(workspace.status, { kind: "registered" });
    assert.deepEqual(await states(), []);
    assert.match(await open(), /1 offene Instanz von TypeScript/);
    assert.deepEqual(await states(), ["ready"]);
  } finally {
    await close();
  }
});

test("eine Abmeldung, die beim erneuten Angebot noch läuft, entfernt die neue Anmeldung beim Server nicht",{ timeout: 120_000 }, async () => {
  const server = await startStubServer({ contributions: [await typescriptContribution()] });
  const { client, directory, workspace, open, close } = await withLanguageServer(server);
  const unsubscribe = client.rpc.subscribe(coreContracts.channels.runs, {}, () => undefined);
  try {
    await workspace.register();
    assert.match(await open(), /1 offene Instanz von TypeScript/);

    const emptied = workspace.update([]);
    await workspace.update([directory]);
    await workspace.register();
    await emptied;
    assert.deepEqual(workspace.status, { kind: "registered" });
    assert.deepEqual(server.workspaceClients().get(CLIENT_ID)?.folders, [directory]);
    assert.match(await open(), /1 offene Instanz von TypeScript/);
  } finally {
    unsubscribe();
    await close();
  }
});

test("ohne verlangte Beiträge kennt der Executor des Arbeitsplatzes keinen Sprachserver", async () => {
  const server = await startStubServer();
  const { client, execute, workspace, directory, runs } = await started(server);
  try {
    await assert.rejects(execute(languageServerSnapshotOperation(typescriptLanguageServer.id), null), /Der Executor kennt die Operation typescript_snapshot nicht/);
    await workspace.unregister();
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
    await server.close();
  }
});

test("ein fehlendes Bundle, ein anderer Stand oder ein fehlender Host lassen die Anmeldung mit Ursache scheitern", async () => {
  const cases: Array<{ contributions: ExecutorContributionStand[]; hostRoot: string | undefined; expected: RegExp }> = [
    { contributions: [{ plugin: "acme.fehlt", stand: "0".repeat(64) }], hostRoot: HOST_ROOT, expected: /Der Executor-Beitrag von acme\.fehlt fehlt unter .*acme\.fehlt[/\\]executor[/\\]index\.mjs.*muss dieselben Bundles tragen wie der Server/ },
    { contributions: [{ plugin: "ragents.lsp-typescript", stand: "0".repeat(64) }], hostRoot: HOST_ROOT, expected: /hat den Stand [0-9a-f]{12}, verlangt ist 000000000000\. Der Host dieses Arbeitsplatzes/ },
    { contributions: [await typescriptContribution()], hostRoot: undefined, expected: /Der Server verlangt die Executor-Beiträge von ragents\.lsp-typescript; dieser Arbeitsplatz kennt keinen Host/ },
  ];
  for (const { contributions, hostRoot, expected } of cases) {
    const server = await startStubServer({ contributions });
    const client = new ServerClient(server.url, undefined);
    const directory = await folder();
    try {
      const workspace = new WorkspaceClient(client, {
        id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [directory], runsDirectory: join(directory, "..", "runs"),
      }, { hostRoot: () => hostRoot });
      await workspace.register();
      assert.equal(workspace.status.kind, "failed");
      assert.match((workspace.status as { message: string }).message, expected);
      assert.equal(server.workspaceClients().has(CLIENT_ID), false, "der Server sieht keine Anmeldung");
      await workspace.unregister();
    } finally {
      client.rpc.close();
      await rm(directory, { recursive: true, force: true });
      await server.close();
    }
  }
});

test("ein toter Server wird als Fehler gemeldet", async () => {
  const offline = new ServerClient("http://127.0.0.1:1", undefined);
  const dead = new WorkspaceClient(offline, {
    id: "vscode-offline", label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: ["/tmp"], runsDirectory: "/tmp/ragents-runs",
  }, { hostRoot: () => undefined });
  const changes: string[] = [];
  dead.onChange(() => changes.push(dead.status.kind));
  await dead.register();
  assert.equal(dead.status.kind, "failed");
  assert.deepEqual(changes, ["failed"]);
  offline.rpc.close();
});

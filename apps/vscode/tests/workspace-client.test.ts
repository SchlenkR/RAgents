import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MethodConnection } from "@aicontainer/ragents";
import { workspaceClientContracts } from "../../../plugins/ragents.workspace/contract";
import { ServerClient } from "../src/server-client";
import { WorkspaceClient } from "../src/workspace-client";
import { startStubServer, waitFor, type StubServer } from "./fixtures";

const CLIENT_ID = "vscode-notebook";

const folder = async (): Promise<string> => mkdtemp(join(tmpdir(), "ragents-workspace-"));

const text = (chunks: readonly string[]): string => chunks.map((chunk) => Buffer.from(chunk, "base64").toString("utf8")).join("");

const progressInto = (chunks: string[]) => (value: unknown) => { chunks.push((value as { base64: string }).base64); };

const started = async (server: StubServer, options: { sameMachine?: boolean } = {}) => {
  const client = new ServerClient(server.url, undefined);
  const directory = await folder();
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID,
    label: "Notebook",
    hostname: "notebook.local",
    platform: process.platform,
    folders: [directory],
  });
  await workspace.register();
  assert.deepEqual(workspace.status, { kind: "registered", sameMachine: options.sameMachine === true });
  const connection = server.workspaceConnection(CLIENT_ID);
  assert.ok(connection);
  return { client, connection, directory, workspace };
};

test("der Arbeitsplatz meldet sich an und führt Datei-Aufträge in seinem Ordner aus", async () => {
  const server = await startStubServer();
  const { client, connection, directory, workspace } = await started(server);
  try {
    assert.deepEqual(server.workspaceClients().get(CLIENT_ID), {
      label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [directory],
    });
    await writeFile(join(directory, "notiz.md"), "Grüße\n", "utf8");
    assert.deepEqual(await connection.call(workspaceClientContracts.readFile, { path: join(directory, "notiz.md") }), {
      base64: Buffer.from("Grüße\n", "utf8").toString("base64"),
    });
    await assert.rejects(connection.call(workspaceClientContracts.writeFile, { path: join(directory, "neu/datei.txt"), content: "inhalt" }), /ENOENT/);
    assert.equal(await connection.call(workspaceClientContracts.mkdir, { path: join(directory, "neu") }), null);
    assert.equal(await connection.call(workspaceClientContracts.writeFile, { path: join(directory, "neu/datei.txt"), content: "inhalt" }), null);
    assert.equal(await readFile(join(directory, "neu/datei.txt"), "utf8"), "inhalt");
    assert.ok((await stat(join(directory, "neu"))).isDirectory());
    assert.equal(await connection.call(workspaceClientContracts.access, { path: join(directory, "neu/datei.txt"), mode: "write" }), null);
    await assert.rejects(connection.call(workspaceClientContracts.readFile, { path: "/etc/hosts" }), /Pfad außerhalb des angebotenen Ordners: \/etc\/hosts/);
    assert.deepEqual(workspace.binding(directory), { kind: "client", client: CLIENT_ID, label: "Notebook", path: directory });
    await workspace.unregister();
    assert.deepEqual(workspace.status, { kind: "idle" });
    assert.equal(server.workspaceClients().has(CLIENT_ID), false);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await server.close();
  }
});

test("exec liefert Ausgabe und Exit-Code, Abbruch und Zeitüberschreitung beenden die Prozessgruppe", async () => {
  const server = await startStubServer();
  const { client, connection, directory } = await started(server);
  const exec = (command: string, timeoutSeconds: number, chunks: string[], signal?: AbortSignal) => connection.call(
    workspaceClientContracts.exec,
    { command, cwd: directory, env: { RAGENTS_TEST: "1" }, timeoutSeconds },
    { onProgress: progressInto(chunks), ...(signal ? { signal } : {}) },
  );
  try {
    const greeting: string[] = [];
    assert.deepEqual(await exec("printf hallo-$RAGENTS_TEST; exit 3", 30, greeting), { exitCode: 3 });
    assert.equal(text(greeting), "hallo-1");

    const long: string[] = [];
    const controller = new AbortController();
    const pending = exec("printf gestartet; sleep 30", 30, long, controller.signal);
    await waitFor(() => text(long) === "gestartet");
    controller.abort();
    assert.deepEqual(await pending, { exitCode: null });

    await assert.rejects(exec("sleep 30", 1, []), /timeout:1/);
    await assert.rejects(
      connection.call(workspaceClientContracts.exec, { command: "pwd", cwd: "/etc", env: {}, timeoutSeconds: 5 }),
      /Pfad außerhalb des angebotenen Ordners: \/etc/,
    );
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await server.close();
  }
});

test("auf demselben Rechner bindet der Ordner direkt, auf Windows gibt es keine Bash, ein toter Server wird gemeldet", async () => {
  const server = await startStubServer({ sameMachine: true });
  const { client, directory, workspace } = await started(server, { sameMachine: true });
  const windowsClient = new ServerClient(server.url, undefined);
  try {
    assert.deepEqual(workspace.binding(directory), { kind: "path", path: directory });
    const windows = new WorkspaceClient(windowsClient, {
      id: "vscode-windows", label: "PC", hostname: "pc", platform: "win32", folders: [directory],
    });
    await windows.register();
    assert.equal(windows.status.kind, "registered");
    const connection = server.workspaceConnection("vscode-windows") as MethodConnection;
    await assert.rejects(
      connection.call(workspaceClientContracts.exec, { command: "pwd", cwd: directory, env: {}, timeoutSeconds: 5 }),
      /Bash ist auf dieser Plattform nicht verfügbar/,
    );
  } finally {
    windowsClient.rpc.close();
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await server.close();
  }
  const offline = new ServerClient("http://127.0.0.1:1", undefined);
  const dead = new WorkspaceClient(offline, {
    id: "vscode-offline", label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: ["/tmp"],
  });
  const changes: string[] = [];
  dead.onChange(() => changes.push(dead.status.kind));
  await dead.register();
  assert.equal(dead.status.kind, "failed");
  assert.deepEqual(changes, ["failed"]);
  offline.rpc.close();
});

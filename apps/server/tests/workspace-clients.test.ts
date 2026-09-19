import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { DomainError, RpcError, type MethodConnection, type PluginContext, type ToolScope } from "@aicontainer/ragents";
import { RpcClient } from "../../web/src/rpc/client.ts";
import { workspaceClientContracts, workspaceContracts } from "../../../plugins/ragents.workspace/contract.ts";
import { workspaceBindingOption } from "../../../plugins/ragents.workspace/server/binding.ts";
import { clientMethods, WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";
import type { RemoteWorkspaceOperations, SessionWorkspace } from "../src/ragents/workspace-runtime.ts";
import { startRpcServer } from "./rpc-fixture.ts";

const CLIENT = "client-00000001";

const description = (folders: string[] = ["/home/kriko/project"]) =>
  ({ label: "Laptop", hostname: "laptop", platform: "darwin", folders });

const base64 = (text: string) => Buffer.from(text).toString("base64");

const until = async (condition: () => boolean, timeoutMs = 3000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Bedingung wurde nicht erfüllt.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

interface StubConnection extends MethodConnection {
  end: () => void;
}

/** Eine Verbindung ohne Gegenstelle; sie meldet nur ihren Besitzer und ihr Ende. */
const stubConnection = (userId: string | null = "ronald", streamless = false): StubConnection => {
  const listeners = new Set<() => void>();
  return {
    id: randomUUID(),
    userId,
    streamless,
    call: () => Promise.reject(new Error("Dieser Arbeitsplatz antwortet nicht")),
    onClose: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    end: () => {
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
  };
};

const registryWith = async (options: { serverHostname?: string; existing?: boolean } = {}) => {
  const registry = new WorkspaceClientRegistry({
    serverHostname: options.serverHostname ?? "server",
    folderExists: async () => options.existing ?? false,
  });
  const connection = stubConnection();
  await registry.register(CLIENT, description(), connection);
  return { registry, connection };
};

/** Server mit den Arbeitsplatz-Methoden und ein Client, der die Rückrufe beantwortet. */
const fixture = async (t: TestContext) => {
  const registry = new WorkspaceClientRegistry({ serverHostname: "server", folderExists: async () => false });
  const { url } = await startRpcServer(t, { methods: clientMethods(registry) });
  const client = new RpcClient({ baseUrl: url, retryDelayMs: 50 });
  t.after(() => client.close());
  return { registry, client };
};

test("registration binds the calling connection and its end disconnects the workplace", async () => {
  const registry = new WorkspaceClientRegistry({ serverHostname: "laptop", folderExists: async (folder) => folder === "/home/kriko/project" });
  const connection = stubConnection();
  const info = await registry.register(CLIENT, description(), connection);
  assert.deepEqual(info, { ...description(), id: CLIENT, connected: true, sameMachine: true });
  const elsewhere = await registry.register("client-00000002", description(["/srv/other"]), stubConnection());
  assert.equal(elsewhere.sameMachine, false);
  await assert.rejects(registry.register(CLIENT, description(), stubConnection("kriko")), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-client-foreign" && error.status === 403);
  await assert.rejects(registry.register("client-00000003", description(), stubConnection("ronald", true)), (error: unknown) =>
    error instanceof DomainError && error.code === "stream-required" && error.status === 409);

  assert.deepEqual(registry.connected().map((entry) => entry.id), [CLIENT, "client-00000002"]);
  connection.end();
  assert.equal(registry.info(CLIENT)?.connected, false);

  const renewed = stubConnection();
  await registry.register(CLIENT, description(), renewed);
  connection.end();
  assert.equal(registry.info(CLIENT)?.connected, true);

  registry.unregister(CLIENT, "ronald");
  assert.equal(registry.info(CLIENT), undefined);
  renewed.end();
  assert.equal(registry.info(CLIENT), undefined);
  assert.throws(() => registry.unregister(CLIENT, "ronald"), /nicht angemeldet/);
  assert.throws(() => registry.unregister("client-00000002", "kriko"), /anderen Benutzer/);
});

test("the server calls the registered workplace back over its connection", async (t) => {
  const { registry, client } = await fixture(t);
  const chunks: string[] = [];
  const commands: string[] = [];
  t.after(client.handle(workspaceClientContracts.readFile, ({ path: file }) => ({ base64: base64(`Inhalt von ${file}`) })));
  t.after(client.handle(workspaceClientContracts.writeFile, () => null));
  t.after(client.handle(workspaceClientContracts.access, ({ path: file }) => {
    throw new Error(`Pfad außerhalb des angebotenen Ordners: ${file}`);
  }));
  t.after(client.handle(workspaceClientContracts.exec, async ({ command }, context) => {
    commands.push(command);
    if (command === "sleep 60") return new Promise((resolve) => context.signal.addEventListener("abort", () => resolve({ exitCode: null })));
    context.progress({ base64: base64("hallo") });
    return { exitCode: 3 };
  }));
  await until(() => client.status.kind === "connected");

  const registered = await client.call(workspaceContracts.clients.register, { id: CLIENT, ...description() });
  assert.deepEqual(registered, { ...description(), id: CLIENT, connected: true, sameMachine: false });
  assert.deepEqual(await client.call(workspaceContracts.clients.list, {}), [registered]);

  const operations = registry.operationsFor(CLIENT, "Laptop");
  assert.equal((await operations.readFile("/home/kriko/project/a.txt")).toString("utf8"), "Inhalt von /home/kriko/project/a.txt");
  await operations.writeFile("/home/kriko/project/b.txt", "neu");
  await assert.rejects(operations.access("/home/kriko/project/c.txt", "write"), /außerhalb/);

  const finished = await operations.exec("printf hallo", "/home/kriko/project", {
    onData: (data) => chunks.push(data.toString("utf8")),
    timeoutSeconds: 5,
    env: { CI: "true" },
  });
  assert.deepEqual(finished, { exitCode: 3 });
  await until(() => chunks.length === 1);
  assert.deepEqual(chunks, ["hallo"]);

  const controller = new AbortController();
  const cancelled = operations.exec("sleep 60", "/home/kriko/project", { onData: () => undefined, signal: controller.signal, timeoutSeconds: 60, env: {} });
  await until(() => commands.length === 2);
  controller.abort();
  assert.deepEqual(await cancelled, { exitCode: null });

  client.close();
  await until(() => registry.info(CLIENT)?.connected === false);
  await assert.rejects(operations.readFile("/home/kriko/project/a.txt"), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-client-disconnected" && error.status === 409);
});

test("a registration without an event stream is refused", async (t) => {
  const { client } = await fixture(t);
  await assert.rejects(client.call(workspaceContracts.clients.register, { id: CLIENT, ...description() }), (error: unknown) =>
    error instanceof RpcError && error.domainCode === "stream-required" && error.status === 409);
});

test("the start option accepts only bindings that can be resolved later", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-binding-")));
  try {
    const { registry, connection } = await registryWith();
    const option = workspaceBindingOption(registry);
    const context = { runId: "run-1" };
    assert.deepEqual(option.defaultValue(context), { kind: "fresh" });
    assert.deepEqual(option.accept({ kind: "fresh" }, context), { kind: "fresh" });
    assert.throws(() => option.accept({ kind: "path", path: "relative" }, context), /absoluter Pfad/);
    assert.throws(() => option.accept({ kind: "path", path: path.join(root, "missing") }, context), /existiert auf dem Server nicht/);
    await mkdir(path.join(root, "project"));
    assert.deepEqual(option.accept({ kind: "path", path: path.join(root, "project") }, context), { kind: "path", path: path.join(root, "project") });
    assert.throws(() => option.accept({ kind: "client", client: CLIENT, label: "", path: "/home/other" }, context), /bietet den Ordner/);
    assert.deepEqual(
      option.accept({ kind: "client", client: CLIENT, label: "", path: "/home/kriko/project/src" }, context),
      { kind: "client", client: CLIENT, label: "Laptop", path: "/home/kriko/project/src" },
    );
    assert.deepEqual(option.describe({ kind: "fresh" }, context), { kind: "workspace-binding", clients: [{ ...description(), id: CLIENT, connected: true, sameMachine: false }] });
    connection.end();
    assert.throws(() => option.accept({ kind: "client", client: CLIENT, label: "", path: "/home/kriko/project" }, context), /nicht verbunden/);
    assert.deepEqual(option.describe({ kind: "fresh" }, context), { kind: "workspace-binding", clients: [] });
    assert.throws(() => option.accept({ kind: "elsewhere" }, context), /kein gültiges Format/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sandbox tools route paths inside the bound folder to the workplace and the rest to the server", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-remote-sandbox-")));
  const files = path.join(directory, "files");
  await mkdir(files);
  await writeFile(path.join(files, "note.md"), "auf dem Server");
  const seen: string[] = [];
  const remoteFiles = new Map<string, string>([["/home/kriko/project/src/app.ts", "const a = 1;\n"]]);
  const remote: RemoteWorkspaceOperations = {
    label: "Laptop",
    readFile: async (file) => { seen.push(`read ${file}`); const content = remoteFiles.get(file); if (content === undefined) throw new Error("ENOENT"); return Buffer.from(content); },
    writeFile: async (file, content) => { seen.push(`write ${file}`); remoteFiles.set(file, content); },
    access: async (file) => { seen.push(`access ${file}`); if (!remoteFiles.has(file)) throw new Error("ENOENT"); },
    mkdir: async (target) => { seen.push(`mkdir ${target}`); },
    exec: async (command, cwd, options) => { seen.push(`exec ${command} in ${cwd} timeout ${options.timeoutSeconds} env ${Object.keys(options.env).sort().join(",")}`); options.onData(Buffer.from("ausgabe")); return { exitCode: 0 }; },
  };
  const workspace: SessionWorkspace = {
    cwd: "/home/kriko/project",
    remote,
    currentRoot: async () => "/home/kriko/project",
    ensureWritable: async () => "/home/kriko/project",
    runOperation: (operation) => operation(),
  };
  const host = new WorkspaceSandboxHost({
    contributorName: "test.workspace",
    workspaceFor: async () => workspace,
    identFor: async () => undefined,
    skillPaths: async () => [],
    homeFor: async () => ({ home: path.join(directory, "home") }),
    filesFor: async () => files,
  });
  try {
    const tools = await host.workspaceTools().tools({ runId: "run-1" } as PluginContext);
    const invoke = async (name: string, params: unknown) => {
      const tool = tools.find((entry) => entry.name === name);
      assert.ok(tool, name);
      return tool.run({ signal: new AbortController().signal } as ToolScope, `test-${name}`, params as never);
    };
    assert.match(String(await invoke("read", { path: "src/app.ts" })), /const a = 1/);
    assert.match(String(await invoke("read", { path: "$RAGENTS_FILES_DIR/note.md" })), /auf dem Server/);
    await invoke("write", { path: "src/new.ts", content: "export {};\n" });
    assert.equal(remoteFiles.get("/home/kriko/project/src/new.ts"), "export {};\n");
    await invoke("edit", { path: "src/app.ts", edits: [{ oldText: "1", newText: "2" }] });
    assert.equal(remoteFiles.get("/home/kriko/project/src/app.ts"), "const a = 2;\n");
    await invoke("write", { path: "$RAGENTS_FILES_DIR/result.md", content: "Ergebnis" });
    assert.equal(await readFile(path.join(files, "result.md"), "utf8"), "Ergebnis");
    await assert.rejects(invoke("write", { path: "/etc/passwd", content: "x" }), /außerhalb/);
    assert.match(String(await invoke("bash", { command: "printf hallo" })), /ausgabe/);
    const exec = seen.find((entry) => entry.startsWith("exec "));
    assert.equal(exec, "exec printf hallo in /home/kriko/project timeout 600 env CI,GIT_CONFIG_COUNT,GIT_CONFIG_KEY_0,GIT_CONFIG_KEY_1,GIT_CONFIG_KEY_2,GIT_CONFIG_VALUE_0,GIT_CONFIG_VALUE_1,GIT_CONFIG_VALUE_2,GIT_OPTIONAL_LOCKS,RAGENTS_RUN_ID");
    assert.ok(seen.every((entry) => !entry.includes(files)), "Serverpfade gehen nicht an den Arbeitsplatz");
    const context = await host.processContextFor("run-1");
    assert.equal(context.remote, "Laptop");
    assert.equal(context.cwd, "/home/kriko/project");
  } finally {
    await host.shutdownAll();
    await rm(directory, { recursive: true, force: true });
  }
});

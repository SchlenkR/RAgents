import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createAccessContext, DomainError, MethodContributionRegistry, RpcError, type MethodConnection } from "@ragents/engine";
import { RUN_MARKER_ENV, WORKSPACE_EXECUTOR_VERSION } from "@ragents/workspace-executor";
import { RpcClient } from "../../web/src/rpc/client.ts";
import { workspaceClientContracts, workspaceContracts } from "../../../plugins/ragents.workspace/contract.ts";
import { workspaceBindingOption } from "../../../plugins/ragents.workspace/server/binding.ts";
import { assertMayRegister, clientMethods, WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreSources, dispatchMethod, startRpcServer } from "./rpc-fixture.ts";

const CLIENT = "client-00000001";

const description = (folders: string[] = ["/home/beispiel/project"]) =>
  ({ label: "Laptop", hostname: "laptop", platform: "darwin", folders });

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
const stubConnection = (userId: string | null = "alice", streamless = false): StubConnection => {
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

const registryWith = async () => {
  const registry = new WorkspaceClientRegistry();
  const connection = stubConnection();
  await registry.register(CLIENT, description(), WORKSPACE_EXECUTOR_VERSION, connection);
  return { registry, connection };
};

/** Server mit den Arbeitsplatz-Methoden und ein Client, der die Rückrufe beantwortet. */
const fixture = async (t: TestContext) => {
  const registry = new WorkspaceClientRegistry();
  const { url } = await startRpcServer(t, { methods: clientMethods(registry) });
  const client = new RpcClient({ baseUrl: url, retryDelayMs: 50 });
  t.after(() => client.close());
  return { registry, client };
};

test("registration binds the calling connection, checks the executor and its end removes the workplace", async () => {
  const registry = new WorkspaceClientRegistry();
  const connection = stubConnection();
  const info = await registry.register(CLIENT, description(), WORKSPACE_EXECUTOR_VERSION, connection);
  assert.deepEqual(info, { ...description(), id: CLIENT });
  await assert.rejects(registry.register("client-00000004", description(), "abweichend", stubConnection()), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-executor-version" && error.status === 409);
  await assert.rejects(registry.register("client-00000003", description(), WORKSPACE_EXECUTOR_VERSION, stubConnection("alice", true)), (error: unknown) =>
    error instanceof DomainError && error.code === "stream-required" && error.status === 409);

  assert.deepEqual(registry.list("alice").map((entry) => entry.id), [CLIENT]);
  connection.end();
  assert.equal(registry.info("alice", CLIENT), undefined);

  const renewed = stubConnection();
  await registry.register(CLIENT, description(), WORKSPACE_EXECUTOR_VERSION, renewed);
  connection.end();
  assert.equal(registry.info("alice", CLIENT)?.id, CLIENT);

  registry.unregister("alice", CLIENT, renewed);
  assert.equal(registry.info("alice", CLIENT), undefined);
  renewed.end();
  assert.equal(registry.info("alice", CLIENT), undefined);
  assert.doesNotThrow(() => registry.unregister("alice", CLIENT, renewed));
});

test("the same id under two users gives two workplaces that never touch each other", async () => {
  const registry = new WorkspaceClientRegistry();
  const alices = stubConnection("alice");
  const bobs = stubConnection("bob");
  await registry.register(CLIENT, description(["/home/alice/project"]), WORKSPACE_EXECUTOR_VERSION, alices);
  await registry.register(CLIENT, description(["/home/bob/project"]), WORKSPACE_EXECUTOR_VERSION, bobs);
  assert.deepEqual(registry.info("alice", CLIENT)?.folders, ["/home/alice/project"]);
  assert.deepEqual(registry.info("bob", CLIENT)?.folders, ["/home/bob/project"]);
  assert.equal(registry.info(null, CLIENT), undefined, "ohne Benutzer gibt es diesen Arbeitsplatz nicht");

  registry.unregister("bob", CLIENT, bobs);
  assert.deepEqual(registry.info("alice", CLIENT)?.folders, ["/home/alice/project"], "die Abmeldung eines anderen trifft ihn nicht");
  await registry.register(CLIENT, description(["/home/bob/project"]), WORKSPACE_EXECUTOR_VERSION, bobs);
  alices.end();
  assert.equal(registry.info("alice", CLIENT), undefined);
  assert.deepEqual(registry.info("bob", CLIENT)?.folders, ["/home/bob/project"], "die Trennung eines anderen trifft ihn nicht");
});

test("a user lists only the workplaces he registered himself", async () => {
  const registry = new WorkspaceClientRegistry();
  await registry.register(CLIENT, description(["/home/alice/project"]), WORKSPACE_EXECUTOR_VERSION, stubConnection("alice"));
  await registry.register("client-00000002", description(["/home/bob/project"]), WORKSPACE_EXECUTOR_VERSION, stubConnection("bob"));
  const methods = new MethodContributionRegistry();
  methods.register("ragents.workspace", clientMethods(registry));
  const listed = async (userId: string) => {
    const access = createAccessContext({ enabled: true, user: { id: userId, label: userId, rights: ["runs.read", "runs.read.all"] } });
    return (await dispatchMethod(methods, workspaceContracts.clients.list.id, {}, access) as Array<{ id: string }>).map((entry) => entry.id);
  };
  assert.deepEqual(await listed("alice"), [CLIENT]);
  assert.deepEqual(await listed("bob"), ["client-00000002"]);
  assert.deepEqual(await listed("carol"), [], "auch runs.read.all zeigt keinen fremden Arbeitsplatz");
});

test("the server runs the executor of the registered workplace over its connection", async (t) => {
  const { registry, client } = await fixture(t);
  const calls: Array<{ operation: string; toolCallId: string | undefined; cwd: string; env: Record<string, string>; input: unknown }> = [];
  const progress: unknown[] = [];
  t.after(client.handle(workspaceClientContracts.execute, async (input, context) => {
    calls.push({ operation: input.operation, toolCallId: input.toolCallId, cwd: input.cwd, env: input.env, input: input.input });
    if (input.operation === "bash" && (input.input as { command: string }).command === "sleep 60") {
      return new Promise((resolve) => context.signal.addEventListener("abort", () => resolve({ value: { content: [] } })));
    }
    if (input.operation === "files.read") throw new DomainError("workspace-path-invalid", "Ungültiger Pfad: ../geheim", 400);
    context.progress({ text: "hallo" });
    return { value: { content: [{ type: "text", text: `${input.operation} erledigt` }] } };
  }));
  await until(() => client.status.kind === "connected");

  const registered = await client.call(workspaceContracts.clients.register, {
    id: CLIENT, ...description(), executor: WORKSPACE_EXECUTOR_VERSION,
  });
  assert.deepEqual(registered, { ...description(), id: CLIENT });
  assert.deepEqual(await client.call(workspaceContracts.clients.list, {}), [registered]);

  const executor = registry.executorFor(null, CLIENT, "Laptop", "/home/beispiel/project");
  assert.equal(executor.version, WORKSPACE_EXECUTOR_VERSION);
  const read = await executor.execute("run-1", "read", { path: "a.txt" }, { toolCallId: "call-1" });
  assert.deepEqual(read, { content: [{ type: "text", text: "read erledigt" }] });
  assert.deepEqual(calls[0], {
    operation: "read", toolCallId: "call-1", cwd: "/home/beispiel/project", env: calls[0]!.env, input: { path: "a.txt" },
  });
  assert.equal(calls[0]!.env[RUN_MARKER_ENV], "run-1");
  assert.equal(calls[0]!.env.CI, "true");
  assert.equal(calls[0]!.env.GIT_CONFIG_COUNT, "3");
  assert.ok(Object.keys(calls[0]!.env).every((name) => !name.startsWith("GIT_ASKPASS")), "keine Zugangsdaten des Servers");

  await executor.execute("run-1", "bash", { command: "printf hallo" }, { onProgress: (value) => progress.push(value) });
  await until(() => progress.length === 1);
  assert.deepEqual(progress, [{ text: "hallo" }]);
  assert.equal(calls[1]!.toolCallId, undefined, "ohne Werkzeugaufruf keine Kennung");
  await assert.rejects(executor.execute("run-1", "files.read", { path: "../geheim" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-invalid" && error.status === 400 && error.message === "Ungültiger Pfad: ../geheim");
  await assert.rejects(executor.execute("run-1", "files.watch", {}, { untilAborted: true }), /braucht dafür ein Abbruchsignal/);

  const controller = new AbortController();
  const cancelled = executor.execute("run-1", "bash", { command: "sleep 60" }, { signal: controller.signal });
  await until(() => calls.length === 4);
  controller.abort();
  assert.deepEqual(await cancelled, { content: [] });

  const interrupted = executor.execute("run-1", "bash", { command: "sleep 60" });
  await until(() => calls.length === 5);
  client.close();
  await assert.rejects(interrupted, (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-client-disconnected"
    && error.message.includes("Laptop") && error.message.includes("Verbindung verloren"));
  await until(() => registry.info(null, CLIENT) === undefined);
  await assert.rejects(executor.execute("run-1", "read", { path: "a.txt" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-client-disconnected" && error.status === 409);
  assert.equal(await executor.execute("run-1", "processes.stopAll", {}, { whenReachable: true }), null);
  await executor.stopRun("run-1");
});

test("a registration without an event stream is refused", async (t) => {
  const { client } = await fixture(t);
  await assert.rejects(client.call(workspaceContracts.clients.register, {
    id: CLIENT, ...description(), executor: WORKSPACE_EXECUTOR_VERSION,
  }), (error: unknown) => error instanceof RpcError && error.domainCode === "stream-required" && error.status === 409);
});

test("the start option accepts only bindings that can be resolved later", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-binding-")));
  try {
    const { registry, connection } = await registryWith();
    const option = workspaceBindingOption(registry, () => undefined);
    const context = { runId: "run-1", userId: "alice" };
    assert.deepEqual(option.defaultValue(context), { kind: "fresh" });
    assert.deepEqual(option.accept({ kind: "fresh" }, context), { kind: "fresh" });
    assert.throws(() => option.accept({ kind: "path", path: "relative" }, context), /absoluter Pfad/);
    assert.throws(() => option.accept({ kind: "path", path: path.join(root, "missing") }, context), /existiert auf dem Server nicht/);
    await mkdir(path.join(root, "project"));
    assert.deepEqual(option.accept({ kind: "path", path: path.join(root, "project") }, context), { kind: "path", path: path.join(root, "project") });
    assert.throws(() => option.accept({ kind: "client", client: CLIENT, label: "", path: "/home/other" }, context), /bietet den Ordner/);
    assert.deepEqual(
      option.accept({ kind: "client", client: CLIENT, label: "", path: "/home/beispiel/project/src" }, context),
      { kind: "client", client: CLIENT, label: "Laptop", path: "/home/beispiel/project/src" },
    );
    assert.deepEqual(option.describe({ kind: "fresh" }, context), {
      kind: "workspace-binding",
      clients: [{ ...description(), id: CLIENT }],
      freshLabel: "Leerer Ordner je Run",
      serverFolders: true,
    });
    connection.end();
    assert.throws(() => option.accept({ kind: "client", client: CLIENT, label: "", path: "/home/beispiel/project" }, context), /nicht verbunden/);
    assert.deepEqual(option.describe({ kind: "fresh" }, context), {
      kind: "workspace-binding",
      clients: [],
      freshLabel: "Leerer Ordner je Run",
      serverFolders: true,
    });
    assert.throws(() => option.accept({ kind: "elsewhere" }, context), /kein gültiges Format/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a contributed workspace names the first kind and keeps folders of the server out", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-binding-")));
  try {
    const { registry } = await registryWith();
    const kind = { id: "example.worktree", label: "Worktree je Run", serverFolders: false };
    const option = workspaceBindingOption(registry, () => kind);
    const context = { runId: "run-1", userId: "alice" };
    await mkdir(path.join(root, "project"));
    assert.throws(
      () => option.accept({ kind: "path", path: path.join(root, "project") }, context),
      (error: unknown) => error instanceof DomainError && error.code === "workspace-binding-unsupported"
        && error.message.includes("Worktree je Run"),
    );
    assert.deepEqual(option.accept({ kind: "fresh" }, context), { kind: "fresh" });
    assert.deepEqual(option.describe({ kind: "fresh" }, context), {
      kind: "workspace-binding",
      clients: [{ ...description(), id: CLIENT }],
      freshLabel: "Worktree je Run",
      serverFolders: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a workplace of another user is neither offered nor accepted as binding, and only a workplace binding reserves the run for its owner", async () => {
  const { registry } = await registryWith();
  const option = workspaceBindingOption(registry, () => undefined);
  const binding = { kind: "client", client: CLIENT, label: "", path: "/home/beispiel/project" };
  const alice = { runId: "run-1", userId: "alice" };
  const bob = { runId: "run-2", userId: "bob" };
  assert.deepEqual(option.accept(binding, alice), { ...binding, label: "Laptop" });
  assert.throws(() => option.accept(binding, bob), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-client-disconnected" && error.status === 409);
  assert.throws(() => option.accept(binding, { runId: "run-3", userId: null }), /nicht verbunden/);
  assert.deepEqual((option.describe({ kind: "fresh" }, alice) as { clients: unknown[] }).clients, [{ ...description(), id: CLIENT }]);
  assert.deepEqual((option.describe({ kind: "fresh" }, bob) as { clients: unknown[] }).clients, []);

  assert.equal(option.ownerOnly?.({ ...binding, label: "Laptop" }), true);
  assert.equal(option.ownerOnly?.({ kind: "fresh" }), false);
  assert.equal(option.ownerOnly?.({ kind: "path", path: "/srv/project" }), false);
});

test("choosing the binding in the web takes the user of the request, not any registered workplace", async () => {
  const { registry } = await registryWith();
  const option = workspaceBindingOption(registry, () => undefined);
  const chosen: unknown[] = [];
  const methods = new MethodContributionRegistry();
  methods.register("host", coreMethods(coreSources({
    selectStartOption: (runId, optionId, value, userId) => {
      const accepted = option.accept(value as never, { runId, userId });
      chosen.push(accepted);
      return { id: optionId, owner: "ragents.workspace", value: accepted, presentation: null, selectable: true, locked: false };
    },
  })));
  const rights = ["runs.read", "runs.write", "runs.create", "runs.inspect", "runs.read.all"];
  const as = (id: string) => createAccessContext({ enabled: true, user: { id, label: id, rights } });
  const select = (id: string) => dispatchMethod(methods, coreContracts.startOptions.select.id, {
    runId: "draft-run", optionId: "ragents.workspace.binding", value: { kind: "client", client: CLIENT, label: "", path: "/home/beispiel/project" },
  }, as(id));
  await assert.rejects(select("bob"), (error: unknown) => error instanceof DomainError && error.code === "workspace-client-disconnected");
  assert.deepEqual(chosen, []);
  await select("alice");
  assert.deepEqual(chosen, [{ kind: "client", client: CLIENT, label: "Laptop", path: "/home/beispiel/project" }]);
});

test("a sign-off removes only the entry its own connection holds", async () => {
  const registry = new WorkspaceClientRegistry();
  const first = stubConnection("alice");
  const second = stubConnection("alice");
  await registry.register(CLIENT, description(["/home/alice/a"]), WORKSPACE_EXECUTOR_VERSION, first);
  await registry.register(CLIENT, description(["/home/alice/b"]), WORKSPACE_EXECUTOR_VERSION, second);
  registry.unregister("alice", CLIENT, first);
  assert.deepEqual(registry.info("alice", CLIENT)?.folders, ["/home/alice/b"], "eine alte Verbindung meldet die neue nicht ab");
  first.end();
  assert.deepEqual(registry.info("alice", CLIENT)?.folders, ["/home/alice/b"]);
  registry.unregister("alice", CLIENT, second);
  assert.equal(registry.info("alice", CLIENT), undefined);
});

/** Ein Arbeitsplatz über eine echte Verbindung, der jede Operation mitschreibt; `hang` lässt eine Operation offen, bis der Strom endet. */
const workplace = async (t: TestContext, url: string, hang: readonly string[] = []) => {
  const client = new RpcClient({ baseUrl: url, retryDelayMs: 50 });
  const operations: string[] = [];
  t.after(client.handle(workspaceClientContracts.execute, (input, context) => {
    operations.push(`${input.operation}:${input.runId}`);
    if (!hang.includes(input.operation)) return { value: null };
    return new Promise((resolve) => context.signal.addEventListener("abort", () => resolve({ value: null })));
  }));
  t.after(() => client.close());
  await until(() => client.status.kind === "connected");
  await client.call(workspaceContracts.clients.register, { id: CLIENT, ...description(), executor: WORKSPACE_EXECUTOR_VERSION });
  return { client, operations };
};

test("a stop while the workplace is away is held and delivered when it registers again, before any new order of that run", async (t) => {
  const { registry } = await fixture(t);
  const url = (await startRpcServer(t, { methods: clientMethods(registry) })).url;
  const first = await workplace(t, url);
  const executor = registry.executorFor(null, CLIENT, "Laptop", "/home/beispiel/project");
  first.client.close();
  await until(() => registry.info(null, CLIENT) === undefined);

  await executor.stopRun("run-1");
  assert.deepEqual(registry.pendingStops(null, CLIENT), ["run-1"]);
  assert.equal(await executor.execute("run-1", "processes.stopAll", {}, { whenReachable: true }), null);

  const second = await workplace(t, url);
  await executor.execute("run-1", "read", { path: "a.txt" });
  assert.deepEqual(second.operations, ["stop:run-1", "read:run-1"]);
  assert.deepEqual(registry.pendingStops(null, CLIENT), []);
  assert.deepEqual(first.operations, []);
});

test("a new connection of the same workplace takes over: open calls of the old one fail at once, a stop in flight arrives over the new one", async (t) => {
  const { registry } = await fixture(t);
  const url = (await startRpcServer(t, { methods: clientMethods(registry) })).url;
  const old = await workplace(t, url, ["bash", "stop"]);
  const executor = registry.executorFor(null, CLIENT, "Laptop", "/home/beispiel/project");
  const running = executor.execute("run-1", "bash", { command: "sleep 600" }).then(() => undefined, (error: unknown) => error);
  const stopping = executor.stopRun("run-2");
  await until(() => old.operations.length === 2);
  const begun = Date.now();
  assert.equal(await executor.execute("run-2", "processes.stopAll", {}, { whenReachable: true }), null);
  assert.ok(Date.now() - begun < 1000, "Aufräumen neben einem ausstehenden Stopp wartet nicht auf ihn");
  assert.equal(old.operations.length, 2);

  const renewed = await workplace(t, url);
  const failure = await running;
  assert.ok(failure instanceof DomainError && failure.code === "workspace-client-disconnected" && /abgelöst/.test(failure.message), String(failure));
  await stopping;
  await until(() => renewed.operations.includes("stop:run-2"));
  await until(() => registry.pendingStops(null, CLIENT).length === 0);
});

test("without user sign-in the server accepts a workplace only over a loopback connection", async (t) => {
  const registry = new WorkspaceClientRegistry();
  const remote = await startRpcServer(t, { methods: clientMethods(registry), local: false });
  const client = new RpcClient({ baseUrl: remote.url, retryDelayMs: 50 });
  t.after(client.handle(workspaceClientContracts.execute, () => ({ value: null })));
  t.after(() => client.close());
  await until(() => client.status.kind === "connected");
  const register = () => client.call(workspaceContracts.clients.register, { id: CLIENT, ...description(), executor: WORKSPACE_EXECUTOR_VERSION });
  await assert.rejects(register(), (error: unknown) =>
    error instanceof RpcError && error.domainCode === "workspace-client-login-required" && error.status === 403 && /Loopback/.test(error.message));
  assert.deepEqual(registry.list(null), []);

  const anonymous = createAccessContext({ enabled: false, user: { id: "gast", label: "Gast", rights: ["runs.read", "runs.write"] } });
  const signedIn = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read", "runs.write"] } });
  assert.throws(() => assertMayRegister(anonymous, false), /keine Benutzeranmeldung/);
  assert.doesNotThrow(() => assertMayRegister(anonymous, true));
  assert.doesNotThrow(() => assertMayRegister(signedIn, false));

  const local = await startRpcServer(t, { methods: clientMethods(registry), local: true });
  const nearby = new RpcClient({ baseUrl: local.url, retryDelayMs: 50 });
  t.after(nearby.handle(workspaceClientContracts.execute, () => ({ value: null })));
  t.after(() => nearby.close());
  await until(() => nearby.status.kind === "connected");
  await nearby.call(workspaceContracts.clients.register, { id: CLIENT, ...description(), executor: WORKSPACE_EXECUTOR_VERSION });
  assert.deepEqual(registry.list(null).map((entry) => entry.id), [CLIENT]);
});

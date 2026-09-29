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

test("the workspace registers and runs the tools in its folder", async () => {
  const server = await startStubServer();
  const { client, directory, runs, workspace, call, execute } = await started(server);
  try {
    assert.deepEqual(server.workspaceClients().get(CLIENT_ID), {
      label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [directory], runsDirectory: runs,
      ripgrep: ripgrepAvailable(undefined, process.env),
    });
    await writeFile(join(directory, "note.md"), "Café\n", "utf8");
    assert.match(textOf((await execute("read", { path: "note.md" })).value), /Café/);
    await execute("write", { path: "new/file.txt", content: "content" });
    assert.equal(await readFile(join(directory, "new/file.txt"), "utf8"), "content");
    await execute("edit", { path: "new/file.txt", edits: [{ oldText: "content", newText: "changed café" }] });
    assert.equal(await readFile(join(directory, "new/file.txt"), "utf8"), "changed café");
    await assert.rejects(execute("read", { path: "/etc/hosts" }), /outside the working directory/);
    await assert.rejects(call("read", { path: "hosts" }, "/etc"), /Path outside the offered folder: \/etc/);
    const listing = (await execute("files.list", { path: "new" })).value as { entries: Array<{ name: string }> };
    assert.deepEqual(listing.entries.map((entry) => entry.name), ["file.txt"]);
    assert.deepEqual((await execute("files.read", { path: "new/file.txt" })).value, { path: "new/file.txt", size: Buffer.byteLength("changed café"), previewable: true, content: "changed café" });
    await assert.rejects(execute("files.read", { path: "../secret" }), /Invalid path: \.\.\/secret/);
    await assert.rejects(execute("grep", {}), /The executor does not know the operation grep/);
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

test("the workspace bash inherits the environment of this machine, without VS Code variables and without BASH_ENV", async () => {
  const server = await startStubServer();
  const { client, directory, runs, execute } = await started(server);
  const startup = join(directory, "startup.sh");
  const names = ["RAGENTS_TEST_OWN_TOOL", "VSCODE_RAGENTS_TEST", "ELECTRON_RAGENTS_TEST", "BASH_ENV"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    await writeFile(startup, "echo startup-file-read\n", "utf8");
    process.env.RAGENTS_TEST_OWN_TOOL = "from-user";
    process.env.VSCODE_RAGENTS_TEST = "editor";
    process.env.ELECTRON_RAGENTS_TEST = "editor";
    process.env.BASH_ENV = startup;
    const output = textOf((await execute("bash", {
      command: 'printf "%s|%s|%s|%s|%s" "$RAGENTS_TEST_OWN_TOOL" "${VSCODE_RAGENTS_TEST-empty}" "${ELECTRON_RAGENTS_TEST-empty}" "${BASH_ENV-empty}" "$CI"',
    })).value);
    assert.equal(output.trim(), "from-user|empty|empty|empty|true");
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

test("with a bundled rg, the workspace registers rg and its bash finds exactly that one first", async () => {
  const tools = await folder();
  const rg = join(tools, "rg", process.platform === "win32" ? "rg.exe" : "rg");
  await mkdir(join(tools, "rg"), { recursive: true });
  await writeFile(rg, "#!/bin/sh\necho rg-bundled\n", "utf8");
  await chmod(rg, 0o755);
  const server = await startStubServer();
  const { client, directory, runs, execute } = await started(server, rg);
  try {
    assert.equal(server.workspaceClients().get(CLIENT_ID)?.ripgrep, true);
    const output = textOf((await execute("bash", { command: "command -v rg; rg --version" })).value);
    assert.deepEqual(output.trim().split("\n"), [rg, "rg-bundled"]);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
    await rm(tools, { recursive: true, force: true });
    await server.close();
  }
});

test("a named rg that is missing makes the registration fail with a cause", async () => {
  const server = await startStubServer();
  const client = new ServerClient(server.url, undefined);
  const missing = join(tmpdir(), "ragents-no-rg", "rg");
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [tmpdir()], runsDirectory: join(tmpdir(), "ragents-runs"),
  }, { hostRoot: () => undefined, rg: missing });
  try {
    await workspace.register();
    assert.equal(workspace.status.kind, "failed");
    assert.match(workspace.status.kind === "failed" ? workspace.status.message : "", /The rg of this executor is missing: .*ragents-no-rg/);
    assert.equal(server.workspaceClients().has(CLIENT_ID), false);
  } finally {
    await workspace.unregister();
    client.rpc.close();
    await server.close();
  }
});

test("the new folder of a run is created in the runs folder of the workspace, and only this one is allowed besides the offered ones", async () => {
  const server = await startStubServer();
  const { client, directory, runs, call } = await started(server);
  const own = join(runs, RUN);
  try {
    assert.deepEqual((await call("runFolder.create", null, own)).value, { created: true });
    assert.deepEqual((await call("runFolder.create", null, own)).value, { created: false }, "an existing folder stays as it is");
    await call("write", { path: "note.md", content: "in the run's folder" }, own);
    assert.equal(await readFile(join(own, "note.md"), "utf8"), "in the run's folder");
    await assert.rejects(call("read", { path: "note.md" }, join(runs, "other-run")), /Path outside the offered folder/,
      "the folder of another run is not a folder of this task");
    await assert.rejects(call("read", { path: "x" }, runs), /Path outside the offered folder/, "the runs folder itself is not one");
    assert.deepEqual((await call("runFolder.remove", null, own)).value, { removed: true });
    await assert.rejects(readFile(join(own, "note.md"), "utf8"), /ENOENT/);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
    await server.close();
  }
});

test("bash delivers output as progress, exit code, partial result on cancel and timeout", async () => {
  const server = await startStubServer();
  const { client, directory, execute } = await started(server);
  try {
    const greeting: string[] = [];
    const finished = await execute("bash", { command: "printf hello-$RAGENTS_RUN_ID; exit 3" }, {
      onProgress: (value) => greeting.push((value as { text: string }).text),
    });
    assert.match(textOf(finished.value), /hello-run-a/);
    assert.match(textOf(finished.value), /Command exited with code 3/);
    await waitFor(() => greeting.some((text) => text.includes("hello-run-a")));

    const long: string[] = [];
    const controller = new AbortController();
    const pending = execute("bash", { command: "printf started; sleep 30" }, {
      onProgress: (value) => long.push((value as { text: string }).text),
      signal: controller.signal,
    });
    await waitFor(() => long.some((text) => text.includes("started")));
    controller.abort();
    assert.match(textOf((await pending).value), /started/);

    await assert.rejects(execute("bash", { command: "sleep 30", timeout: 1 }), /Command stopped after 1 seconds \(timeout\)/);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await server.close();
  }
});

test("a stop over the same connection goes through while a workspace task is open", async () => {
  const server = await startStubServer();
  const { client, directory, execute } = await started(server);
  try {
    const output: string[] = [];
    const running = execute("bash", { command: "printf started; sleep 30" }, {
      onProgress: (value) => output.push((value as { text: string }).text),
    });
    await waitFor(() => output.some((text) => text.includes("started")));
    await client.rpc.call(runContracts.stopAll, { runId: RUN, commandId: "stop-1", reason: "Test" }, { timeoutMs: 5000 });
    await running.catch(() => undefined);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await server.close();
  }
});

const HOST_ROOT = resolve(import.meta.dirname, "../../..");

/** The TypeScript contribution from the built bundles of this checkout, as a server requires it. */
const typescriptContribution = async (): Promise<ExecutorContributionStand> => {
  const { plugin, stand } = await loadExecutorContribution("ragents.lsp-typescript", join(HOST_ROOT, "bundles", "ragents.lsp-typescript", EXECUTOR_CONTRIBUTION_FILE));
  return { plugin, stand };
};

/** A workspace with the TypeScript language server from the host of this checkout; the language server host keeps state across calls. */
const withLanguageServer = async (server: StubServer) => {
  const client = new ServerClient(server.url, undefined);
  const directory = await folder();
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [directory], runsDirectory: join(directory, "..", "runs"),
  }, { hostRoot: () => HOST_ROOT });
  const execute = (operation: string, input: unknown) => {
    const connection = server.workspaceConnection(CLIENT_ID);
    assert.ok(connection, "the workspace is registered with the server");
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

test("after empty folders and a new offer, the workspace opens language servers again", { timeout: 120_000 }, async () => {
  const server = await startStubServer({ contributions: [await typescriptContribution()] });
  const { directory, workspace, open, states, close } = await withLanguageServer(server);
  try {
    await workspace.register();
    assert.match(await open(), /1 open instance of TypeScript/);

    await workspace.update([]);
    assert.deepEqual(workspace.status, { kind: "idle" });
    assert.equal(server.workspaceClients().has(CLIENT_ID), false);

    await workspace.update([directory]);
    await workspace.register();
    assert.deepEqual(workspace.status, { kind: "registered" });
    assert.deepEqual(await states(), []);
    assert.match(await open(), /1 open instance of TypeScript/);
    assert.deepEqual(await states(), ["ready"]);
  } finally {
    await close();
  }
});

test("an unregistration still running during the new offer does not remove the new registration at the server",{ timeout: 120_000 }, async () => {
  const server = await startStubServer({ contributions: [await typescriptContribution()] });
  const { client, directory, workspace, open, close } = await withLanguageServer(server);
  const unsubscribe = client.rpc.subscribe(coreContracts.channels.runs, {}, () => undefined);
  try {
    await workspace.register();
    assert.match(await open(), /1 open instance of TypeScript/);

    const emptied = workspace.update([]);
    await workspace.update([directory]);
    await workspace.register();
    await emptied;
    assert.deepEqual(workspace.status, { kind: "registered" });
    assert.deepEqual(server.workspaceClients().get(CLIENT_ID)?.folders, [directory]);
    assert.match(await open(), /1 open instance of TypeScript/);
  } finally {
    unsubscribe();
    await close();
  }
});

test("without required contributions, the workspace executor knows no language server", async () => {
  const server = await startStubServer();
  const { client, execute, workspace, directory, runs } = await started(server);
  try {
    await assert.rejects(execute(languageServerSnapshotOperation(typescriptLanguageServer.id), null), /The executor does not know the operation typescript_snapshot/);
    await workspace.unregister();
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(runs, { recursive: true, force: true });
    await server.close();
  }
});

test("a missing bundle, a different revision, or a missing host make the registration fail with a cause", async () => {
  const cases: Array<{ contributions: ExecutorContributionStand[]; hostRoot: string | undefined; expected: RegExp; mismatch: boolean }> = [
    { contributions: [{ plugin: "acme.missing", stand: "0".repeat(64) }], hostRoot: HOST_ROOT, expected: /The executor contribution of acme\.missing is missing at .*acme\.missing[/\\]executor[/\\]index\.mjs.*must carry the same bundles as the server/, mismatch: true },
    { contributions: [{ plugin: "ragents.lsp-typescript", stand: "0".repeat(64) }], hostRoot: HOST_ROOT, expected: /has the version [0-9a-f]{12}, required is 000000000000\. The host of this workstation/, mismatch: true },
    { contributions: [await typescriptContribution()], hostRoot: undefined, expected: /The server requires the executor contributions of ragents\.lsp-typescript; this workstation knows no host/, mismatch: false },
  ];
  for (const { contributions, hostRoot, expected, mismatch } of cases) {
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
      assert.equal((workspace.status as { mismatch: boolean }).mismatch, mismatch, "only a different revision is a version difference");
      assert.equal(server.workspaceClients().has(CLIENT_ID), false, "the server sees no registration");
      await workspace.unregister();
    } finally {
      client.rpc.close();
      await rm(directory, { recursive: true, force: true });
      await server.close();
    }
  }
});

test("a dead server is reported as an error", async () => {
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

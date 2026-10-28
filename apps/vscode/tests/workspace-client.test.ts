import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  type ExecutorContributionRevision,
  type LanguageServerSnapshot,
} from "@ragents/workspace-executor";
import { runContracts } from "../../../packages/ragents/src/http/contracts";
import { coreContracts } from "../../server/src/api/contracts";
import { workspaceClientContracts } from "../../../plugins/ragents.workspace/contract";
import { type WorkspaceClientOptions, WorkspaceClient } from "../../../plugins/ragents.workspace/client/workspace-client";
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

const started = async (server: StubServer, rg?: string, accessOptions: Partial<WorkspaceClientOptions> = {}, nestedStorage = false) => {
  const client = new ServerClient(server.url, undefined);
  const directory = await folder();
  const storage = await folder();
  const runs = join(nestedStorage ? directory : storage, "runs");
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID,
    label: "Notebook",
    hostname: "notebook.local",
    platform: process.platform,
    folders: [directory],
    runsDirectory: runs,
  }, { hostRoot: () => undefined, rg, ...accessOptions });
  await workspace.register();
  assert.deepEqual(workspace.status, { kind: "registered" });
  const connection = server.workspaceConnection(CLIENT_ID);
  assert.ok(connection);
  const call = (
    operation: string,
    input: unknown,
    cwd: string,
    options: { onProgress?: (value: unknown) => void; signal?: AbortSignal; access?: "isolated" | "full"; runName?: string } = {},
  ) => server.workspaceConnection(CLIENT_ID)!.call(
    workspaceClientContracts.execute,
    { runId: RUN, access: { level: options.access ?? "isolated" }, ...(options.runName ? { runName: options.runName } : {}), operation, toolCallId: `call-${operation}`, cwd, env: { [RUN_MARKER_ENV]: RUN, CI: "true" }, input },
    options,
  );
  return {
    client,
    directory,
    runs,
    storage,
    workspace,
    call,
    execute: (operation: string, input: unknown, options?: { onProgress?: (value: unknown) => void; signal?: AbortSignal; access?: "isolated" | "full"; runName?: string }) =>
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
    assert.match(textOf((await execute("read", { file_path: "note.md" })).value), /Café/);
    await execute("write", { file_path: "new/file.txt", content: "content" });
    assert.equal(await readFile(join(directory, "new/file.txt"), "utf8"), "content");
    await execute("edit", { file_path: "new/file.txt", old_string: "content", new_string: "changed café" });
    assert.equal(await readFile(join(directory, "new/file.txt"), "utf8"), "changed café");
    assert.match(textOf((await execute("read", { file_path: "/etc/hosts" })).value), /localhost/);
    await assert.rejects(call("read", { file_path: "hosts" }, "/etc"), /Path outside the offered folder: \/etc/);
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
    await rm(join(runs, ".."), { recursive: true, force: true });
    await server.close();
  }
});

test("Windows workstation file checks and environment filtering do not claim command isolation", async (t) => {
  const server = await startStubServer();
  const fixture = await started(server, undefined, { platform: "win32" });
  const outside = join(fixture.storage, "outside.txt");
  await writeFile(outside, "outside-command-probe");
  t.after(async () => {
    await fixture.workspace.unregister();
    fixture.client.rpc.close();
    await server.close();
    await Promise.all([fixture.directory, fixture.storage].map((directory) => rm(directory, { recursive: true, force: true })));
  });
  await assert.rejects(fixture.execute("read", { file_path: outside }), /outside/);
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `${quote(process.execPath)} -e ${quote(`process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(outside)}, 'utf8'))`)}`;
  assert.match(textOf((await fixture.execute("bash", { command })).value), /outside-command-probe/);
});

test("isolated workstation owns its home and temp until the run is deleted", async (t) => {
  const server = await startStubServer();
  const fixture = await started(server);
  t.after(async () => {
    await fixture.workspace.unregister();
    fixture.client.rpc.close();
    await server.close();
    await Promise.all([fixture.directory, fixture.storage].map((directory) => rm(directory, { recursive: true, force: true })));
  });
  const result = textOf((await fixture.execute("bash", { command: 'printf "%s\\n%s\\n" "$HOME" "$TMPDIR"; echo own-home > "$HOME/probe"; echo own-temp > "$TMPDIR/probe"' })).value).trim().split("\n");
  const storage = join(fixture.storage, "run-storage", RUN);
  assert.deepEqual(result, [await realpath(join(storage, "home")), await realpath(join(storage, "tmp"))]);
  await fixture.execute("stop", null);
  assert.equal(await readFile(join(storage, "home", "probe"), "utf8"), "own-home\n");
  await fixture.execute("runFolder.remove", null);
  await assert.rejects(readFile(join(storage, "home", "probe")), /ENOENT/);
});

test("an isolated working folder cannot contain workstation consent or other run storage", async (t) => {
  const server = await startStubServer();
  const fixture = await started(server, undefined, {}, true);
  t.after(async () => {
    await fixture.workspace.unregister();
    fixture.client.rpc.close();
    await server.close();
    await Promise.all([fixture.directory, fixture.storage].map((directory) => rm(directory, { recursive: true, force: true })));
  });
  await assert.rejects(fixture.execute("write", { file_path: "full-access/forged.txt", content: "confirmed" }), /Move the workstation data and runs folders outside the project/);
  await assert.rejects(readFile(join(fixture.directory, "full-access", "forged.txt")), /ENOENT/);
});

test("the isolated workspace bash inherits toolchain variables of this machine, without other variables, VS Code variables and BASH_ENV", async () => {
  const server = await startStubServer();
  const { client, directory, runs, execute } = await started(server);
  const startup = join(directory, "startup.sh");
  const names = ["RAGENTS_TEST_OWN_TOOL", "JAVA_HOME", "VSCODE_RAGENTS_TEST", "ELECTRON_RAGENTS_TEST", "BASH_ENV"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    await writeFile(startup, "echo startup-file-read\n", "utf8");
    process.env.RAGENTS_TEST_OWN_TOOL = "from-user";
    process.env.JAVA_HOME = "/opt/example-java";
    process.env.VSCODE_RAGENTS_TEST = "editor";
    process.env.ELECTRON_RAGENTS_TEST = "editor";
    process.env.BASH_ENV = startup;
    const output = textOf((await execute("bash", {
      command: 'printf "%s|%s|%s|%s|%s|%s" "${RAGENTS_TEST_OWN_TOOL-empty}" "$JAVA_HOME" "${VSCODE_RAGENTS_TEST-empty}" "${ELECTRON_RAGENTS_TEST-empty}" "${BASH_ENV-empty}" "$CI"',
    })).value);
    assert.equal(output.trim(), "empty|/opt/example-java|empty|empty|empty|true");
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
    await server.close();
  }
});


test("isolated workstation commands remove secrets and full access uses the locally confirmed environment and files", async (t) => {
  const server = await startStubServer();
  const confirmed: unknown[] = [];
  const { client, directory, runs, workspace, execute } = await started(server, undefined, {
    confirmFullAccess: async (run) => { confirmed.push(run); return true; },
  });
  const outside = await folder();
  const previous = process.env.RAGENTS_TEST_TOKEN;
  process.env.RAGENTS_TEST_TOKEN = "local-secret";
  t.after(async () => {
    if (previous === undefined) delete process.env.RAGENTS_TEST_TOKEN;
    else process.env.RAGENTS_TEST_TOKEN = previous;
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const command = 'printf "%s" "${RAGENTS_TEST_TOKEN-empty}"';
  assert.equal(textOf((await execute("bash", { command })).value).trim(), "empty");
  await assert.rejects(execute("write", { file_path: join(outside, "note.txt"), content: "isolated" }), /outside the working directory/);
  assert.equal(textOf((await execute("bash", { command }, { access: "full", runName: "Review project" })).value).trim(), "local-secret");
  await execute("write", { file_path: join(outside, "note.txt"), content: "full" }, { access: "full" });
  assert.equal(await readFile(join(outside, "note.txt"), "utf8"), "full");
  assert.deepEqual(confirmed, [{ runId: RUN, name: "Review project" }]);
  assert.equal(textOf((await execute("bash", { command })).value).trim(), "empty");
  await assert.rejects(execute("read", { file_path: join(outside, "note.txt") }), /outside the working directory/);
});

test("a workstation refuses full access before any tool side effect without a local decision", async (t) => {
  const server = await startStubServer();
  const { client, directory, runs, workspace, execute } = await started(server);
  t.after(async () => {
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
  });
  await assert.rejects(execute("write", { file_path: "unconfirmed.txt", content: "forbidden" }, { access: "full" }), /Isolated.*VS Code.*--allow-full-access/);
  await assert.rejects(readFile(join(directory, "unconfirmed.txt")), /ENOENT/);
  for (const operation of ["stop", "delete"]) {
    await assert.rejects(server.workspaceConnection(CLIENT_ID)!.call(workspaceClientContracts.execute, {
      runId: "../outside", access: { level: "isolated" }, operation, cwd: directory, env: {}, input: null,
    }), /not usable as a folder name/);
  }
  await execute("write", { file_path: "isolated.txt", content: "allowed" });
  assert.equal(await readFile(join(directory, "isolated.txt"), "utf8"), "allowed");
});

test("deleting an offered-folder run clears its local full access confirmation", async (t) => {
  const server = await startStubServer();
  let calls = 0;
  const { client, directory, runs, workspace, execute } = await started(server, undefined, {
    confirmFullAccess: async () => { calls += 1; return true; },
  });
  t.after(async () => {
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
  });
  await execute("write", { file_path: "note.txt", content: "one" }, { access: "full" });
  await execute("stop", null);
  await execute("read", { file_path: "note.txt" }, { access: "full" });
  assert.equal(calls, 1, "stopping a run preserves its approval");
  await execute("delete", null);
  await execute("read", { file_path: "note.txt" }, { access: "full" });
  assert.equal(calls, 2, "deleting the run requires local approval again");
});


test("a downgrade ends a full access background command before executing isolated calls", { skip: process.platform === "win32", timeout: 30_000 }, async (t) => {
  const server = await startStubServer();
  const { client, directory, runs, workspace, execute } = await started(server, undefined, { fullAccess: () => "allow" });
  t.after(async () => {
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
  });
  await execute("bash", { command: 'printf "%s" $$ > full.pid; while :; do sleep 0.1; done', run_in_background: true, startedBy: "agent-1" }, { access: "full" });
  let pid = 0;
  await waitFor(() => {
    try { pid = Number(readFileSync(join(directory, "full.pid"), "utf8")); return pid > 0; }
    catch { return false; }
  });
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(), true);
  await execute("read", { file_path: "full.pid" });
  assert.equal(alive(), false, "the isolated operation only returns after the full access process ended");
});

test("a downgrade while local confirmation is pending prevents the full access call from starting", async (t) => {
  const server = await startStubServer();
  const answer = Promise.withResolvers<boolean>();
  let asked = false;
  const { client, directory, runs, workspace, execute } = await started(server, undefined, {
    confirmFullAccess: () => { asked = true; return answer.promise; },
  });
  t.after(async () => {
    answer.resolve(false);
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
  });
  const full = execute("write", { file_path: "late.txt", content: "forbidden" }, { access: "full" });
  const refused = assert.rejects(full, /access changed before the operation started/);
  await waitFor(() => asked);
  await execute("write", { file_path: "isolated.txt", content: "allowed" });
  answer.resolve(true);
  await refused;
  await assert.rejects(readFile(join(directory, "late.txt")), /ENOENT/);
});

test("commits in the workspace bash carry the Git identity of the folder, even when the command names another one", async () => {
  const server = await startStubServer();
  const { client, directory, runs, execute } = await started(server);
  try {
    await execute("bash", { command: "git init -q && git config user.name Developer && git config user.email developer@example.invalid" });
    const output = textOf((await execute("bash", {
      command: "git -c user.name=Agent -c user.email=agent@example.invalid commit -q --allow-empty -m first && git log -1 --format='%an <%ae>|%cn <%ce>'",
    })).value);
    assert.equal(output.trim(), "Developer <developer@example.invalid>|Developer <developer@example.invalid>");
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
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
    assert.deepEqual(output.trim().split("\n"), [process.platform === "win32" ? rg : await realpath(rg), "rg-bundled"]);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
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
    await call("write", { file_path: "note.md", content: "in the run's folder" }, own);
    assert.equal(await readFile(join(own, "note.md"), "utf8"), "in the run's folder");
    await assert.rejects(call("read", { file_path: "note.md" }, join(runs, "other-run")), /Path outside the offered folder/,
      "the folder of another run is not a folder of this task");
    await assert.rejects(call("read", { file_path: "x" }, runs), /Path outside the offered folder/, "the runs folder itself is not one");
    assert.deepEqual((await call("runFolder.remove", null, own)).value, { removed: true });
    await assert.rejects(readFile(join(own, "note.md"), "utf8"), /ENOENT/);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
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

    await assert.rejects(execute("bash", { command: "sleep 30", timeout: 1_000 }), /Command stopped after 1000 ms \(timeout\)/);
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
    await client.rpc.call(runContracts.stop, { runId: RUN, commandId: "stop-1", reason: "Test" }, { timeoutMs: 5000 });
    await running.catch(() => undefined);
  } finally {
    client.rpc.close();
    await rm(directory, { recursive: true, force: true });
    await server.close();
  }
});

const HOST_ROOT = resolve(import.meta.dirname, "../../..");

/** The TypeScript contribution from the built bundles of this checkout, as a server requires it. */
const typescriptContribution = async (): Promise<ExecutorContributionRevision> => {
  const { plugin, revision } = await loadExecutorContribution("ragents.lsp-typescript", join(HOST_ROOT, "bundles", "ragents.lsp-typescript", EXECUTOR_CONTRIBUTION_FILE));
  return { plugin, revision };
};

/** A workspace with the TypeScript language server from the host of this checkout; the language server host keeps state across calls. */
const withLanguageServer = async (server: StubServer) => {
  const client = new ServerClient(server.url, undefined);
  const directory = await folder();
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [directory], runsDirectory: join(directory, "..", "runs"),
  }, { hostRoot: () => HOST_ROOT, fullAccess: () => "allow" });
  const execute = (operation: string, input: unknown, access: "isolated" | "full" = "isolated") => {
    const connection = server.workspaceConnection(CLIENT_ID);
    assert.ok(connection, "the workspace is registered with the server");
    return connection.call(workspaceClientContracts.execute, { runId: RUN, access: { level: access }, operation, cwd: directory, env: { [RUN_MARKER_ENV]: RUN }, input });
  };
  return {
    client,
    directory,
    workspace,
    open: async (access: "isolated" | "full" = "isolated") => (await execute(languageServerOpenOperation(typescriptLanguageServer.id), { root: "." }, access)).value as string,
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

test("a workstation downgrade stops language servers and they reopen on demand", { timeout: 120_000 }, async () => {
  const server = await startStubServer({ contributions: [await typescriptContribution()] });
  const { workspace, open, states, close } = await withLanguageServer(server);
  try {
    await workspace.register();
    assert.match(await open("full"), /1 open instance of TypeScript/);
    assert.deepEqual(await states(), [], "the first isolated operation closes full access language servers");
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
    await rm(join(runs, ".."), { recursive: true, force: true });
    await server.close();
  }
});

test("a missing bundle, a different revision, or a missing host make the registration fail with a cause", async () => {
  const cases: Array<{ contributions: ExecutorContributionRevision[]; hostRoot: string | undefined; expected: RegExp; mismatch: boolean }> = [
    { contributions: [{ plugin: "acme.missing", revision: "0".repeat(64) }], hostRoot: HOST_ROOT, expected: /The executor contribution of acme\.missing is missing at .*acme\.missing[/\\]executor[/\\]index\.mjs.*must carry the same bundles as the server/, mismatch: true },
    { contributions: [{ plugin: "ragents.lsp-typescript", revision: "0".repeat(64) }], hostRoot: HOST_ROOT, expected: /has the version [0-9a-f]{12}, required is 000000000000\. The host of this workstation/, mismatch: true },
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

test("a headless package mismatch names both RAgents versions and the matching package installation", async () => {
  const server = await startStubServer({ version: "0.2.0", refuseRegistration: { code: "workspace-executor-version", message: "The executor versions differ." } });
  const client = new ServerClient(server.url, undefined);
  const directory = await folder();
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Headless", hostname: "notebook.local", platform: process.platform, folders: [directory], runsDirectory: join(directory, "runs"),
  }, { hostRoot: () => HOST_ROOT, version: "0.1.8" });
  try {
    await workspace.register();
    assert.equal(workspace.status.kind, "failed");
    assert.match((workspace.status as { message: string }).message, /Workstation package version 0\.1\.8, server version 0\.2\.0\. Install the matching package version: npm install -g @schlenkr\/ragents@0\.2\.0/);
  } finally {
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("operations resolve dependencies from the asynchronously selected host, also after a host change", async (t) => {
  const directory = await folder();
  const project = join(directory, "project");
  await mkdir(project);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const contribution = `import { readFileSync } from "node:fs";
export const executor = (machine) => ({ modules: [(host) => ({ operations: {
  acme_version: async ({ runId }) => JSON.parse(readFileSync(machine.hostPackageFile((await host.contextFor(runId)).hostRoot, "acme-dependency"), "utf8")),
} })] });
`;
  const roots = [join(directory, "first-host"), join(directory, "second-host")];
  for (const [index, root] of roots.entries()) {
    await mkdir(join(root, "bundles/acme.executor/executor"), { recursive: true });
    await mkdir(join(root, "node_modules/acme-dependency"), { recursive: true });
    await writeFile(join(root, "bundles/acme.executor/executor/index.mjs"), contribution);
    await writeFile(join(root, "node_modules/acme-dependency/index.json"), JSON.stringify({ version: index + 1 }));
  }
  const loaded = await loadExecutorContribution("acme.executor", join(roots[0]!, "bundles/acme.executor/executor/index.mjs"));
  const server = await startStubServer({ contributions: [{ plugin: loaded.plugin, revision: loaded.revision }] });
  t.after(() => server.close());
  const client = new ServerClient(server.url, undefined);
  t.after(() => client.rpc.close());
  const selection = { root: roots[0]! };
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [project], runsDirectory: join(directory, "runs"),
  }, { hostRoot: () => undefined, prepareHost: () => Promise.resolve(selection.root) });
  t.after(() => workspace.unregister());
  await workspace.register();
  selection.root = roots[1]!;
  const version = () => server.workspaceConnection(CLIENT_ID)!.call(workspaceClientContracts.execute, {
    runId: RUN, access: { level: "isolated" }, operation: "acme_version", cwd: project, env: {}, input: null,
  });
  assert.deepEqual(await version(), { value: { version: 1 } });
  await workspace.register();
  assert.deepEqual(await version(), { value: { version: 2 } });
});

test("signing out during host preparation discards the late result", async (t) => {
  const server = await startStubServer({ contributions: [await typescriptContribution()] });
  t.after(() => server.close());
  const client = new ServerClient(server.url, undefined);
  t.after(() => client.rpc.close());
  const pending = Promise.withResolvers<string>();
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [tmpdir()], runsDirectory: join(tmpdir(), "ragents-runs"),
  }, { hostRoot: () => undefined, prepareHost: (report) => { report("Fetching host ..."); return pending.promise; } });
  const registering = workspace.register();
  await waitFor(() => workspace.status.kind === "preparing");
  const stopping = workspace.unregister();
  pending.resolve(HOST_ROOT);
  await Promise.all([registering, stopping]);
  assert.deepEqual(workspace.status, { kind: "idle" });
  assert.equal(server.workspaceClients().size, 0);
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

test("a failed downgrade cleanup is retried before any later workstation operation", async (t) => {
  const directory = await folder();
  const project = join(directory, "project");
  await mkdir(project);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const contribution = join(directory, "bundles/acme.cleanup/executor/index.mjs");
  await mkdir(join(directory, "bundles/acme.cleanup/executor"), { recursive: true });
  await writeFile(contribution, `
export const executor = () => {
  let stops = 0;
  return { modules: [() => ({
    operations: { acme_stops: () => Promise.resolve(stops) },
    stopRun: async () => { stops += 1; if (stops === 1) throw new Error("cleanup blocked"); },
  })] };
};
`);
  const loaded = await loadExecutorContribution("acme.cleanup", contribution);
  const server = await startStubServer({ contributions: [{ plugin: loaded.plugin, revision: loaded.revision }] });
  t.after(() => server.close());
  const client = new ServerClient(server.url, undefined);
  t.after(() => client.rpc.close());
  const workspace = new WorkspaceClient(client, {
    id: CLIENT_ID, label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [project], runsDirectory: join(directory, "runs"),
  }, { hostRoot: () => directory, fullAccess: () => "allow" });
  t.after(() => workspace.unregister());
  await workspace.register();
  const call = (level: "isolated" | "full") => server.workspaceConnection(CLIENT_ID)!.call(workspaceClientContracts.execute, {
    runId: RUN, access: { level }, operation: "acme_stops", cwd: project, env: {}, input: null,
  });
  assert.deepEqual(await call("full"), { value: 0 });
  await assert.rejects(call("isolated"), /cleanup blocked/);
  assert.deepEqual(await call("isolated"), { value: 2 });
});

test("a full access background command ends when the workstation loses its server connection", { skip: process.platform === "win32", timeout: 30_000 }, async (t) => {
  const server = await startStubServer();
  const { client, directory, runs, workspace, execute } = await started(server, undefined, { fullAccess: () => "allow" });
  t.after(async () => {
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
  });
  await execute("bash", { command: 'printf "%s" $$ > disconnected.pid; while :; do sleep 0.1; done', run_in_background: true, startedBy: "agent-1" }, { access: "full" });
  let pid = 0;
  await waitFor(() => {
    try { pid = Number(readFileSync(join(directory, "disconnected.pid"), "utf8")); return pid > 0; }
    catch { return false; }
  });
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(), true);
  client.rpc.close();
  await waitFor(() => !alive(), 10_000);
  client.rpc.connect();
  await workspace.register();
  assert.deepEqual(workspace.status, { kind: "registered" });
  await execute("read", { file_path: "disconnected.pid" });
  assert.equal(alive(), false);
});

test("a pending full access confirmation cannot launch its operation after a disconnect", { timeout: 30_000 }, async (t) => {
  const server = await startStubServer();
  const answer = Promise.withResolvers<boolean>();
  let asked = false;
  const { client, directory, runs, workspace, execute } = await started(server, undefined, {
    confirmFullAccess: () => { asked = true; return answer.promise; },
  });
  t.after(async () => {
    answer.resolve(false);
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
    await rm(join(runs, ".."), { recursive: true, force: true });
  });
  const full = execute("write", { file_path: "disconnected.txt", content: "forbidden" }, { access: "full" });
  const ended = assert.rejects(full, /closed|cancel|connection/i);
  await waitFor(() => asked);
  client.rpc.close();
  answer.resolve(true);
  await ended;
  client.rpc.connect();
  await workspace.register();
  assert.deepEqual(workspace.status, { kind: "registered" });
  await execute("write", { file_path: "reconnected.txt", content: "allowed" });
  await assert.rejects(readFile(join(directory, "disconnected.txt")), /ENOENT/);
});

import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DomainError, pluginStateKey, type MethodConnection, type PluginContext, type RunState } from "@ragents/engine";
import { WORKSPACE_EXECUTOR_VERSION } from "@ragents/workspace-executor";

import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract.ts";
import { WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";
import { RunWorkspaceRuntime, type RunWorkspaceRuntimeOptions } from "../../../plugins/ragents.workspace/server/runtime.ts";
import type { WorkspaceResolver, WorkspaceResolverContext } from "../src/ragents/workspace-runtime.ts";

const CLIENT = "client-00000001";

const RUNS = "/home/beispiel/.local/share/ragents/workspace/runs";

const onLaptop = (folder: { path: string; fresh?: true }) => ({ machine: { client: CLIENT, label: "Laptop" }, folder });

const laptopProject = onLaptop({ path: "/home/beispiel/project" });

interface WorkstationCall {
  operation: string;
  cwd: string;
  input?: unknown;
}

interface WorkstationConnection extends MethodConnection {
  end: () => void;
}

type WorkstationAnswer = (call: WorkstationCall) => unknown;

const toolAnswer: WorkstationAnswer = ({ operation }) => ({ content: [{ type: "text", text: `${operation} erledigt` }] });

/** Ein Arbeitsplatz ohne Gegenstelle; er merkt sich, womit der Server ihn beauftragt. */
const workstationConnection = (calls: WorkstationCall[], userId: string | null = "beispiel", answer: WorkstationAnswer = toolAnswer): WorkstationConnection => {
  const listeners = new Set<() => void>();
  return {
    id: `connection-${userId}`,
    userId,
    streamless: false,
    call: async (_contract: unknown, input: unknown) => {
      const { operation, cwd, input: payload } = input as WorkstationCall;
      calls.push({ operation, cwd, ...(payload === undefined || payload === null ? {} : { input: payload }) });
      return { value: await answer({ operation, cwd, input: payload }) };
    },
    onClose: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    end: () => {
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
  } as unknown as WorkstationConnection;
};

const agentTool = async (runtime: RunWorkspaceRuntime, runId: string, name: string, input: unknown): Promise<unknown> => {
  const tools = await runtime.sandbox.workspaceTools().tools({ runId } as PluginContext);
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Das Arbeitsbereich-Werkzeug ${name} fehlt`);
  return tool.run({ signal: undefined } as never, "call-1", input as never);
};

const runStateWith = (optionId: string | undefined, choice: unknown, ownerUserId: string | null = null): RunState => ({
  ownerUserId,
  pluginStates: new Map(optionId === undefined ? [] : [[
    pluginStateKey(optionId, { kind: "run" }),
    { pluginId: optionId, scope: { kind: "run" }, state: choice, updatedAt: "2026-09-03T00:00:00.000Z" },
  ]]),
}) as unknown as RunState;

const fixture = async (overrides: Partial<RunWorkspaceRuntimeOptions> = {}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-run-workspace-")));
  const runtime = new RunWorkspaceRuntime({
    globalDirectory: path.join(root, "global"),
    sessionDirectory: (runId, ...segments) => path.join(root, "sessions", runId, "plugins", "ragents.workspace", ...segments),
    storageRootFor: (runId) => path.join(root, "sessions", runId),
    sessionsDirectoryPattern: path.join(root, "sessions", "{runId}", "plugins", "ragents.workspace"),
    sessionWorkspaceFor: () => Promise.reject(new Error("nicht gefragt")),
    skillPaths: async () => [],
    resolver: () => undefined,
    runState: () => runStateWith(undefined, undefined),
    clients: new WorkspaceClientRegistry(),
    ...overrides,
  });
  return { root, runtime, remove: () => rm(root, { recursive: true, force: true }) };
};

test("a run bound to a folder on the server works there and creates nothing under the session storage", async () => {
  const { root, runtime, remove } = await fixture({
    runState: (runId) => runId === "bound" ? runStateWith(WORKSPACE_BINDING_OPTION_ID, { machine: "server", folder: { path: path.join(root, "project") } }) : null,
  });
  try {
    await mkdtempInside(root, "project");
    const notes: string[] = [];
    const workspace = await runtime.resolve("bound", (text) => notes.push(text));
    assert.equal(workspace.cwd, path.join(root, "project"));
    assert.equal(await workspace.currentRoot(), path.join(root, "project"));
    assert.deepEqual(notes, [`Arbeitsbereich: ${path.join(root, "project")} (Projektordner auf dem Server)`]);
    assert.equal(await stat(path.join(root, "sessions")).catch(() => undefined), undefined);
    await rm(path.join(root, "project"), { recursive: true });
    await assert.rejects(workspace.currentRoot(), (error: unknown) => error instanceof DomainError && error.code === "workspace-path-missing");
  } finally {
    await remove();
  }
});

test("a run bound to a workstation names the bound folder, creates nothing on the server and refuses every local access to it", async () => {
  const { root, runtime, remove } = await fixture({
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, laptopProject),
  });
  try {
    const notes: string[] = [];
    const workspace = await runtime.resolve("remote", (text) => notes.push(text));
    assert.equal(workspace.cwd, "/home/beispiel/project");
    const local = /liegt auf dem Arbeitsplatz Laptop, nicht auf dem Server; er ist nur über den Executor des Runs/;
    await assert.rejects(workspace.currentRoot(), local);
    assert.deepEqual(runtime.placementOf("remote"), { machine: "client", folder: "existing" });
    assert.deepEqual(notes, ["Arbeitsbereich: /home/beispiel/project (Projektordner auf dem Arbeitsplatz Laptop)"]);
    assert.equal(await stat(path.join(root, "sessions")).catch(() => undefined), undefined);
    await assert.rejects(runtime.sandbox.execute("remote", "read", { path: "a.txt" }), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
    assert.equal(await runtime.sandbox.execute("remote", "processes.stopAll", {}, { whenReachable: true }), null);
  } finally {
    await remove();
  }
});

test("work of a bound run that stays on the server gets its own server folder, never the path of the workstation", async () => {
  let resolved: RunWorkspaceRuntime | undefined;
  const { root, runtime, remove } = await fixture({
    sessionWorkspaceFor: (runId) => resolved!.resolve(runId, () => undefined),
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, laptopProject),
  });
  resolved = runtime;
  try {
    const context = await runtime.sandbox.serverProcessContextFor("remote");
    const server = path.join(root, "sessions", "remote", "plugins", "ragents.workspace", "server");
    assert.equal(context.cwd, server);
    assert.equal(context.root, server);
    assert.ok((await stat(server)).isDirectory());
    assert.equal(context.env.RAGENTS_RUN_ID, "remote");
    assert.ok(!JSON.stringify(context).includes("/home/beispiel/project"), "der Pfad des Arbeitsplatzes erscheint im Serverkontext nicht");
  } finally {
    await remove();
  }
});

test("the agent tool of a bound run runs in the same folder the prompt names", async () => {
  const calls: WorkstationCall[] = [];
  const clients = new WorkspaceClientRegistry();
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/beispiel/project"], runsDirectory: RUNS },
    WORKSPACE_EXECUTOR_VERSION, workstationConnection(calls));
  const { runtime, remove } = await fixture({
    clients,
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, laptopProject, "beispiel"),
  });
  try {
    const workspace = await runtime.resolve("remote", () => undefined);
    assert.equal(await agentTool(runtime, "remote", "read", { path: "a.txt" }), "read erledigt");
    assert.deepEqual(calls, [{ operation: "read", cwd: "/home/beispiel/project", input: { path: "a.txt" } }]);
    assert.equal(calls[0].cwd, workspace.cwd);
  } finally {
    await remove();
  }
});

test("a workstation of another user with the same id never takes over a bound run", async () => {
  const alices: WorkstationCall[] = [];
  const bobs: WorkstationCall[] = [];
  const clients = new WorkspaceClientRegistry();
  const workstation = { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/beispiel/project"], runsDirectory: RUNS };
  const alice = workstationConnection(alices, "alice");
  await clients.register(CLIENT, workstation, WORKSPACE_EXECUTOR_VERSION, alice);
  const binding = laptopProject;
  const states = new Map<string, RunState>([
    ["alices-run", runStateWith(WORKSPACE_BINDING_OPTION_ID, binding, "alice")],
    ["ownerless-run", runStateWith(WORKSPACE_BINDING_OPTION_ID, binding)],
  ]);
  const { runtime, remove } = await fixture({ clients, runState: (runId) => states.get(runId) ?? null });
  try {
    assert.equal(await agentTool(runtime, "alices-run", "read", { path: "a.txt" }), "read erledigt");
    alice.end();
    await clients.register(CLIENT, workstation, WORKSPACE_EXECUTOR_VERSION, workstationConnection(bobs, "bob"));
    await assert.rejects(runtime.sandbox.execute("alices-run", "bash", { command: "cat ~/.ssh/id_ed25519" }), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
    await assert.rejects(runtime.sandbox.execute("ownerless-run", "read", { path: "a.txt" }), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
    assert.deepEqual(bobs, [], "Bobs Arbeitsplatz mit derselben Kennung bekommt keinen Aufruf aus Alices Run");

    await clients.register(CLIENT, workstation, WORKSPACE_EXECUTOR_VERSION, workstationConnection(alices, "alice"));
    assert.equal(await agentTool(runtime, "alices-run", "read", { path: "b.txt" }), "read erledigt");
    assert.deepEqual(alices.map((call) => call.operation), ["read", "read"], "Alice meldet sich neben Bob mit derselben Kennung wieder an");
    assert.deepEqual(bobs, []);
  } finally {
    await remove();
  }
});

test("a run that has not started has no working directory yet", async () => {
  const { runtime, remove } = await fixture({ runState: () => null });
  try {
    await assert.rejects(
      runtime.resolve("draft", () => undefined),
      (error: unknown) => error instanceof DomainError && error.code === "run-not-started" && error.status === 409,
    );
  } finally {
    await remove();
  }
});

test("without a resolver every run gets its own empty directory under the session storage", async () => {
  const { root, runtime, remove } = await fixture();
  try {
    const first = await runtime.resolve("run-1", () => undefined);
    const second = await runtime.resolve("run-2", () => undefined);
    assert.equal(first.cwd, path.join(root, "sessions", "run-1", "plugins", "ragents.workspace", "workspace"));
    assert.notEqual(first.cwd, second.cwd);
    assert.ok((await stat(first.cwd)).isDirectory());
    assert.equal(await first.currentRoot(), first.cwd);
    assert.deepEqual(runtime.describe(), {
      mode: "per-run",
      directoryPattern: path.join(root, "sessions", "{runId}", "plugins", "ragents.workspace", "workspace"),
    });
  } finally {
    await remove();
  }
});

test("a resolver without an option receives the prepared directory and may point elsewhere", async () => {
  const seen: WorkspaceResolverContext[] = [];
  const { root, runtime, remove } = await fixture({
    resolver: () => ({
      resolve: async (context) => {
        seen.push(context);
        return { cwd: path.join(root, "elsewhere"), extraEnv: { PROJECT: "demo" } };
      },
    }),
  });
  try {
    await mkdtempInside(root, "elsewhere");
    const workspace = await runtime.resolve("run-1", () => undefined);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].runId, "run-1");
    assert.equal(seen[0].choice, null);
    assert.ok((await stat(seen[0].directory)).isDirectory());
    assert.equal(workspace.cwd, path.join(root, "elsewhere"));
    assert.deepEqual(workspace.extraEnv, { PROJECT: "demo" });
  } finally {
    await remove();
  }
});

test("a resolver with an option gets the stored choice and refuses runs that have not started", async () => {
  const choices: unknown[] = [];
  const resolver: WorkspaceResolver = {
    optionId: "test.source",
    resolve: async ({ directory, choice }) => {
      choices.push(choice);
      return { cwd: directory };
    },
  };
  const states = new Map<string, RunState | null>([
    ["started", runStateWith("test.source", "clone")],
    ["unstored", runStateWith(undefined, undefined)],
    ["draft", null],
  ]);
  const { runtime, remove } = await fixture({
    resolver: () => resolver,
    runState: (runId) => states.get(runId) ?? null,
  });
  try {
    await runtime.resolve("started", () => undefined);
    assert.deepEqual(choices, ["clone"]);
    await assert.rejects(
      runtime.resolve("draft", () => undefined),
      (error: unknown) => error instanceof DomainError && error.code === "run-not-started" && error.status === 409,
    );
    await assert.rejects(runtime.resolve("unstored", () => undefined), /test\.source .* nicht gespeichert/);
    assert.equal(choices.length, 1);
  } finally {
    await remove();
  }
});

test("a contribution brings its own kind of workspace and the host prepares no folder for it", async () => {
  const notes: string[] = [];
  const operations: string[] = [];
  let workspaceRoot = "";
  const resolver = (root: string): WorkspaceResolver => ({
    kind: { id: "example.worktree", label: "Worktree je Run", serverFolders: false, directoryPattern: path.join(root, "worktrees", "{runId}") },
    resolve: async ({ runId, emitSystem }) => {
      emitSystem("Erzeuge den Worktree des Runs ...");
      const directory = path.join(root, "worktrees", runId);
      await mkdirInside(directory);
      return {
        cwd: directory,
        description: "# Working directory\n\nDein Worktree.",
        gitEnv: { GIT_OBJECT_DIRECTORY: path.join(directory, ".git/objects") },
        extraEnv: { EXAMPLE_BRANCH_PREFIX: "beispiel/" },
        hostSandbox: { home: directory, readOnlyRoots: [{ directory: root }], ident: { uid: 4301, gid: 4200, name: "sess-4301" } },
        runOperation: async (operation) => {
          operations.push("gesperrt");
          return operation();
        },
      };
    },
  });
  const { root, runtime, remove } = await fixture({ resolver: () => resolver(root) });
  try {
    const workspace = await runtime.resolve("run-1", (text) => notes.push(text));
    workspaceRoot = path.join(root, "worktrees", "run-1");
    assert.equal(workspace.cwd, workspaceRoot);
    assert.deepEqual(notes, ["Erzeuge den Worktree des Runs ..."]);
    assert.equal(workspace.description, "# Working directory\n\nDein Worktree.");
    assert.deepEqual(workspace.extraEnv, { EXAMPLE_BRANCH_PREFIX: "beispiel/" });
    assert.deepEqual(workspace.gitEnv, { GIT_OBJECT_DIRECTORY: path.join(workspaceRoot, ".git/objects") });
    assert.equal(await workspace.runOperation(async () => "fertig"), "fertig");
    assert.deepEqual(operations, ["gesperrt"]);
    assert.deepEqual(runtime.placementOf("run-1"), { machine: "server", folder: "fresh", kind: "example.worktree" });
    assert.equal(runtime.describe().directoryPattern, path.join(root, "worktrees", "{runId}"));
    assert.equal(await stat(path.join(root, "sessions")).catch(() => undefined), undefined);
  } finally {
    await remove();
  }
});

test("the sandbox of a contributed workspace runs under its account with its readable roots", async () => {
  const ident = { uid: 4301, gid: 4200, name: "sess-4301" };
  let home = "";
  let resolved: RunWorkspaceRuntime | undefined;
  const { root, runtime, remove } = await fixture({
    sessionWorkspaceFor: (runId) => resolved!.resolve(runId, () => undefined),
    resolver: () => ({
      kind: { id: "example.worktree", label: "Worktree je Run", serverFolders: false },
      resolve: async ({ runId }) => {
        home = path.join(root, "homes", runId);
        await mkdirInside(home);
        return { cwd: home, hostSandbox: { home, readOnlyRoots: [{ directory: root }, { directory: path.join(root, "fehlt") }], ident } };
      },
    }),
  });
  resolved = runtime;
  try {
    const context = await runtime.sandbox.serverProcessContextFor("run-1");
    assert.equal(context.cwd, home);
    assert.equal(context.uid, ident.uid);
    assert.equal(context.gid, ident.gid);
    assert.equal(context.home, home);
    assert.deepEqual(context.readOnlyRoots, [root]);
  } finally {
    await remove();
  }
});

test("the contribution stops and deletes its own runs around the sandbox, bound runs without it", async () => {
  const steps: string[] = [];
  const resolver: WorkspaceResolver = {
    kind: { id: "example.worktree", label: "Worktree je Run", serverFolders: false },
    resolve: async ({ directory }) => ({ cwd: directory }),
    stopSession: async (runId, sandbox) => {
      steps.push(`prozesse ${runId}`);
      await sandbox();
      steps.push(`nachlauf ${runId}`);
    },
    deleteSession: async (runId) => {
      steps.push(`worktree weg ${runId}`);
    },
  };
  const bound = laptopProject;
  const { runtime, remove } = await fixture({
    resolver: () => resolver,
    runState: (runId) => runId === "remote" ? runStateWith(WORKSPACE_BINDING_OPTION_ID, bound) : runStateWith(undefined, undefined),
  });
  try {
    await runtime.deleteSession("run-1");
    assert.deepEqual(steps, ["prozesse run-1", "nachlauf run-1", "worktree weg run-1"]);
    await runtime.stopSession("remote");
    await runtime.deleteSession("remote");
    assert.deepEqual(steps, ["prozesse run-1", "nachlauf run-1", "worktree weg run-1"]);
  } finally {
    await remove();
  }
});

test("each combination of machine and folder has its own placement, and an older journal maps onto exactly one", async () => {
  const fresh = onLaptop({ path: `${RUNS}/fresh-remote`, fresh: true });
  const states = new Map<string, unknown>([
    ["server-existing", { machine: "server", folder: { path: "/srv/project" } }],
    ["client-existing", laptopProject],
    ["client-fresh", fresh],
    ["old-fresh", { kind: "fresh" }],
    ["old-path", { kind: "path", path: "/srv/project" }],
    ["old-client", { kind: "client", client: CLIENT, label: "Laptop", path: "/home/beispiel/project" }],
    ["broken", { kind: "elsewhere" }],
    ["client-fresh-without-path", onLaptop("fresh" as never)],
    ["server-with-own-path", { machine: "server", folder: { path: "/srv/project", fresh: true } }],
  ]);
  const { runtime, remove } = await fixture({
    runState: (runId) => runStateWith(states.has(runId) ? WORKSPACE_BINDING_OPTION_ID : undefined, states.get(runId)),
  });
  try {
    assert.deepEqual(runtime.placementOf("server-fresh"), { machine: "server", folder: "fresh" });
    assert.deepEqual(runtime.placementOf("server-existing"), { machine: "server", folder: "existing" });
    assert.deepEqual(runtime.placementOf("client-existing"), { machine: "client", folder: "existing" });
    assert.deepEqual(runtime.placementOf("client-fresh"), { machine: "client", folder: "fresh" });
    assert.deepEqual(runtime.placementOf("old-fresh"), runtime.placementOf("server-fresh"));
    assert.deepEqual(runtime.placementOf("old-path"), runtime.placementOf("server-existing"));
    assert.deepEqual(runtime.placementOf("old-client"), runtime.placementOf("client-existing"));
    assert.equal((await runtime.resolve("old-client", () => undefined)).cwd, "/home/beispiel/project");
    assert.equal(runtime.transfer.boundDirectory("old-path"), "/srv/project");
    assert.equal(runtime.transfer.boundDirectory("client-fresh"), null);
    for (const runId of ["broken", "client-fresh-without-path", "server-with-own-path"]) {
      assert.throws(() => runtime.placementOf(runId), /gespeicherte Arbeitsbereich-Bindung ist ungültig/, runId);
      await assert.rejects(runtime.resolve(runId, () => undefined), /gespeicherte Arbeitsbereich-Bindung ist ungültig/, runId);
    }
  } finally {
    await remove();
  }
});

test("a new folder per run on a workstation: the prompt names it, the server creates nothing, and the workstation creates it before the first order only", async () => {
  const calls: WorkstationCall[] = [];
  const clients = new WorkspaceClientRegistry();
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/beispiel/project"], runsDirectory: RUNS },
    WORKSPACE_EXECUTOR_VERSION, workstationConnection(calls, "beispiel", (call) =>
      call.operation === "runFolder.create" ? { created: true } : toolAnswer(call)));
  const folder = `${RUNS}/remote`;
  const { root, runtime, remove } = await fixture({
    clients,
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, onLaptop({ path: folder, fresh: true }), "beispiel"),
  });
  try {
    const notes: string[] = [];
    const workspace = await runtime.resolve("remote", (text) => notes.push(text));
    assert.equal(workspace.cwd, folder);
    assert.deepEqual(notes, [`Arbeitsbereich: ${folder} (Leerer Ordner je Run auf dem Arbeitsplatz Laptop)`]);
    assert.match(workspace.description ?? "", /on the workstation "Laptop", not on the server: a folder of this run alone/);
    await assert.rejects(workspace.currentRoot(), /liegt auf dem Arbeitsplatz Laptop, nicht auf dem Server/);
    assert.deepEqual(calls, [], "das Auflösen erreicht den Arbeitsplatz nie");
    assert.deepEqual(await runtime.sandbox.execute("remote", "processes.stopAll", {}, { whenReachable: true }), toolAnswer({ operation: "processes.stopAll", cwd: folder }));
    assert.deepEqual(calls.map((call) => call.operation), ["processes.stopAll"], "Aufräumen legt keinen Ordner an");
    assert.equal(await agentTool(runtime, "remote", "read", { path: "a.txt" }), "read erledigt");
    assert.equal(await agentTool(runtime, "remote", "read", { path: "b.txt" }), "read erledigt");
    assert.deepEqual(calls.slice(1), [
      { operation: "runFolder.create", cwd: folder },
      { operation: "read", cwd: folder, input: { path: "a.txt" } },
      { operation: "read", cwd: folder, input: { path: "b.txt" } },
    ]);
    assert.equal(await stat(path.join(root, "sessions")).catch(() => undefined), undefined);
  } finally {
    await remove();
  }
});

test("a contribution fills the new folder on the workstation once, and a failed step takes the folder away so the next order starts over", async () => {
  const calls: WorkstationCall[] = [];
  let failures = 1;
  const clients = new WorkspaceClientRegistry();
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/beispiel/project"], runsDirectory: RUNS },
    WORKSPACE_EXECUTOR_VERSION, workstationConnection(calls, "beispiel", (call) => {
      if (call.operation === "runFolder.create") return { created: !calls.some((entry) => entry.operation === "read") };
      if (call.operation === "commands.run" && failures-- > 0) throw new DomainError("command-failed", "git scheitert", 409);
      return toolAnswer(call);
    }));
  const folder = `${RUNS}/remote`;
  const seen: unknown[] = [];
  const worktree = (context: { path: string; runId: string }) =>
    [{ operation: "commands.run", input: { program: "git", args: ["-C", "/home/beispiel/project", "worktree", "add", context.path, "-b", `ragents/${context.runId}`], timeoutMs: 60_000 } }];
  const resolver: WorkspaceResolver = {
    optionId: "test.source",
    kind: { id: "example.worktree", label: "Worktree je Run", serverFolders: false },
    workstation: {
      label: "Git-Worktree je Run",
      prepare: (context) => {
        seen.push(context);
        return worktree(context);
      },
      description: ({ path: folderPath, label }) => `# Working directory\n\nDein Worktree ${folderPath} auf ${label}.`,
    },
    resolve: () => Promise.reject(new Error("auf dem Server nicht gefragt")),
  };
  const state = runStateWith(WORKSPACE_BINDING_OPTION_ID, onLaptop({ path: folder, fresh: true }), "beispiel");
  state.pluginStates.set(pluginStateKey("test.source", { kind: "run" }),
    { pluginId: "test.source", scope: { kind: "run" }, state: "main", updatedAt: "2026-09-24T00:00:00.000Z" });
  const { runtime, remove } = await fixture({ clients, resolver: () => resolver, runState: () => state });
  try {
    const notes: string[] = [];
    const workspace = await runtime.resolve("remote", (text) => notes.push(text));
    assert.deepEqual(notes, [`Arbeitsbereich: ${folder} (Git-Worktree je Run auf dem Arbeitsplatz Laptop)`]);
    assert.equal(workspace.description, `# Working directory\n\nDein Worktree ${folder} auf Laptop.`);
    assert.deepEqual(runtime.placementOf("remote"), { machine: "client", folder: "fresh", kind: "example.worktree" });
    await assert.rejects(agentTool(runtime, "remote", "read", { path: "a.txt" }), /git scheitert/);
    assert.deepEqual(calls.map((call) => call.operation), ["runFolder.create", "commands.run", "runFolder.remove"]);
    assert.equal(await agentTool(runtime, "remote", "read", { path: "a.txt" }), "read erledigt");
    assert.equal(await agentTool(runtime, "remote", "read", { path: "b.txt" }), "read erledigt");
    assert.deepEqual(calls.slice(3).map((call) => call.operation), ["runFolder.create", "commands.run", "read", "read"]);
    assert.deepEqual(calls[4], { operation: "commands.run", cwd: folder, input: worktree({ path: folder, runId: "remote" })[0]!.input });
    assert.deepEqual(seen[0], { runId: "remote", path: folder, label: "Laptop", choice: "main" });
  } finally {
    await remove();
  }
});

test("a folder that already exists on the workstation gets no steps again, for instance after a restart of the server", async () => {
  const calls: WorkstationCall[] = [];
  const clients = new WorkspaceClientRegistry();
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/beispiel/project"], runsDirectory: RUNS },
    WORKSPACE_EXECUTOR_VERSION, workstationConnection(calls, "beispiel", (call) =>
      call.operation === "runFolder.create" ? { created: false } : toolAnswer(call)));
  const resolver: WorkspaceResolver = {
    workstation: { label: "Git-Worktree je Run", prepare: () => [{ operation: "commands.run", input: { program: "git", timeoutMs: 1000 } }] },
    resolve: () => Promise.reject(new Error("auf dem Server nicht gefragt")),
  };
  const { runtime, remove } = await fixture({
    clients,
    resolver: () => resolver,
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, onLaptop({ path: `${RUNS}/remote`, fresh: true }), "beispiel"),
  });
  try {
    assert.equal(await agentTool(runtime, "remote", "read", { path: "a.txt" }), "read erledigt");
    assert.deepEqual(calls.map((call) => call.operation), ["runFolder.create", "read"]);
    assert.deepEqual(runtime.placementOf("remote"), { machine: "client", folder: "fresh" }, "ohne Art keine Kennung");
  } finally {
    await remove();
  }
});

test("deleting a run takes its new folder on the workstation away after the release steps, and leaves it with a note while the workstation is away", async (t) => {
  const calls: WorkstationCall[] = [];
  const serverSteps: string[] = [];
  const clients = new WorkspaceClientRegistry();
  const connection = workstationConnection(calls, "beispiel", (call) =>
    call.operation === "runFolder.remove" ? { removed: true } : toolAnswer(call));
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/beispiel/project"], runsDirectory: RUNS },
    WORKSPACE_EXECUTOR_VERSION, connection);
  const resolver: WorkspaceResolver = {
    workstation: {
      label: "Git-Worktree je Run",
      prepare: () => [],
      release: ({ path: folderPath }) => [{ operation: "commands.run", input: { program: "git", args: ["worktree", "remove", "--force", folderPath], timeoutMs: 1000 } }],
    },
    resolve: () => Promise.reject(new Error("auf dem Server nicht gefragt")),
    stopSession: async (_runId, sandbox) => {
      serverSteps.push("stopp");
      await sandbox();
    },
    deleteSession: async () => { serverSteps.push("löschen"); },
  };
  const { runtime, remove } = await fixture({
    clients,
    resolver: () => resolver,
    runState: (runId) => runStateWith(WORKSPACE_BINDING_OPTION_ID, onLaptop({ path: `${RUNS}/${runId}`, fresh: true }), "beispiel"),
  });
  const warnings = t.mock.method(console, "warn", () => undefined);
  try {
    await runtime.deleteSession("remote");
    assert.deepEqual(calls.map((call) => call.operation), ["stop", "commands.run", "runFolder.remove"]);
    assert.ok(calls.every((call) => call.cwd === `${RUNS}/remote`));
    assert.deepEqual(serverSteps, [], "der Beitrag räumt auf dem Server, nicht auf dem Arbeitsplatz");
    connection.end();
    await runtime.deleteSession("away");
    assert.ok(warnings.mock.calls.some((call) => String(call.arguments[0]).includes(`Der Ordner ${RUNS}/away des Runs away bleibt auf dem Arbeitsplatz Laptop`)));
  } finally {
    await remove();
  }
});

const mkdirInside = async (directory: string): Promise<void> => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
};

const mkdtempInside = async (root: string, name: string): Promise<void> => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, name), { recursive: true });
};

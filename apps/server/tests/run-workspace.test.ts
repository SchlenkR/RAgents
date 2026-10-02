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

const RUNS = "/home/example/.local/share/ragents/workspace/runs";

const onLaptop = (folder: { path: string; fresh?: true }) => ({ machine: { client: CLIENT, label: "Laptop" }, folder });

const laptopProject = onLaptop({ path: "/home/example/project" });

interface WorkstationCall {
  operation: string;
  cwd: string;
  input?: unknown;
}

interface WorkstationConnection extends MethodConnection {
  end: () => void;
}

type WorkstationAnswer = (call: WorkstationCall) => unknown;

const toolAnswer: WorkstationAnswer = ({ operation }) => ({ content: [{ type: "text", text: `${operation} done` }] });

/** A workstation without a remote end; it remembers what the server asks it to do. */
const workstationConnection = (calls: WorkstationCall[], userId: string | null = "example", answer: WorkstationAnswer = toolAnswer): WorkstationConnection => {
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
  if (!tool) throw new Error(`The workspace tool ${name} is missing`);
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
    sessionWorkspaceFor: () => Promise.reject(new Error("not asked")),
    skillPaths: async () => [],
    resolver: () => undefined,
    runState: () => runStateWith(undefined, undefined),
    clients: new WorkspaceClientRegistry([]),
    contributions: [],
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
    assert.deepEqual(notes, [`Workspace: ${path.join(root, "project")} (project folder on the server)`]);
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
    assert.equal(workspace.cwd, "/home/example/project");
    const local = /is on the workstation Laptop, not on the server; it is reachable only through the run's executor/;
    await assert.rejects(workspace.currentRoot(), local);
    assert.deepEqual(runtime.placementOf("remote"), { machine: "client", folder: "existing" });
    assert.deepEqual(notes, ["Workspace: /home/example/project (project folder on the workstation Laptop)"]);
    assert.equal(await stat(path.join(root, "sessions")).catch(() => undefined), undefined);
    await assert.rejects(runtime.sandbox.execute("remote", "read", { file_path: "a.txt" }), (error: unknown) =>
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
    assert.ok(!JSON.stringify(context).includes("/home/example/project"), "the path of the workstation does not appear in the server context");
  } finally {
    await remove();
  }
});

test("the agent tool of a bound run runs in the same folder the prompt names", async () => {
  const calls: WorkstationCall[] = [];
  const clients = new WorkspaceClientRegistry([]);
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/example/project"], runsDirectory: RUNS, ripgrep: false },
    WORKSPACE_EXECUTOR_VERSION, [], workstationConnection(calls));
  const { runtime, remove } = await fixture({
    clients,
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, laptopProject, "example"),
  });
  try {
    const workspace = await runtime.resolve("remote", () => undefined);
    assert.equal(await agentTool(runtime, "remote", "read", { file_path: "a.txt" }), "read done");
    assert.deepEqual(calls, [{ operation: "read", cwd: "/home/example/project", input: { file_path: "a.txt" } }]);
    assert.equal(calls[0].cwd, workspace.cwd);
  } finally {
    await remove();
  }
});

test("a workstation of another user with the same id never takes over a bound run", async () => {
  const alices: WorkstationCall[] = [];
  const bobs: WorkstationCall[] = [];
  const clients = new WorkspaceClientRegistry([]);
  const workstation = { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/example/project"], runsDirectory: RUNS, ripgrep: false };
  const alice = workstationConnection(alices, "alice");
  await clients.register(CLIENT, workstation, WORKSPACE_EXECUTOR_VERSION, [], alice);
  const binding = laptopProject;
  const states = new Map<string, RunState>([
    ["alices-run", runStateWith(WORKSPACE_BINDING_OPTION_ID, binding, "alice")],
    ["ownerless-run", runStateWith(WORKSPACE_BINDING_OPTION_ID, binding)],
  ]);
  const { runtime, remove } = await fixture({ clients, runState: (runId) => states.get(runId) ?? null });
  try {
    assert.equal(await agentTool(runtime, "alices-run", "read", { file_path: "a.txt" }), "read done");
    alice.end();
    await clients.register(CLIENT, workstation, WORKSPACE_EXECUTOR_VERSION, [], workstationConnection(bobs, "bob"));
    await assert.rejects(runtime.sandbox.execute("alices-run", "bash", { command: "cat ~/.ssh/id_ed25519" }), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
    await assert.rejects(runtime.sandbox.execute("ownerless-run", "read", { file_path: "a.txt" }), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
    assert.deepEqual(bobs, [], "Bob's workstation with the same id gets no call from Alice's run");

    await clients.register(CLIENT, workstation, WORKSPACE_EXECUTOR_VERSION, [], workstationConnection(alices, "alice"));
    assert.equal(await agentTool(runtime, "alices-run", "read", { file_path: "b.txt" }), "read done");
    assert.deepEqual(alices.map((call) => call.operation), ["read", "read"], "Alice signs in again next to Bob with the same id");
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
    await assert.rejects(runtime.resolve("unstored", () => undefined), /test\.source .* not stored/);
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
    kind: { id: "example.worktree", label: "Worktree per run", serverFolders: false, directoryPattern: path.join(root, "worktrees", "{runId}") },
    resolve: async ({ runId, emitSystem }) => {
      emitSystem("Creating the run's worktree ...");
      const directory = path.join(root, "worktrees", runId);
      await mkdirInside(directory);
      return {
        cwd: directory,
        description: "# Working directory\n\nYour worktree.",
        gitEnv: { GIT_OBJECT_DIRECTORY: path.join(directory, ".git/objects") },
        extraEnv: { EXAMPLE_BRANCH_PREFIX: "example/" },
        hostSandbox: { home: directory, readOnlyRoots: [{ directory: root }], ident: { uid: 4301, gid: 4200, name: "sess-4301" } },
        runOperation: async (operation) => {
          operations.push("locked");
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
    assert.deepEqual(notes, ["Creating the run's worktree ..."]);
    assert.equal(workspace.description, "# Working directory\n\nYour worktree.");
    assert.deepEqual(workspace.extraEnv, { EXAMPLE_BRANCH_PREFIX: "example/" });
    assert.deepEqual(workspace.gitEnv, { GIT_OBJECT_DIRECTORY: path.join(workspaceRoot, ".git/objects") });
    assert.equal(await workspace.runOperation(async () => "done"), "done");
    assert.deepEqual(operations, ["locked"]);
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
      kind: { id: "example.worktree", label: "Worktree per run", serverFolders: false },
      resolve: async ({ runId }) => {
        home = path.join(root, "homes", runId);
        await mkdirInside(home);
        return { cwd: home, hostSandbox: { home, readOnlyRoots: [{ directory: root }, { directory: path.join(root, "missing") }], ident } };
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
    kind: { id: "example.worktree", label: "Worktree per run", serverFolders: false },
    resolve: async ({ directory }) => ({ cwd: directory }),
    stopSession: async (runId, sandbox) => {
      steps.push(`processes ${runId}`);
      await sandbox();
      steps.push(`cleanup ${runId}`);
    },
    deleteSession: async (runId) => {
      steps.push(`worktree gone ${runId}`);
    },
  };
  const bound = laptopProject;
  const { runtime, remove } = await fixture({
    resolver: () => resolver,
    runState: (runId) => runId === "remote" ? runStateWith(WORKSPACE_BINDING_OPTION_ID, bound) : runStateWith(undefined, undefined),
  });
  try {
    await runtime.deleteSession("run-1");
    assert.deepEqual(steps, ["processes run-1", "cleanup run-1", "worktree gone run-1"]);
    await runtime.stopSession("remote");
    await runtime.deleteSession("remote");
    assert.deepEqual(steps, ["processes run-1", "cleanup run-1", "worktree gone run-1"]);
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
    ["old-client", { kind: "client", client: CLIENT, label: "Laptop", path: "/home/example/project" }],
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
    assert.equal((await runtime.resolve("old-client", () => undefined)).cwd, "/home/example/project");
    assert.equal(runtime.transfer.boundDirectory("old-path"), "/srv/project");
    assert.equal(runtime.transfer.boundDirectory("client-fresh"), null);
    for (const runId of ["broken", "client-fresh-without-path", "server-with-own-path"]) {
      assert.throws(() => runtime.placementOf(runId), /stored workspace binding is invalid/, runId);
      await assert.rejects(runtime.resolve(runId, () => undefined), /stored workspace binding is invalid/, runId);
    }
  } finally {
    await remove();
  }
});

test("a new folder per run on a workstation: the prompt names it, the server creates nothing, and the workstation creates it before the first order only", async () => {
  const calls: WorkstationCall[] = [];
  const clients = new WorkspaceClientRegistry([]);
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/example/project"], runsDirectory: RUNS, ripgrep: false },
    WORKSPACE_EXECUTOR_VERSION, [], workstationConnection(calls, "example", (call) =>
      call.operation === "runFolder.create" ? { created: true } : toolAnswer(call)));
  const folder = `${RUNS}/remote`;
  const { root, runtime, remove } = await fixture({
    clients,
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, onLaptop({ path: folder, fresh: true }), "example"),
  });
  try {
    const notes: string[] = [];
    const workspace = await runtime.resolve("remote", (text) => notes.push(text));
    assert.equal(workspace.cwd, folder);
    assert.deepEqual(notes, [`Workspace: ${folder} (Empty folder per run on the workstation Laptop)`]);
    assert.match(workspace.description ?? "", /on the workstation "Laptop", not on the server: a folder of this run alone/);
    await assert.rejects(workspace.currentRoot(), /is on the workstation Laptop, not on the server/);
    assert.deepEqual(calls, [], "resolving never reaches the workstation");
    assert.deepEqual(await runtime.sandbox.execute("remote", "processes.stopAll", {}, { whenReachable: true }), toolAnswer({ operation: "processes.stopAll", cwd: folder }));
    assert.deepEqual(calls.map((call) => call.operation), ["processes.stopAll"], "cleanup creates no folder");
    assert.equal(await agentTool(runtime, "remote", "read", { file_path: "a.txt" }), "read done");
    assert.equal(await agentTool(runtime, "remote", "read", { file_path: "b.txt" }), "read done");
    assert.deepEqual(calls.slice(1), [
      { operation: "runFolder.create", cwd: folder },
      { operation: "read", cwd: folder, input: { file_path: "a.txt" } },
      { operation: "read", cwd: folder, input: { file_path: "b.txt" } },
    ]);
    assert.equal(await stat(path.join(root, "sessions")).catch(() => undefined), undefined);
  } finally {
    await remove();
  }
});

test("a contribution fills the new folder on the workstation once, and a failed step takes the folder away so the next order starts over", async () => {
  const calls: WorkstationCall[] = [];
  let failures = 1;
  const clients = new WorkspaceClientRegistry([]);
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/example/project"], runsDirectory: RUNS, ripgrep: false },
    WORKSPACE_EXECUTOR_VERSION, [], workstationConnection(calls, "example", (call) => {
      if (call.operation === "runFolder.create") return { created: !calls.some((entry) => entry.operation === "read") };
      if (call.operation === "commands.run" && failures-- > 0) throw new DomainError("command-failed", "git fails", 409);
      return toolAnswer(call);
    }));
  const folder = `${RUNS}/remote`;
  const seen: unknown[] = [];
  const worktree = (context: { path: string; runId: string }) =>
    [{ operation: "commands.run", input: { program: "git", args: ["-C", "/home/example/project", "worktree", "add", context.path, "-b", `ragents/${context.runId}`], timeoutMs: 60_000 } }];
  const resolver: WorkspaceResolver = {
    optionId: "test.source",
    kind: { id: "example.worktree", label: "Worktree per run", serverFolders: false },
    workstation: {
      label: "Git worktree per run",
      prepare: (context) => {
        seen.push(context);
        return worktree(context);
      },
      description: ({ path: folderPath, label }) => `# Working directory\n\nYour worktree ${folderPath} on ${label}.`,
    },
    resolve: () => Promise.reject(new Error("not asked on the server")),
  };
  const state = runStateWith(WORKSPACE_BINDING_OPTION_ID, onLaptop({ path: folder, fresh: true }), "example");
  state.pluginStates.set(pluginStateKey("test.source", { kind: "run" }),
    { pluginId: "test.source", scope: { kind: "run" }, state: "main", updatedAt: "2026-09-24T00:00:00.000Z" });
  const { runtime, remove } = await fixture({ clients, resolver: () => resolver, runState: () => state });
  try {
    const notes: string[] = [];
    const workspace = await runtime.resolve("remote", (text) => notes.push(text));
    assert.deepEqual(notes, [`Workspace: ${folder} (Git worktree per run on the workstation Laptop)`]);
    assert.equal(workspace.description, `# Working directory\n\nYour worktree ${folder} on Laptop.`);
    assert.deepEqual(runtime.placementOf("remote"), { machine: "client", folder: "fresh", kind: "example.worktree" });
    await assert.rejects(agentTool(runtime, "remote", "read", { file_path: "a.txt" }), /git fails/);
    assert.deepEqual(calls.map((call) => call.operation), ["runFolder.create", "commands.run", "runFolder.remove"]);
    assert.equal(await agentTool(runtime, "remote", "read", { file_path: "a.txt" }), "read done");
    assert.equal(await agentTool(runtime, "remote", "read", { file_path: "b.txt" }), "read done");
    assert.deepEqual(calls.slice(3).map((call) => call.operation), ["runFolder.create", "commands.run", "read", "read"]);
    assert.deepEqual(calls[4], { operation: "commands.run", cwd: folder, input: worktree({ path: folder, runId: "remote" })[0]!.input });
    assert.deepEqual(seen[0], { runId: "remote", path: folder, label: "Laptop", choice: "main" });
  } finally {
    await remove();
  }
});

test("a folder that already exists on the workstation gets no steps again, for instance after a restart of the server", async () => {
  const calls: WorkstationCall[] = [];
  const clients = new WorkspaceClientRegistry([]);
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/example/project"], runsDirectory: RUNS, ripgrep: false },
    WORKSPACE_EXECUTOR_VERSION, [], workstationConnection(calls, "example", (call) =>
      call.operation === "runFolder.create" ? { created: false } : toolAnswer(call)));
  const resolver: WorkspaceResolver = {
    workstation: { label: "Git worktree per run", prepare: () => [{ operation: "commands.run", input: { program: "git", timeoutMs: 1000 } }] },
    resolve: () => Promise.reject(new Error("not asked on the server")),
  };
  const { runtime, remove } = await fixture({
    clients,
    resolver: () => resolver,
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, onLaptop({ path: `${RUNS}/remote`, fresh: true }), "example"),
  });
  try {
    assert.equal(await agentTool(runtime, "remote", "read", { file_path: "a.txt" }), "read done");
    assert.deepEqual(calls.map((call) => call.operation), ["runFolder.create", "read"]);
    assert.deepEqual(runtime.placementOf("remote"), { machine: "client", folder: "fresh" }, "no kind, no id");
  } finally {
    await remove();
  }
});

test("deleting a run takes its new folder on the workstation away after the release steps, and leaves it with a note while the workstation is away", async (t) => {
  const calls: WorkstationCall[] = [];
  const serverSteps: string[] = [];
  const clients = new WorkspaceClientRegistry([]);
  const connection = workstationConnection(calls, "example", (call) =>
    call.operation === "runFolder.remove" ? { removed: true } : toolAnswer(call));
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/example/project"], runsDirectory: RUNS, ripgrep: false },
    WORKSPACE_EXECUTOR_VERSION, [], connection);
  const resolver: WorkspaceResolver = {
    workstation: {
      label: "Git worktree per run",
      prepare: () => [],
      release: ({ path: folderPath }) => [{ operation: "commands.run", input: { program: "git", args: ["worktree", "remove", "--force", folderPath], timeoutMs: 1000 } }],
    },
    resolve: () => Promise.reject(new Error("not asked on the server")),
    stopSession: async (_runId, sandbox) => {
      serverSteps.push("stop");
      await sandbox();
    },
    deleteSession: async () => { serverSteps.push("delete"); },
  };
  const { runtime, remove } = await fixture({
    clients,
    resolver: () => resolver,
    runState: (runId) => runStateWith(WORKSPACE_BINDING_OPTION_ID, onLaptop({ path: `${RUNS}/${runId}`, fresh: true }), "example"),
  });
  const warnings = t.mock.method(console, "warn", () => undefined);
  try {
    await runtime.deleteSession("remote");
    assert.deepEqual(calls.map((call) => call.operation), ["stop", "commands.run", "runFolder.remove"]);
    assert.ok(calls.every((call) => call.cwd === `${RUNS}/remote`));
    assert.deepEqual(serverSteps, [], "the contribution cleans up on the server, not on the workstation");
    connection.end();
    await runtime.deleteSession("away");
    assert.ok(warnings.mock.calls.some((call) => String(call.arguments[0]).includes(`The folder ${RUNS}/away of run away stays on the workstation Laptop`)));
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

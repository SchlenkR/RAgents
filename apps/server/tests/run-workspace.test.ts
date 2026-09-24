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

interface WorkplaceCall {
  operation: string;
  cwd: string;
}

interface WorkplaceConnection extends MethodConnection {
  end: () => void;
}

/** Ein Arbeitsplatz ohne Gegenstelle; er merkt sich, womit der Server ihn beauftragt. */
const workplaceConnection = (calls: WorkplaceCall[], userId: string | null = "beispiel"): WorkplaceConnection => {
  const listeners = new Set<() => void>();
  return {
    id: `connection-${userId}`,
    userId,
    streamless: false,
    call: (_contract: unknown, input: unknown) => {
      const { operation, cwd } = input as WorkplaceCall;
      calls.push({ operation, cwd });
      return Promise.resolve({ value: { content: [{ type: "text", text: `${operation} erledigt` }] } });
    },
    onClose: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    end: () => {
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
  } as unknown as WorkplaceConnection;
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
    runState: (runId) => runId === "bound" ? runStateWith(WORKSPACE_BINDING_OPTION_ID, { kind: "path", path: path.join(root, "project") }) : null,
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

test("a run bound to a workplace names the bound folder, creates nothing on the server and refuses every local access to it", async () => {
  const { root, runtime, remove } = await fixture({
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, { kind: "client", client: CLIENT, label: "Laptop", path: "/home/beispiel/project" }),
  });
  try {
    const notes: string[] = [];
    const workspace = await runtime.resolve("remote", (text) => notes.push(text));
    assert.equal(workspace.cwd, "/home/beispiel/project");
    const local = /liegt auf dem Arbeitsplatz Laptop, nicht auf dem Server; er ist nur über den Executor des Runs/;
    await assert.rejects(workspace.currentRoot(), local);
    assert.equal(runtime.kindOf("remote"), "client");
    assert.deepEqual(notes, ["Arbeitsbereich: /home/beispiel/project (Projektordner auf dem Arbeitsplatz Laptop)"]);
    assert.equal(await stat(path.join(root, "sessions")).catch(() => undefined), undefined);
    await assert.rejects(runtime.sandbox.execute("remote", "read", { path: "a.txt" }), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
    assert.equal(await runtime.sandbox.execute("remote", "processes.stopAll", {}, { whenReachable: true }), null);
  } finally {
    await remove();
  }
});

test("work of a bound run that stays on the server gets its own server folder, never the path of the workplace", async () => {
  let resolved: RunWorkspaceRuntime | undefined;
  const { root, runtime, remove } = await fixture({
    sessionWorkspaceFor: (runId) => resolved!.resolve(runId, () => undefined),
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, { kind: "client", client: CLIENT, label: "Laptop", path: "/home/beispiel/project" }),
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
  const calls: WorkplaceCall[] = [];
  const clients = new WorkspaceClientRegistry();
  await clients.register(CLIENT, { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/beispiel/project"] },
    WORKSPACE_EXECUTOR_VERSION, workplaceConnection(calls));
  const { runtime, remove } = await fixture({
    clients,
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, { kind: "client", client: CLIENT, label: "Laptop", path: "/home/beispiel/project" }, "beispiel"),
  });
  try {
    const workspace = await runtime.resolve("remote", () => undefined);
    assert.equal(await agentTool(runtime, "remote", "read", { path: "a.txt" }), "read erledigt");
    assert.deepEqual(calls, [{ operation: "read", cwd: "/home/beispiel/project" }]);
    assert.equal(calls[0].cwd, workspace.cwd);
  } finally {
    await remove();
  }
});

test("a workplace of another user with the same id never takes over a bound run", async () => {
  const alices: WorkplaceCall[] = [];
  const bobs: WorkplaceCall[] = [];
  const clients = new WorkspaceClientRegistry();
  const workplace = { label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/beispiel/project"] };
  const alice = workplaceConnection(alices, "alice");
  await clients.register(CLIENT, workplace, WORKSPACE_EXECUTOR_VERSION, alice);
  const binding = { kind: "client", client: CLIENT, label: "Laptop", path: "/home/beispiel/project" };
  const states = new Map<string, RunState>([
    ["alices-run", runStateWith(WORKSPACE_BINDING_OPTION_ID, binding, "alice")],
    ["ownerless-run", runStateWith(WORKSPACE_BINDING_OPTION_ID, binding)],
  ]);
  const { runtime, remove } = await fixture({ clients, runState: (runId) => states.get(runId) ?? null });
  try {
    assert.equal(await agentTool(runtime, "alices-run", "read", { path: "a.txt" }), "read erledigt");
    alice.end();
    await clients.register(CLIENT, workplace, WORKSPACE_EXECUTOR_VERSION, workplaceConnection(bobs, "bob"));
    await assert.rejects(runtime.sandbox.execute("alices-run", "bash", { command: "cat ~/.ssh/id_ed25519" }), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
    await assert.rejects(runtime.sandbox.execute("ownerless-run", "read", { path: "a.txt" }), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
    assert.deepEqual(bobs, [], "Bobs Arbeitsplatz mit derselben Kennung bekommt keinen Aufruf aus Alices Run");

    await clients.register(CLIENT, workplace, WORKSPACE_EXECUTOR_VERSION, workplaceConnection(alices, "alice"));
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
      emitSystem("Erzeuge den Worktree der Unterhaltung ...");
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
    assert.deepEqual(notes, ["Erzeuge den Worktree der Unterhaltung ..."]);
    assert.equal(workspace.description, "# Working directory\n\nDein Worktree.");
    assert.deepEqual(workspace.extraEnv, { EXAMPLE_BRANCH_PREFIX: "beispiel/" });
    assert.deepEqual(workspace.gitEnv, { GIT_OBJECT_DIRECTORY: path.join(workspaceRoot, ".git/objects") });
    assert.equal(await workspace.runOperation(async () => "fertig"), "fertig");
    assert.deepEqual(operations, ["gesperrt"]);
    assert.equal(runtime.kindOf("run-1"), "example.worktree");
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
  const bound = { kind: "client", client: CLIENT, label: "Laptop", path: "/home/beispiel/project" };
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

const mkdirInside = async (directory: string): Promise<void> => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
};

const mkdtempInside = async (root: string, name: string): Promise<void> => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, name), { recursive: true });
};

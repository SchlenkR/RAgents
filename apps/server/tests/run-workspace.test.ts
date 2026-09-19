import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DomainError, pluginStateKey, type RunState } from "@aicontainer/ragents";

import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract.ts";
import { WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";
import { RunWorkspaceRuntime, type RunWorkspaceRuntimeOptions } from "../../../plugins/ragents.workspace/server/runtime.ts";
import type { WorkspaceResolver, WorkspaceResolverContext } from "../src/ragents/workspace-runtime.ts";

const runStateWith = (optionId: string | undefined, choice: unknown): RunState => ({
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
    sessionsDirectoryPattern: path.join(root, "sessions", "{runId}", "plugins", "ragents.workspace"),
    sessionWorkspaceFor: () => Promise.reject(new Error("nicht gefragt")),
    skillPaths: async () => [],
    resolver: () => undefined,
    runState: () => runStateWith(undefined, undefined),
    documentsFor: async () => undefined,
    clients: new WorkspaceClientRegistry({ serverHostname: "server", folderExists: async () => false }),
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
    assert.equal(workspace.remote, undefined);
    assert.equal(await workspace.currentRoot(), path.join(root, "project"));
    assert.deepEqual(notes, [`Arbeitsbereich: ${path.join(root, "project")} (Projektordner auf dem Server)`]);
    assert.equal(await stat(path.join(root, "sessions")).catch(() => undefined), undefined);
    await rm(path.join(root, "project"), { recursive: true });
    await assert.rejects(workspace.currentRoot(), (error: unknown) => error instanceof DomainError && error.code === "workspace-path-missing");
  } finally {
    await remove();
  }
});

test("a run bound to a workplace gets remote operations and never touches the server file system", async () => {
  const { runtime, remove } = await fixture({
    runState: () => runStateWith(WORKSPACE_BINDING_OPTION_ID, { kind: "client", client: "client-0001", label: "Laptop", path: "/home/kriko/project" }),
  });
  try {
    const notes: string[] = [];
    const workspace = await runtime.resolve("remote", (text) => notes.push(text));
    assert.equal(workspace.cwd, "/home/kriko/project");
    assert.equal(workspace.remote?.label, "Laptop");
    assert.equal(await workspace.currentRoot(), "/home/kriko/project");
    assert.deepEqual(notes, ["Arbeitsbereich: /home/kriko/project (Projektordner auf dem Arbeitsplatz Laptop)"]);
    await assert.rejects(workspace.remote!.readFile("/home/kriko/project/a.txt"), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-client-disconnected");
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

const mkdtempInside = async (root: string, name: string): Promise<void> => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, name), { recursive: true });
};

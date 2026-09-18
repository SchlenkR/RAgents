import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DomainError, pluginStateKey, type RunState } from "@aicontainer/ragents";

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
    runState: () => null,
    documentsFor: async () => undefined,
    ...overrides,
  });
  return { root, runtime, remove: () => rm(root, { recursive: true, force: true }) };
};

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

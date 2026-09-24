import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LanguageServerHost,
  createSandboxTools,
  resolveRootDirectory,
  workspaceProcessContext,
  type ResolvedWorkspaceRoot,
} from "@ragents/workspace-executor";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

test("registered private roots provide file aliases and Bash variables without exposing another run", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-workspace-roots-")));
  const root = path.join(directory, "main");
  const apps = path.join(directory, "private/run-1/apps");
  const other = path.join(directory, "private/run-2/apps");
  const roots: ResolvedWorkspaceRoot[] = [];
  await Promise.all([root, apps, other].map((entry) => mkdir(entry, { recursive: true })));
  const sandbox = await createSandboxTools("run-1", async () => workspaceProcessContext({
    runId: "run-1",
    cwd: root,
    root,
    home: { home: path.join(directory, "home") },
    logDirectory: path.join(directory, "home"),
    hostRoot: undefined,
    additionalRoots: roots,
  }));
  const byName = (name: string) => ({
    execute: (toolCallId: string, input: unknown) =>
      sandbox.tools.get(name)!(input, { toolCallId }) as Promise<{ content: Array<{ text?: string }> }>,
  });
  try {
    await assert.rejects(byName("write").execute("before", { path: "@apps/counter/src/client.tsx", content: "first" }), /Alias/);
    roots.push({ directory: apps, alias: "@apps", environmentVariable: "RAGENTS_APPS_DIR" });
    await byName("write").execute("write", { path: "@apps/counter/src/client.tsx", content: "first" });
    await byName("edit").execute("edit", { path: "@apps/counter/src/client.tsx", edits: [{ oldText: "first", newText: "second" }] });
    assert.equal(await readFile(path.join(apps, "counter/src/client.tsx"), "utf8"), "second");
    assert.match((await byName("read").execute("read", { path: "@apps/counter/src/client.tsx" })).content[0]!.text!, /second/);
    assert.match((await byName("bash").execute("bash", { command: 'cat "$RAGENTS_APPS_DIR/counter/src/client.tsx"' })).content[0]!.text!, /second/);
    await assert.rejects(byName("write").execute("outside", { path: path.join(other, "private.ts"), content: "denied" }), /außerhalb/);
    await symlink(other, path.join(apps, "escape"));
    await assert.rejects(byName("write").execute("link", { path: "@apps/escape/private.ts", content: "denied" }), /außerhalb/);
    await symlink(path.join(other, "missing"), path.join(apps, "dangling"));
    await assert.rejects(byName("write").execute("dangling", { path: "@apps/dangling/private.ts", content: "denied" }), /außerhalb/);
  } finally { await sandbox.shutdown(); await rm(directory, { recursive: true, force: true }); }
});

test("the existing language server resolves the run's app alias before launch and rejects foreign roots", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-lsp-roots-")));
  const root = path.join(directory, "main");
  const apps = path.join(directory, "apps");
  const app = path.join(apps, "counter");
  const other = path.join(directory, "other-run");
  await Promise.all([root, app, other].map((entry) => mkdir(entry, { recursive: true })));
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test", workspaceFor: async () => ({
      cwd: root, currentRoot: async () => root, runOperation: (operation) => operation(),
    }), identFor: async () => undefined, skillPaths: async () => [],
    homeFor: async () => ({ home: directory }),
  });
  sandbox.registerWorkspaceRoot({ id: "apps", alias: "@apps", environmentVariable: "RAGENTS_APPS_DIR", directoryFor: (runId) => runId === "run-1" ? apps : other });
  const launched: string[] = [];
  const server = new LanguageServerHost({
    id: "typescript", label: "TypeScript", languages: { ".ts": "typescript" }, rootDescription: "project",
    resolveRoot: resolveRootDirectory,
    launch: async (_context, requested) => { launched.push(requested); throw new Error("launch captured without starting a server"); },
    open: async () => "unused",
  }, (runId) => sandbox.serverProcessContextFor(runId));
  try {
    const context = await sandbox.serverProcessContextFor("run-1");
    assert.deepEqual(context.additionalRoots, [apps]);
    assert.equal(context.env.RAGENTS_APPS_DIR, apps);
    assert.deepEqual(context.workspaceAliases, { "@apps": apps });
    await assert.rejects(server.open("run-1", "@apps/counter"), /launch captured/);
    assert.deepEqual(launched, [app]);
    await assert.rejects(server.open("run-1", other), /außerhalb/);
    await assert.rejects(server.open("run-2", app), /außerhalb/);
    await symlink(other, path.join(apps, "escape"));
    await assert.rejects(server.open("run-1", "@apps/escape"), /außerhalb/);
    assert.deepEqual(launched, [app]);
    assert.throws(() => sandbox.registerWorkspaceRoot({ id: "duplicate", alias: "@apps", directoryFor: () => apps }), /bereits registriert/);
  } finally { await server.shutdown(); await sandbox.shutdownAll(); await rm(directory, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall, type Context } from "@ragents/ai";
import { defineRunFunction } from "@ragents/engine";
import { FILE_OPERATIONS, WorkspaceOperationExecutor, workspaceExecutorModules, workspaceProcessContext } from "@ragents/workspace-executor";
import { AgentRuntimeManager } from "../../../packages/ragents/src/drivers/agent-runtime.ts";
import { fauxModelRuntime, journalHarness, nativeTool, turnOf } from "../../../packages/ragents/tests/agent-runtime-fixture.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

const data = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-run-attachments-")));
process.env.DATA_DIR = data;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { SessionWorkspaces } = await import("../src/ragents/engine.ts");
after(() => rm(data, { recursive: true, force: true }));

const textOf = (result: unknown): string =>
  (result as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "").join("\n");

const modelText = (context: Context): string => context.messages.flatMap((message) =>
  typeof message.content === "string" ? [message.content] : message.content.flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n");

const read = defineRunFunction({
  name: "read", label: "Read", description: "Read a file.", nativeTool: true,
  schema: Type.Object({ file_path: Type.String(), limit: Type.Optional(Type.Number()) }),
  resultSchema: Type.String(), available: () => true, run: () => "",
});

for (const binding of ["server-fresh", "server-existing", "workstation-fresh", "workstation-existing"] as const) {
  test(`${binding}: tool results and chat attachments keep a Git checkout clean and remain readable`, async (t) => {
    const base = path.join(data, binding);
    const storage = path.join(base, "run");
    const project = binding === "server-fresh" ? path.join(storage, "workspace") : path.join(base, "project");
    const home = path.join(storage, "home");
    const serverFolder = path.join(storage, "server-workspace");
    await Promise.all([project, home, serverFolder].map((directory) => mkdir(directory, { recursive: true })));
    execFileSync("git", ["init", "-q", project]);
    const status = () => execFileSync("git", ["status", "--porcelain"], { cwd: project, encoding: "utf8" });
    assert.equal(status(), "");
    const workstation = binding.startsWith("workstation");
    const remoteOperations: string[] = [];
    const remote = new WorkspaceOperationExecutor({
      contextFor: async (runId) => workspaceProcessContext({ runId, cwd: project, root: project, home: { home }, logDirectory: home, hostRoot: undefined }),
      modules: workspaceExecutorModules({ contributions: [] }),
    });
    const sandbox = new WorkspaceSandboxHost({
      contributorName: "test", contributions: [], storageRootFor: () => storage,
      workspaceFor: async () => ({ cwd: workstation ? "/foreign/project" : project,
        currentRoot: async () => {
          if (workstation) throw new Error("The project is on the workstation.");
          return project;
        }, runOperation: (operation) => operation() }),
      identFor: async () => undefined, skillPaths: async () => [], homeFor: async () => ({ home }),
      serverDirectoryFor: async () => serverFolder,
      executorFor: async () => workstation ? {
        execute: (runId, operation, input, options) => { remoteOperations.push(operation); return remote.execute(runId, operation, input, options); },
        stopRun: (runId) => remote.stopRun(runId), shutdown: () => remote.shutdown(),
      } : undefined,
    });
    const workspaces = new SessionWorkspaces(() => sandbox);
    const setup = fauxModelRuntime(`attachments-${binding}`);
    const harness = journalHarness(setup.selection);
    const manager = new AgentRuntimeManager({ modelRuntime: setup.modelRuntime });
    t.after(async () => { await manager.shutdown(); harness.journal.close(); setup.faux.unregister(); await sandbox.shutdownAll(); await remote.shutdown(); });
    const original = "Oversized stored output\n".repeat(100_000);
    const input = "Attached chat payload\n";
    const storeAttachment = (name: string, content: Uint8Array, reuseIdentical?: boolean) => workspaces.storeAttachment(harness.runId, name, content, reuseIdentical);
    let reference = "";
    setup.faux.setResponses([
      () => fauxAssistantMessage([fauxToolCall("lookup", {})]),
      (context) => {
        reference = /Full text: (@attachments\/tool-result-[a-f0-9]+\.txt)/.exec(modelText(context))?.[1] ?? "";
        assert.ok(reference);
        return fauxAssistantMessage([fauxToolCall("read", { file_path: reference, limit: 2 })]);
      },
      (context) => { assert.match(modelText(context), /1.*Oversized stored output/); return fauxAssistantMessage("Read the result."); },
      (context) => {
        assert.match(modelText(context), /Attached file "data.bin"[^\n]*@attachments\/data.bin/);
        return fauxAssistantMessage([fauxToolCall("read", { file_path: "@attachments/data.bin" })]);
      },
      (context) => { assert.match(modelText(context), /1.*Attached chat payload/); return fauxAssistantMessage("Read the attachment."); },
    ]);
    const invoke = async (_id: string, name: string, args: unknown) => name === "lookup" ? original : textOf(await sandbox.execute(harness.runId, name, args));
    const options = { tools: [nativeTool("lookup"), read], workspace: project, storeAttachment, invoke };
    assert.equal((await turnOf(harness, manager, "Look up the result.", options)).result.failure, null);
    assert.equal(status(), "", "oversized tool results leave no untracked files");
    assert.equal(await readFile(path.join(storage, "attachments", path.basename(reference)), "utf8"), original);
    assert.equal((await turnOf(harness, manager, "Read the file.", { ...options,
      attachments: [{ name: "data.bin", mediaType: "application/octet-stream", content: Buffer.from(input) }],
    })).result.failure, null);
    assert.equal(status(), "", "chat attachments leave no untracked files");
    assert.deepEqual(remoteOperations, []);
    assert.match(textOf(await sandbox.execute(harness.runId, "bash", { command: "cat data.bin", cwd: "@attachments" })), /Attached chat payload/);
    await assert.rejects(sandbox.execute(harness.runId, "write", { file_path: "@attachments/data.bin", content: "changed" }), /outside/);
    await assert.rejects(sandbox.execute(harness.runId, "edit", { file_path: "@attachments/data.bin", old_string: "Attached", new_string: "changed" }), /outside/);
    await mkdir(path.join(project, "attachments"));
    await writeFile(path.join(project, "attachments", "legacy.txt"), "Legacy attachment\n");
    assert.match(textOf(await sandbox.execute(harness.runId, "read", { file_path: "attachments/legacy.txt" })), /Legacy attachment/);
    assert.match(textOf(await sandbox.execute(harness.runId, "bash", { command: "cat attachments/legacy.txt" })), /Legacy attachment/);
    assert.deepEqual(remoteOperations, workstation ? ["read", "bash"] : []);
    assert.equal(await readFile(path.join(storage, "attachments", "data.bin"), "utf8"), input);
  });
}

test("attachment storage rejects a symlink and reserves the root alias", async (t) => {
  const storage = path.join(data, "linked-run");
  const outside = path.join(data, "outside");
  await Promise.all([storage, outside].map((directory) => mkdir(directory)));
  await symlink(outside, path.join(storage, "attachments"));
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test", contributions: [], storageRootFor: () => storage,
    workspaceFor: async () => ({ cwd: storage, currentRoot: async () => storage, runOperation: (operation) => operation() }),
    identFor: async () => undefined, skillPaths: async () => [], homeFor: async () => ({ home: storage }),
  });
  t.after(() => sandbox.shutdownAll());
  assert.throws(() => sandbox.registerWorkspaceRoot({ id: "attachments", alias: "@attachments", directoryFor: () => outside }), /reserved/);
  await assert.rejects(sandbox.execute("run", FILE_OPERATIONS.attach, { name: "data.bin", content: "" }), /not a regular directory/);
  assert.deepEqual(await readdir(outside), []);
});

test("attachments remain readable by a switched account under a restrictive umask", { skip: process.platform === "win32" }, async () => {
  const storage = path.join(data, "restricted-mode");
  const project = path.join(data, "restricted-project");
  await mkdir(project);
  await mkdir(storage, { mode: 0o711 });
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test", contributions: [], storageRootFor: () => storage,
    workspaceFor: async () => ({ cwd: project, currentRoot: async () => project, runOperation: (operation) => operation() }),
    identFor: async () => ({ uid: 4301, gid: 4200, name: "session" }), skillPaths: async () => [], homeFor: async () => ({ home: project }),
  });
  const mask = process.umask(0o077);
  try {
    await sandbox.execute("run", FILE_OPERATIONS.attach, { name: "data.txt", content: Buffer.from("Readable\n").toString("base64") });
    const directory = await stat(path.join(storage, "attachments"));
    const file = await stat(path.join(storage, "attachments", "data.txt"));
    assert.equal(directory.mode & 0o777, 0o755);
    assert.equal(file.mode & 0o777, 0o644);
    assert.equal(directory.uid, process.getuid!());
    assert.equal(file.uid, directory.uid);
    assert.match(textOf(await sandbox.execute("run", "read", { file_path: "@attachments/data.txt" })), /Readable/);
  } finally {
    process.umask(mask);
    await sandbox.shutdownAll();
  }
});

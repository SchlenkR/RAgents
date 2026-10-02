import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  WorkspaceOperationExecutor,
  changedWorkspaceFiles,
  languageServerModule,
  runManagedProcess,
  sandboxToolsModule,
  workspaceProcessContext,
  type LanguageServerAdapter,
  type WorkspaceProcessContext,
} from "../src/index.ts";

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

const fixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-executor-")));
  const workspace = path.join(directory, "workspace");
  const skills = path.join(directory, "skills");
  await Promise.all([workspace, skills].map((entry) => mkdir(entry, { recursive: true })));
  await writeFile(path.join(skills, "guide.md"), "# Guide\n");
  const contexts: WorkspaceProcessContext[] = [];
  const executor = new WorkspaceOperationExecutor({
    modules: [sandboxToolsModule],
    contextFor: (runId) => {
      const context = workspaceProcessContext({
        runId,
        cwd: workspace,
        root: workspace,
        home: { home: path.join(directory, "home") },
        logDirectory: path.join(directory, "logs"),
        hostRoot: undefined,
        readOnlyRoots: [{ directory: skills }],
        additions: { RAGENTS_RUN_ID: runId },
      });
      contexts.push(context);
      return Promise.resolve(context);
    },
  });
  return {
    directory,
    workspace,
    skills,
    executor,
    contexts,
    close: async () => {
      await executor.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("the executor runs read, write, edit and bash in the folder of its machine", async () => {
  const f = await fixture();
  try {
    await f.executor.execute("run-1", "write", { file_path: "note.md", content: "Greetings\n" });
    assert.equal(await readFile(path.join(f.workspace, "note.md"), "utf8"), "Greetings\n");
    await f.executor.execute("run-1", "edit", { file_path: "note.md", old_string: "Greetings", new_string: "Hello" });
    assert.match(textOf(await f.executor.execute("run-1", "read", { file_path: "note.md" })), /Hello/);
    assert.match(textOf(await f.executor.execute("run-1", "bash", { command: "printf hello-$RAGENTS_RUN_ID" })), /hello-run-1/);
  } finally {
    await f.close();
  }
});

test("read-only roots stay readable, everything outside fails with a cause", async () => {
  const f = await fixture();
  try {
    assert.match(textOf(await f.executor.execute("run-1", "read", { file_path: path.join(f.skills, "guide.md") })), /Guide/);
    await assert.rejects(f.executor.execute("run-1", "write", { file_path: path.join(f.skills, "new.md"), content: "x" }), /outside/);
    await assert.rejects(f.executor.execute("run-1", "read", { file_path: "/etc/hosts" }), /outside/);
    await assert.rejects(f.executor.execute("run-1", "grep", { path: "note.md" }), /does not know the operation grep/);
  } finally {
    await f.close();
  }
});

test("bash reports its output as progress and can be aborted", async () => {
  const f = await fixture();
  try {
    const progress: string[] = [];
    const finished = await f.executor.execute("run-1", "bash", { command: "printf done; exit 4" }, {
      onProgress: (value) => progress.push((value as { text: string }).text),
    });
    assert.match(textOf(finished), /done/);
    assert.match(textOf(finished), /Command exited with code 4/);
    assert.ok(progress.some((text) => text.includes("done")), progress.join("|"));

    const controller = new AbortController();
    const running = f.executor.execute("run-1", "bash", { command: "printf started; sleep 5" }, {
      signal: controller.signal,
      onProgress: (value) => {
        if ((value as { text: string }).text.includes("started")) controller.abort();
      },
    });
    assert.match(textOf(await running), /started/);
  } finally {
    await f.close();
  }
});

test("stop ends the tools of a run and the language servers with the same id", async () => {
  const f = await fixture();
  const stopped: string[] = [];
  const adapter: LanguageServerAdapter = {
    id: "fake",
    label: "Fake",
    languages: { ".fake": "fake" },
    rootDescription: "directory",
    resolveRoot: (_workspaceRoot, root) => Promise.resolve(root),
    rootDirectory: (root) => root,
    launch: () => Promise.reject(new Error("Fake does not start")),
    open: () => Promise.resolve("unused"),
  };
  const executor = new WorkspaceOperationExecutor({
    contextFor: (runId) => {
      stopped.push(runId);
      return Promise.resolve(workspaceProcessContext({
        runId, cwd: f.workspace, root: f.workspace, home: { home: f.directory }, logDirectory: f.directory, hostRoot: undefined,
      }));
    },
    modules: [sandboxToolsModule, languageServerModule([adapter])],
  });
  try {
    await assert.rejects(executor.execute("run-2", "fake_diagnostics", { paths: ["a.fake"] }), /fake_open/);
    assert.deepEqual(await executor.execute("run-2", "fake_snapshot", null), { instances: [] });
    await executor.execute("run-2", "write", { file_path: "file.txt", content: "x" });
    await executor.stopRun("run-2");
    await executor.execute("run-2", "write", { file_path: "file.txt", content: "y" });
    assert.equal(await readFile(path.join(f.workspace, "file.txt"), "utf8"), "y");
    assert.ok(stopped.length > 0);
  } finally {
    await executor.shutdown();
    await f.close();
  }
});

test("without paths the diagnostics find the changed files in a subfolder of a repo too", async () => {
  const f = await fixture();
  const repository = path.join(f.directory, "repo");
  const area = path.join(repository, "area");
  try {
    await mkdir(area, { recursive: true });
    await writeFile(path.join(repository, "top.fake"), "top\n");
    await writeFile(path.join(area, "known.fake"), "inside\n");
    for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first"]]) {
      const result = await runManagedProcess({ command: "git", args, cwd: repository, env: process.env, label: "git", timeoutMs: 30_000 });
      assert.equal(result.code, 0);
    }
    await writeFile(path.join(area, "known.fake"), "inside changed\n");
    await writeFile(path.join(area, "fresh.fake"), "new\n");
    await writeFile(path.join(repository, "top.fake"), "top changed\n");
    const context = workspaceProcessContext({ runId: "run-3", cwd: area, root: area, home: { home: f.directory }, logDirectory: f.directory, hostRoot: undefined });
    const changed = await changedWorkspaceFiles(context, area, "fake_diagnostics", (file) => file.endsWith(".fake"));
    assert.deepEqual(changed.sort(), [path.join(area, "fresh.fake"), path.join(area, "known.fake")]);
  } finally {
    await f.close();
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PluginContext, ToolScope } from "@ragents/engine";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

const fixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-seen-state-")));
  const runId = "run-1";
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test", contributions: [], workspaceFor: async () => ({
      cwd: directory, currentRoot: async () => directory, runOperation: (operation) => operation(),
    }), identFor: async () => undefined, skillPaths: async () => [],
    homeFor: async () => ({ home: directory }),
  });
  const scope = {
    caller: { runId, actorId: "agent-1", turnId: "turn-1" },
    modelContext: "context-1",
    signal: undefined,
  } as ToolScope;
  const tools = await sandbox.workspaceTools().tools({ runId } as PluginContext);
  const tool = (name: string) => {
    const found = tools.find((candidate) => candidate.name === name);
    assert.ok(found);
    return (toolCallId: string, input: Record<string, unknown>) => found.run(scope, toolCallId, input as never);
  };
  return {
    directory,
    read: tool("read"),
    edit: tool("edit"),
    write: tool("write"),
    close: async () => {
      await sandbox.shutdownAll();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("parallel first reads preserve seen state for every following write", async () => {
  const f = await fixture();
  const files = ["alpha.md", "beta.md", "gamma.md", "delta.md"];
  try {
    await Promise.all(files.map((file) => writeFile(path.join(f.directory, file), `Initial ${file}`)));
    await Promise.all(files.map((file) => f.read(`read-${file}`, { file_path: file })));
    for (const file of files) {
      const content = `Updated ${file}`;
      await f.write(`write-${file}`, { file_path: file, content });
      assert.equal(await readFile(path.join(f.directory, file), "utf8"), content);
    }
  } finally { await f.close(); }
});

test("parallel edits of one file apply in call order and leave the file state current", async () => {
  const f = await fixture();
  const file = path.join(f.directory, "note.md");
  try {
    await writeFile(file, "one\ntwo\nthree\n");
    await f.read("read", { file_path: "note.md" });
    const results = await Promise.all(["one", "two", "three"].map((word, index) =>
      f.edit(`edit-${word}`, { file_path: "note.md", old_string: word, new_string: String(index + 1) })));
    assert.deepEqual(results, Array(3).fill("The file note.md has been updated successfully."));
    assert.equal(await readFile(file, "utf8"), "1\n2\n3\n");
    assert.equal(await f.edit("edit-after", { file_path: "note.md", old_string: "2", new_string: "two" }), "The file note.md has been updated successfully.");
    await f.write("write-after", { file_path: "note.md", content: "replaced" });
    assert.equal(await readFile(file, "utf8"), "replaced");
  } finally { await f.close(); }
});

test("a parallel edit whose target an earlier edit removed fails on its text and the file state stays current", async () => {
  const f = await fixture();
  const file = path.join(f.directory, "note.md");
  try {
    await writeFile(file, "alpha beta\n");
    await f.read("read", { file_path: "note.md" });
    const results = await Promise.allSettled([
      f.edit("edit-first", { file_path: "note.md", old_string: "alpha", new_string: "gamma" }),
      f.edit("edit-second", { file_path: "note.md", old_string: "alpha beta", new_string: "delta" }),
    ]);
    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(results[1]?.status, "rejected");
    assert.match(String((results[1] as PromiseRejectedResult).reason), /String to replace not found in file/);
    assert.equal(await readFile(file, "utf8"), "gamma beta\n");
    await f.write("write-after", { file_path: "note.md", content: "replaced" });
    assert.equal(await readFile(file, "utf8"), "replaced");
  } finally { await f.close(); }
});

test("a read in the same step as an edit of its file shows the edited content", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.directory, "note.md"), "one\ntwo\n");
    await f.read("read-first", { file_path: "note.md" });
    const [, read] = await Promise.all([
      f.edit("edit", { file_path: "note.md", old_string: "one", new_string: "1" }),
      f.read("read-second", { file_path: "note.md" }),
    ]);
    assert.equal(read, "1\t1\n2\ttwo");
    await f.write("write-after", { file_path: "note.md", content: "replaced" });
  } finally { await f.close(); }
});

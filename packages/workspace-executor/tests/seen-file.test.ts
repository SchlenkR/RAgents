import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSandboxTools, workspaceProcessContext, type SeenFile } from "../src/index.ts";

type Result = { content?: Array<{ type: string; text?: string }>; details?: { seen?: SeenFile } };

const textOf = (result: Result): string => (result.content ?? []).map((part) => part.text ?? "").join("\n");

const coded = (code: string, message: RegExp) => (error: unknown) => {
  assert.equal((error as { code?: unknown }).code, code);
  assert.match((error as Error).message, message);
  return true;
};

/** The file tools as the model calls them directly: every call passes the state of the file it saw last. */
const fixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-seen-")));
  const sandbox = await createSandboxTools("seen-test", async () => workspaceProcessContext({
    runId: "seen-test", cwd: directory, root: directory, home: { home: directory }, logDirectory: directory, hostRoot: undefined,
  }));
  const states = new Map<string, SeenFile>();
  const call = async (name: "read" | "edit" | "write", input: Record<string, unknown> & { file_path: string }): Promise<Result> => {
    const result = await sandbox.tools.get(name)!({ ...input, seen: states.get(input.file_path) ?? null }, { toolCallId: name }) as Result;
    const seen = result.details?.seen;
    assert.ok(seen, `${name} reports the file state`);
    states.set(input.file_path, seen);
    return result;
  };
  return {
    directory,
    call,
    file: (name: string) => path.join(directory, name),
    close: async () => {
      await sandbox.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("edit and write of an existing file need a read first, a new file does not", async () => {
  const f = await fixture();
  try {
    await writeFile(f.file("note.md"), "one\ntwo\n");
    await assert.rejects(f.call("edit", { file_path: "note.md", old_string: "one", new_string: "three" }),
      coded("workspace-file-unread", /^File has not been read yet\. Read it first before writing to it\.$/));
    await assert.rejects(f.call("write", { file_path: "note.md", content: "new" }), coded("workspace-file-unread", /not been read yet/));
    assert.equal(textOf(await f.call("write", { file_path: "fresh.md", content: "fresh" })), "File created successfully at: fresh.md");
    assert.equal(textOf(await f.call("edit", { file_path: "other.md", old_string: "", new_string: "created" })), "File created successfully at: other.md");
    assert.equal(textOf(await f.call("read", { file_path: "note.md" })), "1\tone\n2\ttwo");
    assert.equal(textOf(await f.call("edit", { file_path: "note.md", old_string: "one", new_string: "three" })), "The file note.md has been updated successfully.");
    assert.equal(textOf(await f.call("edit", { file_path: "note.md", old_string: "two", new_string: "four" })), "The file note.md has been updated successfully.");
    assert.equal(await readFile(f.file("note.md"), "utf8"), "three\nfour\n");
  } finally {
    await f.close();
  }
});

test("a repeated read of an unchanged section answers briefly, a changed file is read again", async () => {
  const f = await fixture();
  try {
    await writeFile(f.file("note.md"), "one\n");
    await f.call("read", { file_path: "note.md" });
    assert.match(textOf(await f.call("read", { file_path: "note.md" })), /^File unchanged since last read\. /);
    assert.equal(textOf(await f.call("read", { file_path: "note.md", offset: 1 })), "1\tone");
    await writeFile(f.file("note.md"), "changed\n");
    assert.equal(textOf(await f.call("read", { file_path: "note.md", offset: 1 })), "1\tchanged");
  } finally {
    await f.close();
  }
});

test("after an outside change an edit applies only if old_string still selects its target, and says so", async () => {
  const f = await fixture();
  try {
    await writeFile(f.file("note.md"), "alpha\nbeta\n");
    await f.call("read", { file_path: "note.md" });
    await writeFile(f.file("note.md"), "alpha\nbeta\ngamma\nbeta\n");
    await assert.rejects(f.call("edit", { file_path: "note.md", old_string: "beta", new_string: "delta" }),
      coded("workspace-file-changed", /^File has been modified since read, either by the user or by a linter\. Read it again before attempting to write it\.$/));
    await assert.rejects(f.call("edit", { file_path: "note.md", old_string: "omega", new_string: "delta" }), coded("workspace-file-changed", /modified since read/));
    const applied = textOf(await f.call("edit", { file_path: "note.md", old_string: "gamma", new_string: "delta" }));
    assert.match(applied, /^The file note\.md has been updated successfully\.\n\(note: the file had been modified on disk since you last read it - the edit applied cleanly/);
    assert.equal(await readFile(f.file("note.md"), "utf8"), "alpha\nbeta\ndelta\nbeta\n");
    await assert.rejects(f.call("write", { file_path: "note.md", content: "replaced" }), coded("workspace-file-changed", /modified since read/));
    await f.call("read", { file_path: "note.md" });
    await f.call("write", { file_path: "note.md", content: "replaced" });
    assert.equal(await readFile(f.file("note.md"), "utf8"), "replaced");
  } finally {
    await f.close();
  }
});

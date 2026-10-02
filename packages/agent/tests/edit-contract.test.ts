import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEditToolDefinition, editApplies } from "../src/core/tools/edit.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const textOf = (result: { content: Array<{ type: string; text?: string }> }) => result.content.map((part) => part.text ?? "").join("");

const inFolder = async (name: string, run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), `ragents-edit-${name}-`));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("the schema has the fields of the standard edit tool and is closed", () => {
  const schema = JSON.parse(JSON.stringify(createEditToolDefinition(".").parameters)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(schema.properties as object), ["file_path", "old_string", "new_string", "replace_all"]);
  assert.deepEqual(schema.required, ["file_path", "old_string", "new_string"]);
  assert.equal(schema.additionalProperties, false);
});

test("a unique old_string is replaced once, an ambiguous one names its lines, and replace_all changes every occurrence", async () => {
  await inFolder("unique", async (directory) => {
    const path = join(directory, "example.txt");
    const original = "start\nvalue\nmiddle\nvalue\nend\n";
    const tool = createEditToolDefinition(directory);
    await writeFile(path, original);
    await assert.rejects(tool.execute("ambiguous", { file_path: path, old_string: "value", new_string: "changed" }),
      /^Error: Found 2 matches of the string to replace, but replace_all is false\. To replace all occurrences, set replace_all to true\. To replace only one occurrence, please provide more context to uniquely identify the instance\. Matches:\n  line 2: value\n  line 4: value$/);
    assert.equal(await readFile(path, "utf8"), original);
    const unique = await tool.execute("unique", { file_path: path, old_string: "middle\nvalue", new_string: "middle\nchanged" });
    assert.equal(textOf(unique), `The file ${path} has been updated successfully.`);
    assert.equal(await readFile(path, "utf8"), "start\nvalue\nmiddle\nchanged\nend\n");
    assert.equal(unique.details.contentHash, hash("start\nvalue\nmiddle\nchanged\nend\n"));
    await writeFile(path, original);
    const all = await tool.execute("all", { file_path: path, old_string: "value", new_string: "changed", replace_all: true });
    assert.equal(textOf(all), `The file ${path} has been updated. All occurrences were successfully replaced.`);
    assert.equal(await readFile(path, "utf8"), original.replaceAll("value", "changed"));
  });
});

test("edit fails with the standard messages before it changes anything", async () => {
  await inFolder("errors", async (directory) => {
    const path = join(directory, "example.txt");
    const tool = createEditToolDefinition(directory);
    await writeFile(path, "one\n");
    await assert.rejects(tool.execute("same", { file_path: path, old_string: "one", new_string: "one" }),
      /^Error: No changes to make: old_string and new_string are exactly the same\.$/);
    await assert.rejects(tool.execute("missing", { file_path: path, old_string: "two", new_string: "three" }), /^Error: String to replace not found in file\./);
    await assert.rejects(tool.execute("absent", { file_path: join(directory, "absent.txt"), old_string: "one", new_string: "two" }), /^Error: File does not exist\.$/);
    await assert.rejects(tool.execute("exists", { file_path: path, old_string: "", new_string: "two" }), /^Error: Cannot create new file - file already exists\.$/);
    assert.equal(await readFile(path, "utf8"), "one\n");
  });
});

test("an empty old_string creates a missing file with its folders and fills an empty one", async () => {
  await inFolder("create", async (directory) => {
    const tool = createEditToolDefinition(directory);
    const created = await tool.execute("create", { file_path: "nested/new.txt", old_string: "", new_string: "fresh\n" });
    assert.equal(textOf(created), "File created successfully at: nested/new.txt");
    assert.equal(await readFile(join(directory, "nested", "new.txt"), "utf8"), "fresh\n");
    await writeFile(join(directory, "empty.txt"), "");
    await tool.execute("fill", { file_path: "empty.txt", old_string: "", new_string: "filled" });
    assert.equal(await readFile(join(directory, "empty.txt"), "utf8"), "filled");
  });
});

test("deleting a whole line removes its line break, and line endings, BOM and fuzzy quotes survive", async () => {
  await inFolder("lines", async (directory) => {
    const tool = createEditToolDefinition(directory);
    await writeFile(join(directory, "lines.txt"), "keep\ndrop\nkeep too\n");
    await tool.execute("drop", { file_path: "lines.txt", old_string: "drop", new_string: "" });
    assert.equal(await readFile(join(directory, "lines.txt"), "utf8"), "keep\nkeep too\n");
    await writeFile(join(directory, "windows.txt"), "﻿first\r\nsecond\r\n");
    await tool.execute("crlf", { file_path: "windows.txt", old_string: "first\nsecond", new_string: "first\nchanged" });
    assert.equal(await readFile(join(directory, "windows.txt"), "utf8"), "﻿first\r\nchanged\r\n");
    await writeFile(join(directory, "quotes.txt"), "say “hello”\nother\n");
    await tool.execute("fuzzy", { file_path: "quotes.txt", old_string: "say \"hello\"", new_string: "say \"bye\"" });
    assert.equal(await readFile(join(directory, "quotes.txt"), "utf8"), "say \"bye\"\nother\n");
  });
});

test("editApplies tells whether old_string selects what the edit replaces", () => {
  assert.equal(editApplies("﻿a\r\nb\r\na\r\n", "b", false), true);
  assert.equal(editApplies("a\nb\na\n", "a", false), false);
  assert.equal(editApplies("a\nb\na\n", "a", true), true);
  assert.equal(editApplies("a\nb\n", "c", true), false);
  assert.equal(editApplies("a\n", "", false), false);
});

test("queued edits through a symbolic alias wait for the file lock and see the previous edit", async () => {
  await inFolder("race", async (directory) => {
    const path = join(directory, "example.txt");
    const alias = join(directory, "alias.txt");
    const entered = deferred();
    const release = deferred();
    let reads = 0;
    const tool = createEditToolDefinition(directory, { operations: {
      mkdir: async (folder) => { await mkdir(folder, { recursive: true }); },
      readFile: async (file) => { reads += 1; return readFile(file); },
      writeFile: async (file, content) => { entered.resolve(); await release.promise; await writeFile(file, content); },
    } });
    try {
      await writeFile(path, "one\ntwo\n");
      await symlink(path, alias);
      const first = tool.execute("first", { file_path: path, old_string: "one", new_string: "three" });
      await entered.promise;
      const second = tool.execute("second", { file_path: alias, old_string: "two", new_string: "four" });
      assert.equal(reads, 1);
      release.resolve();
      const result = await first;
      await second;
      assert.equal(await readFile(path, "utf8"), "three\nfour\n");
      assert.equal(result.details.contentHash, hash("three\ntwo\n"));
    } finally {
      release.resolve();
    }
  });
});

test("an aborted in-flight write retains the lock until filesystem settlement", async () => {
  await inFolder("abort", async (directory) => {
    const path = join(directory, "example.txt");
    const entered = deferred();
    const release = deferred();
    const controller = new AbortController();
    let writes = 0;
    const tool = createEditToolDefinition(directory, { operations: {
      mkdir: async (folder) => { await mkdir(folder, { recursive: true }); },
      readFile,
      writeFile: async (file, content) => {
        writes += 1;
        if (writes === 1) { entered.resolve(); await release.promise; }
        await writeFile(file, content);
      },
    } });
    try {
      await writeFile(path, "one");
      const first = tool.execute("first", { file_path: path, old_string: "one", new_string: "two" }, controller.signal);
      const aborted = assert.rejects(first, /aborted/);
      await entered.promise;
      controller.abort();
      const second = tool.execute("second", { file_path: path, old_string: "two", new_string: "three" });
      release.resolve();
      await Promise.all([aborted, second]);
      assert.equal(await readFile(path, "utf8"), "three");
    } finally {
      release.resolve();
    }
  });
});

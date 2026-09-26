import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test("ambiguous edits name matching lines and explicit anchors select the intended occurrence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-edit-anchors-"));
  const path = join(directory, "example.txt");
  const original = "start\nWert\nMitte\nWert\nEnde\n";
  const tool = createEditToolDefinition(directory);
  const edit = { oldText: "Wert", newText: "Geändert" };
  try {
    await writeFile(path, original);
    await assert.rejects(tool.execute("ambiguous", { path, edits: [edit] }), /line 2[\s\S]*line 4/);
    assert.equal(await readFile(path, "utf8"), original);
    await assert.rejects(tool.execute("tie", { path, edits: [{ ...edit, nearLine: 3 }] }), /equally close/);
    await assert.rejects(tool.execute("conflict", { path, edits: [{ ...edit, occurrence: 1, nearLine: 4 }] }), /different occurrences/);
    await tool.execute("occurrence", { path, edits: [{ ...edit, occurrence: 2 }] });
    assert.equal(await readFile(path, "utf8"), "start\nWert\nMitte\nGeändert\nEnde\n");
    await writeFile(path, original);
    await tool.execute("near", { path, edits: [{ ...edit, nearLine: 1 }] });
    assert.equal(await readFile(path, "utf8"), "start\nGeändert\nMitte\nWert\nEnde\n");
    await writeFile(path, original);
    await tool.execute("all", { path, edits: [{ ...edit, replaceAll: true }] });
    assert.equal(await readFile(path, "utf8"), original.replaceAll("Wert", "Geändert"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("queued edits through a symbolic alias wait for the file lock and see the previous edit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-edit-race-"));
  const path = join(directory, "example.txt");
  const alias = join(directory, "alias.txt");
  const entered = deferred();
  const release = deferred();
  const original = "eins\nzwei\n";
  let reads = 0;
  const tool = createEditToolDefinition(directory, { operations: {
    access: async () => undefined,
    readFile: async (file) => { reads += 1; return readFile(file); },
    writeFile: async (file, content) => { entered.resolve(); await release.promise; await writeFile(file, content); },
  } });
  try {
    await writeFile(path, original);
    await symlink(path, alias);
    const first = tool.execute("first", { path, edits: [{ oldText: "eins", newText: "drei" }] });
    await entered.promise;
    const second = tool.execute("second", { path: alias, edits: [{ oldText: "zwei", newText: "vier" }] });
    assert.equal(reads, 1);
    release.resolve();
    const result = await first;
    await second;
    assert.equal(await readFile(path, "utf8"), "drei\nvier\n");
    assert.equal(result.details?.contentHash, hash("drei\nzwei\n"));
  } finally {
    release.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an aborted in-flight write retains the lock until filesystem settlement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-edit-abort-"));
  const path = join(directory, "example.txt");
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  let writes = 0;
  const tool = createEditToolDefinition(directory, { operations: {
    access: async () => undefined,
    readFile,
    writeFile: async (file, content) => {
      writes += 1;
      if (writes === 1) { entered.resolve(); await release.promise; }
      await writeFile(file, content);
    },
  } });
  try {
    await writeFile(path, "eins");
    const first = tool.execute("first", { path, edits: [{ oldText: "eins", newText: "zwei" }] }, controller.signal);
    const aborted = assert.rejects(first, /aborted/);
    await entered.promise;
    controller.abort();
    const second = tool.execute("second", { path, edits: [{ oldText: "zwei", newText: "drei" }] });
    release.resolve();
    await Promise.all([aborted, second]);
    assert.equal(await readFile(path, "utf8"), "drei");
  } finally {
    release.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReadToolDefinition, READ_MAX_LINE_CHARS } from "../src/core/tools/read.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";

const textOf = (result: { content: Array<{ type: string; text?: string }> }) => result.content.map((part) => part.text ?? "").join("");

const inFolder = async (name: string, run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), `ragents-${name}-`));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const closedSchema = (parameters: unknown) => JSON.parse(JSON.stringify(parameters)) as { properties: object; required: string[]; additionalProperties: boolean };

test("read and write have the fields of the standard tools and closed schemas", () => {
  const read = closedSchema(createReadToolDefinition(".").parameters);
  assert.deepEqual(Object.keys(read.properties), ["file_path", "offset", "limit"]);
  assert.deepEqual(read.required, ["file_path"]);
  assert.equal(read.additionalProperties, false);
  const write = closedSchema(createWriteToolDefinition(".").parameters);
  assert.deepEqual(Object.keys(write.properties), ["file_path", "content"]);
  assert.deepEqual(write.required, ["file_path", "content"]);
  assert.equal(write.additionalProperties, false);
});

test("read numbers the lines like cat -n and names the offset to continue with", async () => {
  await inFolder("read", async (directory) => {
    const tool = createReadToolDefinition(directory);
    await writeFile(join(directory, "five.txt"), "one\r\ntwo\nthree\n\tfour\nfive\n");
    assert.equal(textOf(await tool.execute("all", { file_path: "five.txt" })), "1\tone\n2\ttwo\n3\tthree\n4\t\tfour\n5\tfive");
    assert.equal(textOf(await tool.execute("part", { file_path: "five.txt", offset: 2, limit: 2 })),
      "2\ttwo\n3\tthree\n\n[Showing lines 2-3 of 5. Use offset=4 to continue.]");
    assert.equal(textOf(await tool.execute("zero", { file_path: "five.txt", offset: 0, limit: 1 })),
      "1\tone\n\n[Showing lines 1-1 of 5. Use offset=2 to continue.]");
    assert.equal(textOf(await tool.execute("beyond", { file_path: "five.txt", offset: 9 })),
      "Warning: the file exists but is shorter than the provided offset (9). The file has 5 lines.");
    await writeFile(join(directory, "empty.txt"), "");
    assert.equal(textOf(await tool.execute("empty", { file_path: "empty.txt" })), "Warning: the file exists but the contents are empty.");
  });
});

test("read truncates long lines and stops at 2000 lines", async () => {
  await inFolder("read-limits", async (directory) => {
    const tool = createReadToolDefinition(directory);
    await writeFile(join(directory, "long.txt"), `${"x".repeat(READ_MAX_LINE_CHARS + 5)}\nshort\n`);
    assert.equal(textOf(await tool.execute("long", { file_path: "long.txt" })),
      `1\t${"x".repeat(READ_MAX_LINE_CHARS)}... (line truncated to ${READ_MAX_LINE_CHARS} chars)\n2\tshort`);
    await writeFile(join(directory, "many.txt"), Array.from({ length: 2500 }, (_, index) => `line ${index + 1}`).join("\n"));
    const many = textOf(await tool.execute("many", { file_path: "many.txt", limit: 3000 }));
    assert.match(many, /\n2000\tline 2000\n\n\[Showing lines 1-2000 of 2500\. Use offset=2001 to continue\.\]$/);
  });
});

test("write says whether it created or updated a file and creates parent folders", async () => {
  await inFolder("write", async (directory) => {
    const tool = createWriteToolDefinition(directory);
    assert.equal(textOf(await tool.execute("create", { file_path: "nested/note.md", content: "first" })), "File created successfully at: nested/note.md");
    assert.equal(textOf(await tool.execute("update", { file_path: "nested/note.md", content: "second" })), "The file nested/note.md has been updated successfully.");
    assert.equal(await readFile(join(directory, "nested", "note.md"), "utf8"), "second");
  });
});

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import type { ToolScope } from "@ragents/engine";

import { createDocumentWriteTool } from "../../../plugins/ragents.documents/server/document-write-tool.ts";

const scope = { caller: { runId: "run-1", actorId: "actor-1", turnId: "turn-1" }, signal: undefined } as unknown as ToolScope;

const toolWithStore = async () => {
  const files = await mkdtemp(path.join(tmpdir(), "ragents-document-write-"));
  const read: string[] = [];
  const tool = createDocumentWriteTool({
    storeFor: async () => files,
    workspaceText: async (_runId, filePath) => {
      read.push(filePath);
      return "# Copied\n";
    },
  });
  return { files, read, tool, write: (input: unknown) => tool.run(scope, "call-1", input as never) };
};

test("document_write stores the given content in the file store", async () => {
  const { files, write } = await toolWithStore();
  assert.equal(await write({ storePath: "topic/report.md", content: "# Report\n" }), "Stored in the file store (9 bytes).");
  assert.equal(await readFile(path.join(files, "topic/report.md"), "utf8"), "# Report\n");
});

test("document_write copies a file named like read unchanged instead of retyping it", async () => {
  const { files, read, write } = await toolWithStore();
  await write({ storePath: "topic/copy.md", file_path: "@actors/notes/README.md" });
  assert.deepEqual(read, ["@actors/notes/README.md"]);
  assert.equal(await readFile(path.join(files, "topic/copy.md"), "utf8"), "# Copied\n");
});

test("document_write takes exactly one source and a store path inside the file store", async () => {
  const { tool, write } = await toolWithStore();
  await assert.rejects(write({ storePath: "a.md" }), /content and file_path exclude each other/);
  await assert.rejects(write({ storePath: "a.md", content: "x", file_path: "b.md" }), /content and file_path exclude each other/);
  await assert.rejects(write({ storePath: "/etc/passwd", content: "x" }), /relative to the file store/);
  await assert.rejects(write({ storePath: "../escape.md", content: "x" }), /relative to the file store/);
  assert.equal(Value.Check(tool.schema, { path: "topic/report.md", content: "x" }), false);
});

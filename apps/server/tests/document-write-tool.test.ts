import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolScope } from "@ragents/engine";

import { createDocumentWriteTool } from "../../../plugins/ragents.documents/server/document-write-tool.ts";

const scope = { caller: { runId: "run-1", actorId: "actor-1", turnId: null } } as unknown as ToolScope;

const toolWithStore = async () => {
  const files = await mkdtemp(path.join(tmpdir(), "ragents-document-write-"));
  return { files, tool: createDocumentWriteTool(async () => files) };
};

test("document_write stores the given content in the file store", async () => {
  const { files, tool } = await toolWithStore();
  const result = await tool.run(scope, "call-1", { path: "topic/report.md", content: "# Report\n" } as never);
  assert.match(String(result), /topic\/report\.md/);
  assert.equal(await readFile(path.join(files, "topic/report.md"), "utf8"), "# Report\n");
});

test("document_write requires a path inside the file store", async () => {
  const { tool } = await toolWithStore();
  await assert.rejects(tool.run(scope, "call-1", { path: "/etc/passwd", content: "x" } as never), /relative to the file store/);
  await assert.rejects(tool.run(scope, "call-1", { path: "../escape.md", content: "x" } as never), /relative to the file store/);
});

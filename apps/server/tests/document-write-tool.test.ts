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

test("document_write legt den übergebenen Inhalt in der Ablage ab", async () => {
  const { files, tool } = await toolWithStore();
  const result = await tool.run(scope, "call-1", { path: "thema/bericht.md", content: "# Bericht\n" } as never);
  assert.match(String(result), /thema\/bericht\.md/);
  assert.equal(await readFile(path.join(files, "thema/bericht.md"), "utf8"), "# Bericht\n");
});

test("document_write verlangt einen Pfad in der Ablage", async () => {
  const { tool } = await toolWithStore();
  await assert.rejects(tool.run(scope, "call-1", { path: "/etc/passwd", content: "x" } as never), /relativ zur Dateiablage/);
  await assert.rejects(tool.run(scope, "call-1", { path: "../ausbruch.md", content: "x" } as never), /relativ zur Dateiablage/);
});

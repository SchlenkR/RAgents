import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import type { ToolScope } from "@ragents/engine";

import { createShowDocumentTool } from "../../../plugins/ragents.documents/server/show-document-tool.ts";
import type { DocumentSources } from "../../../plugins/ragents.documents/server/sources.ts";

const scope = { caller: { runId: "run-1", actorId: "actor-1", turnId: "turn-1" }, signal: undefined } as unknown as ToolScope;

const fixture = async () => {
  const files = await mkdtemp(path.join(tmpdir(), "ragents-documents-"));
  await mkdir(path.join(files, "topic"));
  await writeFile(path.join(files, "topic", "file.md"), "# Content\n");
  const read: Array<{ runId: string; filePath: string; toolCallId: string | undefined }> = [];
  const sources: DocumentSources = {
    storeFor: async () => files,
    workspaceText: async (runId, filePath, call) => {
      read.push({ runId, filePath, toolCallId: call?.toolCallId });
      if (filePath === "missing.md") throw new Error("Not found: missing.md");
      return "# Guide\n";
    },
  };
  const tool = createShowDocumentTool(sources);
  return { read, tool, show: (input: unknown) => tool.run(scope, "call-1", input as never) };
};

test("show_document reads a file named like read where the workspace lies and does not echo it", async () => {
  const f = await fixture();

  assert.equal(await f.show({ title: "Guide", file_path: "docs/guide.md" }), "Shown to the user.");
  assert.deepEqual(f.read, [{ runId: "run-1", filePath: "docs/guide.md", toolCallId: "call-1" }]);
  await assert.rejects(async () => await f.show({ title: "Missing", file_path: "missing.md" }), /Not found: missing\.md/);
});

test("show_document shows a file of the file store and rejects one outside it", async () => {
  const f = await fixture();

  assert.equal(await f.show({ title: "File", storePath: "topic/file.md" }), "Shown to the user.");
  await assert.rejects(async () => await f.show({ title: "README", storePath: "src/README.md" }), /src\/README\.md is not in this run's file store/);
  await assert.rejects(async () => await f.show({ title: "Escape", storePath: "../escape.md" }), /relative to the file store/);
  assert.deepEqual(f.read, []);
});

test("show_document shows own content without reading a file", async () => {
  const f = await fixture();

  assert.equal(await f.show({ title: "Report", content: "# Report" }), "Shown to the user.");
  assert.deepEqual(f.read, []);
});

test("show_document takes exactly one source and names the three valid forms", async () => {
  const f = await fixture();

  for (const input of [
    { title: "File" },
    { title: "File", content: "# Content", file_path: "docs/guide.md" },
    { title: "File", storePath: "topic/file.md", file_path: "docs/guide.md" },
    { title: "File", content: "# Content", storePath: "topic/file.md" },
  ]) {
    await assert.rejects(async () => await f.show(input), /file_path, storePath and content exclude each other: valid are \{ title, file_path \}.*\{ title, storePath \}.*\{ title, content \}/, JSON.stringify(input));
  }
});

test("show_document has a flat input without a root union and no longer takes path", async () => {
  const { tool } = await fixture();
  const schema = tool.schema as { type?: unknown; anyOf?: unknown; oneOf?: unknown; required?: readonly string[] };

  assert.equal(schema.type, "object");
  assert.equal(schema.anyOf, undefined);
  assert.equal(schema.oneOf, undefined);
  assert.deepEqual(schema.required, ["title"]);
  assert.equal(Value.Check(tool.schema, { title: "Old", path: "topic/file.md" }), false);
  assert.notEqual(tool.nativeTool, false);
});

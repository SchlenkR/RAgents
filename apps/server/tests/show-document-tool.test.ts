import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { DomainError, type ToolScope } from "@ragents/engine";
import { FILE_OPERATIONS } from "@ragents/workspace-executor";

import { createShowDocumentTool } from "../../../plugins/ragents.documents/server/show-document-tool.ts";

const scope = { caller: { runId: "run-1", actorId: "actor-1", turnId: "turn-1" }, signal: undefined } as unknown as ToolScope;

const fixture = () => {
  const calls: Array<{ runId: string; operation: string; input: unknown; toolCallId: string | undefined }> = [];
  const tool = createShowDocumentTool({
    execute: async (runId, operation, input, options) => {
      calls.push({ runId, operation, input, toolCallId: options?.toolCallId });
      if ((input as { path: string }).path === "missing.md") throw new DomainError("workspace-path-not-found", "Not found: missing.md", 404);
      return { path: (input as { path: string }).path, size: 10, previewable: false, reason: "The file is binary" };
    },
  });
  return { calls, tool, show: (input: unknown) => tool.run(scope, "call-1", input as never) };
};

test("show_document checks a file named like read where its root lies and does not echo it, also an image", async () => {
  const f = fixture();

  assert.equal(await f.show({ title: "Guide", file_path: "docs/guide.md" }), "Shown to the user.");
  assert.equal(await f.show({ title: "Login", file_path: "@documents/review/shots/login.png" }), "Shown to the user.");
  assert.deepEqual(f.calls, [
    { runId: "run-1", operation: FILE_OPERATIONS.text, input: { path: "docs/guide.md" }, toolCallId: "call-1" },
    { runId: "run-1", operation: FILE_OPERATIONS.text, input: { path: "@documents/review/shots/login.png" }, toolCallId: "call-1" },
  ]);
  await assert.rejects(async () => await f.show({ title: "Missing", file_path: "missing.md" }), /Not found: missing\.md/);
});

test("show_document shows own content without reading a file", async () => {
  const f = fixture();

  assert.equal(await f.show({ title: "Report", content: "# Report" }), "Shown to the user.");
  assert.deepEqual(f.calls, []);
});

test("show_document takes exactly one source and names the two valid forms", async () => {
  const f = fixture();

  for (const input of [{ title: "File" }, { title: "File", content: "# Content", file_path: "docs/guide.md" }]) {
    await assert.rejects(async () => await f.show(input), /file_path and content exclude each other: valid are \{ title, file_path \}.*\{ title, content \}/, JSON.stringify(input));
  }
});

test("show_document has a flat input without a root union and takes neither path nor storePath", () => {
  const { tool } = fixture();
  const schema = tool.schema as { type?: unknown; anyOf?: unknown; oneOf?: unknown; required?: readonly string[]; properties: object };

  assert.equal(schema.type, "object");
  assert.equal(schema.anyOf, undefined);
  assert.equal(schema.oneOf, undefined);
  assert.deepEqual(schema.required, ["title"]);
  assert.deepEqual(Object.keys(schema.properties), ["title", "file_path", "content", "format"]);
  assert.equal(Value.Check(tool.schema, { title: "Old", path: "topic/file.md" }), false);
  assert.equal(Value.Check(tool.schema, { title: "Old", storePath: "topic/file.md" }), false);
  assert.doesNotMatch(JSON.stringify([tool.description, tool.longDescription, tool.schema]), /storePath|document_write|file store/);
  assert.notEqual(tool.nativeTool, false);
});

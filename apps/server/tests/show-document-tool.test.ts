import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolScope } from "@ragents/engine";

import { createShowDocumentTool } from "../../../plugins/ragents.documents/server/show-document-tool.ts";

const scope = { caller: { runId: "run-1", actorId: "actor-1", turnId: null } } as unknown as ToolScope;

const toolWithFiles = async () => {
  const files = await mkdtemp(path.join(tmpdir(), "ragents-documents-"));
  await mkdir(path.join(files, "topic"));
  await writeFile(path.join(files, "topic", "file.md"), "# Content\n");
  return createShowDocumentTool(async () => files);
};

const show = async (input: unknown) => (await toolWithFiles()).run(scope, "call-1", input as never);

test("show_document shows a file from the file store", async () => {
  const result = await show({ title: "File", path: "topic/file.md" });

  assert.equal(result, "Shown to the user: File (file topic/file.md from the file store)");
});

test("show_document rejects a path that is not in the file store", async () => {
  await assert.rejects(
    async () => await show({ title: "README", path: "src/README.md" }),
    /src\/README\.md is not in this run's file store/,
  );
});

test("show_document shows passed content without a file reference", async () => {
  const result = await show({ title: "Report", content: "# Report" });

  assert.equal(result, "Shown to the user: Report");
});

test("show_document rejects content and path together", async () => {
  await assert.rejects(
    async () => await show({ title: "File", content: "# Content", path: "topic/file.md" }),
    /content and path exclude each other/,
  );
});

test("show_document rejects an input without content and without path", async () => {
  await assert.rejects(
    async () => await show({ title: "File" }),
    /content and path exclude each other/,
  );
});

test("show_document describes its input as a flat object without a root union", async () => {
  const schema = createShowDocumentTool(async () => "").schema as {
    type?: unknown;
    anyOf?: unknown;
    oneOf?: unknown;
    required?: readonly string[];
  };

  assert.equal(schema.type, "object");
  assert.equal(schema.anyOf, undefined);
  assert.equal(schema.oneOf, undefined);
  assert.deepEqual(schema.required, ["title"]);
});

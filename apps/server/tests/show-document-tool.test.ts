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
  await mkdir(path.join(files, "thema"));
  await writeFile(path.join(files, "thema", "datei.md"), "# Inhalt\n");
  return createShowDocumentTool(async () => files);
};

const show = async (input: unknown) => (await toolWithFiles()).run(scope, "call-1", input as never);

test("show_document zeigt eine Datei der Dateiablage an", async () => {
  const result = await show({ title: "Datei", path: "thema/datei.md" });

  assert.equal(result, "Dem Benutzer angezeigt: Datei (Datei thema/datei.md aus der Dateiablage)");
});

test("show_document lehnt einen Pfad ab, der nicht in der Dateiablage liegt", async () => {
  await assert.rejects(
    async () => await show({ title: "README", path: "src/README.md" }),
    /src\/README\.md liegt nicht in der Dateiablage dieses Runs/,
  );
});

test("show_document zeigt übergebenen Inhalt ohne Dateibezug an", async () => {
  const result = await show({ title: "Bericht", content: "# Bericht" });

  assert.equal(result, "Dem Benutzer angezeigt: Bericht");
});

test("show_document lehnt content und path zusammen ab", async () => {
  await assert.rejects(
    async () => await show({ title: "Datei", content: "# Inhalt", path: "thema/datei.md" }),
    /content und path schließen einander aus/,
  );
});

test("show_document lehnt eine Eingabe ohne content und ohne path ab", async () => {
  await assert.rejects(
    async () => await show({ title: "Datei" }),
    /content und path schließen einander aus/,
  );
});

test("show_document beschreibt seine Eingabe als flaches Objekt ohne Wurzel-Union", async () => {
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

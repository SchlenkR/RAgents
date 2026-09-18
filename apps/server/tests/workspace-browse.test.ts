import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { BrowseListing, BrowsePreview, BrowseRoot } from "../../../plugins/ragents.workspace/contract.ts";
import { createBrowseRoutes } from "../../../plugins/ragents.workspace/server/browse-route.ts";
import { capturedJson } from "./runtime-fixture.ts";

const fixture = async (): Promise<{ workspace: string; files: string; remove: () => Promise<void> }> => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-browse-")));
  const workspace = path.join(directory, "workspace");
  const files = path.join(directory, "files");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, ".git"), { recursive: true });
  await mkdir(files, { recursive: true });
  await writeFile(path.join(workspace, "notes.md"), "Grüße aus dem Lauf\n");
  await writeFile(path.join(workspace, ".env"), "TOKEN=1\n");
  await writeFile(path.join(workspace, "app.bin"), Buffer.from([0x50, 0x00, 0x4b]));
  await writeFile(path.join(workspace, "src", "index.ts"), "export const x = 1;\n");
  await writeFile(path.join(directory, "geheim.txt"), "nicht für den Browser\n");
  return { workspace, files, remove: () => rm(directory, { recursive: true, force: true }) };
};

const routesFor = (roots: Readonly<Record<BrowseRoot, string>>, ensureSession: (runId: string) => void = () => {}) =>
  createBrowseRoutes({
    rootFor: (_runId, root) => Promise.resolve(roots[root]),
    ensureSession,
  });

const call = async (route: ReturnType<typeof routesFor>[number], target: string) => {
  const url = new URL(target, "http://host");
  const { captured, response } = capturedJson();
  await route.handle({ request: { method: "GET" } as IncomingMessage, response, url });
  return captured;
};

test("das Listing nennt Verzeichnisse zuerst, dann alphabetisch, versteckte Einträge inklusive", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const [listing] = routesFor({ workspace, files });
    const url = new URL("http://host/api/plugins/ragents.workspace/runs/run-1/browse");
    assert.ok(listing.isApiPath(url.pathname));
    assert.ok(listing.matches({ method: "GET" } as IncomingMessage, url));
    assert.ok(!listing.matches({ method: "POST" } as IncomingMessage, url));

    const captured = await call(listing, "/api/plugins/ragents.workspace/runs/run-1/browse?root=workspace");
    assert.equal(captured.status, 200);
    const body = captured.body as BrowseListing;
    assert.deepEqual(body.entries.map((entry) => entry.name), [".git", "src", ".env", "app.bin", "notes.md"]);
    assert.deepEqual(body.entries.map((entry) => entry.kind),
      ["directory", "directory", "file", "file", "file"]);
    assert.equal(body.truncated, false);
    assert.equal(body.path, "");
    assert.equal(body.root, "workspace");

    const nested = await call(listing, "/api/plugins/ragents.workspace/runs/run-1/browse?root=workspace&path=src");
    assert.deepEqual((nested.body as BrowseListing).entries.map((entry) => entry.name), ["index.ts"]);

    const empty = await call(listing, "/api/plugins/ragents.workspace/runs/run-1/browse?root=files");
    assert.deepEqual((empty.body as BrowseListing).entries, []);
  } finally {
    await remove();
  }
});

test("ein Ausbruch aus der Wurzel und ein fehlendes Verzeichnis werden abgelehnt", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const [listing] = routesFor({ workspace, files });

    const escaped = await call(listing, "/api/plugins/ragents.workspace/runs/run-1/browse?root=workspace&path=../geheim.txt");
    assert.equal(escaped.status, 400);
    assert.deepEqual(escaped.body, { error: "Ungültiger Pfad" });

    const missing = await call(listing, "/api/plugins/ragents.workspace/runs/run-1/browse?root=workspace&path=nirgends");
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, { error: "Nicht gefunden: nirgends" });

    const unknownRoot = await call(listing, "/api/plugins/ragents.workspace/runs/run-1/browse?root=global");
    assert.equal(unknownRoot.status, 400);
    assert.deepEqual(unknownRoot.body, { error: "Unbekannte Wurzel; erlaubt sind workspace und files" });
  } finally {
    await remove();
  }
});

test("die Vorschau liefert Text und verweigert Binärdateien", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const [, preview] = routesFor({ workspace, files });
    const url = new URL("http://host/api/plugins/ragents.workspace/runs/run-1/browse/file");
    assert.ok(preview.isApiPath(url.pathname));
    assert.ok(!preview.isApiPath("/api/plugins/ragents.workspace/runs/run-1/browse"));

    const text = await call(preview, "/api/plugins/ragents.workspace/runs/run-1/browse/file?root=workspace&path=notes.md");
    assert.equal(text.status, 200);
    assert.deepEqual(text.body, {
      root: "workspace",
      path: "notes.md",
      size: Buffer.byteLength("Grüße aus dem Lauf\n"),
      previewable: true,
      content: "Grüße aus dem Lauf\n",
    });

    const binary = await call(preview, "/api/plugins/ragents.workspace/runs/run-1/browse/file?root=workspace&path=app.bin");
    const body = binary.body as BrowsePreview;
    assert.equal(body.previewable, false);
    assert.equal(body.previewable === false ? body.reason : undefined, "Die Datei ist binär");

    const directory = await call(preview, "/api/plugins/ragents.workspace/runs/run-1/browse/file?root=workspace&path=src");
    assert.equal(directory.status, 400);
    assert.deepEqual(directory.body, { error: "Keine Datei: src" });
  } finally {
    await remove();
  }
});

test("eine unbekannte Unterhaltung wird gemeldet, ohne das Dateisystem zu lesen", async () => {
  const routes = createBrowseRoutes({
    rootFor: () => Promise.reject(new Error("nicht gefragt")),
    ensureSession: (runId) => {
      throw new Error(`Unterhaltung ${runId} ist unbekannt`);
    },
  });

  for (const target of [
    "/api/plugins/ragents.workspace/runs/run-9/browse?root=workspace",
    "/api/plugins/ragents.workspace/runs/run-9/browse/file?root=workspace&path=notes.md",
  ]) {
    const captured = await call(routes[target.includes("/file") ? 1 : 0], target);
    assert.equal(captured.status, 400);
    assert.deepEqual(captured.body, { error: "Unterhaltung run-9 ist unbekannt" });
  }
});

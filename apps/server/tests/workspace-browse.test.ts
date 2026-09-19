import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import { DomainError } from "@aicontainer/ragents";

import { workspaceContracts, type BrowseListing, type BrowsePreview, type BrowseRoot } from "../../../plugins/ragents.workspace/contract.ts";
import { createBrowseChannel, createBrowseMethods } from "../../../plugins/ragents.workspace/server/browse-route.ts";
import { methodContext } from "./rpc-fixture.ts";

const context = methodContext();

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

const browseOptions = (roots: Readonly<Record<BrowseRoot, string>>, ensureSession: (runId: string) => void = () => {}) => ({
  rootFor: (_runId: string, root: BrowseRoot) => Promise.resolve(roots[root]),
  ensureSession,
});

const listing = (roots: Readonly<Record<BrowseRoot, string>>, ensureSession?: (runId: string) => void) =>
  (root: BrowseRoot, target: string): Promise<BrowseListing> =>
    createBrowseMethods(browseOptions(roots, ensureSession))[0]
      .execute({ runId: "run-1", root, path: target }, context) as Promise<BrowseListing>;

const preview = (roots: Readonly<Record<BrowseRoot, string>>) =>
  (root: BrowseRoot, target: string): Promise<BrowsePreview> =>
    createBrowseMethods(browseOptions(roots))[1]
      .execute({ runId: "run-1", root, path: target }, context) as Promise<BrowsePreview>;

test("das Listing nennt Verzeichnisse zuerst, dann alphabetisch, versteckte Einträge inklusive", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const seen: string[] = [];
    const list = listing({ workspace, files }, (runId) => seen.push(runId));

    const body = await list("workspace", "");
    assert.deepEqual(seen, ["run-1"]);
    assert.deepEqual(body.entries.map((entry) => entry.name), [".git", "src", ".env", "app.bin", "notes.md"]);
    assert.deepEqual(body.entries.map((entry) => entry.kind),
      ["directory", "directory", "file", "file", "file"]);
    assert.equal(body.truncated, false);
    assert.equal(body.path, "");
    assert.equal(body.root, "workspace");
    assert.equal(body.location, workspace);

    const nested = await list("workspace", "src");
    assert.deepEqual(nested.entries.map((entry) => entry.name), ["index.ts"]);

    const empty = await list("files", "");
    assert.deepEqual(empty.entries, []);
  } finally {
    await remove();
  }
});

test("ein Ausbruch aus der Wurzel und ein fehlendes Verzeichnis werden abgelehnt", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const list = listing({ workspace, files });

    await assert.rejects(list("workspace", "../geheim.txt"), (error: unknown) =>
      error instanceof DomainError && error.code === "browse-path-invalid" && error.message === "Ungültiger Pfad");
    await assert.rejects(list("workspace", "nirgends"), (error: unknown) =>
      error instanceof DomainError && error.code === "browse-not-found" && error.message === "Nicht gefunden: nirgends");
    assert.ok(!Value.Check(workspaceContracts.browse.list.input, { runId: "run-1", root: "global", path: "" }));
  } finally {
    await remove();
  }
});

test("die Vorschau liefert Text und verweigert Binärdateien", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const file = preview({ workspace, files });

    assert.deepEqual(await file("workspace", "notes.md"), {
      root: "workspace",
      path: "notes.md",
      size: Buffer.byteLength("Grüße aus dem Lauf\n"),
      previewable: true,
      content: "Grüße aus dem Lauf\n",
    });

    const binary = await file("workspace", "app.bin");
    assert.equal(binary.previewable, false);
    assert.equal(binary.previewable === false ? binary.reason : undefined, "Die Datei ist binär");

    await assert.rejects(file("workspace", "src"), (error: unknown) =>
      error instanceof DomainError && error.message === "Keine Datei: src");
  } finally {
    await remove();
  }
});

test("der Kanal meldet Änderungen unterhalb der beobachteten Wurzel", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const messages: unknown[] = [];
    const channel = createBrowseChannel(browseOptions({ workspace, files }));
    const stop = await channel.open({ runId: "run-1", root: "workspace" }, (message) => messages.push(message), { access: context.access, connection: context.connection });
    await writeFile(path.join(workspace, "src", "neu.ts"), "export const y = 2;\n");
    const started = Date.now();
    while (messages.length === 0 && Date.now() - started < 3000) await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    assert.deepEqual(messages, [{ changed: true }]);
  } finally {
    await remove();
  }
});

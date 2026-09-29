import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import { DomainError } from "@ragents/engine";
import { WorkspaceOperationExecutor, fileModule, workspaceProcessContext } from "@ragents/workspace-executor";

import { workspaceContracts, type BrowseListing, type BrowsePreview, type BrowseRoot } from "../../../plugins/ragents.workspace/contract.ts";
import { createBrowseChannel, createBrowseMethods, type BrowseOptions } from "../../../plugins/ragents.workspace/server/browse-route.ts";
import { withDomainCause } from "../src/plugin-support/workspace-sandbox-host.ts";
import { methodContext } from "./rpc-fixture.ts";

const context = methodContext();

const fixture = async (): Promise<{ workspace: string; files: string; remove: () => Promise<void> }> => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-browse-")));
  const workspace = path.join(directory, "workspace");
  const files = path.join(directory, "files");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, ".git"), { recursive: true });
  await mkdir(files, { recursive: true });
  await writeFile(path.join(workspace, "notes.md"), "Greetings from the run\n");
  await writeFile(path.join(workspace, ".env"), "TOKEN=1\n");
  await writeFile(path.join(workspace, "app.bin"), Buffer.from([0x50, 0x00, 0x4b]));
  await writeFile(path.join(workspace, "src", "index.ts"), "export const x = 1;\n");
  await writeFile(path.join(directory, "secret.txt"), "not for the browser\n");
  return { workspace, files, remove: () => rm(directory, { recursive: true, force: true }) };
};

/** The workspace comes through an executor with the file module, the file store directly from the server. */
const browseOptions = (roots: Readonly<Record<BrowseRoot, string>>, ensureSession: (runId: string) => void = () => {}): BrowseOptions => {
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId, cwd: roots.workspace, root: roots.workspace, home: { home: roots.workspace }, logDirectory: roots.workspace, hostRoot: undefined,
    }),
    modules: [fileModule],
  });
  return {
    ensureSession,
    ensureWorkspaceAccess: (_access, runId) => ensureSession(runId),
    execute: async (runId, operation, input, options) => {
      try {
        return await executor.execute(runId, operation, input, options);
      } catch (error) {
        throw withDomainCause(error);
      }
    },
    documentsFor: () => Promise.resolve(roots.files),
    locationOf: (_runId, location) => `Workstation Laptop: ${location}`,
  };
};

const listing = (roots: Readonly<Record<BrowseRoot, string>>, ensureSession?: (runId: string) => void) =>
  (root: BrowseRoot, target: string): Promise<BrowseListing> =>
    createBrowseMethods(browseOptions(roots, ensureSession))[0]
      .execute({ runId: "run-1", root, path: target }, context) as Promise<BrowseListing>;

const preview = (roots: Readonly<Record<BrowseRoot, string>>) =>
  (root: BrowseRoot, target: string): Promise<BrowsePreview> =>
    createBrowseMethods(browseOptions(roots))[1]
      .execute({ runId: "run-1", root, path: target }, context) as Promise<BrowsePreview>;

test("the listing names directories first, then alphabetically, hidden entries included", async () => {
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
    assert.equal(body.location, `Workstation Laptop: ${workspace}`);

    const nested = await list("workspace", "src");
    assert.deepEqual(nested.entries.map((entry) => entry.name), ["index.ts"]);

    const empty = await list("files", "");
    assert.deepEqual(empty.entries, []);
    assert.equal(empty.location, files);
  } finally {
    await remove();
  }
});

test("an escape from the root and a missing directory are rejected", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const list = listing({ workspace, files });

    for (const root of ["workspace", "files"] as const) {
      await assert.rejects(list(root, "../secret.txt"), (error: unknown) =>
        error instanceof DomainError && error.code === "workspace-path-invalid" && error.status === 400
        && error.message === "Invalid path: ../secret.txt");
    }
    await assert.rejects(list("workspace", "nowhere"), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-path-not-found" && error.status === 404
      && error.message === "Not found: nowhere");
    assert.ok(!Value.Check(workspaceContracts.browse.list.input, { runId: "run-1", root: "global", path: "" }));
  } finally {
    await remove();
  }
});

test("the preview returns text and refuses binary files", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    const file = preview({ workspace, files });

    assert.deepEqual(await file("workspace", "notes.md"), {
      root: "workspace",
      path: "notes.md",
      size: Buffer.byteLength("Greetings from the run\n"),
      previewable: true,
      content: "Greetings from the run\n",
    });

    const binary = await file("workspace", "app.bin");
    assert.equal(binary.previewable, false);
    assert.equal(binary.previewable === false ? binary.reason : undefined, "The file is binary");

    await assert.rejects(file("workspace", "src"), (error: unknown) =>
      error instanceof DomainError && error.message === "Not a file: src");
  } finally {
    await remove();
  }
});

test("the channel reports changes below the observed root, in the workspace as in the file store", async () => {
  const { workspace, files, remove } = await fixture();
  try {
    for (const [root, directory] of [["workspace", path.join(workspace, "src")], ["files", files]] as const) {
      const messages: unknown[] = [];
      const channel = createBrowseChannel(browseOptions({ workspace, files }));
      const stop = await channel.open({ runId: "run-1", root }, (message) => messages.push(message), { access: context.access, connection: context.connection });
      await writeFile(path.join(directory, "new.ts"), "export const y = 2;\n");
      const started = Date.now();
      while (messages.length === 0 && Date.now() - started < 3000) await new Promise((resolve) => setTimeout(resolve, 20));
      stop();
      assert.deepEqual(messages, [{ changed: true }], root);
    }
  } finally {
    await remove();
  }
});

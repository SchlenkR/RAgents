import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { RunDocumentStore } from "../../../plugins/ragents.documents/server/store.ts";

const fixture = async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-documents-store-")));
  const sessionDirectory = (runId: string) => path.join(root, "sessions", runId, "plugins", "ragents.documents", "documents");
  const sessionsDirectoryPattern = path.join(root, "sessions", "{runId}", "plugins", "ragents.documents", "documents");
  return { root, sessionDirectory, sessionsDirectoryPattern, remove: () => rm(root, { recursive: true, force: true }) };
};

test("documents live in the session storage of the run by default", async () => {
  const { sessionDirectory, sessionsDirectoryPattern, remove } = await fixture();
  try {
    const store = new RunDocumentStore({ sessionDirectory, sessionsDirectoryPattern, externalRoot: undefined });
    const directory = await store.directoryFor("run-1");
    assert.equal(directory, sessionDirectory("run-1"));
    assert.ok((await stat(directory)).isDirectory());
    assert.deepEqual(store.describe(), { directoryPattern: sessionsDirectoryPattern });
  } finally {
    await remove();
  }
});

test("an external root keeps one subdirectory per run", async () => {
  const { root, sessionDirectory, sessionsDirectoryPattern, remove } = await fixture();
  try {
    const externalRoot = path.join(root, "external");
    const store = new RunDocumentStore({ sessionDirectory, sessionsDirectoryPattern, externalRoot });
    assert.equal(await store.directoryFor("run-1"), path.join(externalRoot, "run-1"));
    assert.equal(await store.directoryFor("run-2"), path.join(externalRoot, "run-2"));
    assert.ok((await stat(path.join(externalRoot, "run-2"))).isDirectory());
    assert.deepEqual(store.describe(), { directoryPattern: path.join(externalRoot, "{runId}") });
    await assert.rejects(store.directoryFor("../escape"), /Ungültige Run-ID/);
  } finally {
    await remove();
  }
});

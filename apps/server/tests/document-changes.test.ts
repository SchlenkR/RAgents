import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAccessContext, DomainError } from "@ragents/engine";
import { documentsContracts } from "../../../plugins/ragents.documents/contract.ts";
import { createFilesChannel } from "../../../plugins/ragents.documents/server/files-route.ts";

test("document changes need only read access, send initial state and stop with their subscription", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-document-changes-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "reports"));
  const seen: unknown[] = [];
  const checked: string[] = [];
  const channel = createFilesChannel({ filesFor: async () => directory, ensureSession: (runId) => { checked.push(runId); } });
  const stop = await channel.open({ runId: "run-1" }, (message) => seen.push(message), {
    access: createAccessContext({ enabled: true, user: { id: "reader", label: "Reader", rights: ["runs.read"] } }),
    connection: { id: "connection-1" },
  });
  context.after(stop);
  assert.deepEqual(documentsContracts.changed.rights, ["runs.read"]);
  assert.deepEqual(checked, ["run-1"]);
  assert.deepEqual(seen, [{ changed: true }]);
  await writeFile(path.join(directory, "reports", "report.md"), "# Report");
  const deadline = Date.now() + 3000;
  while (seen.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seen.length, 2, "nested file changes reach the subscriber");
  stop();
  await writeFile(path.join(directory, "reports", "report.md"), "# Revised report");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(seen.length, 2, "a closed subscription holds no watcher");
});

test("a document watch applies the run guard before opening its directory", async () => {
  const channel = createFilesChannel({
    filesFor: async () => { throw new Error("The rejected run must not open its directory"); },
    ensureSession: () => { throw new DomainError("run-not-found", "Run not found", 404); },
  });
  await assert.rejects(channel.open({ runId: "missing" }, () => {}, {
    access: createAccessContext({ enabled: false, user: null }), connection: { id: "connection-1" },
  }), (cause: unknown) => cause instanceof DomainError && cause.code === "run-not-found");
});

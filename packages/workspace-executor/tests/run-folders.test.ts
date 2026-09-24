import assert from "node:assert/strict";
import { mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RUN_FOLDER_OPERATIONS,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  workspaceExecutorModules,
} from "../src/index.ts";

const executorWith = (runFolder?: (runId: string) => string): WorkspaceOperationExecutor => new WorkspaceOperationExecutor({
  contextFor: () => Promise.reject(new Error("Der Ordner je Run braucht keinen Kontext")),
  modules: workspaceExecutorModules(runFolder ? { runFolder } : {}),
});

test("a workplace creates the new folder of a run once, keeps what is in it and removes only that folder", async () => {
  const runs = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-run-folders-")));
  const executor = executorWith((runId) => path.join(runs, runId));
  try {
    assert.deepEqual(await executor.execute("run-1", RUN_FOLDER_OPERATIONS.create, null), { created: true });
    await writeFile(path.join(runs, "run-1", "notiz.md"), "bleibt");
    assert.deepEqual(await executor.execute("run-1", RUN_FOLDER_OPERATIONS.create, null), { created: false });
    assert.deepEqual(await readdir(path.join(runs, "run-1")), ["notiz.md"]);
    await executor.execute("run-2", RUN_FOLDER_OPERATIONS.create, null);
    assert.deepEqual(await executor.execute("run-1", RUN_FOLDER_OPERATIONS.remove, null), { removed: true });
    assert.deepEqual(await readdir(runs), ["run-2"]);
    assert.deepEqual(await executor.execute("run-1", RUN_FOLDER_OPERATIONS.remove, null), { removed: true }, "ein fehlender Ordner ist schon weg");
  } finally {
    await executor.shutdown();
    await rm(runs, { recursive: true, force: true });
  }
});

test("an executor without a folder for runs, the one of the server, creates and removes none", async () => {
  const executor = executorWith();
  const refused = (error: unknown): boolean =>
    error instanceof WorkspaceOperationError && error.code === "run-folder-unavailable" && error.status === 409;
  await assert.rejects(executor.execute("run-1", RUN_FOLDER_OPERATIONS.create, null), refused);
  await assert.rejects(executor.execute("run-1", RUN_FOLDER_OPERATIONS.remove, null), refused);
  assert.equal(await stat(path.join(process.cwd(), "run-1")).catch(() => undefined), undefined);
  await executor.shutdown();
});

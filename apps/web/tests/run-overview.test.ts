import assert from "node:assert/strict";
import test from "node:test";
import { connectionRunOf, runActivityNotice } from "../src/run-overview";
import { viewedReporter } from "../src/run-panel/viewed-runs";
import type { ListedSession } from "../src/api";

const run = (id: string, updatedAt: number, revision?: number, seenRevision?: number): ListedSession => ({
  id, title: id, updatedAt, running: false, state: "idle", pendingActions: 0, workspaceAccessible: true,
  ...(revision === undefined ? {} : { revision }), ...(seenRevision === undefined ? {} : { seenRevision }),
});

test("unread notices compare the journal revision with the caller's own read marker rather than activity timestamps", () => {
  assert.equal(runActivityNotice(run("a", 999, 4)), "unseen");
  assert.equal(runActivityNotice(run("a", 999, 4, 3)), "updated");
  assert.equal(runActivityNotice(run("a", 999, 4, 4)), undefined);
  assert.equal(runActivityNotice(run("a", 999, 4, 5)), undefined);
  assert.equal(runActivityNotice(run("a", 999)), undefined);
  assert.equal(runActivityNotice(run("a", 1000, 0, 0)), undefined);
});

test("a listed run carries metadata and becomes the same row in every host", () => {
  assert.deepEqual(connectionRunOf({
    ...run("a", 5, 4, 2), state: "waiting", pendingActions: 2, ownerLabel: "Alice",
    listDetails: [{ label: "Workspace", text: "/home/user/project", icon: "folder" }], metadata: { "ragents.workspace": {} },
  }), {
    id: "a", title: "a", state: "waiting", pendingActions: 2, updatedAt: 5, notice: "updated", owner: "Alice",
    metadata: { "ragents.workspace": {} },
    details: [{ label: "Workspace", text: "/home/user/project", icon: "folder" }],
  });
  assert.deepEqual(connectionRunOf({ ...run("b", 6, 3, 3), listDetails: [] }), { id: "b", title: "b", state: "idle", pendingActions: 0, updatedAt: 6 });
  assert.deepEqual(connectionRunOf({ ...run("c", 7), locked: "unsupported journal format 6" }), {
    id: "c", title: "c", state: "idle", pendingActions: 0, updatedAt: 7, locked: "unsupported journal format 6",
  });
});

test("run metadata keeps each contribution's values, including empty and missing metadata", () => {
  const metadata = { "test.documents": [{ title: "Project brief", path: "brief.md" }], "test.review": { complete: true } };
  assert.equal(connectionRunOf({ ...run("documents", 1), metadata }).metadata, metadata);
  assert.deepEqual(connectionRunOf({ ...run("empty", 2), metadata: {} }).metadata, {});
  assert.equal("metadata" in connectionRunOf(run("missing", 3)), false);
});

test("a row carries the caller's sharing: who may share and whether it is shared, or what a share permits a sharee", () => {
  assert.deepEqual(connectionRunOf({ ...run("own", 1), operable: true, canShare: true, shared: true }), {
    id: "own", title: "own", state: "idle", pendingActions: 0, updatedAt: 1, canShare: true, shared: true,
  });
  assert.deepEqual(connectionRunOf({ ...run("viewed", 2), operable: false, ownerLabel: "Alice", sharedAccess: "read" }), {
    id: "viewed", title: "viewed", state: "idle", pendingActions: 0, updatedAt: 2, owner: "Alice", sharedAccess: "read",
  });
  assert.equal("operable" in connectionRunOf({ ...run("foreign", 3), operable: false }), false, "the row draws nothing from operable; the run panel reads it from the list");
});

test("viewed revisions go out one request per run at a time, the newest one follows, nothing lower or equal twice", async () => {
  const sent: Array<[string, number]> = [];
  const pending: Array<PromiseWithResolvers<void>> = [];
  const errors: unknown[] = [];
  const report = viewedReporter((runId, revision) => {
    sent.push([runId, revision]);
    const next = Promise.withResolvers<void>();
    pending.push(next);
    return next.promise;
  }, (cause) => errors.push(cause));
  const settle = async (index: number, failure?: Error) => {
    if (failure) pending[index]!.reject(failure);
    else pending[index]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  report("a", 3);
  report("a", 4);
  report("a", 5);
  report("a", 2);
  report("b", 1);
  assert.deepEqual(sent, [["a", 3], ["b", 1]], "one request per run, a second run is not held up");
  await settle(0);
  assert.deepEqual(sent, [["a", 3], ["b", 1], ["a", 5]], "only the newest waiting revision follows");
  await settle(2);
  report("a", 5);
  report("a", 4);
  assert.equal(sent.length, 3, "nothing lower or equal goes out again");

  report("a", 6);
  await settle(3, new Error("offline"));
  assert.deepEqual(errors.map((error) => (error as Error).message), ["offline"]);
  report("a", 6);
  assert.deepEqual(sent.at(-1), ["a", 6], "a failed revision may go out again");
  await settle(4);
  await settle(1);
});

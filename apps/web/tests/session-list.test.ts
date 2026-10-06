import assert from "node:assert/strict";
import test from "node:test";
import type { ListedSession } from "../src/api";
import { shareSessionList } from "../src/run-panel/use-session-list";

const run = (id: string): ListedSession => ({
  id,
  title: id,
  createdAt: 1000,
  updatedAt: 2000,
  revision: 7,
  running: false,
  state: "idle",
  pendingActions: 0,
  workspaceAccessible: true,
  operable: true,
  ownerLabel: "Alice",
  seenRevision: 6,
  metadata: {
    "test.workspace": { root: "/home/user/project", paths: ["notes.md", "board.md"] },
    "test.review": { complete: false, count: 2 },
  },
  metadataUnavailable: { "test.offline": "Not connected" },
  listDetails: [{ label: "Workspace", text: "/home/user/project", icon: "folder" }],
});

test("an unchanged poll retains the array and entries even when metadata keys are reordered", () => {
  const previous = [run("alpha"), run("beta")];
  const next = previous.map((session) => ({
    ...structuredClone(session),
    metadata: {
      "test.review": { count: 2, complete: false },
      "test.workspace": { paths: ["notes.md", "board.md"], root: "/home/user/project" },
    },
  }));

  const shared = shareSessionList(previous, next);

  assert.equal(shared, previous);
  assert.equal(shared[0], previous[0]);
  assert.equal(shared[1], previous[1]);
});

test("a changed run replaces its entry while other runs retain their identities", () => {
  const previous = [run("alpha"), run("beta"), run("gamma")];
  const next = structuredClone(previous);
  const changed = { ...next[1]!, title: "Updated title" };

  const shared = shareSessionList(previous, [next[0]!, changed, next[2]!]);

  assert.notEqual(shared, previous);
  assert.equal(shared[0], previous[0]);
  assert.equal(shared[1], changed);
  assert.equal(shared[2], previous[2]);
  assert.equal(previous[1]!.title, "beta");
});

test("a changed revision replaces the session even when the other fields are unchanged", () => {
  const previous = [run("alpha")];
  const changed = { ...structuredClone(previous[0]!), revision: 8 };

  const shared = shareSessionList(previous, [changed]);

  assert.notEqual(shared, previous);
  assert.equal(shared[0], changed);
});

const changes: ReadonlyArray<readonly [string, Partial<ListedSession>]> = [
  ["metadata", { metadata: { "test.workspace": { root: "/home/user/project", paths: ["notes.md", "board.md"] }, "test.review": { complete: true, count: 2 } } }],
  ["metadata array order", { metadata: { "test.workspace": { root: "/home/user/project", paths: ["board.md", "notes.md"] }, "test.review": { complete: false, count: 2 } } }],
  ["metadata availability", { metadataUnavailable: { "test.offline": "Access denied" } }],
  ["list details", { listDetails: [{ label: "Workspace", text: "/home/user/other", icon: "folder" }] }],
  ["workspace access", { workspaceAccessible: false }],
  ["operation access", { operable: false }],
  ["sharing permission", { canShare: true }],
  ["sharing state", { canShare: true, shared: true }],
  ["shared access", { sharedAccess: "write" }],
  ["viewed revision", { seenRevision: 7 }],
];

for (const [field, change] of changes) {
  test(`changes to ${field} replace the session at the same run revision`, () => {
    const previous = [run("alpha"), run("beta")];
    const changed = { ...structuredClone(previous[0]!), ...change };

    const shared = shareSessionList(previous, [changed, structuredClone(previous[1]!)]);

    assert.equal(changed.revision, previous[0]!.revision);
    assert.notEqual(shared, previous);
    assert.equal(shared[0], changed);
    assert.equal(shared[1], previous[1]);
  });
}

test("inserting a run preserves the existing entries and creates a new array", () => {
  const previous = [run("alpha"), run("gamma")];
  const inserted = run("beta");

  const shared = shareSessionList(previous, [structuredClone(previous[0]!), inserted, structuredClone(previous[1]!)]);

  assert.notEqual(shared, previous);
  assert.deepEqual(shared.map((session) => session.id), ["alpha", "beta", "gamma"]);
  assert.equal(shared[0], previous[0]);
  assert.equal(shared[1], inserted);
  assert.equal(shared[2], previous[1]);
});

test("removing a run preserves the remaining entries and creates a new array", () => {
  const previous = [run("alpha"), run("beta"), run("gamma")];

  const shared = shareSessionList(previous, [structuredClone(previous[0]!), structuredClone(previous[2]!)]);

  assert.notEqual(shared, previous);
  assert.deepEqual(shared.map((session) => session.id), ["alpha", "gamma"]);
  assert.equal(shared[0], previous[0]);
  assert.equal(shared[1], previous[2]);
});

test("reordering runs preserves entries by ID and creates a new array", () => {
  const previous = [run("alpha"), run("beta")];

  const shared = shareSessionList(previous, [structuredClone(previous[1]!), structuredClone(previous[0]!)]);

  assert.notEqual(shared, previous);
  assert.deepEqual(shared.map((session) => session.id), ["beta", "alpha"]);
  assert.equal(shared[0], previous[1]);
  assert.equal(shared[1], previous[0]);
});

test("unchanged empty polls retain the previous empty array", () => {
  const previous: ListedSession[] = [];

  assert.equal(shareSessionList(previous, []), previous);
});

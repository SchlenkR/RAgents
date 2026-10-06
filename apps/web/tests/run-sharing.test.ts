import assert from "node:assert/strict";
import test from "node:test";
import type { PanelSharing } from "../src/panel/contract";
import {
  listedUsers, openSharing, readOnlyReason, saveSharing, sharedWithYouLabel, sharingChanged, sharingOf, withEveryone, withoutUser, withUser,
  type RunSharing, type RunSharingResult, type SharingClient, type SharingStore,
} from "../src/run-sharing";

const result = (sharing: RunSharingResult["sharing"] = { everyone: null, users: [{ userId: "bob", label: "Bob", access: "read" }] }): RunSharingResult => ({
  sharing,
  users: [{ id: "bob", label: "Bob" }, { id: "carol", label: "Carol" }, { id: "dave", label: "Dave" }],
});

const memoryStore = (initial?: PanelSharing): SharingStore & { history: Array<PanelSharing | undefined> } => {
  const history: Array<PanelSharing | undefined> = [];
  let current = initial;
  return { history, get: () => current, set: (next) => { current = next; history.push(next); } };
};

test("the panel edits a copy without labels: everyone, access per user, new users at the end, removal", () => {
  const start = sharingOf(result());
  assert.deepEqual(start, { everyone: null, users: [{ userId: "bob", access: "read" }] });
  const edited = withUser(withUser(withEveryone(start, "read"), "carol", "read"), "bob", "write");
  assert.deepEqual(edited, { everyone: "read", users: [{ userId: "bob", access: "write" }, { userId: "carol", access: "read" }] });
  assert.deepEqual(withoutUser(edited, "bob"), { everyone: "read", users: [{ userId: "carol", access: "read" }] });
  assert.deepEqual(start, { everyone: null, users: [{ userId: "bob", access: "read" }] }, "editing never changes the previous value");
});

test("sharing changes ignore the order of users", () => {
  const loaded = result({ everyone: "read", users: [{ userId: "bob", label: "Bob", access: "read" }, { userId: "carol", label: "Carol", access: "write" }] });
  assert.equal(sharingChanged(loaded, sharingOf(loaded)), false);
  assert.equal(sharingChanged(loaded, { everyone: "read", users: [{ userId: "carol", access: "write" }, { userId: "bob", access: "read" }] }), false);
  assert.equal(sharingChanged(loaded, withEveryone(sharingOf(loaded), null)), true);
  assert.equal(sharingChanged(loaded, withoutUser(withUser(sharingOf(loaded), "dave", "read"), "dave")), false, "adding and removing again is no change");
});

test("the list names every candidate, then shared users the profile no longer offers", () => {
  const listed = listedUsers(result({ everyone: null, users: [{ userId: "bob", label: "Bob", access: "read" }, { userId: "erin", label: "Erin", access: "write" }] }));
  assert.deepEqual(listed, [{ id: "bob", label: "Bob" }, { id: "carol", label: "Carol" }, { id: "dave", label: "Dave" }, { id: "erin", label: "Erin" }]);
});

test("sharees read what the share permits, and the composer names why it is disabled", () => {
  assert.equal(sharedWithYouLabel("read"), "Shared with you - view only");
  assert.equal(sharedWithYouLabel("write"), "Shared with you - can operate");
  assert.equal(readOnlyReason({ id: "run", title: "Run", updatedAt: 0, operable: false, sharedAccess: "read" }), "Shared with you for viewing only");
  assert.equal(readOnlyReason({ id: "run", title: "Run", updatedAt: 0, operable: false, sharedAccess: "write" }), "Only its owner operates this run");
  assert.equal(readOnlyReason({ id: "run", title: "Run", updatedAt: 0, operable: false }), "Only its owner operates this run");
  assert.equal(readOnlyReason({ id: "run", title: "Run", updatedAt: 0 }), "Read access to this run");
});

test("opening loads into the panel; a refusal stays in it, an answer for a panel closed meanwhile is dropped", async () => {
  const loaded = result();
  const store = memoryStore();
  await openSharing("workshop", "run-a", { load: async () => loaded, save: async () => loaded }, store);
  assert.deepEqual(store.history, [{ connection: "workshop", runId: "run-a", pending: true }, { connection: "workshop", runId: "run-a", result: loaded }]);

  const refused = memoryStore();
  await openSharing("workshop", "run-a", { load: async () => { throw new Error("Only the owner of run run-a changes whom it is shared with."); }, save: async () => loaded }, refused);
  assert.deepEqual(refused.get(), { connection: "workshop", runId: "run-a", error: "Only the owner of run run-a changes whom it is shared with." });

  const late = Promise.withResolvers<RunSharingResult>();
  const closed = memoryStore();
  const opening = openSharing("workshop", "run-a", { load: () => late.promise, save: async () => loaded }, closed);
  closed.set(undefined);
  late.resolve(loaded);
  await opening;
  assert.equal(closed.get(), undefined, "a closed panel does not reopen");
});

test("saving keeps the server state while pending, displays the returned state, and restores it on refusal", async () => {
  const loaded = result();
  const choice: RunSharing = { everyone: "write", users: [] };
  const returned = result({ everyone: "read", users: [{ userId: "carol", label: "Carol", access: "write" }] });
  const saved: Array<[string, RunSharing]> = [];
  const client: SharingClient = { load: async () => loaded, save: async (runId, sharing) => { saved.push([runId, sharing]); return returned; } };
  const open = memoryStore({ connection: "workshop", runId: "run-a", result: loaded, error: "earlier refusal" });
  await saveSharing("workshop", "run-a", choice, client, open);
  assert.deepEqual(saved, [["run-a", choice]]);
  assert.deepEqual(open.history, [
    { connection: "workshop", runId: "run-a", result: loaded, pending: true },
    { connection: "workshop", runId: "run-a", result: returned },
  ], "pending drops the earlier refusal, success keeps the actual server response open");

  const refused = memoryStore(open.get());
  await saveSharing("workshop", "run-a", choice, { load: client.load, save: async () => { throw new Error("carol is not a user of this profile"); } }, refused);
  assert.deepEqual(refused.get(), { connection: "workshop", runId: "run-a", result: returned, error: "carol is not a user of this profile" });
});

test("another access change waits for the pending save, and unchanged sharing sends nothing", async () => {
  const loaded = result();
  const store = memoryStore({ connection: "workshop", runId: "run-a", result: loaded });
  const reply = Promise.withResolvers<RunSharingResult>();
  const calls: RunSharing[] = [];
  const client: SharingClient = { load: async () => loaded, save: async (_runId, sharing) => { calls.push(sharing); return reply.promise; } };
  await saveSharing("workshop", "run-a", sharingOf(loaded), client, store);
  assert.deepEqual(calls, []);
  const next = withEveryone(sharingOf(loaded), "read");
  const saving = saveSharing("workshop", "run-a", next, client, store);
  assert.equal(store.get()?.pending, true);
  await saveSharing("workshop", "run-a", withEveryone(sharingOf(loaded), "write"), client, store);
  assert.deepEqual(calls, [next], "a second request cannot overwrite the pending save");
  const saved = result({ everyone: "read", users: loaded.sharing.users });
  reply.resolve(saved);
  await saving;
  assert.deepEqual(store.get(), { connection: "workshop", runId: "run-a", result: saved });
});

test("late loads and saves leave a closed or reopened panel alone", async () => {
  const loaded = result();
  for (const operation of ["load", "save"] as const) {
    for (const refused of [false, true]) {
      const reply = Promise.withResolvers<RunSharingResult>();
      const store = memoryStore({ connection: "workshop", runId: "run-a", result: loaded });
      const client: SharingClient = { load: () => reply.promise, save: () => reply.promise };
      const pending = operation === "load"
        ? openSharing("workshop", "run-a", client, store)
        : saveSharing("workshop", "run-a", withEveryone(sharingOf(loaded), "write"), client, store);
      store.set(undefined);
      const reopened = { connection: "workshop", runId: "run-a", result: result({ everyone: "read", users: [] }) };
      store.set(reopened);
      if (refused) reply.reject(new Error("late refusal"));
      else reply.resolve(loaded);
      await pending;
      assert.equal(store.get(), reopened, `${operation} completion cannot replace the reopened panel`);
    }
  }
  const reply = Promise.withResolvers<RunSharingResult>();
  const closed = memoryStore({ connection: "workshop", runId: "run-a", result: loaded });
  const saving = saveSharing("workshop", "run-a", withEveryone(sharingOf(loaded), "write"), { load: async () => loaded, save: () => reply.promise }, closed);
  closed.set(undefined);
  reply.resolve(result({ everyone: "write", users: [] }));
  await saving;
  assert.equal(closed.get(), undefined, "saving does not reopen a dismissed panel");
});

test("saving without an open panel of the run hands a refusal to the caller and leaves another panel alone", async () => {
  const loaded = result();
  const other: PanelSharing = { connection: "workshop", runId: "run-b", result: loaded };
  const store = memoryStore(other);
  await assert.rejects(saveSharing("workshop", "run-a", { everyone: null, users: [] }, { load: async () => loaded, save: async () => { throw new Error("refused"); } }, store), /refused/);
  assert.equal(store.get(), other);
  await saveSharing("workshop", "run-a", { everyone: null, users: [] }, { load: async () => loaded, save: async () => loaded }, store);
  assert.equal(store.get(), other);
});

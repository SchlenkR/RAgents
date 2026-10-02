import assert from "node:assert/strict";
import test from "node:test";
import type { PanelSharing } from "../src/panel/contract";
import {
  addableUsers, openSharing, readOnlyReason, saveSharing, sharedUserLabel, sharedWithYouLabel, sharingChanged, sharingOf, withEveryone, withoutUser, withUser,
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

test("the dialog edits a copy without labels: everyone, access per user, new users at the end, removal", () => {
  const start = sharingOf(result());
  assert.deepEqual(start, { everyone: null, users: [{ userId: "bob", access: "read" }] });
  const edited = withUser(withUser(withEveryone(start, "read"), "carol", "read"), "bob", "write");
  assert.deepEqual(edited, { everyone: "read", users: [{ userId: "bob", access: "write" }, { userId: "carol", access: "read" }] });
  assert.deepEqual(withoutUser(edited, "bob"), { everyone: "read", users: [{ userId: "carol", access: "read" }] });
  assert.deepEqual(start, { everyone: null, users: [{ userId: "bob", access: "read" }] }, "editing never changes the previous value");
});

test("Save counts only a real change, in any order of the users", () => {
  const loaded = result({ everyone: "read", users: [{ userId: "bob", label: "Bob", access: "read" }, { userId: "carol", label: "Carol", access: "write" }] });
  assert.equal(sharingChanged(loaded, sharingOf(loaded)), false);
  assert.equal(sharingChanged(loaded, { everyone: "read", users: [{ userId: "carol", access: "write" }, { userId: "bob", access: "read" }] }), false);
  assert.equal(sharingChanged(loaded, withEveryone(sharingOf(loaded), null)), true);
  assert.equal(sharingChanged(loaded, withoutUser(withUser(sharingOf(loaded), "dave", "read"), "dave")), false, "adding and removing again is no change");
});

test("the picker offers only users not named yet; labels come from the server, then from the candidates, else the id", () => {
  const loaded = result();
  const draft: RunSharing = withUser(sharingOf(loaded), "carol", "read");
  assert.deepEqual(addableUsers(loaded, draft).map((user) => user.id), ["dave"]);
  assert.equal(sharedUserLabel(loaded, "bob"), "Bob");
  assert.equal(sharedUserLabel(loaded, "carol"), "Carol");
  assert.equal(sharedUserLabel(result({ everyone: null, users: [{ userId: "erin", label: "erin", access: "read" }] }), "frank"), "frank");
});

test("sharees read what the share permits, and the composer names why it is disabled", () => {
  assert.equal(sharedWithYouLabel("read"), "Shared with you - view only");
  assert.equal(sharedWithYouLabel("write"), "Shared with you - can operate");
  assert.equal(readOnlyReason({ id: "run", title: "Run", updatedAt: 0, operable: false, sharedAccess: "read" }), "Shared with you for viewing only");
  assert.equal(readOnlyReason({ id: "run", title: "Run", updatedAt: 0, operable: false, sharedAccess: "write" }), "Only its owner operates this run");
  assert.equal(readOnlyReason({ id: "run", title: "Run", updatedAt: 0, operable: false }), "Only its owner operates this run");
  assert.equal(readOnlyReason({ id: "run", title: "Run", updatedAt: 0 }), "Read access to this run");
});

test("opening loads into the dialog; a refusal stays in it, an answer for a dialog closed meanwhile is dropped", async () => {
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
  assert.equal(closed.get(), undefined, "a closed dialog does not reopen");
});

test("saving keeps the loaded sharing while pending, closes on success, and shows a refusal next to the draft", async () => {
  const loaded = result();
  const choice: RunSharing = { everyone: "write", users: [] };
  const saved: Array<[string, RunSharing]> = [];
  const client: SharingClient = { load: async () => loaded, save: async (runId, sharing) => { saved.push([runId, sharing]); return loaded; } };
  const open = memoryStore({ connection: "workshop", runId: "run-a", result: loaded, error: "earlier refusal" });
  await saveSharing("workshop", "run-a", choice, client, open);
  assert.deepEqual(saved, [["run-a", choice]]);
  assert.deepEqual(open.history, [{ connection: "workshop", runId: "run-a", result: loaded, pending: true }, undefined], "pending drops the earlier refusal, success closes");

  const refused = memoryStore({ connection: "workshop", runId: "run-a", result: loaded });
  await saveSharing("workshop", "run-a", choice, { load: client.load, save: async () => { throw new Error("carol is not a user of this profile"); } }, refused);
  assert.deepEqual(refused.get(), { connection: "workshop", runId: "run-a", result: loaded, error: "carol is not a user of this profile" });
});

test("saving without an open dialog of the run hands a refusal to the caller and leaves another dialog alone", async () => {
  const loaded = result();
  const other: PanelSharing = { connection: "workshop", runId: "run-b", result: loaded };
  const store = memoryStore(other);
  await assert.rejects(saveSharing("workshop", "run-a", { everyone: null, users: [] }, { load: async () => loaded, save: async () => { throw new Error("refused"); } }, store), /refused/);
  assert.equal(store.get(), other);
  await saveSharing("workshop", "run-a", { everyone: null, users: [] }, { load: async () => loaded, save: async () => loaded }, store);
  assert.equal(store.get(), other);
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { journalEventOf } from "../src/domain/event-validation.ts";
import type { JournalEvent } from "../src/domain/events.ts";
import { isShared, notShared, sameSharing, sharedAccessOf, type RunSharing } from "../src/domain/model.ts";
import { project } from "../src/domain/projection.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { manualExecution, testServices } from "./support.ts";

const runtimeOf = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    return { journal, runtime: new Orchestration(journal, services) };
};

const owned = (runtime: Orchestration, sharing?: RunSharing) => runtime.createRun(
    { commandId: "create-owned" },
    { runId: "owned-run", title: "Owned", ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice", ...sharing ? { sharing } : {} },
);

const sharingEvents = (runtime: Orchestration, runId: string) =>
    runtime.events(runId).filter((event): event is Extract<JournalEvent, { type: "run.sharing-changed" }> => event.type === "run.sharing-changed");

test("the access of a user is the higher of everyone's and their own", () => {
    const sharing: RunSharing = { everyone: "read", users: [{ userId: "bob", access: "write" }, { userId: "carol", access: "read" }] };
    assert.equal(sharedAccessOf(sharing, "bob"), "write");
    assert.equal(sharedAccessOf(sharing, "carol"), "read");
    assert.equal(sharedAccessOf(sharing, "dave"), "read", "everyone reads");
    assert.equal(sharedAccessOf({ everyone: "write", users: [{ userId: "carol", access: "read" }] }, "carol"), "write", "an individual read does not lower everyone's write");
    assert.equal(sharedAccessOf(notShared(), "bob"), undefined);
    assert.equal(isShared(notShared()), false);
    assert.equal(isShared({ everyone: null, users: [{ userId: "bob", access: "read" }] }), true);
    assert.equal(sameSharing(sharing, { everyone: "read", users: [{ userId: "carol", access: "read" }, { userId: "bob", access: "write" }] }), true);
    assert.equal(sameSharing(sharing, { everyone: "read", users: [{ userId: "bob", access: "read" }, { userId: "carol", access: "read" }] }), false);
});

test("a run starts shared with nobody; the owner's sharing replaces it completely and stays out of the run view", () => {
    const { journal, runtime } = runtimeOf();
    try {
        const view = owned(runtime);
        assert.deepEqual(runtime.state(view.id).sharing, notShared());
        assert.equal("sharing" in view, false, "the run view for clients does not name the users");

        runtime.shareRun({ actorId: view.ownerId, commandId: "share-1" }, view.id, {
            sharing: { everyone: "read", users: [{ userId: "carol", access: "write" }, { userId: "bob", access: "read" }] },
            changedBy: "alice",
        });
        assert.deepEqual(runtime.state(view.id).sharing, { everyone: "read", users: [{ userId: "bob", access: "read" }, { userId: "carol", access: "write" }] }, "users stand sorted by id");

        runtime.shareRun({ actorId: view.ownerId, commandId: "share-2" }, view.id, {
            sharing: { everyone: null, users: [{ userId: "carol", access: "read" }] },
            changedBy: "root",
        });
        assert.deepEqual(runtime.state(view.id).sharing, { everyone: null, users: [{ userId: "carol", access: "read" }] }, "a new sharing replaces the old one");
        assert.deepEqual(sharingEvents(runtime, view.id).map((event) => event.payload.changedBy), ["alice", "root"]);
        assert.deepEqual(project(runtime.events(view.id))?.sharing, runtime.state(view.id).sharing, "replay restores the same sharing");
    } finally {
        journal.close();
    }
});

test("an unchanged sharing writes no event, whatever the order of its users", () => {
    const { journal, runtime } = runtimeOf();
    try {
        const view = owned(runtime);
        const sharing: RunSharing = { everyone: null, users: [{ userId: "bob", access: "read" }, { userId: "carol", access: "read" }] };
        runtime.shareRun({ actorId: view.ownerId, commandId: "share-1" }, view.id, { sharing, changedBy: "alice" });
        const revision = runtime.state(view.id).revision;
        runtime.shareRun({ actorId: view.ownerId, commandId: "share-2" }, view.id, { sharing: { everyone: null, users: [...sharing.users].reverse() }, changedBy: "alice" });
        runtime.shareRun({ actorId: view.ownerId, commandId: "share-3" }, view.id, { sharing: notShared(), changedBy: "alice" });
        runtime.shareRun({ actorId: view.ownerId, commandId: "share-4" }, view.id, { sharing: notShared(), changedBy: "alice" });
        assert.equal(runtime.state(view.id).revision, revision + 1, "only the change to nobody wrote an event");
        assert.equal(sharingEvents(runtime, view.id).length, 2);
    } finally {
        journal.close();
    }
});

test("an initial sharing joins the creation record, an empty one writes nothing", () => {
    const { journal, runtime } = runtimeOf();
    try {
        const view = owned(runtime, { everyone: "write", users: [{ userId: "bob", access: "read" }] });
        const events = runtime.events(view.id);
        assert.deepEqual(events.map((event) => event.type), ["run.created", "run.sharing-changed"]);
        assert.equal(events[1]!.commandId, events[0]!.commandId, "one command creates and shares the run");
        assert.deepEqual(sharingEvents(runtime, view.id)[0]!.payload, { everyone: "write", users: [{ userId: "bob", access: "read" }], changedBy: "alice" });

        const empty = runtime.createRun({ commandId: "create-empty" }, { title: "Empty", ownerHandle: "bob", ownerDisplayName: "Bob", ownerUserId: "bob", sharing: notShared() });
        assert.deepEqual(runtime.events(empty.id).map((event) => event.type), ["run.created"]);
    } finally {
        journal.close();
    }
});

test("sharing refuses a run without a signed-in owner, the owner as a user, a user twice and another actor", () => {
    const { journal, runtime } = runtimeOf();
    try {
        assert.throws(() => runtime.createRun({ commandId: "create-open" }, { title: "Open", ownerHandle: "owner", ownerDisplayName: "Owner", sharing: { everyone: "read", users: [] } }),
            { code: "run-not-shareable", status: 409 });
        const open = runtime.createRun({ commandId: "create-open-2" }, { title: "Open", ownerHandle: "owner", ownerDisplayName: "Owner" });
        assert.throws(() => runtime.shareRun({ actorId: open.ownerId, commandId: "share-open" }, open.id, { sharing: { everyone: "read", users: [] }, changedBy: "root" }),
            { code: "run-not-shareable", status: 409 });

        const view = owned(runtime);
        assert.throws(() => runtime.shareRun({ actorId: view.ownerId, commandId: "share-owner" }, view.id, { sharing: { everyone: null, users: [{ userId: "alice", access: "read" }] }, changedBy: "alice" }),
            { code: "share-owner", status: 400 });
        assert.throws(() => runtime.shareRun({ actorId: view.ownerId, commandId: "share-twice" }, view.id, {
            sharing: { everyone: null, users: [{ userId: "bob", access: "read" }, { userId: "bob", access: "write" }] }, changedBy: "alice",
        }), { code: "share-user-duplicate", status: 400 });

        const agent = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
            handle: "helper", displayName: "Helper", prompt: "", execution: manualExecution(), grants: [], toolNames: [],
        }).actors.find((actor) => actor.kind === "agent")!;
        assert.throws(() => runtime.shareRun({ actorId: agent.id, commandId: "share-agent" }, view.id, { sharing: { everyone: "read", users: [] }, changedBy: "alice" }),
            /cannot issue commands|only its owner/);
        assert.deepEqual(runtime.state(view.id).sharing, notShared());
    } finally {
        journal.close();
    }
});

test("the journal check rejects invalid sharing events and keeps a run with valid ones loadable after a restart", () => {
    const base = {
        eventId: "event-2", runId: "owned-run", sequence: 2, schemaVersion: 3, occurredAt: "2026-10-02T10:00:00.000Z",
        actorId: "human-1", commandId: "share", correlationId: null, causationId: null, type: "run.sharing-changed",
    };
    const valid = { everyone: "read", users: [{ userId: "bob", access: "write" }], changedBy: "alice" };
    assert.equal(journalEventOf({ ...base, payload: valid }, "event").type, "run.sharing-changed");
    for (const [payload, message] of [
        [{ ...valid, everyone: "admin" }, /everyone must be read or write/],
        [{ ...valid, users: [{ userId: "bob", access: "owner" }] }, /users\[0\]\.access must be read or write/],
        [{ ...valid, users: [{ userId: "bob", access: "read" }, { userId: "bob", access: "write" }] }, /users must not name a user twice/],
        [{ ...valid, users: [{ userId: "", access: "read" }] }, /users\[0\]\.userId must be a non-empty string/],
        [{ everyone: null, users: [] }, /changedBy is required/],
    ] as const) assert.throws(() => journalEventOf({ ...base, payload }, "event"), message);

    const directory = mkdtempSync(join(tmpdir(), "ragents-run-sharing-"));
    try {
        const first = new Journal(join(directory, "runs"), testServices());
        const runtime = new Orchestration(first, testServices());
        const view = owned(runtime, { everyone: null, users: [{ userId: "bob", access: "read" }] });
        runtime.shareRun({ actorId: view.ownerId, commandId: "share-later" }, view.id, { sharing: { everyone: "write", users: [] }, changedBy: "alice" });
        first.close();

        const second = new Journal(join(directory, "runs"), testServices());
        try {
            assert.deepEqual(second.stateOf(view.id)?.sharing, { everyone: "write", users: [] });
        } finally {
            second.close();
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("the replay refuses a sharing event of another actor or with the owner as a user", () => {
    const { journal, runtime } = runtimeOf();
    try {
        const view = owned(runtime);
        const agent = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
            handle: "helper", displayName: "Helper", prompt: "", execution: manualExecution(), grants: [], toolNames: [],
        }).actors.find((actor) => actor.kind === "agent")!;
        const events = runtime.events(view.id);
        const sharing = (actorId: string, users: RunSharing["users"]): JournalEvent => ({
            ...events.at(-1)!, eventId: "event-sharing", sequence: events.length + 1, commandId: "share", actorId, type: "run.sharing-changed",
            payload: { everyone: null, users, changedBy: "alice" },
        });
        assert.throws(() => project([...events, sharing(agent.id, [])]), /must be authored by run owner/);
        assert.throws(() => project([...events, sharing(view.ownerId, [{ userId: "alice", access: "read" }])]), /cannot be shared with its owner alice/);
        assert.deepEqual(project([...events, sharing(view.ownerId, [{ userId: "bob", access: "read" }])])?.sharing, { everyone: null, users: [{ userId: "bob", access: "read" }] });
    } finally {
        journal.close();
    }
});

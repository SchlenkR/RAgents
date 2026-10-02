import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { actorRosterText } from "../src/agents/delivery.ts";
import { TurnToolset } from "../src/agents/toolset.ts";
import { claimTurn } from "../src/agents/turn.ts";
import { actorByReference, addressFrom, addressOf, freeRoomName } from "../src/domain/actor-reference.ts";
import { Journal, type CommandRecord } from "../src/runtime/journal.ts";
import { serializeJournalRecord } from "../src/runtime/journal-storage.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { actorHandleOf } from "../src/runtime/guards.ts";
import { allGrants, catalog, manualExecution, postTo, testServices } from "./support.ts";

const actors = [
    { id: "owner", handle: "owner", room: null },
    { id: "coordinator", handle: "coordinator", room: null },
    { id: "legacy", handle: "team.lead", room: null },
    { id: "first", handle: "rule-review", room: "review" },
    { id: "second", handle: "rule-review", room: "review-2" },
    { id: "setup", handle: "review", room: "review" },
];

test("addresses resolve relative to the caller's room, absolute with one dot, and a dotted handle of an older journal exactly", () => {
    const from = (reference: string, room: string | null) => actorByReference(actors, reference, room)?.id;

    assert.equal(from("rule-review", "review"), "first");
    assert.equal(from("@Rule-Review", "review-2"), "second");
    assert.equal(from("review-2.rule-review", "review"), "second");
    assert.equal(from("review.rule-review", null), "first");
    assert.equal(from("coordinator", "review"), "coordinator");
    assert.equal(from("rule-review", null), undefined);
    assert.equal(from("team.lead", "review"), "legacy");
    assert.equal(from("a.b.c", null), undefined);
    assert.equal(from("second", "review"), "second");

    assert.deepEqual(actors.map((actor) => addressFrom(actor, "review")), ["owner", "coordinator", "team.lead", "rule-review", "review-2.rule-review", "review"]);
    assert.deepEqual(actors.map((actor) => addressOf(actor)), ["owner", "coordinator", "team.lead", "review.rule-review", "review-2.rule-review", "review.review"]);
});

test("a free room name counts up past open rooms and the prefixes of dotted handles", () => {
    const run = { rooms: [{ name: "review" }, { name: "review-2" }], actors: [{ id: "a", handle: "review-3.lead" }] };

    assert.equal(freeRoomName(run, "review"), "review-4");
    assert.equal(freeRoomName(run, "review", (name) => name === "review-4"), "review-5");
    assert.equal(freeRoomName(run, "word-game"), "word-game");
    assert.throws(() => freeRoomName(run, "Review"), /no room name/);
});

test("new handles of agents and TypeScript actors may no longer contain a dot", () => {
    assert.equal(actorHandleOf("@Rule_Review-2"), "rule_review-2");
    assert.throws(() => actorHandleOf("review.lead"), /dot separates the room/);
});

const roomRun = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun({ commandId: "create" }, { title: "Rooms", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const owner = (commandId: string) => ({ actorId: view.ownerId, commandId });
    view = runtime.spawnAgent(owner("spawn-coordinator"), view.id, {
        handle: "coordinator", displayName: "Coordinator", prompt: "Coordinate.", execution: manualExecution(), grants: allGrants(), toolNames: null,
    });
    view = runtime.createScriptActor(owner("create-setup"), view.id, {
        handle: "review", displayName: "Review", grants: [...allGrants(), { capability: "run.configure", scope: { kind: "run" }, delegable: true }], toolNames: null,
        room: { kind: "open", name: "review", origin: null },
    });
    const setup = view.actors.find((actor) => actor.handle === "review");
    assert.ok(setup);
    return { journal, runtime, runId: view.id, ownerId: view.ownerId, setupId: setup.id, owner };
};

const toolsetOf = async (runtime: Orchestration, runId: string, actorId: string, label: string) => {
    const view = postTo(runtime, runtime.view(runId), actorId, `input-${label}`, "Set up.");
    const input = view.inputs.findLast((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending");
    assert.ok(input);
    return TurnToolset.create({ runtime, turn: claimTurn(runtime, runId, actorId, input.id, `turn-${label}`), catalog });
};

test("a room opens with its first actor in one command, and agents spawned there stay in their creator's room", async () => {
    const { journal, runtime, runId, setupId } = roomRun();
    try {
        const opening = journal.records(runId).find((record) => record.command.id === "create-setup");
        assert.deepEqual(opening?.events.map((event) => event.type), ["room.opened", "script.created"]);
        assert.deepEqual(runtime.view(runId).rooms.map(({ name, origin }) => ({ name, origin })), [{ name: "review", origin: null }]);

        const toolset = await toolsetOf(runtime, runId, setupId, "setup");
        const spawned = await toolset.invokeFunction("spawn", "agent_spawn", { name: "rule-review", description: "checks one rule", profile: "agent", tools: [] });
        assert.deepEqual(spawned, { id: runtime.view(runId).actors.find((actor) => actor.handle === "rule-review")!.id, handle: "rule-review" });
        const reviewer = runtime.view(runId).actors.find((actor) => actor.handle === "rule-review");
        assert.equal(reviewer?.room, "review");

        const clash = await toolset.invokeFunction("spawn-clash", "agent_spawn", { name: "coordinator", description: "a second coordinator", profile: "agent", tools: [] });
        assert.deepEqual(clash, { id: runtime.view(runId).actors.findLast((actor) => actor.handle.startsWith("coordinator-"))!.id, handle: "coordinator-1" });
    } finally {
        journal.close();
    }
});

test("tools resolve bare names in the caller's room before the main room and show every address from the caller's room", async () => {
    const { journal, runtime, runId, setupId, owner } = roomRun();
    try {
        const toolset = await toolsetOf(runtime, runId, setupId, "setup");
        await toolset.invokeFunction("spawn", "agent_spawn", { name: "rule-review", description: "checks one rule", profile: "agent", tools: [] });
        runtime.createScriptActor(owner("create-other"), runId, {
            handle: "rule-review", displayName: "Other review", grants: [], toolNames: null, room: { kind: "open", name: "review-2", origin: "review" },
        });
        assert.deepEqual(runtime.view(runId).rooms.map(({ name, origin }) => ({ name, origin })), [{ name: "review", origin: null }, { name: "review-2", origin: "review" }]);

        const listed = await toolset.invokeFunction("list", "actor_list", {}) as { handle: string }[];
        assert.deepEqual(listed.map((actor) => actor.handle), ["owner", "coordinator", "review", "rule-review", "review-2.rule-review"]);

        const local = await toolset.invokeFunction("to-local", "actor_input", { to: "@rule-review", message: "Check the comments." }) as { payload: { actorId: string } }[];
        assert.equal(local[0]?.payload.actorId, runtime.view(runId).actors.find((actor) => actor.room === "review" && actor.handle === "rule-review")!.id);
        const main = await toolset.invokeFunction("to-main", "actor_input", { to: "coordinator", message: "Done soon." }) as { payload: { actorId: string } }[];
        assert.equal(main[0]?.payload.actorId, runtime.view(runId).actors.find((actor) => actor.handle === "coordinator")!.id);
        const other = await toolset.invokeFunction("to-other", "actor_input", { to: "review-2.rule-review", message: "Compare." }) as { payload: { actorId: string } }[];
        assert.equal(other[0]?.payload.actorId, runtime.view(runId).actors.find((actor) => actor.room === "review-2")!.id);
        await assert.rejects(
            toolset.invokeFunction("to-unknown", "actor_input", { to: "nobody", message: "Hello." }),
            /Actor nobody does not exist\. Actors as seen from room review: owner, coordinator, review, rule-review, review-2\.rule-review\./,
        );

        const subscription = await toolset.invokeFunction("subscribe", "event_subscribe", { sourceActorIds: ["rule-review", "review-2.rule-review"], eventTypes: ["turn.finished"] }) as { sources: string[] };
        assert.deepEqual(subscription.sources, ["@rule-review", "@review-2.rule-review"]);

        const view = runtime.view(runId);
        const roster = actorRosterText(view, setupId);
        assert.match(roster, /Rooms: an actor's address is room\.name, the main room has no prefix; names are relative to your room, .* You are in room review\./);
        assert.match(roster, /- @review-2\.rule-review: "Other review", script, idle/);
        assert.match(roster, /- @rule-review: "rule-review", agent, idle/);
        const coordinator = view.actors.find((actor) => actor.handle === "coordinator")!;
        assert.match(actorRosterText(view, coordinator.id), /- @review\.rule-review: "rule-review", agent, idle/);
        assert.match(actorRosterText(view, coordinator.id), /You are in the main room\./);
    } finally {
        journal.close();
    }
});

test("a TypeScript actor never repeats a name of its room or of the main room, while two rooms may share one", () => {
    const { journal, runtime, runId, owner } = roomRun();
    try {
        assert.throws(() => runtime.createScriptActor(owner("main-clash"), runId, {
            handle: "review", displayName: "Main review", grants: [], toolNames: null,
        }), /Handle @review already belongs to the actor @review\.review/);
        assert.throws(() => runtime.createScriptActor(owner("room-clash"), runId, {
            handle: "coordinator", displayName: "Room coordinator", grants: [], toolNames: null, room: { kind: "existing", name: "review" },
        }), /Handle @coordinator already belongs to the actor @coordinator/);
        assert.throws(() => runtime.createScriptActor(owner("reopen"), runId, {
            handle: "second", displayName: "Second", grants: [], toolNames: null, room: { kind: "open", name: "review", origin: null },
        }), { code: "room-exists" });
        assert.throws(() => runtime.createScriptActor(owner("unknown-room"), runId, {
            handle: "second", displayName: "Second", grants: [], toolNames: null, room: { kind: "existing", name: "elsewhere" },
        }), { code: "room-not-found" });
        runtime.createScriptActor(owner("twin"), runId, {
            handle: "review", displayName: "Twin", grants: [], toolNames: null, room: { kind: "open", name: "twin", origin: null },
        });
        assert.deepEqual(runtime.view(runId).actors.filter((actor) => actor.handle === "review").map(addressOf), ["review.review", "twin.review"]);
    } finally {
        journal.close();
    }
});

const reload = (records: CommandRecord[], runId: string, root: string, edit = (line: string) => line) => {
    const directory = join(root, runId);
    mkdirSync(directory);
    writeFileSync(join(directory, "journal.jsonl"), records.map((record) => edit(serializeJournalRecord(record, directory))).join("\n") + "\n", "utf8");
    return new Journal(root, testServices());
};

test("replay restores rooms and the room of every actor; a room actor without its opened room isolates only its run", (t) => {
    const { journal, runtime, runId, setupId } = roomRun();
    const records = structuredClone(journal.records(runId)) as CommandRecord[];
    const before = runtime.view(runId);
    journal.close();

    const root = mkdtempSync(join(tmpdir(), "ragents-rooms-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const reloaded = reload(records, runId, root);
    t.after(() => reloaded.close());
    const view = new Orchestration(reloaded, testServices()).view(runId);
    assert.deepEqual(view.rooms, before.rooms);
    assert.deepEqual(view.actors.map((actor) => [actor.handle, actor.room]), [["owner", null], ["coordinator", null], ["review", "review"]]);
    assert.equal(view.actors.find((actor) => actor.id === setupId)?.room, "review");

    const brokenRoot = mkdtempSync(join(tmpdir(), "ragents-rooms-broken-"));
    t.after(() => rmSync(brokenRoot, { recursive: true, force: true }));
    const withoutRoom = structuredClone(records);
    for (const record of withoutRoom)
        record.events = record.events.filter((event) => event.type !== "room.opened");
    let sequence = 0;
    for (const event of withoutRoom.flatMap((record) => record.events))
        event.sequence = ++sequence;
    const broken = reload(withoutRoom, runId, brokenRoot);
    t.after(() => broken.close());
    assert.match(broken.failureOf(runId)?.message ?? "", /Room review was not opened/);
});

test("an older journal without rooms loads unchanged: every actor stands in the main room and a dotted handle still resolves", (t) => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun({ commandId: "create" }, { title: "Old", ownerHandle: "owner", ownerDisplayName: "Owner" });
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
        handle: "lead", displayName: "Lead", prompt: "Lead.", execution: manualExecution(), grants: allGrants(), toolNames: [],
    });
    const records = structuredClone(journal.records(view.id)) as CommandRecord[];
    journal.close();

    const root = mkdtempSync(join(tmpdir(), "ragents-rooms-old-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const older = reload(records, view.id, root, (line) => line.replace('"formatVersion":12', '"formatVersion":11').replace('"handle":"lead"', '"handle":"team.lead"'));
    t.after(() => older.close());
    assert.equal(older.failureOf(view.id) ?? null, null);
    const oldRuntime = new Orchestration(older, testServices());
    const oldView = oldRuntime.view(view.id);
    assert.deepEqual(oldView.rooms, []);
    assert.deepEqual(oldView.actors.map((actor) => [actor.handle, actor.room, addressOf(actor)]), [["owner", null, "owner"], ["team.lead", null, "team.lead"]]);
    assert.equal(actorRosterText(oldView, oldView.actors[1]!.id).includes("Rooms:"), false);

    const queued = oldRuntime.enqueueInput({ actorId: oldView.ownerId, commandId: "to-legacy" }, view.id, { actorId: "@team.lead", content: "Still there?" });
    assert.equal(queued.inputs.at(-1)?.actorId, oldView.actors[1]!.id);
    assert.throws(() => oldRuntime.createScriptActor({ actorId: oldView.ownerId, commandId: "open-team" }, view.id, {
        handle: "lead", displayName: "Lead", grants: [], toolNames: null, room: { kind: "open", name: "team", origin: null },
    }), { code: "room-exists" });
});

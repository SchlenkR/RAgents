import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { claimTurn } from "../src/agents/turn.ts";
import { TurnToolset } from "../src/agents/toolset.ts";
import { actorDescriptionMaxLength } from "../src/domain/model.ts";
import { Journal, type CommandRecord } from "../src/runtime/journal.ts";
import { serializeJournalRecord } from "../src/runtime/journal-storage.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { allGrants, catalog, manualExecution, postTo, setupRun, testServices } from "./support.ts";

const spawningToolset = async (setup: ReturnType<typeof setupRun>) => {
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "input-spawn", "Spawn reviewers.");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "turn-spawn");
    return TurnToolset.create({ runtime: setup.runtime, turn, catalog });
};

const reviewRun = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun({ commandId: "create" }, { title: "Review", ownerHandle: "owner", ownerDisplayName: "Owner" });
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-lead" }, view.id, {
        handle: "lead", displayName: "Lead", prompt: "Coordinate.", execution: manualExecution(), grants: allGrants(), toolNames: [],
    });
    const lead = view.actors.find((entry) => entry.handle === "lead");
    assert.ok(lead);
    const input = postTo(runtime, view, lead.id, "input-lead", "Start the review.").inputs.find((entry) => entry.actorId === lead.id);
    assert.ok(input);
    const turnId = claimTurn(runtime, view.id, lead.id, input.id, "turn-lead").turnId;
    const byLead = (commandId: string) => ({ actorId: lead.id, commandId, turnId });
    view = runtime.spawnAgent(byLead("spawn-reviewer"), view.id, {
        handle: "reviewer", displayName: "Reviewer", description: "  prüft\n die   Regel zu Kommentaren ", prompt: "Review.", execution: manualExecution(), grants: [], toolNames: [],
    });
    view = runtime.createScriptActor(byLead("create-counter"), view.id, {
        handle: "counter", displayName: "Counter", description: "zählt Befunde", grants: [], toolNames: null,
    });
    return { journal, runtime, runId: view.id, leadId: lead.id, byLead };
};

const reload = (records: CommandRecord[], runId: string, root: string, edit = (line: string) => line) => {
    const directory = join(root, runId);
    mkdirSync(directory);
    writeFileSync(join(directory, "journal.jsonl"), records.map((record) => edit(serializeJournalRecord(record, directory))).join("\n") + "\n", "utf8");
    return new Journal(root, testServices());
};

test("agent_spawn records a short description and actor_list reports it next to the creator", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn", "actor_list"] });
    try {
        const toolset = await spawningToolset(setup);
        await toolset.invokeFunction("spawn-described", "agent_spawn", { handle: "rule-review", description: "prüft die Regel zu Kommentaren", prompt: "Review one rule.", profile: "agent", tools: [] });
        await toolset.invokeFunction("spawn-plain", "agent_spawn", { handle: "helper", prompt: "Help.", profile: "agent", tools: [] });
        await assert.rejects(
            toolset.invokeFunction("spawn-long", "agent_spawn", { handle: "long", description: "x".repeat(actorDescriptionMaxLength + 1), prompt: "Long.", profile: "agent", tools: [] }),
            /description/,
        );
        const listed = await toolset.invokeFunction("list", "actor_list", {}) as { handle: string; createdBy: string | null; description: string | null }[];
        assert.deepEqual(listed.map(({ handle, createdBy, description }) => ({ handle, createdBy, description })), [
            { handle: "owner", createdBy: null, description: null },
            { handle: "worker", createdBy: setup.view.ownerId, description: null },
            { handle: "rule-review", createdBy: setup.agent.id, description: "prüft die Regel zu Kommentaren" },
            { handle: "helper", createdBy: setup.agent.id, description: null },
        ]);
    } finally {
        setup.journal.close();
    }
});

test("the engine collapses whitespace in a description and rejects an empty or overlong one", () => {
    const { journal, runtime, runId, leadId, byLead } = reviewRun();
    try {
        const actors = runtime.view(runId).actors;
        const reviewer = actors.find((entry) => entry.handle === "reviewer");
        assert.ok(reviewer?.kind === "agent");
        assert.equal(reviewer.description, "prüft die Regel zu Kommentaren");
        const counter = actors.find((entry) => entry.handle === "counter");
        assert.ok(counter?.kind === "script");
        assert.equal(counter.description, "zählt Befunde");
        assert.equal(counter.createdBy, leadId);
        const spawn = (description: string) => runtime.spawnAgent(byLead(`spawn-${description.length}`), runId, {
            handle: "extra", displayName: "Extra", description, prompt: "Extra.", execution: manualExecution(), grants: [], toolNames: [],
        });
        assert.throws(() => spawn("   "), /description must not be empty/);
        assert.throws(() => spawn("y".repeat(actorDescriptionMaxLength + 1)), new RegExp(`must not exceed ${actorDescriptionMaxLength} characters`));
    } finally {
        journal.close();
    }
});

test("a reloaded journal keeps descriptions and creators, and an older journal without descriptions still loads", (t) => {
    const { journal, runtime, runId, leadId } = reviewRun();
    const records = structuredClone(journal.records(runId)) as CommandRecord[];
    const before = runtime.view(runId);
    journal.close();

    const root = mkdtempSync(join(tmpdir(), "ragents-actor-description-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const current = reload(records, runId, root);
    t.after(() => current.close());
    const reloaded = new Orchestration(current, testServices()).view(runId);
    assert.deepEqual(reloaded.actors.map((actor) => actor.kind === "human" ? null : [actor.handle, actor.createdBy, actor.description]),
        before.actors.map((actor) => actor.kind === "human" ? null : [actor.handle, actor.createdBy, actor.description]));

    const olderRoot = mkdtempSync(join(tmpdir(), "ragents-actor-description-old-"));
    t.after(() => rmSync(olderRoot, { recursive: true, force: true }));
    const older = structuredClone(records);
    for (const event of older.flatMap((record) => record.events))
        if (event.type === "agent.spawned" || event.type === "script.created") delete event.payload.description;
    const olderJournal = reload(older, runId, olderRoot);
    t.after(() => olderJournal.close());
    assert.equal(olderJournal.failureOf(runId) ?? null, null);
    const olderView = new Orchestration(olderJournal, testServices()).view(runId);
    assert.deepEqual(olderView.actors.flatMap((actor) => actor.kind === "human" ? [] : [[actor.handle, actor.createdBy === leadId, actor.description]]),
        [["lead", false, null], ["reviewer", true, null], ["counter", true, null]]);
});

test("a stored empty description isolates only its run with the path", (t) => {
    const { journal, runId } = reviewRun();
    const records = structuredClone(journal.records(runId)) as CommandRecord[];
    journal.close();
    const root = mkdtempSync(join(tmpdir(), "ragents-actor-description-empty-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const broken = reload(records, runId, root, (line) => line.replace('"description":"zählt Befunde"', '"description":""'));
    t.after(() => broken.close());
    assert.match(broken.failureOf(runId)?.message ?? "", /payload\.description must be a non-empty string/);
    assert.deepEqual(broken.runIds(), []);
});

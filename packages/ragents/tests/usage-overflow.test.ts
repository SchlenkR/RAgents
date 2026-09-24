import { serializeJournalRecord } from "../src/runtime/journal-storage.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TurnUsage } from "../src/domain/model.ts";
import { Journal, type CommandRecord } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { manualExecution, testServices } from "./support.ts";

const usage = (inputTokens: number, costUsd: number): TurnUsage => ({
    inputTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
});

const setup = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun(
        { commandId: "create" },
        { title: "Usage totals", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Work.",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });
    const actor = view.actors.find((entry) => entry.kind === "agent");
    assert.ok(actor);

    return { journal, runtime, runId: view.id, ownerId: view.ownerId, actorId: actor.id };
};

const startTurn = (
    fixture: ReturnType<typeof setup>,
    name: string,
) => {
    const enqueued = fixture.runtime.enqueueInput(
        { actorId: fixture.ownerId, commandId: `input-${name}` },
        fixture.runId,
        { actorId: fixture.actorId, content: `Input ${name}` },
    );
    const input = enqueued.inputs.find(
        (entry) => entry.actorId === fixture.actorId && entry.lifecycle.kind === "pending",
    );
    assert.ok(input);
    const running = fixture.runtime.startTurn(
        { actorId: fixture.actorId, commandId: `start-${name}` },
        fixture.runId,
        fixture.actorId,
        input.id,
    );
    const actor = running.actors.find((entry) => entry.id === fixture.actorId);
    assert.ok(actor && actor.kind !== "human" && actor.lifecycle.kind === "running");

    return actor.lifecycle.turnId;
};

const completeTurn = (
    fixture: ReturnType<typeof setup>,
    name: string,
    turnUsage: TurnUsage,
) => {
    const turnId = startTurn(fixture, name);

    fixture.runtime.finishTurn(
        { actorId: fixture.actorId, commandId: `finish-${name}`, turnId },
        fixture.runId,
        fixture.actorId,
        { turnId, outcome: "completed", usage: turnUsage },
    );
};

const twoTurnRecords = () => {
    const fixture = setup();

    try {
        completeTurn(fixture, "one", usage(0, 0));
        completeTurn(fixture, "two", usage(0, 0));

        return {
            runId: fixture.runId,
            records: structuredClone(fixture.journal.records(fixture.runId)) as CommandRecord[],
        };
    } finally {
        fixture.journal.close();
    }
};

const replaceFinishedUsage = (
    records: CommandRecord[],
    first: TurnUsage,
    second: TurnUsage,
) => {
    const events = records
        .flatMap((record) => record.events)
        .filter((event) => event.type === "turn.finished");
    assert.equal(events.length, 2);
    const firstEvent = events[0];
    const secondEvent = events[1];
    assert.ok(firstEvent && secondEvent);
    firstEvent.payload.usage = first;
    secondEvent.payload.usage = second;
};

test("append rejects a cumulative cost that would become infinite", () => {
    const fixture = setup();

    try {
        completeTurn(fixture, "one", usage(0, Number.MAX_VALUE));
        const turnId = startTurn(fixture, "two");
        const revision = fixture.runtime.view(fixture.runId).revision;
        const eventCount = fixture.runtime.events(fixture.runId).length;

        assert.throws(
            () => fixture.runtime.finishTurn(
                { actorId: fixture.actorId, commandId: "finish-two", turnId },
                fixture.runId,
                fixture.actorId,
                { turnId, outcome: "completed", usage: usage(0, Number.MAX_VALUE) },
            ),
            /Cumulative turn usage costUsd must be a finite non-negative number/,
        );

        const current = fixture.runtime.view(fixture.runId);
        const actor = current.actors.find((entry) => entry.id === fixture.actorId);
        assert.equal(current.revision, revision);
        assert.equal(fixture.runtime.events(fixture.runId).length, eventCount);
        assert.equal(current.turns.find((entry) => entry.id === turnId)?.status, "running");
        assert.ok(actor && actor.kind !== "human" && actor.lifecycle.kind === "running");
        assert.equal(actor.usage.costUsd, Number.MAX_VALUE);
    } finally {
        fixture.journal.close();
    }
});

test("adopt rejects cumulative token totals beyond the safe integer range", () => {
    const { records } = twoTurnRecords();
    replaceFinishedUsage(
        records,
        usage(Number.MAX_SAFE_INTEGER, 0),
        usage(1, 0),
    );
    const target = new Journal(":memory:", testServices());

    try {
        assert.throws(
            () => target.adopt(records),
            /Cumulative turn usage inputTokens must be a non-negative safe integer/,
        );
        assert.deepEqual(target.runIds(), []);
    } finally {
        target.close();
    }
});

test("journal replay rejects two finite costs whose total would be infinite", (t) => {
    const root = mkdtempSync(join(tmpdir(), "ragents-usage-overflow-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { runId, records } = twoTurnRecords();
    replaceFinishedUsage(
        records,
        usage(0, Number.MAX_VALUE),
        usage(0, Number.MAX_VALUE),
    );
    const directory = join(root, runId);
    mkdirSync(directory);
    writeFileSync(
        join(directory, "journal.jsonl"),
        records.map((record) => serializeJournalRecord(record, directory)).join("\n") + "\n",
        "utf8",
    );

    const journal = new Journal(root, testServices());
    t.after(() => journal.close());
    assert.match(journal.failureOf(runId)?.message ?? "", /Cumulative turn usage costUsd must be a finite non-negative number/);
    assert.deepEqual(journal.runIds(), []);
});

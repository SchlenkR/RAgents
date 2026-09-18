import assert from "node:assert/strict";
import fs from "node:fs";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { UncommittedEvent } from "../src/domain/events.ts";
import { Journal, type CommandRecord } from "../src/runtime/journal.ts";
import { journalPayloadThresholdBytes, parseJournalRecord, serializeJournalRecord } from "../src/runtime/journal-storage.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import type { RuntimeServices } from "../src/runtime/services.ts";

const directoryFor = (t: test.TestContext) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-journal-storage-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));

    return directory;
};

const recordFor = (state: unknown): CommandRecord => ({
    formatVersion: 3,
    runId: "run-1",
    command: { id: "command-1", type: "plugin.state.replace", actorId: "human-1", requestHash: "request-hash" },
    events: [{
        eventId: "event-1",
        runId: "run-1",
        sequence: 1,
        schemaVersion: 3,
        occurredAt: "2026-09-12T12:00:00.000Z",
        actorId: "human-1",
        commandId: "command-1",
        correlationId: null,
        causationId: null,
        type: "plugin.state-replaced",
        payload: { pluginId: "test", scope: { kind: "run" }, state },
    }],
}) as CommandRecord;

test("compact records reconstruct every envelope field without changing inline reference-shaped JSON", (t) => {
    const directory = directoryFor(t);
    const record = recordFor({ sha256: "a".repeat(64), bytes: 8000, payloadRefs: { state: "ordinary data" } });
    const line = serializeJournalRecord(record, directory);
    const stored = JSON.parse(line);
    assert.equal(stored.formatVersion, 4);
    assert.equal(stored.occurredAt, record.events[0]!.occurredAt);

    for (const field of ["runId", "commandId", "schemaVersion", "occurredAt", "actorId"])
        assert.equal(Object.hasOwn(stored.events[0], field), false);

    assert.deepEqual(parseJournalRecord(line, directory, "test:1"), record);
    assert.equal(existsSync(join(directory, "payloads")), false);
});

test("payload threshold counts serialized UTF-8 bytes and deduplicates immutable values", (t) => {
    const directory = directoryFor(t);
    const below = recordFor("ä".repeat((journalPayloadThresholdBytes - 4) / 2));
    serializeJournalRecord(below, directory);
    assert.equal(existsSync(join(directory, "payloads")), false);
    const at = recordFor("ä".repeat((journalPayloadThresholdBytes - 2) / 2));
    const first = serializeJournalRecord(at, directory);
    assert.equal(serializeJournalRecord(at, directory), first);
    const stored = JSON.parse(first);
    assert.equal(Object.hasOwn(stored.events[0].payload, "state"), false);
    assert.equal(stored.events[0].payloadRefs.state.bytes, journalPayloadThresholdBytes);
    assert.equal(readdirSync(join(directory, "payloads")).length, 1);
    assert.deepEqual(parseJournalRecord(first, directory, "test:1"), at);

    const changed = recordFor("b".repeat(journalPayloadThresholdBytes));
    const second = serializeJournalRecord(changed, directory);
    assert.equal(readdirSync(join(directory, "payloads")).length, 2);
    assert.deepEqual(parseJournalRecord(first, directory, "test:1"), at);
    assert.deepEqual(parseJournalRecord(second, directory, "test:2"), changed);
});

test("large JSON objects with reference-shaped data round-trip as one payload file", (t) => {
    const directory = directoryFor(t);
    const state = JSON.parse(`{"__proto__":{"text":"${"x".repeat(5000)}"},"sha256":"data","bytes":15}`);
    const record = recordFor(state);
    const line = serializeJournalRecord(record, directory);
    assert.deepEqual(parseJournalRecord(line, directory, "test:1"), record);
    assert.equal(readdirSync(join(directory, "payloads")).length, 1);
});

test("missing and corrupted payloads fail on read; writing cannot overwrite corrupt existing content", (t) => {
    const directory = directoryFor(t);
    const record = recordFor("a".repeat(5000));
    const line = serializeJournalRecord(record, directory);
    const reference = JSON.parse(line).events[0].payloadRefs.state;
    const path = join(directory, "payloads", `${reference.sha256}.json`);
    const content = readFileSync(path, "utf8");
    writeFileSync(path, content.replace("a", "b"));
    assert.throws(() => parseJournalRecord(line, directory, "test:1"), /SHA-256 verification/);
    assert.throws(() => serializeJournalRecord(record, directory), /SHA-256 verification/);
    assert.equal(readFileSync(path, "utf8"), content.replace("a", "b"));
    writeFileSync(path, "null");
    assert.throws(() => parseJournalRecord(line, directory, "test:1"), /size or SHA-256 verification/);
    rmSync(path);
    assert.throws(() => parseJournalRecord(line, directory, "test:1"), /cannot read journal payload/);
});

test("stored references reject unsafe paths, wrong sizes, duplicate fields and unknown attributes", (t) => {
    const directory = directoryFor(t);
    const line = serializeJournalRecord(recordFor("a".repeat(5000)), directory);

    for (const change of [
        (record: any) => { record.events[0].payloadRefs.state.sha256 = "../../other"; },
        (record: any) => { record.events[0].payloadRefs.state.bytes = 1; },
        (record: any) => { record.events[0].payloadRefs.state.bytes += 1; },
        (record: any) => { record.events[0].payloadRefs.state.extra = true; },
        (record: any) => { record.events[0].payload.state = "duplicate"; },
        (record: any) => { record.events[0].actorId = "human-2"; },
        (record: any) => { delete record.occurredAt; },
    ]) {
        const stored = JSON.parse(line);
        change(stored);
        assert.throws(() => parseJournalRecord(JSON.stringify(stored), directory, "test:1"));
    }
});

test("legacy disk records and inconsistent in-memory command envelopes fail explicitly", (t) => {
    const directory = directoryFor(t);
    const record = recordFor(null);
    assert.throws(() => parseJournalRecord(JSON.stringify(record), directory, "test:1"), /unsupported journal format version 3/);

    for (const field of ["runId", "commandId", "actorId", "occurredAt"] as const) {
        const modified = structuredClone(record);
        modified.events.push({ ...modified.events[0]!, eventId: "event-2", sequence: 2 });
        modified.events[1]![field] = field === "runId" ? "run-2" : field === "actorId" ? "human-2" : "different";
        assert.throws(() => serializeJournalRecord(modified, directory), /does not match its command envelope/);
    }
});

const servicesFor = (): RuntimeServices => {
    let sequence = 0;

    return { now: () => "2026-09-12T12:00:00.000Z", newId: (kind) => `${kind}-${++sequence}` };
};

const stateEvent = (actorId: string, state: string): UncommittedEvent => ({
    type: "plugin.state-replaced",
    actorId,
    correlationId: null,
    causationId: null,
    payload: { pluginId: "test", scope: { kind: "run" }, state },
});

test("journal appends and reopens a multi-event command with deduplicated payloads and idempotent retries", (t) => {
    const root = directoryFor(t);
    const services = servicesFor();
    const journal = new Journal(root, services);
    t.after(() => journal.close());
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const command = { id: "large", type: "plugin.state.replace", actorId: run.ownerId, requestHash: "large" };
    const proposed = [stateEvent(run.ownerId, "a".repeat(5000)), stateEvent(run.ownerId, "a".repeat(5000))];
    const events = journal.append(run.id, command, proposed);
    const path = join(root, run.id, "journal.jsonl");
    const persisted = readFileSync(path, "utf8");
    const lines = persisted.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]!).events.length, 2);
    assert.equal(readdirSync(join(root, run.id, "payloads")).length, 1);
    assert.deepEqual(journal.append(run.id, command, proposed), events);
    assert.equal(readFileSync(path, "utf8"), persisted);
    const state = journal.stateOf(run.id);
    journal.close();

    const reopened = new Journal(root, services);
    t.after(() => reopened.close());
    assert.deepEqual(reopened.stateOf(run.id), state);
    assert.deepEqual(reopened.append(run.id, command, proposed), events);
    assert.equal(readFileSync(path, "utf8"), persisted);
});

test("payload persistence failure commits no part of a multi-event command and permits retry", (t) => {
    const root = directoryFor(t);
    const services = servicesFor();
    const journal = new Journal(root, services);
    t.after(() => journal.close());
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const runDirectory = join(root, run.id);
    const path = join(runDirectory, "journal.jsonl");
    const before = readFileSync(path, "utf8");
    const state = journal.stateOf(run.id);
    writeFileSync(join(runDirectory, "payloads"), "blocked directory");
    const command = { id: "large", type: "plugin.state.replace", actorId: run.ownerId, requestHash: "large" };
    const proposed = [stateEvent(run.ownerId, "small"), stateEvent(run.ownerId, "a".repeat(5000))];
    let publications = 0;
    journal.subscribe(() => { publications += 1; });
    assert.throws(() => journal.append(run.id, command, proposed), /ENOTDIR/);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(journal.stateOf(run.id), state);
    assert.equal(journal.commandFor(run.id, command.id), null);
    assert.equal(publications, 0);
    rmSync(join(runDirectory, "payloads"));
    assert.equal(journal.append(run.id, command, proposed).length, 2);
    assert.equal(publications, 1);
});

test("a torn multi-event command leaves reusable payloads and recovers at its prior command boundary", (t) => {
    const root = directoryFor(t);
    const services = servicesFor();
    const journal = new Journal(root, services);
    t.after(() => journal.close());
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const before = journal.stateOf(run.id);
    const command = { id: "large", type: "plugin.state.replace", actorId: run.ownerId, requestHash: "large" };
    const proposed = [stateEvent(run.ownerId, "a".repeat(5000)), stateEvent(run.ownerId, "b".repeat(5000))];
    journal.append(run.id, command, proposed);
    journal.close();
    const path = join(root, run.id, "journal.jsonl");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, lines[0]! + "\n" + lines[1]!.slice(0, lines[1]!.length / 2));
    const reopened = new Journal(root, services);
    t.after(() => reopened.close());
    assert.deepEqual(reopened.stateOf(run.id), before);
    assert.equal(reopened.commandFor(run.id, command.id), null);
    assert.equal(readdirSync(join(root, run.id, "payloads")).length, 2);
    assert.equal(reopened.append(run.id, command, proposed).length, 2);
    assert.equal(readdirSync(join(root, run.id, "payloads")).length, 2);
});

test("a fork owns its inherited payload files and reopens after removing the source run", (t) => {
    const root = directoryFor(t);
    const services = servicesFor();
    const journal = new Journal(root, services);
    t.after(() => journal.close());
    const runtime = new Orchestration(journal, services);
    const source = runtime.createRun({ commandId: "create" }, {
        title: "Test",
        ownerHandle: "owner",
        ownerDisplayName: "Owner",
        initialPluginStates: [{ pluginId: "test", state: { text: "a".repeat(5000) } }],
    });
    const fork = runtime.forkRun({ commandId: "fork" }, source.id, source.revision);
    const state = journal.stateOf(fork.id);
    const events = journal.load(fork.id);
    assert.deepEqual(readdirSync(join(root, fork.id, "payloads")), readdirSync(join(root, source.id, "payloads")));
    journal.close();
    rmSync(join(root, source.id), { recursive: true });
    const reopened = new Journal(root, services);
    t.after(() => reopened.close());
    assert.deepEqual(reopened.stateOf(fork.id), state);
    assert.deepEqual(reopened.load(fork.id), events);
});

for (const failure of ["partial write", "fsync"] as const) {
    test(`a journal ${failure} failure blocks only the affected run until reopen without duplicating commands`, (t) => {
        const root = directoryFor(t);
        const services = servicesFor();
        const journal = new Journal(root, services);
        t.after(() => journal.close());
        const runtime = new Orchestration(journal, services);
        const run = runtime.createRun({ commandId: "create" }, { title: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" });
        const other = runtime.createRun({ commandId: "other" }, { title: "Other", ownerHandle: "owner", ownerDisplayName: "Owner" });
        const path = join(root, run.id, "journal.jsonl");
        const state = journal.stateOf(run.id);
        const otherState = journal.stateOf(other.id);
        const command = { id: "large", type: "plugin.state.replace", actorId: run.ownerId, requestHash: "large" };
        const proposed = [stateEvent(run.ownerId, "a".repeat(5000)), stateEvent(run.ownerId, "b".repeat(5000))];
        let publications = 0;
        journal.subscribe(() => { publications += 1; });
        const originalOpen = fs.openSync;
        const originalWrite = fs.writeFileSync;
        const originalSync = fs.fsyncSync;
        let appendDescriptor: number | null = null;
        let injected = false;

        try {
            t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
                const descriptor = originalOpen(...args);

                if (args[0] === path && args[1] === "a")
                    appendDescriptor = descriptor;

                return descriptor;
            });
            t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
                if (failure === "partial write" && args[0] === appendDescriptor) {
                    assert.equal(typeof args[1], "string");
                    originalWrite(args[0], (args[1] as string).slice(0, 35), args[2]);
                    injected = true;
                    throw new Error("Injected partial journal write failure");
                }

                return originalWrite(...args);
            });
            t.mock.method(fs, "fsyncSync", (descriptor: number) => {
                if (failure === "fsync" && descriptor === appendDescriptor) {
                    injected = true;
                    throw new Error("Injected journal fsync failure");
                }

                return originalSync(descriptor);
            });
            syncBuiltinESMExports();
            assert.throws(() => journal.append(run.id, command, proposed), (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /Journal write failed; reopen the journal before retrying/);
                assert.ok(error.cause instanceof Error);
                assert.match(error.cause.message, /Injected .* failure/);

                return true;
            });
            assert.equal(injected, true);
        } finally {
            t.mock.restoreAll();
            syncBuiltinESMExports();
        }

        const failedContent = readFileSync(path, "utf8");
        assert.deepEqual(journal.stateOf(run.id), state);
        assert.equal(journal.commandFor(run.id, command.id), null);
        assert.equal(publications, 0);
        assert.throws(() => journal.append(run.id, command, proposed), /Journal write failed; reopen the journal before retrying/);
        assert.equal(journal.append(other.id, {
            ...command, id: "other-state", actorId: other.ownerId,
        }, [stateEvent(other.ownerId, "unrelated")]).length, 1);
        assert.doesNotThrow(() => journal.adopt([]));
        assert.notDeepEqual(journal.stateOf(other.id), otherState);
        assert.throws(() => runtime.state(run.id), { code: "journal-unavailable", status: 409 });
        assert.equal(readFileSync(path, "utf8"), failedContent);
        journal.close();

        const reopened = new Journal(root, services);
        t.after(() => reopened.close());
        let replayPublications = 0;
        reopened.subscribe(() => { replayPublications += 1; });
        assert.equal(reopened.commandFor(run.id, command.id) !== null, failure === "fsync");
        const accepted = reopened.append(run.id, command, proposed);
        assert.equal(accepted.length, 2);
        assert.equal(replayPublications, failure === "fsync" ? 0 : 1);
        assert.deepEqual(reopened.append(run.id, command, proposed), accepted);
        assert.equal(replayPublications, failure === "fsync" ? 0 : 1);
        assert.equal(reopened.load(run.id).length, 3);
        assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 2);
        assert.equal(readdirSync(join(root, run.id, "payloads")).length, 2);
        assert.equal(reopened.append(other.id, {
            ...command, id: "other-state", actorId: other.ownerId,
        }, [stateEvent(other.ownerId, "independent")]).length, 1);
    });
}

for (const damage of ["missing", "corrupt"] as const) {
    test(`a ${damage} payload isolates its run while other journals remain writable`, (t) => {
        const root = directoryFor(t);
        const services = servicesFor();
        const original = new Journal(root, services);
        const runtime = new Orchestration(original, services);
        const broken = runtime.createRun({ commandId: "broken" }, {
            title: "Broken", ownerHandle: "owner", ownerDisplayName: "Owner",
            initialPluginStates: [{ pluginId: "test", state: "x".repeat(5000) }],
        });
        const healthy = runtime.createRun({ commandId: "healthy" }, {
            title: "Healthy", ownerHandle: "owner", ownerDisplayName: "Owner",
        });
        original.close();
        const journalPath = join(root, broken.id, "journal.jsonl");
        const journalBytes = readFileSync(journalPath);
        const payloadDirectory = join(root, broken.id, "payloads");
        const payloadPath = join(payloadDirectory, readdirSync(payloadDirectory)[0]!);

        if (damage === "missing")
            rmSync(payloadPath);
        else
            writeFileSync(payloadPath, "corrupt");

        const journal = new Journal(root, services, { onLoadError: () => {} });
        t.after(() => journal.close());
        assert.deepEqual(journal.runIds(), [healthy.id]);
        assert.equal(journal.loadFailures()[0]?.runId, broken.id);
        assert.throws(() => journal.load(broken.id), { code: "journal-unavailable", status: 409 });
        assert.equal(journal.append(healthy.id, {
            id: "still-works", type: "plugin.state.replace", actorId: healthy.ownerId, requestHash: "healthy",
        }, [stateEvent(healthy.ownerId, "writable")]).length, 1);
        assert.deepEqual(readFileSync(journalPath), journalBytes);
        assert.equal(existsSync(payloadPath), damage === "corrupt");

        if (damage === "corrupt")
            assert.equal(readFileSync(payloadPath, "utf8"), "corrupt");
    });
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { UncommittedEvent } from "../src/domain/events.ts";
import { DirectoryArtifactContents } from "../src/runtime/artifacts.ts";
import { Journal, type CommandRecord } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import type { RuntimeServices } from "../src/runtime/services.ts";

const services = (start = 0) => {
    let next = start;

    return {
        now: () => "2026-08-15T12:00:00.000Z",
        newId: (kind: string) => `${kind}-${++next}`,
    } satisfies RuntimeServices;
};

const temporaryDirectory = (t: test.TestContext) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-v3-persistence-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));

    return directory;
};

const runCreatedPayload = () => ({
    title: "Test",
    owner: {
        id: "human-1",
        handle: "Owner",
        displayName: "Owner",
        grants: [],
    },
});

const record = (
    eventType = "run.created",
    schemaVersion = 3,
    formatVersion = 3,
    payload: unknown = runCreatedPayload(),
    commandId = "command-1",
    sequence = 1,
) => ({
    formatVersion,
    runId: "run-1",
    command: {
        id: commandId,
        type: "run.create",
        actorId: "human-1",
        requestHash: "request-hash",
    },
    events: [
        {
            type: eventType,
            payload,
            eventId: `event-${sequence}`,
            runId: "run-1",
            sequence,
            schemaVersion,
            occurredAt: "2026-08-15T12:00:00.000Z",
            actorId: "human-1",
            commandId,
            correlationId: null,
            causationId: null,
        },
    ],
});

const diskRecord = (value: ReturnType<typeof record> | CommandRecord) => ({
    formatVersion: value.formatVersion === 3 ? 4 : value.formatVersion,
    runId: value.runId,
    command: value.command,
    occurredAt: value.events[0]!.occurredAt,
    events: value.events.map(({ runId: _run, commandId: _command, schemaVersion: _schema, actorId: _actor, occurredAt: _at, ...event }) => event),
});

const stored = (value: ReturnType<typeof record> | CommandRecord) => JSON.stringify(diskRecord(value));

const writeJournal = (root: string, content: string) => {
    const directory = join(root, "run-1");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "journal.jsonl"), content, "utf8");
};

const assertIsolated = (root: string, expected: RegExp, runId = "run-1") => {
    const diagnostics: string[] = [];
    const journal = new Journal(root, services(), { onLoadError: (failure) => diagnostics.push(failure.message) });

    try {
        assert.match(journal.failureOf(runId)?.message ?? "", expected);
        assert.ok(diagnostics.some((message) => expected.test(message)));
        assert.equal(journal.stateOf(runId), null);
        assert.throws(() => journal.load(runId), { code: "journal-unavailable", status: 409 });
    } finally {
        journal.close();
    }
};

const secondCommand = () => ({
    id: "command-2",
    type: "plugin.state.replace",
    actorId: "human-1",
    requestHash: "request-hash-2",
});

const secondEvent = () => ({
    type: "plugin.state-replaced",
    actorId: "human-1",
    correlationId: null,
    causationId: null,
    payload: { pluginId: "test", scope: { kind: "run" }, state: {} },
}) as unknown as UncommittedEvent;

const pluginStateRecord = () => record(
    "plugin.state-replaced",
    3,
    3,
    { pluginId: "test", scope: { kind: "run" }, state: {} },
    "command-2",
    2,
);

const plantLock = (root: string, owner: Record<string, unknown>) => {
    const lockPath = join(root, ".writer.lock");
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, "owner-planted.json"), JSON.stringify(owner) + "\n", "utf8");

    return lockPath;
};

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

test("a writer lock of a dead process is taken over with a notice", (t) => {
    const root = temporaryDirectory(t);
    const lockPath = plantLock(root, { pid: 999999 });
    const notices: string[] = [];

    const journal = new Journal(root, services(), { onStaleLock: (message) => notices.push(message) });

    assert.equal(existsSync(join(lockPath, "owner-planted.json")), false);
    assert.equal(readdirSync(lockPath).length, 1);
    assert.match(notices.join("\n"), /Prozess 999999 lebt nicht mehr/);
    journal.close();
    assert.equal(existsSync(lockPath), false);
});

test("a living writer with a fresh heartbeat is refused", (t) => {
    const root = temporaryDirectory(t);
    const lockPath = plantLock(root, { pid: process.pid, hostname: hostname(), heartbeatAt: new Date().toISOString() });

    assert.throws(() => new Journal(root, services()), /remove this lock manually if it is stale/);
    assert.equal(existsSync(join(lockPath, "owner-planted.json")), true);
});

test("a living process without heartbeat counts as stale", (t) => {
    const root = temporaryDirectory(t);
    plantLock(root, { pid: process.pid, hostname: hostname(), heartbeatAt: secondsAgo(120) });
    const notices: string[] = [];

    const journal = new Journal(root, services(), { onStaleLock: (message) => notices.push(message) });

    assert.match(notices.join("\n"), /Prozess \d+ ohne Herzschlag seit 1\d\d s/);
    journal.close();
});

test("a lock from another host is judged by its heartbeat alone", (t) => {
    const root = temporaryDirectory(t);
    plantLock(root, { pid: process.pid, hostname: "anderswo", heartbeatAt: new Date().toISOString() });
    assert.throws(() => new Journal(root, services()), /already owns/);
    rmSync(join(root, ".writer.lock"), { recursive: true });

    plantLock(root, { pid: process.pid, hostname: "anderswo", heartbeatAt: secondsAgo(120) });
    const notices: string[] = [];
    const journal = new Journal(root, services(), { onStaleLock: (message) => notices.push(message) });
    assert.match(notices.join("\n"), /auf anderswo ohne Herzschlag/);
    journal.close();
});

test("the heartbeat refreshes the owner file while the journal is open", async (t) => {
    const root = temporaryDirectory(t);
    const journal = new Journal(root, services(), { writerHeartbeatIntervalMs: 10 });
    const lockPath = join(root, ".writer.lock");
    const ownerPath = join(lockPath, readdirSync(lockPath)[0]!);
    const first = JSON.parse(readFileSync(ownerPath, "utf8")) as { heartbeatAt: string; startedAt: string };

    await new Promise((resolve) => setTimeout(resolve, 60));

    const later = JSON.parse(readFileSync(ownerPath, "utf8")) as { heartbeatAt: string; startedAt: string };
    assert.equal(later.startedAt, first.startedAt);
    assert.notEqual(later.heartbeatAt, first.heartbeatAt);
    journal.close();
});

test("a journal whose lock vanished stops accepting writes", async (t) => {
    const root = temporaryDirectory(t);
    const notices: string[] = [];
    const journal = new Journal(root, services(), { writerHeartbeatIntervalMs: 10, onStaleLock: (message) => notices.push(message) });
    rmSync(join(root, ".writer.lock"), { recursive: true });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.match(notices.join("\n"), /von außen entfernt/);
    assert.throws(() => journal.append("run-a", { id: "c1", type: "run.create", actorId: "human", requestHash: "h" }, [
        { type: "run.created", actorId: "human", payload: { title: "x", ownerId: "human" } } as never,
    ]), /keine Schreibvorgänge mehr/);
    journal.close();
});

test("run IDs reject filesystem aliases before journal I/O", (t) => {
    const base = temporaryDirectory(t);
    const root = join(base, "runs");
    mkdirSync(root);
    const journal = new Journal(root, services());
    const runtime = new Orchestration(journal, services());

    try {
        for (const runId of [
            ".",
            "..",
            ".writer.lock",
            ".WRITER.LOCK",
            "Run-A",
            "-run",
            "run-",
            "run.",
            "con",
            "nul",
            "com1",
            "r".repeat(65),
        ]) {
            assert.throws(
                () => runtime.createRun(
                    { commandId: `create-${runId}` },
                    { runId, title: "Invalid", ownerHandle: "owner", ownerDisplayName: "Owner" },
                ),
                /cannot be used as a journal directory/,
            );
        }

        assert.deepEqual(journal.runIds(), []);
        assert.equal(existsSync(join(root, "journal.jsonl")), false);
        assert.equal(existsSync(join(base, "journal.jsonl")), false);
    } finally {
        journal.close();
    }
});

test("run IDs are canonical and portable across append, adoption, fork, and replay", (t) => {
    const root = temporaryDirectory(t);
    const journal = new Journal(root, services());
    const runtime = new Orchestration(journal, services());

    try {
        const view = runtime.createRun(
            { commandId: "create-portable" },
            { runId: "run-a", title: "Valid", ownerHandle: "owner", ownerDisplayName: "Owner" },
        );
        assert.equal(view.id, "run-a");
        assert.throws(
            () => runtime.createRun(
                { commandId: "create-windows-alias" },
                { runId: "run-a.", title: "Invalid", ownerHandle: "owner", ownerDisplayName: "Owner" },
            ),
            /Run ID run-a\. cannot be used as a journal directory/,
        );

        const adopted = record() as unknown as CommandRecord;
        adopted.runId = "run-b.";
        adopted.events[0]!.runId = "run-b.";
        assert.throws(
            () => journal.adopt([adopted]),
            /event 1\.runId must be a lowercase portable run ID/,
        );

        const adoptedRecord = record() as unknown as CommandRecord;
        adoptedRecord.runId = "run-b.";
        assert.throws(
            () => journal.adopt([adoptedRecord]),
            /Run ID run-b\. cannot be used as a journal directory/,
        );

        const forkRecord = record(
            "run.forked",
            3,
            3,
            { sourceRunId: "run-a.", sourceSequence: 1 },
        ) as unknown as CommandRecord;
        assert.throws(
            () => journal.adopt([forkRecord]),
            /payload\.sourceRunId must be a lowercase portable run ID/,
        );
        assert.deepEqual(journal.runIds(), ["run-a"]);
    } finally {
        journal.close();
    }

    const replayRoot = temporaryDirectory(t);
    const replayRunId = "run-c.";
    const replayRecord = record() as unknown as CommandRecord;
    replayRecord.runId = replayRunId;
    replayRecord.events[0]!.runId = replayRunId;
    mkdirSync(join(replayRoot, replayRunId));
    writeFileSync(join(replayRoot, replayRunId, "journal.jsonl"), `${stored(replayRecord)}\n`, "utf8");

    assertIsolated(replayRoot, /Run ID run-c\. cannot be used as a journal directory/, replayRunId);
});

test("closing an old owner cannot remove a replacement writer lock", (t) => {
    const root = temporaryDirectory(t);
    const lockPath = join(root, ".writer.lock");
    const first = new Journal(root, services());

    rmSync(lockPath, { recursive: true });
    const second = new Journal(root, services());
    first.close();

    assert.equal(existsSync(lockPath), true);
    assert.throws(() => new Journal(root, services()), /already owns/);

    second.close();
    assert.equal(existsSync(lockPath), false);
});

test("replay rejects unknown event types", (t) => {
    const root = temporaryDirectory(t);
    writeJournal(root, `${stored(record("future.event"))}\n`);

    assertIsolated(root, /unknown event type future\.event/);
});

test("adoption rejects unsupported event schema versions", () => {
    const journal = new Journal(":memory:", services());
    assert.throws(() => journal.adopt([record("run.created", 2) as unknown as CommandRecord]), /unsupported schema version 2/);
    journal.close();
});

test("replay rejects the previous full-record disk format", (t) => {
    const root = temporaryDirectory(t);
    writeJournal(root, `${JSON.stringify(record())}\n`);
    assertIsolated(root, /unsupported journal format version 3/);
});

test("replay rejects a missing nested event field", (t) => {
    const root = temporaryDirectory(t);
    writeJournal(root, `${stored(record("run.created", 3, 3, {
        title: "Test",
        owner: {
            id: "human-1",
            handle: "Owner",
            grants: [],
        },
    }))}\n`);

    assertIsolated(root, /payload\.owner\.displayName is required/);
});

test("replay rejects a wrongly typed nested event field", (t) => {
    const root = temporaryDirectory(t);
    writeJournal(root, `${stored(record("run.created", 3, 3, {
        title: "Test",
        owner: {
            id: "human-1",
            handle: "Owner",
            displayName: "Owner",
            grants: "all",
        },
    }))}\n`);

    assertIsolated(root, /payload\.owner\.grants must be an array/);
});

test("replay hard-rejects pre-v4 journals", (t) => {
    const root = temporaryDirectory(t);
    writeJournal(root, `${stored(record("run.created", 2, 2))}\n`);

    assertIsolated(root, /unsupported journal format version 2/);
});

test("replay isolates and preserves a journal with no committed record", (t) => {
    const root = temporaryDirectory(t);
    writeJournal(root, stored(record()));

    const journal = new Journal(root, services());
    assert.deepEqual(journal.runIds(), []);
    assert.match(journal.failureOf("run-1")?.message ?? "", /contains no committed run/);
    assert.equal(readFileSync(join(root, "run-1", "journal.jsonl"), "utf8"), stored(record()));
    journal.close();
});

test("append extends an existing journal file in place", (t) => {
    const root = temporaryDirectory(t);
    const committed = `${stored(record())}\n`;
    writeJournal(root, committed);
    const journal = new Journal(root, services(100));
    const journalPath = join(root, "run-1", "journal.jsonl");
    const inodeBefore = statSync(journalPath).ino;

    journal.append("run-1", secondCommand(), [secondEvent()]);

    assert.equal(statSync(journalPath).ino, inodeBefore);
    const content = readFileSync(journalPath, "utf8");
    assert.equal(content.startsWith(committed), true);
    assert.equal(content.endsWith("\n"), true);
    assert.equal(content.trim().split("\n").length, 2);
    assert.equal(journal.load("run-1").length, 2);
    journal.close();

    const replay = new Journal(root, services());
    assert.equal(replay.load("run-1").length, 2);
    replay.close();
});

test("replay drops a torn last line, repairs the file, and appends cleanly afterwards", (t) => {
    const root = temporaryDirectory(t);
    const committed = `${stored(record())}\n`;
    writeJournal(root, `${committed}{"formatVersion":3,"runId":"run-1","comm`);
    const journal = new Journal(root, services(100));
    const journalPath = join(root, "run-1", "journal.jsonl");

    assert.equal(journal.load("run-1").length, 1);
    assert.equal(readFileSync(journalPath, "utf8"), committed);

    journal.append("run-1", secondCommand(), [secondEvent()]);
    assert.equal(journal.load("run-1").length, 2);
    journal.close();

    const replay = new Journal(root, services());
    assert.equal(replay.load("run-1").length, 2);
    assert.equal(readFileSync(journalPath, "utf8").trim().split("\n").length, 2);
    replay.close();
});

test("replay drops a newline-terminated last line that is not valid JSON", (t) => {
    const root = temporaryDirectory(t);
    const committed = `${stored(record())}\n`;
    writeJournal(root, `${committed}{"broken\n`);

    const journal = new Journal(root, services());
    assert.equal(journal.load("run-1").length, 1);
    assert.equal(readFileSync(join(root, "run-1", "journal.jsonl"), "utf8"), committed);
    journal.close();
});

test("replay keeps corruption in a non-last line a hard error", (t) => {
    const root = temporaryDirectory(t);
    writeJournal(root, `{"broken\n${stored(record())}\n`);

    assertIsolated(root, /journal\.jsonl:1 is not valid JSON/);
});

test("replay keeps a validation error in the last line a hard error", (t) => {
    const root = temporaryDirectory(t);
    writeJournal(root, `${stored(record())}\n{"formatVersion":3}\n`);

    assertIsolated(root, /journal\.jsonl:2/);
});

test("replay rejects duplicate event IDs across records and runs", (t) => {
    const sameRunRoot = temporaryDirectory(t);
    const second = pluginStateRecord();
    const secondEvent = second.events[0];
    assert.ok(secondEvent);
    secondEvent.eventId = "event-1";
    writeJournal(sameRunRoot, `${stored(record())}\n${stored(second)}\n`);

    assertIsolated(sameRunRoot, /Event ID event-1 occurs more than once/);

    const crossRunRoot = temporaryDirectory(t);
    const otherRun = structuredClone(record());
    const otherEvent = otherRun.events[0];
    assert.ok(otherEvent);
    otherRun.runId = "run-2";
    otherRun.command.id = "command-2";
    otherEvent.runId = "run-2";
    otherEvent.commandId = "command-2";
    writeJournal(crossRunRoot, `${stored(record())}\n`);
    const otherDirectory = join(crossRunRoot, "run-2");
    mkdirSync(otherDirectory);
    writeFileSync(join(otherDirectory, "journal.jsonl"), `${stored(otherRun)}\n`, "utf8");

    assertIsolated(crossRunRoot, /Event ID event-1 occurs more than once/, "run-2");
});

test("journal append leaves a complete readable file", (t) => {
    const root = temporaryDirectory(t);
    const journal = new Journal(root, services());
    journal.append(
        "run-1",
        {
            id: "command-1",
            type: "run.create",
            actorId: "human-1",
            requestHash: "request-hash",
        },
        [
            {
                type: "run.created",
                actorId: "human-1",
                correlationId: null,
                causationId: null,
                payload: {
                    title: "Test",
                    owner: {
                        id: "human-1",
                        handle: "Owner",
                        displayName: "Owner",
                        grants: [],
                    },
                },
            },
        ],
    );
    journal.close();

    const runDirectory = join(root, "run-1");
    const content = readFileSync(join(runDirectory, "journal.jsonl"), "utf8");
    assert.equal(content.endsWith("\n"), true);
    assert.deepEqual(readdirSync(runDirectory), ["journal.jsonl"]);

    const replay = new Journal(root, services());
    assert.equal(replay.load("run-1").length, 1);
    replay.close();
});

test("append installs a fully renamed command before a directory fsync error", {
    skip: process.platform === "win32" || process.getuid?.() === 0,
}, (t) => {
    const root = temporaryDirectory(t);
    const runDirectory = join(root, "run-1");
    mkdirSync(runDirectory);
    const journal = new Journal(root, services());
    chmodSync(runDirectory, 0o300);
    const command = {
        id: "command-1",
        type: "run.create",
        actorId: "human-1",
        requestHash: "request-hash",
    };
    const proposed = [{
        type: "run.created" as const,
        actorId: "human-1",
        correlationId: null,
        causationId: null,
        payload: runCreatedPayload(),
    }];
    let appendError: unknown = null;

    try {
        journal.append("run-1", command, proposed);
    } catch (error) {
        appendError = error;
    } finally {
        chmodSync(runDirectory, 0o700);
    }

    assert.ok(appendError instanceof Error && "code" in appendError);
    assert.equal(appendError.code, "EACCES");
    const installed = journal.load("run-1");
    assert.equal(installed.length, 1);

    const retried = journal.append("run-1", command, proposed);
    assert.equal(retried[0]?.eventId, installed[0]?.eventId);
    const journalPath = join(runDirectory, "journal.jsonl");
    assert.equal(readFileSync(journalPath, "utf8").trim().split("\n").length, 1);
    journal.close();

    const replay = new Journal(root, services());
    assert.equal(replay.load("run-1").length, 1);
    replay.close();
});

test("append validates the same nested payload shape before persistence", (t) => {
    const root = temporaryDirectory(t);
    const journal = new Journal(root, services());
    const malformed = {
        type: "run.created",
        actorId: "human-1",
        correlationId: null,
        causationId: null,
        payload: {
            title: "Test",
            owner: {
                id: "human-1",
                handle: "Owner",
                displayName: 42,
                grants: [],
            },
        },
    } as unknown as UncommittedEvent;

    assert.throws(() => journal.append(
        "run-1",
        {
            id: "command-1",
            type: "run.create",
            actorId: "human-1",
            requestHash: "request-hash",
        },
        [malformed],
    ), /payload\.owner\.displayName must be a string/);
    assert.deepEqual(journal.runIds(), []);
    assert.equal(existsSync(join(root, "run-1")), false);
    journal.close();
});

test("append rejects duplicate generated event IDs before persistence", (t) => {
    const root = temporaryDirectory(t);
    const duplicateServices = {
        now: () => "2026-08-15T12:00:00.000Z",
        newId: () => "event-duplicate",
    } satisfies RuntimeServices;
    const journal = new Journal(root, duplicateServices);

    assert.throws(() => journal.append(
        "run-1",
        {
            id: "command-1",
            type: "run.create",
            actorId: "human-1",
            requestHash: "request-hash",
        },
        [
            {
                type: "run.created",
                actorId: "human-1",
                correlationId: null,
                causationId: null,
                payload: runCreatedPayload(),
            },
            {
                type: "plugin.state-replaced",
                actorId: "human-1",
                correlationId: null,
                causationId: null,
                payload: { pluginId: "test", scope: { kind: "run" }, state: {} },
            },
        ],
    ), /Event ID event-duplicate occurs more than once/);
    assert.deepEqual(journal.runIds(), []);
    assert.equal(existsSync(join(root, "run-1")), false);
    journal.close();
});

test("adopt rejects missing and wrongly typed nested payload fields", () => {
    const journal = new Journal(":memory:", services());
    const missing = record("run.created", 3, 3, {
        title: "Test",
        owner: {
            id: "human-1",
            displayName: "Owner",
            grants: [],
        },
    }) as unknown as CommandRecord;
    const wronglyTyped = record("run.created", 3, 3, {
        title: "Test",
        owner: {
            id: "human-1",
            handle: "Owner",
            displayName: "Owner",
            grants: [{ capability: "actor.input", scope: { kind: "run" }, delegable: "yes" }],
        },
    }) as unknown as CommandRecord;

    assert.throws(() => journal.adopt([missing]), /payload\.owner\.handle is required/);
    assert.throws(() => journal.adopt([wronglyTyped]), /payload\.owner\.grants\[0\]\.delegable must be a boolean/);
    assert.deepEqual(journal.runIds(), []);
    journal.close();
});

test("replay rejects path-unsafe and aliased actor IDs before loading the run", (t) => {
    for (const agentId of ["../../outside", "agent.", "con", "a".repeat(65)]) {
        const root = temporaryDirectory(t);
        const spawned = record(
            "agent.spawned",
            3,
            3,
            {
                agentId,
                handle: "worker",
                displayName: "Worker",
                prompt: "Work.",
                execution: {
                    driver: { kind: "manual", config: {} },
                    workspacePath: null,
                    turnTimeoutMs: null,
                },
                grants: [],
                toolNames: [],
            },
            "command-2",
            2,
        );
        spawned.command.type = "agent.spawn";
        writeJournal(root, `${stored(record())}\n${stored(spawned)}\n`);

        assertIsolated(root, /payload\.agentId must be a lowercase portable actor ID/);
        assert.equal(existsSync(join(root, "outside")), false);
    }
});

test("adopt rejects command accessors without evaluating them", () => {
    const journal = new Journal(":memory:", services());
    const unstable = record();
    let reads = 0;
    Object.defineProperty(unstable.command, "type", {
        enumerable: true,
        get: () => {
            reads += 1;
            return "run.create";
        },
    });

    assert.throws(
        () => journal.adopt([unstable as unknown as CommandRecord]),
        /command\.type must be an enumerable JSON value/,
    );
    assert.equal(reads, 0);
    assert.deepEqual(journal.runIds(), []);
    journal.close();
});

test("an invalid adopt batch performs no write or state mutation", (t) => {
    const root = temporaryDirectory(t);
    const journal = new Journal(root, services());
    const valid = record() as unknown as CommandRecord;
    const invalid = record(
        "action.resolved",
        3,
        3,
        {
            actionId: "missing-action",
            decision: "approved",
            response: null,
        },
        "command-2",
        2,
    ) as unknown as CommandRecord;

    assert.throws(() => journal.adopt([valid, invalid]), /Action missing-action does not exist/);
    assert.deepEqual(journal.runIds(), []);
    assert.equal(existsSync(join(root, "run-1")), false);
    journal.close();
    assert.deepEqual(readdirSync(root), []);
});

test("adopt rejects duplicate event IDs against state and within its batch", () => {
    const journal = new Journal(":memory:", services());
    const first = record() as unknown as CommandRecord;
    const duplicate = pluginStateRecord();
    const duplicateEvent = duplicate.events[0];
    assert.ok(duplicateEvent);
    duplicateEvent.eventId = "event-1";

    journal.adopt([first]);
    assert.throws(
        () => journal.adopt([duplicate as unknown as CommandRecord]),
        /Event ID event-1 occurs more than once/,
    );

    const fresh = new Journal(":memory:", services());
    assert.throws(
        () => fresh.adopt([first, duplicate as unknown as CommandRecord]),
        /Event ID event-1 occurs more than once/,
    );
    assert.deepEqual(fresh.runIds(), []);
    fresh.close();
    journal.close();
});

test("adopt rejects multi-run batches before persistence", (t) => {
    const root = temporaryDirectory(t);
    const journal = new Journal(root, services());
    const otherRun = structuredClone(record());
    const otherEvent = otherRun.events[0];
    assert.ok(otherEvent);
    otherRun.runId = "run-2";
    otherRun.command.id = "command-2";
    otherEvent.eventId = "event-2";
    otherEvent.runId = "run-2";
    otherEvent.commandId = "command-2";

    assert.throws(
        () => journal.adopt([
            record() as unknown as CommandRecord,
            otherRun as unknown as CommandRecord,
        ]),
        /An adopt batch must belong to one run/,
    );
    assert.deepEqual(journal.runIds(), []);
    journal.close();
    assert.deepEqual(readdirSync(root), []);
});

test("adopt stages the complete batch before atomically replacing the run journal", (t) => {
    const root = temporaryDirectory(t);
    const journal = new Journal(root, services());
    const runDirectory = join(root, "run-1");
    const journalPath = join(runDirectory, "journal.jsonl");
    mkdirSync(journalPath, { recursive: true });
    const adopted = [
        record() as unknown as CommandRecord,
        pluginStateRecord() as unknown as CommandRecord,
    ];

    assert.throws(
        () => journal.adopt(adopted),
        (error: unknown) => error instanceof Error && "code" in error,
    );
    assert.deepEqual(journal.runIds(), []);
    assert.deepEqual(readdirSync(runDirectory), ["journal.jsonl"]);
    assert.deepEqual(readdirSync(journalPath), []);

    rmSync(journalPath, { recursive: true });
    journal.adopt(adopted);
    assert.equal(journal.load("run-1").length, 2);
    assert.equal(readFileSync(journalPath, "utf8").trim().split("\n").length, 2);
    journal.close();

    const replay = new Journal(root, services());
    assert.equal(replay.load("run-1").length, 2);
    replay.close();
});

test("artifact publication verifies collisions and reads", (t) => {
    const directory = temporaryDirectory(t);
    const contents = new DirectoryArtifactContents(directory);
    const value = Buffer.from("immutable artifact", "utf8");
    const stored = contents.put(value);

    assert.deepEqual(contents.read(stored.hash), value);
    assert.deepEqual(contents.put(value), stored);
    assert.deepEqual(readdirSync(directory), [stored.hash]);

    writeFileSync(join(directory, stored.hash), "corrupt", "utf8");
    assert.throws(() => contents.read(stored.hash), /failed its integrity check/);
    assert.throws(() => contents.put(value), /already exists with different bytes/);
    assert.deepEqual(readdirSync(directory), [stored.hash]);
});

test("artifact EEXIST cannot bless content stored under the wrong hash", (t) => {
    const directory = temporaryDirectory(t);
    const contents = new DirectoryArtifactContents(directory);
    const value = Buffer.from("expected", "utf8");
    const hash = createHash("sha256").update(value).digest("hex");
    writeFileSync(join(directory, hash), "different", "utf8");

    assert.throws(() => contents.put(value), /already exists with different bytes/);
    assert.deepEqual(readdirSync(directory), [hash]);
});

test("a forgotten run leaves the registry and can be created again under the same command id", () => {
    const usedServices = services();
    const journal = new Journal(":memory:", usedServices);
    const runtime = new Orchestration(journal, usedServices);

    try {
        const view = runtime.createRun({ commandId: "create-run" }, { title: "Weg damit", ownerHandle: "owner", ownerDisplayName: "Owner" });

        assert.deepEqual(journal.runIds(), [view.id]);
        assert.equal(journal.forget(view.id), true);
        assert.deepEqual(journal.runIds(), []);
        assert.equal(journal.stateOf(view.id), null);
        assert.equal(journal.forget(view.id), false);

        const zweiter = runtime.createRun({ commandId: "create-run" }, { title: "Neu", ownerHandle: "owner", ownerDisplayName: "Owner" });

        assert.notEqual(zweiter.id, view.id);
        assert.deepEqual(journal.runIds(), [zweiter.id]);
    } finally {
        journal.close();
    }
});

test("isolated journals preserve bytes and cannot reserve IDs or block healthy runs", (t) => {
    const root = temporaryDirectory(t);
    const invalid = pluginStateRecord();
    invalid.command.actorId = "missing-owner";
    invalid.events[0]!.actorId = "missing-owner";
    const broken = `${stored(record())}\n${stored(invalid)}\n{"torn`;
    writeJournal(root, broken);
    const healthy = record();
    healthy.runId = "run-2";
    healthy.events[0]!.runId = "run-2";
    const healthyDirectory = join(root, "run-2");
    mkdirSync(healthyDirectory);
    writeFileSync(join(healthyDirectory, "journal.jsonl"), `${stored(healthy)}\n`);
    const diagnostics: string[] = [];
    const journal = new Journal(root, services(100), { onLoadError: (failure) => diagnostics.push(failure.message) });
    t.after(() => journal.close());

    assert.deepEqual(journal.runIds(), ["run-2"]);
    assert.equal(journal.loadFailures().length, 1);
    assert.match(diagnostics[0]!, /missing-owner/);
    assert.equal(journal.creationCommand("command-1")?.runId, "run-2");
    assert.equal(journal.findCommandRun("command-2"), null);
    assert.equal(journal.stateOf("run-1"), null);
    assert.equal(journal.load("run-2").length, 1);
    assert.equal(readFileSync(join(root, "run-1", "journal.jsonl"), "utf8"), broken);
    assert.throws(() => journal.records("run-1"), { code: "journal-unavailable", status: 409 });
    assert.throws(() => journal.append("run-1", secondCommand(), [secondEvent()]), { code: "journal-unavailable", status: 409 });
    assert.throws(() => journal.adopt([record() as CommandRecord]), { code: "journal-unavailable", status: 409 });
    const runtime = new Orchestration(journal, services(200));
    assert.throws(() => runtime.state("run-1"), { code: "journal-unavailable", status: 409 });
    assert.equal(journal.append("run-2", secondCommand(), [secondEvent()]).length, 1);
    const created = runtime.createRun({ commandId: "new-run" }, {
        title: "Still running", ownerHandle: "owner", ownerDisplayName: "Owner",
    });
    assert.equal(runtime.state(created.id).title, "Still running");
    assert.equal(readFileSync(join(root, "run-1", "journal.jsonl"), "utf8"), broken);
});

test("legacy and malformed journals are isolated without repairing their trailing bytes", (t) => {
    for (const content of [`${JSON.stringify(record())}\n{"torn`, `{"broken\n${stored(record())}\n{"torn`]) {
        const root = temporaryDirectory(t);
        writeJournal(root, content);
        const path = join(root, "run-1", "journal.jsonl");
        const before = readFileSync(path);
        const journal = new Journal(root, services(), { onLoadError: () => {} });
        assert.equal(journal.loadFailures().length, 1);
        assert.deepEqual(readFileSync(path), before);
        journal.close();
    }
});

test("run-level I/O failures and missing journals reserve their directories until explicitly forgotten", (t) => {
    const root = temporaryDirectory(t);
    const missingDirectory = join(root, "run-1");
    mkdirSync(join(missingDirectory, "payloads"), { recursive: true });
    writeFileSync(join(missingDirectory, "payloads", "existing.json"), "preserve me");
    mkdirSync(join(root, "run-2", "journal.jsonl"), { recursive: true });
    mkdirSync(join(root, "run-3"));
    const journal = new Journal(root, services(), { onLoadError: () => {} });
    t.after(() => journal.close());

    assert.deepEqual(journal.loadFailures().map((failure) => failure.runId), ["run-1", "run-2"]);
    assert.match(journal.failureOf("run-1")?.message ?? "", /missing in a non-empty run directory/);
    assert.throws(() => journal.adopt([record() as CommandRecord]), { code: "journal-unavailable", status: 409 });
    assert.equal(existsSync(join(missingDirectory, "journal.jsonl")), false);
    assert.equal(readFileSync(join(missingDirectory, "payloads", "existing.json"), "utf8"), "preserve me");
    rmSync(missingDirectory, { recursive: true });
    assert.equal(journal.forget("run-1"), true);
    assert.equal(journal.failureOf("run-1"), null);
    journal.adopt([record() as CommandRecord]);
    assert.equal(journal.stateOf("run-1")?.title, "Test");
});

import { randomUUID } from "node:crypto";
import {
    closeSync,
    existsSync,
    fsyncSync,
    ftruncateSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmdirSync,
    unlinkSync,
    writeFileSync,
    writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { eventSemanticContext, type EventSemanticContext } from "../domain/event-semantics.ts";
import { journalEventOf, uncommittedEventOf } from "../domain/event-validation.ts";
import type { JournalEvent, UncommittedEvent } from "../domain/events.ts";
import { assertJsonValue } from "../domain/json.ts";
import type { RunId, RunState } from "../domain/model.ts";
import { isRunId } from "../domain/portable-id.ts";
import { applyEvent, forkProjection, type RunDraft } from "../domain/projection.ts";
import { DomainError } from "./domain-error.ts";
import { errorCode, syncDirectory } from "./durable-fs.ts";
import type { RuntimeServices } from "./services.ts";
import { parseJournalRecord, serializeJournalRecord } from "./journal-storage.ts";

export type JournalCommand = {
    id: string;
    type: string;
    actorId: string;
    requestHash: string;
};

export const journalFormatVersion = 3;

export type CommandRecord = {
    formatVersion: 3;
    runId: RunId;
    command: JournalCommand;
    events: JournalEvent[];
};

type RunLog = {
    records: CommandRecord[];
    commands: Map<string, CommandRecord>;
    events: JournalEvent[];
    state: RunDraft | null;
    semantics: EventSemanticContext;
};

type ProjectedRun = Pick<RunLog, "state" | "semantics">;

export type JournalLoadFailure = Readonly<{
    runId: string;
    path: string;
    message: string;
}>;

type JournalOptions = {
    onLoadError?: (failure: JournalLoadFailure) => void;
    onListenerError?: (error: unknown) => void;
    onStaleLock?: (message: string) => void;
    writerHeartbeatIntervalMs?: number;
    writerStaleAfterMs?: number;
};

type WriterLockOwner = {
    token: string;
    pid: number;
    hostname: string;
    startedAt: string;
    heartbeatAt: string;
};

const clone = <Value>(value: Value): Value => structuredClone(value);

const deepFreeze = <Value>(value: Value): Value => {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);

        for (const entry of Object.values(value))
            deepFreeze(entry);
    }

    return value;
};

const objectOf = (value: unknown, location: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${location} is not a journal record.`);

    return value as Record<string, unknown>;
};

const assertExactKeys = (
    value: Record<string, unknown>,
    location: string,
    keys: readonly string[],
) => {
    const expected = new Set(keys);

    for (const key of keys) {
        if (!Object.hasOwn(value, key))
            throw new Error(`${location}.${key} is required.`);
    }

    for (const key of Object.keys(value)) {
        if (!expected.has(key))
            throw new Error(`${location}.${key} is not supported.`);
    }
};

const writerLockDirectory = ".writer.lock";
const writerHeartbeatIntervalMs = 5_000;
const writerStaleAfterMs = 30_000;

const createLockDirectory = (lockPath: string) => {
    try {
        mkdirSync(lockPath);

        return true;
    } catch (error) {
        if (errorCode(error) !== "EEXIST")
            throw error;

        return false;
    }
};

const removeLock = (lockPath: string) => {
    for (const entry of readdirSync(lockPath))
        unlinkSync(join(lockPath, entry));

    rmdirSync(lockPath);
};

const processAlive = (pid: number) => {
    try {
        process.kill(pid, 0);

        return true;
    } catch (error) {
        return errorCode(error) !== "ESRCH";
    }
};

const writeOwner = (descriptor: number, owner: WriterLockOwner) => {
    ftruncateSync(descriptor, 0);
    writeSync(descriptor, JSON.stringify(owner) + "\n", 0, "utf8");
};

/** Why an existing lock may be taken over, or null while a living writer may still hold it. */
const staleLockReason = (lockPath: string, staleAfterMs: number): string | null => {
    const owners = readdirSync(lockPath).filter((name) => name.startsWith("owner-") && name.endsWith(".json"));

    if (owners.length === 0)
        return "kein Besitzer eingetragen";

    if (owners.length > 1)
        return null;

    let owner: Record<string, unknown>;

    try {
        owner = objectOf(JSON.parse(readFileSync(join(lockPath, owners[0]!), "utf8")), "writer lock owner");
    } catch {
        return null;
    }

    const pid = typeof owner.pid === "number" ? owner.pid : null;
    const sameHost = typeof owner.hostname !== "string" || owner.hostname === hostname();

    if (sameHost && pid !== null && !processAlive(pid))
        return `Prozess ${pid} lebt nicht mehr`;

    const lastSeen = typeof owner.heartbeatAt === "string"
        ? owner.heartbeatAt
        : typeof owner.startedAt === "string" ? owner.startedAt : null;
    const age = lastSeen === null ? Number.NaN : Date.now() - Date.parse(lastSeen);

    if (!Number.isFinite(age) || age <= staleAfterMs)
        return null;

    const who = sameHost ? `Prozess ${pid ?? "?"}` : `Prozess ${pid ?? "?"} auf ${String(owner.hostname)}`;

    return `${who} ohne Herzschlag seit ${Math.round(age / 1000)} s`;
};

const assertRunId = (runId: string) => {
    if (!isRunId(runId))
        throw new Error(`Run ID ${runId} cannot be used as a journal directory.`);
};

export const sameJournalCommand = (left: JournalCommand, right: JournalCommand) =>
    left.id === right.id &&
    left.type === right.type &&
    left.actorId === right.actorId &&
    left.requestHash === right.requestHash;

const commandOf = (value: unknown, location: string): JournalCommand => {
    const command = objectOf(value, location);
    assertExactKeys(command, location, ["id", "type", "actorId", "requestHash"]);

    for (const key of ["id", "type", "actorId", "requestHash"] as const) {
        if (typeof command[key] !== "string")
            throw new Error(`${location}.${key} must be a string.`);
    }

    return value as JournalCommand;
};

const journalRecordOf = (value: unknown, location: string): CommandRecord => {
    assertJsonValue(value, location);
    const candidate = objectOf(value, location);

    if (candidate.formatVersion !== journalFormatVersion)
        throw new Error(`${location} has unsupported journal format version ${String(candidate.formatVersion)}.`);

    assertExactKeys(candidate, location, ["formatVersion", "runId", "command", "events"]);

    if (typeof candidate.runId !== "string")
        throw new Error(`${location}.runId must be a string.`);

    commandOf(candidate.command, `${location}.command`);

    if (!Array.isArray(candidate.events) || candidate.events.length === 0)
        throw new Error(`${location}.events must be a non-empty array.`);

    candidate.events.forEach((event, index) => journalEventOf(event, `${location}, event ${index + 1}`));

    return value as CommandRecord;
};

const parsesAsJson = (line: string) => {
    try {
        JSON.parse(line);

        return true;
    } catch {
        return false;
    }
};

const assertCommandActor = (record: CommandRecord, event: JournalEvent) => {
    if (event.actorId !== record.command.actorId)
        throw new Error(
            `Event ${event.eventId} actor ${event.actorId} does not match command actor ${record.command.actorId}.`,
        );
};

export class Journal {
    readonly #path: string | null;
    readonly #services: RuntimeServices;
    readonly #onListenerError: (error: unknown) => void;
    readonly #listeners = new Set<(events: JournalEvent[]) => void>();
    readonly #pendingPublications: JournalEvent[][] = [];
    readonly #runs = new Map<RunId, RunLog>();
    readonly #loadFailures = new Map<string, JournalLoadFailure>();
    readonly #onLoadError: (failure: JournalLoadFailure) => void;
    readonly #creationCommands = new Map<string, CommandRecord>();
    readonly #eventIds = new Set<string>();
    readonly #onStaleLock: (message: string) => void;
    readonly #heartbeatIntervalMs: number;
    readonly #staleAfterMs: number;
    #lockDescriptor: number | null = null;
    #lockOwnerPath: string | null = null;
    #lockOwner: WriterLockOwner | null = null;
    #heartbeat: NodeJS.Timeout | null = null;
    #lockLost = false;
    readonly #writeFailures = new Map<RunId, Error>();
    #publishing = false;
    #closed = false;

    constructor(path: string, services: RuntimeServices, options: JournalOptions = {}) {
        this.#path = path === ":memory:" ? null : path;
        this.#services = services;
        this.#onListenerError = options.onListenerError ?? ((error) => console.error("Journal listener failed:", error));
        this.#onLoadError = options.onLoadError ?? ((failure) => console.error(`Journal ${failure.runId} (${failure.path}) ist nicht verfügbar: ${failure.message}`));
        this.#onStaleLock = options.onStaleLock ?? ((message) => console.warn(message));
        this.#heartbeatIntervalMs = options.writerHeartbeatIntervalMs ?? writerHeartbeatIntervalMs;
        this.#staleAfterMs = options.writerStaleAfterMs ?? writerStaleAfterMs;

        if (this.#path) {
            mkdirSync(this.#path, { recursive: true });
            this.#acquireWriterLock();

            try {
                this.#loadFiles();
            } catch (error) {
                this.#releaseWriterLock();
                throw error;
            }
        }
    }

    close() {
        if (this.#closed)
            return;

        this.#closed = true;
        this.#releaseWriterLock();
    }

    subscribe(listener: (events: JournalEvent[]) => void) {
        this.#listeners.add(listener);

        return () => this.#listeners.delete(listener);
    }

    forget(runId: RunId) {
        const failed = this.#loadFailures.delete(runId) || this.#writeFailures.has(runId);
        this.#writeFailures.delete(runId);

        if (!this.#runs.has(runId))
            return failed;

        for (const [commandId, record] of this.#creationCommands) {
            if (record.runId === runId)
                this.#creationCommands.delete(commandId);
        }

        for (const event of this.#runs.get(runId)?.events ?? [])
            this.#eventIds.delete(event.eventId);

        return this.#runs.delete(runId);
    }

    runIds() {
        return [...this.#runs.entries()]
            .filter(([runId]) => !this.#writeFailures.has(runId))
            .sort(([leftId, left], [rightId, right]) => {
                const leftAt = left.events[0]?.occurredAt ?? "";
                const rightAt = right.events[0]?.occurredAt ?? "";

                return leftAt.localeCompare(rightAt) || leftId.localeCompare(rightId);
            })
            .map(([runId]) => runId);
    }

    loadFailures(): readonly JournalLoadFailure[] {
        return [...this.#loadFailures.values()];
    }

    failureOf(runId: string): JournalLoadFailure | null {
        const failure = this.#loadFailures.get(runId);
        const writeFailure = this.#writeFailures.get(runId);

        return failure ?? (writeFailure ? Object.freeze({
            runId,
            path: this.#path ? join(this.#path, runId, "journal.jsonl") : ":memory:",
            message: writeFailure.message,
        }) : null);
    }

    assertRunAvailable(runId: string) {
        const failure = this.failureOf(runId);

        if (failure)
            throw new DomainError("journal-unavailable", `Journal für Run ${runId} ist nicht verfügbar: ${failure.message}`, 409);
    }

    load(runId: RunId) {
        this.assertRunAvailable(runId);
        return [...(this.#runs.get(runId)?.events ?? [])];
    }

    records(runId: RunId): readonly CommandRecord[] {
        this.assertRunAvailable(runId);
        return [...(this.#runs.get(runId)?.records ?? [])];
    }

    stateOf(runId: RunId): RunState | null {
        const state = this.#runs.get(runId)?.state;

        return state ? clone(state) : null;
    }

    updatedAt(runId: RunId): string | null {
        return this.#runs.get(runId)?.events.at(-1)?.occurredAt ?? null;
    }

    commandFor(runId: RunId, commandId: string) {
        return this.#runs.get(runId)?.commands.get(commandId)?.command ?? null;
    }

    creationCommand(commandId: string) {
        const record = this.#creationCommands.get(commandId);

        return record ? { runId: record.runId, command: record.command } : null;
    }

    findCommandRun(commandId: string): RunId | null {
        for (const [runId, log] of this.#runs) {
            if (log.commands.has(commandId))
                return runId;
        }

        return null;
    }

    append(runId: RunId, command: JournalCommand, proposed: readonly UncommittedEvent[]) {
        if (this.#closed)
            throw new Error("The journal is closed.");

        this.#assertLockHeld();

        if (proposed.length === 0)
            throw new Error("A command must append at least one event.");

        this.assertRunAvailable(runId);
        assertRunId(runId);
        commandOf(command, "append command");
        proposed.forEach((event, index) => uncommittedEventOf(event, `append event ${index + 1}`));
        const log = this.#runs.get(runId);
        const existing = log?.commands.get(command.id);

        if (existing) {
            if (!sameJournalCommand(existing.command, command))
                throw new DomainError("command-id-collision", `Command ID ${command.id} was already used for another command.`, 409);

            return [...existing.events];
        }

        const creation = this.#creationCommands.get(command.id);

        if (creation && creation.runId !== runId)
            throw new DomainError("command-id-collision", `Command ID ${command.id} was already used to create another run.`, 409);

        const latestSequence = log?.events.at(-1)?.sequence ?? 0;
        const occurredAt = this.#services.now();
        const committed = proposed.map(
            (event, index): JournalEvent => ({
                ...clone(event),
                eventId: this.#services.newId("event"),
                runId,
                sequence: latestSequence + index + 1,
                schemaVersion: journalFormatVersion,
                occurredAt,
                commandId: command.id,
            }),
        );
        const record = journalRecordOf({
            formatVersion: journalFormatVersion,
            runId,
            command: clone(command),
            events: committed,
        }, "append record");

        const projected = this.#preflightRecords([record]);
        const projectedRun = projected.get(runId);

        if (!projectedRun)
            throw new Error(`Run ${runId} was not projected before append.`);

        let installed = false;

        try {
            this.#persistAppend(record, () => {
                this.#installAdoptedRecords([record], projectedRun);
                installed = true;
            });
        } catch (error) {
            if (installed)
                this.#publish(committed);

            throw error;
        }

        this.#publish(committed);

        return [...committed];
    }

    adopt(records: readonly CommandRecord[]) {
        if (this.#closed)
            throw new Error("The journal is closed.");

        this.#assertLockHeld();

        const adopted = records.map((record, index) =>
            clone(journalRecordOf(record, `adopt record ${index + 1}`)));

        const runIds = new Set(adopted.map((record) => record.runId));

        if (runIds.size > 1)
            throw new Error("An adopt batch must belong to one run.");

        const projected = this.#preflightRecords(adopted);
        const first = adopted[0];
        const adoptedRun = first ? projected.get(first.runId) : null;

        if (first && !adoptedRun)
            throw new Error(`Run ${first.runId} was not projected before adoption.`);

        let committed = false;

        try {
            this.#replaceRecords(adopted, () => {
                if (adoptedRun)
                    this.#installAdoptedRecords(adopted, adoptedRun);

                committed = true;
            });
        } catch (error) {
            if (committed)
                this.#publish(adopted.flatMap((record) => record.events));

            throw error;
        }

        this.#publish(adopted.flatMap((record) => record.events));
    }

    #preflightRecords(records: readonly CommandRecord[]) {
        const commandIds = new Map<RunId, Set<string>>();
        const nextSequences = new Map<RunId, number>();
        const creations = new Set<string>();
        const eventIds = new Set<string>();
        const appended = new Map<RunId, JournalEvent[]>();
        const projected = new Map<RunId, ProjectedRun>();

        for (const record of records) {
            this.assertRunAvailable(record.runId);
            assertRunId(record.runId);
            const ids = commandIds.get(record.runId) ?? new Set<string>();

            if (ids.has(record.command.id) || this.#runs.get(record.runId)?.commands.has(record.command.id))
                throw new Error(`Command ${record.command.id} occurs twice in run ${record.runId}.`);

            ids.add(record.command.id);
            commandIds.set(record.runId, ids);

            let expected = nextSequences.get(record.runId) ?? (this.#runs.get(record.runId)?.events.length ?? 0) + 1;

            for (const event of record.events) {
                if (eventIds.has(event.eventId) || this.#eventIds.has(event.eventId))
                    throw new Error(`Event ID ${event.eventId} occurs more than once.`);

                if (event.runId !== record.runId || event.sequence !== expected || event.commandId !== record.command.id)
                    throw new Error(`Journal sequence ${record.runId}:${event.sequence} is inconsistent.`);

                assertCommandActor(record, event);

                eventIds.add(event.eventId);
                expected += 1;
            }

            nextSequences.set(record.runId, expected);

            if (record.events.some((event) => event.type === "run.created")) {
                const previous = creations.has(record.command.id) || this.#creationCommands.has(record.command.id);

                if (previous)
                    throw new Error(`Creation command ${record.command.id} occurs in more than one run.`);

                creations.add(record.command.id);
            }

            const events = appended.get(record.runId) ?? [];
            events.push(...record.events);
            appended.set(record.runId, events);
        }

        for (const [runId, events] of appended) {
            const log = this.#runs.get(runId);
            const semantics = log ? {
                events: new Map(log.semantics.events),
                toolCalls: clone(log.semantics.toolCalls),
            } : eventSemanticContext();
            let state: RunDraft | null = log?.state ? forkProjection(log.state) : null;

            for (const event of events)
                state = applyEvent(state, event, semantics);

            projected.set(runId, { state, semantics });
        }

        return projected;
    }

    #publish(events: readonly JournalEvent[]) {
        if (events.length === 0)
            return;

        this.#pendingPublications.push([...events]);

        if (this.#publishing)
            return;

        this.#publishing = true;

        try {
            for (;;) {
                const batch = this.#pendingPublications.shift();

                if (!batch)
                    return;

                for (const listener of this.#listeners) {
                    try {
                        listener([...batch]);
                    } catch (error) {
                        this.#onListenerError(error);
                    }
                }
            }
        } finally {
            this.#publishing = false;
        }
    }

    #persistAppend(record: CommandRecord, commit: () => void) {
        if (!this.#path) {
            commit();
            return;
        }

        const path = join(this.#path, record.runId, "journal.jsonl");

        if (!existsSync(path)) {
            this.#replaceRecords([record], commit);
            return;
        }

        const content = serializeJournalRecord(record, join(this.#path, record.runId)) + "\n";

        try {
            const descriptor = openSync(path, "a");

            try {
                writeFileSync(descriptor, content, "utf8");
                fsyncSync(descriptor);
            } finally {
                closeSync(descriptor);
            }
        } catch (error) {
            const failure = new Error("Journal write failed; reopen the journal before retrying.", { cause: error });
            this.#writeFailures.set(record.runId, failure);
            throw failure;
        }

        commit();
    }

    #replaceRecords(records: readonly CommandRecord[], commit: () => void) {
        if (records.length === 0) {
            commit();
            return;
        }

        if (!this.#path) {
            commit();
            return;
        }

        const first = records[0];

        if (!first)
            throw new Error("An adopt batch must contain a record.");

        const runId = first.runId;
        const directory = join(this.#path, runId);
        const path = join(directory, "journal.jsonl");
        const temporaryPath = join(directory, `.journal.${randomUUID()}.tmp`);
        const directoryExists = existsSync(directory);
        const existing = this.#runs.get(runId)?.records ?? [];
        let descriptor: number | null = null;
        let renamed = false;

        try {
            mkdirSync(directory, { recursive: true });

            if (!directoryExists)
                syncDirectory(this.#path);

            const content = [...existing, ...records]
                .map((record) => serializeJournalRecord(record, directory))
                .join("\n") + "\n";
            descriptor = openSync(temporaryPath, "wx", 0o600);
            writeFileSync(descriptor, content, "utf8");
            fsyncSync(descriptor);
            closeSync(descriptor);
            descriptor = null;
            renameSync(temporaryPath, path);
            renamed = true;
            commit();
            syncDirectory(directory);
        } catch (error) {
            if (descriptor !== null) {
                try {
                    closeSync(descriptor);
                } catch {}
            }

            if (!renamed && existsSync(temporaryPath)) {
                try {
                    unlinkSync(temporaryPath);
                } catch {}
            }

            if (!directoryExists && !renamed) {
                try {
                    rmdirSync(directory);
                    syncDirectory(this.#path);
                } catch {}
            }

            throw error;
        }
    }

    #installAdoptedRecords(
        records: readonly CommandRecord[],
        projected: ProjectedRun,
    ) {
        const first = records[0];

        if (!first)
            return;

        records.forEach(deepFreeze);
        const log = this.#runs.get(first.runId) ?? {
            records: [],
            commands: new Map<string, CommandRecord>(),
            events: [],
            ...projected,
        };
        for (const record of records) {
            log.records.push(record);
            log.commands.set(record.command.id, record);
            log.events.push(...record.events);
        }
        log.state = projected.state;
        log.semantics = projected.semantics;
        this.#runs.set(first.runId, log);

        for (const record of records) {
            if (record.events.some((event) => event.type === "run.created"))
                this.#creationCommands.set(record.command.id, record);

            for (const event of record.events)
                this.#eventIds.add(event.eventId);
        }
    }

    #loadFiles() {
        if (!this.#path)
            return;

        const directories = readdirSync(this.#path, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name !== writerLockDirectory)
            .map((entry) => entry.name)
            .sort();

        for (const runId of directories) {
            const directory = join(this.#path, runId);
            const path = join(directory, "journal.jsonl");

            try {
                assertRunId(runId);

                if (!existsSync(path)) {
                    if (readdirSync(directory).length > 0)
                        throw new Error(`${path} is missing in a non-empty run directory.`);

                    continue;
                }

                const { lines, repair } = this.#committedLines(path);
                const records = lines.map((line, index) => {
                    if (!line)
                        throw new Error(`${path}:${index + 1} is an empty journal record.`);

                    const record = parseJournalRecord(line, directory, `${path}:${index + 1}`);

                    if (record.runId !== runId)
                        throw new Error(`${path}:${index + 1} belongs to run ${record.runId}.`);

                    return record;
                });
                const projected = this.#preflightRecords(records).get(runId);

                if (!projected)
                    throw new Error(`${path} contains no committed run.`);

                repair();
                this.#installAdoptedRecords(records, projected);
            } catch (error) {
                const failure = Object.freeze({ runId, path, message: error instanceof Error ? error.message : String(error) });
                this.#loadFailures.set(runId, failure);

                try {
                    this.#onLoadError(failure);
                } catch (reportError) {
                    console.error(`Journal ${runId} (${path}) ist nicht verfügbar: ${failure.message}`, reportError);
                }
            }
        }
    }

    #committedLines(path: string) {
        const raw = readFileSync(path, "utf8");
        const terminated = raw.slice(0, raw.lastIndexOf("\n") + 1);
        const lines = terminated.length === 0 ? [] : terminated.slice(0, -1).split("\n");
        const last = lines.at(-1);

        if (raw === terminated && last !== undefined && !parsesAsJson(last))
            lines.pop();

        const kept = lines.length === 0 ? "" : lines.join("\n") + "\n";
        const repair = () => {
            if (kept.length === raw.length)
                return;

            const descriptor = openSync(path, "r+");

            try {
                ftruncateSync(descriptor, Buffer.byteLength(kept, "utf8"));
                fsyncSync(descriptor);
            } finally {
                closeSync(descriptor);
            }
        };

        return { lines, repair };
    }

    #assertLockHeld() {
        if (this.#lockLost)
            throw new Error("Das Journal-Lock wurde von außen entfernt; dieses Journal nimmt keine Schreibvorgänge mehr an.");
    }

    #releaseWriterLock() {
        if (this.#heartbeat !== null) {
            clearInterval(this.#heartbeat);
            this.#heartbeat = null;
        }

        if (this.#lockDescriptor !== null) {
            closeSync(this.#lockDescriptor);
            this.#lockDescriptor = null;
        }

        const ownerPath = this.#lockOwnerPath;
        this.#lockOwnerPath = null;
        this.#lockOwner = null;

        if (!ownerPath)
            return;

        try {
            unlinkSync(ownerPath);
        } catch (error) {
            if (errorCode(error) === "ENOENT")
                return;

            throw error;
        }

        try {
            rmdirSync(join(ownerPath, ".."));
        } catch (error) {
            if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ENOTEMPTY")
                throw error;
        }
    }

    #acquireWriterLock() {
        if (!this.#path)
            return;

        const lockPath = join(this.#path, writerLockDirectory);

        if (!createLockDirectory(lockPath)) {
            const reason = staleLockReason(lockPath, this.#staleAfterMs);

            if (reason === null)
                throw new Error(
                    `Another runtime process already owns ${lockPath}. Stop every runtime process, then remove this lock manually if it is stale.`,
                );

            removeLock(lockPath);
            this.#onStaleLock(`Verwaistes Journal-Lock ${lockPath} übernommen: ${reason}.`);

            if (!createLockDirectory(lockPath))
                throw new Error(`Another runtime process took ${lockPath} while its stale lock was being replaced.`);
        }

        const token = randomUUID();
        const ownerPath = join(lockPath, `owner-${token}.json`);
        const startedAt = new Date().toISOString();
        const owner: WriterLockOwner = { token, pid: process.pid, hostname: hostname(), startedAt, heartbeatAt: startedAt };
        let descriptor: number | null = null;

        try {
            descriptor = openSync(ownerPath, "wx", 0o600);
            writeOwner(descriptor, owner);
            fsyncSync(descriptor);
            syncDirectory(lockPath);
            syncDirectory(this.#path);
            this.#lockDescriptor = descriptor;
            this.#lockOwnerPath = ownerPath;
            this.#lockOwner = owner;
        } catch (error) {
            if (descriptor !== null)
                closeSync(descriptor);

            if (existsSync(ownerPath))
                unlinkSync(ownerPath);

            try {
                rmdirSync(lockPath);
            } catch {
            }

            throw error;
        }

        this.#heartbeat = setInterval(() => this.#beat(), this.#heartbeatIntervalMs);
        this.#heartbeat.unref();
    }

    /** Refreshes the owner file; a vanished owner file means someone else took the lock. */
    #beat() {
        const ownerPath = this.#lockOwnerPath;
        const owner = this.#lockOwner;

        if (ownerPath === null || owner === null || this.#lockDescriptor === null)
            return;

        if (!existsSync(ownerPath)) {
            this.#lockLost = true;

            if (this.#heartbeat !== null) {
                clearInterval(this.#heartbeat);
                this.#heartbeat = null;
            }

            this.#onStaleLock(`Das Journal-Lock ${ownerPath} wurde von außen entfernt; dieses Journal nimmt keine Schreibvorgänge mehr an.`);

            return;
        }

        this.#lockOwner = { ...owner, heartbeatAt: new Date().toISOString() };
        writeOwner(this.#lockDescriptor, this.#lockOwner);
    }
}

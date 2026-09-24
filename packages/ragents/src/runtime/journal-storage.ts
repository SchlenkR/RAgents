import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { journalEventOf } from "../domain/event-validation.ts";
import { assertJsonValue } from "../domain/json.ts";
import { isRunId } from "../domain/portable-id.ts";
import { syncDirectory } from "./durable-fs.ts";
import type { CommandRecord, JournalCommand } from "./journal.ts";

/** Rises whenever an older stand would reject newly written lines; the encoding is unchanged since 4, so 4 stays readable. */
export const journalStorageVersion = 5;
const readableJournalStorageVersions: readonly unknown[] = [4, journalStorageVersion];
export const journalPayloadThresholdBytes = 4096;

type PayloadReference = { sha256: string; bytes: number };

const objectOf = (value: unknown, location: string): Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${location} must be an object.`);

    return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, location: string, required: string[], optional: string[] = []) => {
    for (const key of required) {
        if (!Object.hasOwn(value, key))
            throw new Error(`${location}.${key} is required.`);
    }

    for (const key of Object.keys(value)) {
        if (!required.includes(key) && !optional.includes(key))
            throw new Error(`${location}.${key} is not supported.`);
    }
};

const commandOf = (value: unknown, location: string): JournalCommand => {
    const command = objectOf(value, location);
    const keys = ["id", "type", "actorId", "requestHash"];
    exactKeys(command, location, keys);

    for (const key of keys) {
        if (typeof command[key] !== "string")
            throw new Error(`${location}.${key} must be a string.`);
    }

    return value as JournalCommand;
};

const digest = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");

const readPayload = (reference: PayloadReference, directory: string, location: string) => {
    const path = join(directory, "payloads", `${reference.sha256}.json`);
    let content: Buffer;

    try {
        content = readFileSync(path);
    } catch (error) {
        throw new Error(`${location} cannot read journal payload ${path}.`, { cause: error });
    }

    if (content.length !== reference.bytes || digest(content) !== reference.sha256)
        throw new Error(`${location} journal payload ${path} failed size or SHA-256 verification.`);

    return content;
};

const persistPayload = (content: string, directory: string): PayloadReference => {
    const reference = { sha256: digest(content), bytes: Buffer.byteLength(content, "utf8") };
    const payloadDirectory = join(directory, "payloads");
    const path = join(payloadDirectory, `${reference.sha256}.json`);

    if (!existsSync(payloadDirectory))
        mkdirSync(payloadDirectory);

    syncDirectory(directory);

    if (existsSync(path)) {
        readPayload(reference, directory, "Existing payload");
        syncDirectory(payloadDirectory);
        return reference;
    }

    const temporaryPath = join(payloadDirectory, `.payload.${randomUUID()}.tmp`);
    let descriptor: number | null = null;

    try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, content, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = null;
        renameSync(temporaryPath, path);
        syncDirectory(payloadDirectory);
    } finally {
        if (descriptor !== null)
            closeSync(descriptor);

        if (existsSync(temporaryPath))
            unlinkSync(temporaryPath);
    }

    return reference;
};

export const serializeJournalRecord = (record: CommandRecord, runDirectory: string): string => {
    assertJsonValue(record, "Journal record");
    exactKeys(objectOf(record, "Journal record"), "Journal record", ["formatVersion", "runId", "command", "events"]);

    if (record.formatVersion !== 3 || !isRunId(record.runId) || record.events.length === 0)
        throw new Error("Cannot serialize an invalid journal record.");

    commandOf(record.command, "Journal command");
    const occurredAt = record.events[0]!.occurredAt;

    for (const event of record.events) {
        journalEventOf(event, `Journal event ${event.eventId}`);

        if (event.runId !== record.runId || event.commandId !== record.command.id
            || event.actorId !== record.command.actorId || event.occurredAt !== occurredAt)
            throw new Error(`Journal event ${event.eventId} does not match its command envelope.`);
    }

    const events = record.events.map((event) => {
        const payload: Record<string, unknown> = Object.create(null);
        const payloadRefs: Record<string, PayloadReference> = Object.create(null);

        for (const [key, value] of Object.entries(event.payload)) {
            const content = JSON.stringify(value);

            if (Buffer.byteLength(content, "utf8") >= journalPayloadThresholdBytes)
                payloadRefs[key] = persistPayload(content, runDirectory);
            else
                payload[key] = value;
        }

        return {
            eventId: event.eventId,
            sequence: event.sequence,
            type: event.type,
            correlationId: event.correlationId,
            causationId: event.causationId,
            payload,
            ...(Object.keys(payloadRefs).length === 0 ? {} : { payloadRefs }),
        };
    });

    return JSON.stringify({ formatVersion: journalStorageVersion, runId: record.runId, command: record.command, occurredAt, events });
};

export const parseJournalRecord = (line: string, runDirectory: string, location: string): CommandRecord => {
    let parsed: unknown;

    try {
        parsed = JSON.parse(line);
    } catch (error) {
        throw new Error(`${location} is not valid JSON.`, { cause: error });
    }

    assertJsonValue(parsed, location);
    const record = objectOf(parsed, location);

    if (!readableJournalStorageVersions.includes(record.formatVersion))
        throw new Error(`${location} has unsupported journal format version ${String(record.formatVersion)}.`);

    exactKeys(record, location, ["formatVersion", "runId", "command", "occurredAt", "events"]);

    if (!isRunId(record.runId))
        throw new Error(`${location}.runId must be a run ID.`);

    if (typeof record.occurredAt !== "string")
        throw new Error(`${location}.occurredAt must be a string.`);

    const command = commandOf(record.command, `${location}.command`);

    if (!Array.isArray(record.events) || record.events.length === 0)
        throw new Error(`${location}.events must be a non-empty array.`);

    const events = record.events.map((value: unknown, index: number) => {
        const eventLocation = `${location}, event ${index + 1}`;
        const event = objectOf(value, eventLocation);
        exactKeys(event, eventLocation, ["eventId", "sequence", "type", "correlationId", "causationId", "payload"], ["payloadRefs"]);
        const payload = { ...objectOf(event.payload, `${eventLocation}.payload`) };

        if (Object.hasOwn(event, "payloadRefs")) {
            const references = objectOf(event.payloadRefs, `${eventLocation}.payloadRefs`);

            for (const [key, value] of Object.entries(references)) {
                const referenceLocation = `${eventLocation}.payloadRefs.${key}`;
                const reference = objectOf(value, referenceLocation);
                exactKeys(reference, referenceLocation, ["sha256", "bytes"]);

                if (typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256)
                    || typeof reference.bytes !== "number" || !Number.isSafeInteger(reference.bytes)
                    || reference.bytes < journalPayloadThresholdBytes)
                    throw new Error(`${referenceLocation} is not a valid payload reference.`);

                if (Object.hasOwn(payload, key))
                    throw new Error(`${referenceLocation} duplicates an inline payload field.`);

                const content = readPayload(reference as PayloadReference, runDirectory, referenceLocation);
                let resolved: unknown;

                try {
                    resolved = JSON.parse(content.toString("utf8"));
                } catch (error) {
                    throw new Error(`${referenceLocation} contains invalid JSON.`, { cause: error });
                }

                Object.defineProperty(payload, key, { value: resolved, enumerable: true, writable: true, configurable: true });
            }
        }

        return journalEventOf({
            eventId: event.eventId,
            runId: record.runId,
            sequence: event.sequence,
            schemaVersion: 3,
            occurredAt: record.occurredAt,
            actorId: command.actorId,
            commandId: command.id,
            correlationId: event.correlationId,
            causationId: event.causationId,
            type: event.type,
            payload,
        }, eventLocation);
    });

    return { formatVersion: 3, runId: record.runId, command, events };
};

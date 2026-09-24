import { isAgentDriverKind, isThinkingLevel } from "./driver.ts";
import { isEventType, type EventPayloads, type EventType, type JournalEvent, type UncommittedEvent } from "./events.ts";
import { assertJsonValue } from "./json.ts";
import { assertJsonChanges } from "./json-patch.ts";
import { isPortableId, isRunId } from "./portable-id.ts";
import { isCapabilityName, isObservableEventType } from "./vocabulary.ts";

type ObjectValue = Record<string, unknown>;

const fail = (path: string, message: string): never => {
    throw new Error(`${path} ${message}.`);
};

const objectOf = (value: unknown, path: string): ObjectValue => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail(path, "must be an object");

    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null)
        fail(path, "must be a plain object");

    return value as ObjectValue;
};

const exactObject = (
    value: unknown,
    path: string,
    required: readonly string[],
    optional: readonly string[] = [],
): ObjectValue => {
    const object = objectOf(value, path);
    const allowed = new Set([...required, ...optional]);

    for (const key of required) {
        if (!Object.hasOwn(object, key))
            fail(`${path}.${key}`, "is required");
    }

    for (const key of Object.keys(object)) {
        if (!allowed.has(key))
            fail(`${path}.${key}`, "is not supported");
    }

    return object;
};

const stringOf = (value: unknown, path: string) => {
    if (typeof value !== "string")
        fail(path, "must be a string");
};

const actorIdOf = (value: unknown, path: string) => {
    if (!isPortableId(value))
        fail(path, "must be a lowercase portable actor ID");
};

const runIdOf = (value: unknown, path: string) => {
    if (!isRunId(value))
        fail(path, "must be a lowercase portable run ID");
};

const nullableStringOf = (value: unknown, path: string) => {
    if (value !== null)
        stringOf(value, path);
};

const nonEmptyStringOf = (value: unknown, path: string) => {
    if (typeof value !== "string" || value.length === 0)
        fail(path, "must be a non-empty string");
};

const booleanOf = (value: unknown, path: string) => {
    if (typeof value !== "boolean")
        fail(path, "must be a boolean");
};

const finiteNumberOf = (value: unknown, path: string) => {
    if (typeof value !== "number" || !Number.isFinite(value))
        fail(path, "must be a finite number");
};

const nonNegativeIntegerOf = (value: unknown, path: string) => {
    if (!Number.isSafeInteger(value) || (value as number) < 0)
        fail(path, "must be a non-negative safe integer");
};

const positiveIntegerOf = (value: unknown, path: string) => {
    if (!Number.isSafeInteger(value) || (value as number) < 1)
        fail(path, "must be a positive safe integer");
};

const arrayOf = (value: unknown, path: string, validate: (entry: unknown, path: string) => void) => {
    if (!Array.isArray(value))
        fail(path, "must be an array");

    (value as unknown[]).forEach((entry, index) => validate(entry, `${path}[${index}]`));
};

const stringArrayOf = (value: unknown, path: string) => arrayOf(value, path, stringOf);

const nonEmptyStringArrayOf = (value: unknown, path: string) => {
    arrayOf(value, path, nonEmptyStringOf);

    if ((value as unknown[]).length === 0)
        fail(path, "must not be empty");
};

const nullableStringArrayOf = (value: unknown, path: string) => {
    if (value !== null)
        stringArrayOf(value, path);
};

const nullableActorIdArrayOf = (value: unknown, path: string) => {
    if (value !== null)
        arrayOf(value, path, actorIdOf);
};

const stringRecordOf = (value: unknown, path: string) => {
    const record = objectOf(value, path);

    for (const [key, entry] of Object.entries(record))
        stringOf(entry, `${path}.${key}`);
};

const scopeOf = (value: unknown, path: string) => {
    const candidate = objectOf(value, path);

    if (candidate.kind === "run") {
        exactObject(value, path, ["kind"]);
        return;
    }

    if (candidate.kind === "workspace") {
        const scope = exactObject(value, path, ["kind", "path"]);
        stringOf(scope.path, `${path}.path`);
        return;
    }

    fail(`${path}.kind`, "must be run or workspace");
};

const grantOf = (value: unknown, path: string) => {
    const grant = exactObject(value, path, ["capability", "scope", "delegable"], ["usable"]);

    if (!isCapabilityName(grant.capability))
        fail(`${path}.capability`, "must be a known capability");

    scopeOf(grant.scope, `${path}.scope`);
    booleanOf(grant.delegable, `${path}.delegable`);

    if (Object.hasOwn(grant, "usable"))
        booleanOf(grant.usable, `${path}.usable`);
};

const grantsOf = (value: unknown, path: string) => arrayOf(value, path, grantOf);

const modelSelectionOf = (value: unknown, path: string) => {
    const selection = exactObject(value, path, ["provider", "model"], ["thinking"]);
    nonEmptyStringOf(selection.provider, `${path}.provider`);
    nonEmptyStringOf(selection.model, `${path}.model`);

    if (Object.hasOwn(selection, "thinking") && !isThinkingLevel(selection.thinking))
        fail(`${path}.thinking`, "must be a known thinking level");
};

const executionOf = (value: unknown, path: string) => {
    const execution = exactObject(value, path, ["driver", "workspacePath", "turnTimeoutMs"]);
    const driver = exactObject(execution.driver, `${path}.driver`, ["kind", "config"]);

    if (!isAgentDriverKind(driver.kind))
        fail(`${path}.driver.kind`, "must be a known driver kind");

    if (driver.kind === "manual" || driver.kind === "script")
        exactObject(driver.config, `${path}.driver.config`, []);
    else
        modelSelectionOf(driver.config, `${path}.driver.config`);

    nullableStringOf(execution.workspacePath, `${path}.workspacePath`);

    if (execution.turnTimeoutMs !== null)
        nonNegativeIntegerOf(execution.turnTimeoutMs, `${path}.turnTimeoutMs`);
};

const usageOf = (value: unknown, path: string) => {
    const usage = exactObject(value, path, [
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
        "costUsd",
    ]);
    nonNegativeIntegerOf(usage.inputTokens, `${path}.inputTokens`);
    nonNegativeIntegerOf(usage.outputTokens, `${path}.outputTokens`);
    nonNegativeIntegerOf(usage.cacheReadTokens, `${path}.cacheReadTokens`);
    nonNegativeIntegerOf(usage.cacheWriteTokens, `${path}.cacheWriteTokens`);
    finiteNumberOf(usage.costUsd, `${path}.costUsd`);

    if ((usage.costUsd as number) < 0)
        fail(`${path}.costUsd`, "must not be negative");
};

const pluginScopeOf = (value: unknown, path: string) => {
    const candidate = objectOf(value, path);

    if (candidate.kind === "run") {
        exactObject(value, path, ["kind"]);
        return;
    }

    if (candidate.kind === "actor") {
        const scope = exactObject(value, path, ["kind", "actorId"]);
        actorIdOf(scope.actorId, `${path}.actorId`);
        return;
    }

    fail(`${path}.kind`, "must be run or actor");
};

const actionPayloadOf = (value: unknown, path: string) => {
    if (value === null)
        return;

    objectOf(value, path);
    assertJsonValue(value, path);
};

const actionInputOf = (value: unknown, path: string) => {
    if (value === null)
        return;

    const input = exactObject(value, path, ["label", "placeholder", "required"]);
    stringOf(input.label, `${path}.label`);
    nullableStringOf(input.placeholder, `${path}.placeholder`);
    booleanOf(input.required, `${path}.required`);
};

const artifactOf = (value: unknown, path: string) => {
    const artifact = exactObject(value, path, ["id", "title", "mediaType", "hash", "size", "previousVersionId"]);
    stringOf(artifact.id, `${path}.id`);
    stringOf(artifact.title, `${path}.title`);
    stringOf(artifact.mediaType, `${path}.mediaType`);
    stringOf(artifact.hash, `${path}.hash`);
    nonNegativeIntegerOf(artifact.size, `${path}.size`);
    nullableStringOf(artifact.previousVersionId, `${path}.previousVersionId`);
};

const actorKindArrayOf = (value: unknown, path: string) => {
    if (value === null)
        return;

    arrayOf(value, path, (entry, entryPath) => {
        if (entry !== "human" && entry !== "agent" && entry !== "script")
            fail(entryPath, "must be human, agent, or script");
    });
};

const eventTypeArrayOf = (value: unknown, path: string) => arrayOf(value, path, (entry, entryPath) => {
    if (!isObservableEventType(entry))
        fail(entryPath, "must be an observable event type");
});

const scriptDefinitionOf = (payload: ObjectValue, path: string) => {
    const definition = exactObject(payload, path, ["scriptId", "handle", "displayName", "execution", "grants", "toolNames"], ["description"]);
    actorIdOf(definition.scriptId, `${path}.scriptId`);
    if (definition.description !== undefined) nonEmptyStringOf(definition.description, `${path}.description`);
    stringOf(definition.handle, `${path}.handle`);
    stringOf(definition.displayName, `${path}.displayName`);
    executionOf(definition.execution, `${path}.execution`);
    grantsOf(definition.grants, `${path}.grants`);
    nullableStringArrayOf(definition.toolNames, `${path}.toolNames`);
};

const payloadOf = (type: EventType, value: unknown, path: string) => {
    switch (type) {
        case "run.created": {
            const payload = exactObject(value, path, ["title", "owner"]);
            const owner = exactObject(payload.owner, `${path}.owner`, ["id", "handle", "displayName", "grants"], ["userId"]);
            stringOf(payload.title, `${path}.title`);
            actorIdOf(owner.id, `${path}.owner.id`);
            stringOf(owner.handle, `${path}.owner.handle`);
            stringOf(owner.displayName, `${path}.owner.displayName`);
            grantsOf(owner.grants, `${path}.owner.grants`);
            if (owner.userId !== undefined) stringOf(owner.userId, `${path}.owner.userId`);
            return;
        }

        case "run.forked": {
            const payload = exactObject(value, path, ["sourceRunId", "sourceSequence"]);
            runIdOf(payload.sourceRunId, `${path}.sourceRunId`);
            positiveIntegerOf(payload.sourceSequence, `${path}.sourceSequence`);
            return;
        }

        case "run.primary-actor-selected": {
            const payload = exactObject(value, path, ["actorId"]);
            actorIdOf(payload.actorId, `${path}.actorId`);
            return;
        }

        case "run.title-changed": {
            const payload = exactObject(value, path, ["title"]);
            stringOf(payload.title, `${path}.title`);
            return;
        }

        case "agent.spawned": {
            const payload = exactObject(value, path, [
                "agentId",
                "handle",
                "displayName",
                "prompt",
                "execution",
                "grants",
                "toolNames",
            ], ["forkOf", "description"]);
            actorIdOf(payload.agentId, `${path}.agentId`);
            if (payload.forkOf !== undefined) actorIdOf(payload.forkOf, `${path}.forkOf`);
            if (payload.description !== undefined) nonEmptyStringOf(payload.description, `${path}.description`);
            stringOf(payload.handle, `${path}.handle`);
            stringOf(payload.displayName, `${path}.displayName`);
            stringOf(payload.prompt, `${path}.prompt`);
            executionOf(payload.execution, `${path}.execution`);
            grantsOf(payload.grants, `${path}.grants`);
            nullableStringArrayOf(payload.toolNames, `${path}.toolNames`);
            return;
        }

        case "script.created":
            scriptDefinitionOf(objectOf(value, path), path);
            return;

        case "actor.input.enqueued": {
            const subscriptionInput = objectOf(value, path).subscriptionId !== null;
            const payload = exactObject(value, path, [
                "inputId",
                "actorId",
                ...(!subscriptionInput ? ["content"] : []),
                "artifactIds",
                "sourceEventIds",
                "subscriptionId",
            ], ["presentation"]);
            if (payload.presentation !== undefined && payload.presentation !== "background")
                fail(`${path}.presentation`, "must be background");
            stringOf(payload.inputId, `${path}.inputId`);
            actorIdOf(payload.actorId, `${path}.actorId`);
            stringArrayOf(payload.artifactIds, `${path}.artifactIds`);
            if (!subscriptionInput) {
                if (typeof payload.content !== "string") fail(`${path}.content`, "must be a string");
                if (!(payload.content as string).trim() && (payload.artifactIds as string[]).length === 0)
                    fail(`${path}.content`, "must contain text or name at least one artifact");
            }
            stringArrayOf(payload.sourceEventIds, `${path}.sourceEventIds`);
            nullableStringOf(payload.subscriptionId, `${path}.subscriptionId`);

            if (subscriptionInput && (payload.sourceEventIds as string[]).length !== 1)
                fail(`${path}.sourceEventIds`, "must name exactly one source event for a subscription input");
            return;
        }

        case "turn.started":
        case "turn.input-steered": {
            const payload = exactObject(value, path, ["turnId", "inputId"]);
            stringOf(payload.turnId, `${path}.turnId`);
            stringOf(payload.inputId, `${path}.inputId`);
            return;
        }

        case "turn.finished": {
            const payload = exactObject(value, path, ["turnId", "outcome"], ["reason", "usage"]);
            stringOf(payload.turnId, `${path}.turnId`);

            if (payload.outcome !== "completed" && payload.outcome !== "failed")
                fail(`${path}.outcome`, "must be completed or failed");

            if (payload.outcome === "failed")
                nonEmptyStringOf(payload.reason, `${path}.reason`);
            else if (Object.hasOwn(payload, "reason"))
                fail(`${path}.reason`, "is only supported for failed turns");

            if (Object.hasOwn(payload, "usage"))
                usageOf(payload.usage, `${path}.usage`);

            return;
        }

        case "turn.interrupted": {
            const payload = exactObject(value, path, ["turnId", "reason"]);
            stringOf(payload.turnId, `${path}.turnId`);
            stringOf(payload.reason, `${path}.reason`);
            return;
        }

        case "model.output.completed":
        case "model.output.interrupted":
        case "model.reasoning.completed":
        case "runtime.output.recorded": {
            const payload = exactObject(value, path, ["turnId", "text"]);
            stringOf(payload.turnId, `${path}.turnId`);
            stringOf(payload.text, `${path}.text`);
            return;
        }

        case "tool.call.started": {
            const payload = exactObject(value, path, ["turnId", "toolCallId", "name", "input"], ["ignoredFields"]);
            stringOf(payload.turnId, `${path}.turnId`);
            stringOf(payload.toolCallId, `${path}.toolCallId`);
            stringOf(payload.name, `${path}.name`);
            assertJsonValue(payload.input, `${path}.input`);
            if (Object.hasOwn(payload, "ignoredFields"))
                nonEmptyStringArrayOf(payload.ignoredFields, `${path}.ignoredFields`);
            return;
        }

        case "tool.call.completed": {
            const payload = exactObject(value, path, ["turnId", "toolCallId", "name", "output"]);
            stringOf(payload.turnId, `${path}.turnId`);
            stringOf(payload.toolCallId, `${path}.toolCallId`);
            stringOf(payload.name, `${path}.name`);
            assertJsonValue(payload.output, `${path}.output`);
            return;
        }

        case "tool.call.source": {
            const payload = exactObject(value, path, ["turnId", "toolCallId", "code", "path"]);
            stringOf(payload.turnId, `${path}.turnId`);
            stringOf(payload.toolCallId, `${path}.toolCallId`);
            stringOf(payload.code, `${path}.code`);
            nullableStringOf(payload.path, `${path}.path`);
            return;
        }

        case "tool.call.failed": {
            const payload = exactObject(value, path, ["turnId", "toolCallId", "name", "error"]);
            stringOf(payload.turnId, `${path}.turnId`);
            stringOf(payload.toolCallId, `${path}.toolCallId`);
            stringOf(payload.name, `${path}.name`);
            stringOf(payload.error, `${path}.error`);
            return;
        }

        case "actor.tools.opened": {
            const payload = exactObject(value, path, ["actorId", "toolNames"]);
            actorIdOf(payload.actorId, `${path}.actorId`);
            stringArrayOf(payload.toolNames, `${path}.toolNames`);
            return;
        }

        case "actor.stopped": {
            const payload = exactObject(value, path, ["actorId", "reason"]);
            actorIdOf(payload.actorId, `${path}.actorId`);
            stringOf(payload.reason, `${path}.reason`);
            return;
        }

        case "actor.restarted": {
            const payload = exactObject(value, path, ["actorId", "reason"]);
            actorIdOf(payload.actorId, `${path}.actorId`);
            stringOf(payload.reason, `${path}.reason`);
            return;
        }

        case "subscription.created": {
            const payload = exactObject(value, path, [
                "subscriptionId",
                "subscriberId",
                "sourceActorIds",
                "sourceActorKinds",
                "eventTypes",
                "includeSelf",
            ]);
            stringOf(payload.subscriptionId, `${path}.subscriptionId`);
            actorIdOf(payload.subscriberId, `${path}.subscriberId`);
            nullableActorIdArrayOf(payload.sourceActorIds, `${path}.sourceActorIds`);
            actorKindArrayOf(payload.sourceActorKinds, `${path}.sourceActorKinds`);
            eventTypeArrayOf(payload.eventTypes, `${path}.eventTypes`);
            booleanOf(payload.includeSelf, `${path}.includeSelf`);
            return;
        }

        case "subscription.removed": {
            const payload = exactObject(value, path, ["subscriptionId", "reason"], ["discardedInputIds"]);
            stringOf(payload.subscriptionId, `${path}.subscriptionId`);
            stringOf(payload.reason, `${path}.reason`);

            if (Object.hasOwn(payload, "discardedInputIds"))
                stringArrayOf(payload.discardedInputIds, `${path}.discardedInputIds`);

            return;
        }

        case "subscription.failed": {
            const payload = exactObject(value, path, ["subscriptionId", "sourceEventId", "reason"]);
            stringOf(payload.subscriptionId, `${path}.subscriptionId`);
            stringOf(payload.sourceEventId, `${path}.sourceEventId`);
            stringOf(payload.reason, `${path}.reason`);
            return;
        }

        case "plugin.state-patched": {
            const payload = exactObject(value, path, ["pluginId", "scope", "changes"]);
            stringOf(payload.pluginId, `${path}.pluginId`);
            pluginScopeOf(payload.scope, `${path}.scope`);
            assertJsonChanges(payload.changes);
            return;
        }

        case "plugin.state-replaced": {
            const payload = exactObject(value, path, ["pluginId", "scope", "state"]);
            stringOf(payload.pluginId, `${path}.pluginId`);
            pluginScopeOf(payload.scope, `${path}.scope`);
            assertJsonValue(payload.state, `${path}.state`);
            return;
        }

        case "action.proposed": {
            if (Object.hasOwn(objectOf(value, path), "kind"))
                fail(`${path}.kind`, "belongs to a journal written before actions became opaque and is not migrated");

            const payload = exactObject(value, path, [
                "actionId",
                "owner",
                "title",
                "description",
                "parameters",
                "input",
                "payload",
            ]);
            stringOf(payload.actionId, `${path}.actionId`);
            nullableStringOf(payload.owner, `${path}.owner`);
            stringOf(payload.title, `${path}.title`);
            nullableStringOf(payload.description, `${path}.description`);
            stringRecordOf(payload.parameters, `${path}.parameters`);
            actionInputOf(payload.input, `${path}.input`);
            actionPayloadOf(payload.payload, `${path}.payload`);
            return;
        }

        case "action.resolved": {
            const payload = exactObject(value, path, ["actionId", "decision", "result"]);
            stringOf(payload.actionId, `${path}.actionId`);

            if (payload.decision !== "approved" && payload.decision !== "dismissed")
                fail(`${path}.decision`, "must be approved or dismissed");

            assertJsonValue(payload.result, `${path}.result`);
            return;
        }

        case "artifact.published": {
            const payload = exactObject(value, path, ["artifact"]);
            artifactOf(payload.artifact, `${path}.artifact`);
            return;
        }
    }

    const unsupported: never = type;
    return unsupported;
};

export const validatedEventPayloadOf = <Name extends EventType>(
    type: Name,
    value: unknown,
    location: string,
): EventPayloads[Name] => {
    payloadOf(type, value, location);

    return value as EventPayloads[Name];
};

export const journalEventOf = (value: unknown, location: string): JournalEvent => {
    assertJsonValue(value, location);
    const candidate = objectOf(value, location);

    if (candidate.schemaVersion !== 3)
        throw new Error(`${location} has unsupported schema version ${String(candidate.schemaVersion)}.`);

    if (!isEventType(candidate.type))
        throw new Error(`${location} has unknown event type ${String(candidate.type)}.`);

    const event = exactObject(value, location, [
        "type",
        "payload",
        "eventId",
        "runId",
        "sequence",
        "schemaVersion",
        "occurredAt",
        "actorId",
        "commandId",
        "correlationId",
        "causationId",
    ]);
    stringOf(event.eventId, `${location}.eventId`);
    runIdOf(event.runId, `${location}.runId`);
    positiveIntegerOf(event.sequence, `${location}.sequence`);
    stringOf(event.occurredAt, `${location}.occurredAt`);
    actorIdOf(event.actorId, `${location}.actorId`);
    stringOf(event.commandId, `${location}.commandId`);
    nullableStringOf(event.correlationId, `${location}.correlationId`);
    nullableStringOf(event.causationId, `${location}.causationId`);
    payloadOf(candidate.type, event.payload, `${location}.payload`);

    return value as JournalEvent;
};

export const uncommittedEventOf = (value: unknown, location: string): UncommittedEvent => {
    assertJsonValue(value, location);
    const candidate = objectOf(value, location);

    if (!isEventType(candidate.type))
        throw new Error(`${location} has unknown event type ${String(candidate.type)}.`);

    const event = exactObject(value, location, ["type", "payload", "actorId", "correlationId", "causationId"]);
    actorIdOf(event.actorId, `${location}.actorId`);
    nullableStringOf(event.correlationId, `${location}.correlationId`);
    nullableStringOf(event.causationId, `${location}.causationId`);
    payloadOf(candidate.type, event.payload, `${location}.payload`);

    return value as UncommittedEvent;
};

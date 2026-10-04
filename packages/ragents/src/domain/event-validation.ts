import { isAgentDriverKind, isThinkingLevel } from "./driver.ts";
import { isEventType, type EventPayloads, type EventType, type JournalEvent, type UncommittedEvent } from "./events.ts";
import { assertJsonValue } from "./json.ts";
import { assertJsonChanges } from "./json-patch.ts";
import { roomNamePattern } from "./actor-reference.ts";
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

const roomNameOf = (value: unknown, path: string) => {
    if (typeof value !== "string" || !roomNamePattern.test(value))
        fail(path, "must be a room name: a lowercase letter, then lowercase letters, digits or hyphens");
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
    else if (driver.kind === "external") {
        const config = exactObject(driver.config, `${path}.driver.config`, ["runtime"]);
        nonEmptyStringOf(config.runtime, `${path}.driver.config.runtime`);
    }
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

const sha256Of = (value: unknown, path: string) => {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
        fail(path, "must be a lowercase SHA-256");
};

const modelTextPartOf = (value: unknown, path: string) => {
    const part = exactObject(value, path, ["type", "text"]);
    stringOf(part.text, `${path}.text`);
};

const modelInputPartOf = (value: unknown, path: string) => {
    const candidate = objectOf(value, path);

    if (candidate.type === "text")
        return modelTextPartOf(value, path);

    if (candidate.type !== "image" && candidate.type !== "video" && candidate.type !== "file")
        fail(`${path}.type`, "must be text, image, video or file");

    const part = exactObject(value, path, candidate.type === "file" ? ["type", "mimeType", "filename", "hash"] : ["type", "mimeType", "hash"]);
    nonEmptyStringOf(part.mimeType, `${path}.mimeType`);
    sha256Of(part.hash, `${path}.hash`);

    if (candidate.type === "file")
        stringOf(part.filename, `${path}.filename`);
};

const modelToolResultPartOf = (value: unknown, path: string) => {
    const candidate = objectOf(value, path);

    if (candidate.type === "text")
        return modelTextPartOf(value, path);

    if (candidate.type !== "image")
        fail(`${path}.type`, "must be text or image");

    const part = exactObject(value, path, ["type", "mimeType", "hash"]);
    nonEmptyStringOf(part.mimeType, `${path}.mimeType`);
    sha256Of(part.hash, `${path}.hash`);
};

const optionalStringOf = (payload: ObjectValue, key: string, path: string) => {
    if (Object.hasOwn(payload, key))
        stringOf(payload[key], `${path}.${key}`);
};

const modelStepBlockOf = (value: unknown, path: string) => {
    const candidate = objectOf(value, path);

    if (candidate.type === "text") {
        const block = exactObject(value, path, ["type"], ["text", "textSignature"]);
        optionalStringOf(block, "text", path);
        optionalStringOf(block, "textSignature", path);
        return;
    }

    if (candidate.type === "thinking") {
        const block = exactObject(value, path, ["type"], ["thinking", "thinkingSignature", "redacted"]);
        optionalStringOf(block, "thinking", path);
        optionalStringOf(block, "thinkingSignature", path);

        if (Object.hasOwn(block, "redacted"))
            booleanOf(block.redacted, `${path}.redacted`);

        return;
    }

    if (candidate.type !== "toolCall")
        fail(`${path}.type`, "must be text, thinking or toolCall");

    const block = exactObject(value, path, ["type", "id", "name", "arguments"], ["thoughtSignature"]);
    nonEmptyStringOf(block.id, `${path}.id`);
    stringOf(block.name, `${path}.name`);
    objectOf(block.arguments, `${path}.arguments`);
    assertJsonValue(block.arguments, `${path}.arguments`);
    optionalStringOf(block, "thoughtSignature", path);
};

const modelStepUsageOf = (value: unknown, path: string) => {
    const usage = exactObject(value, path, ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"], ["cacheWrite1h", "reasoning"]);

    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cacheWrite1h", "reasoning"]) {
        if (Object.hasOwn(usage, key))
            finiteNumberOf(usage[key], `${path}.${key}`);
    }

    const cost = exactObject(usage.cost, `${path}.cost`, ["input", "output", "cacheRead", "cacheWrite", "total"]);

    for (const key of Object.keys(cost))
        finiteNumberOf(cost[key], `${path}.cost.${key}`);
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
        if (entry !== "human" && entry !== "agent" && entry !== "script" && entry !== "external")
            fail(entryPath, "must be human, agent, script, or external");
    });
};

const shareAccessOf = (value: unknown, path: string) => {
    if (value !== "read" && value !== "write")
        fail(path, "must be read or write");
};

const sharedUsersOf = (value: unknown, path: string) => {
    arrayOf(value, path, (entry, entryPath) => {
        const user = exactObject(entry, entryPath, ["userId", "access"]);
        nonEmptyStringOf(user.userId, `${entryPath}.userId`);
        shareAccessOf(user.access, `${entryPath}.access`);
    });
    const userIds = (value as { userId: string }[]).map((user) => user.userId);

    if (new Set(userIds).size !== userIds.length)
        fail(path, "must not name a user twice");
};

const eventTypeArrayOf = (value: unknown, path: string) => arrayOf(value, path, (entry, entryPath) => {
    if (!isObservableEventType(entry))
        fail(entryPath, "must be an observable event type");
});

const scriptDefinitionOf = (payload: ObjectValue, path: string) => {
    const definition = exactObject(payload, path, ["scriptId", "handle", "displayName", "execution", "grants", "toolNames"], ["description", "room"]);
    actorIdOf(definition.scriptId, `${path}.scriptId`);
    if (definition.room !== undefined) roomNameOf(definition.room, `${path}.room`);
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

        case "run.sharing-changed": {
            const payload = exactObject(value, path, ["everyone", "users", "changedBy"]);
            if (payload.everyone !== null) shareAccessOf(payload.everyone, `${path}.everyone`);
            sharedUsersOf(payload.users, `${path}.users`);
            nonEmptyStringOf(payload.changedBy, `${path}.changedBy`);
            return;
        }

        case "run.paused": {
            const payload = exactObject(value, path, ["reason"], ["userId"]);
            nonEmptyStringOf(payload.reason, `${path}.reason`);
            if (Object.hasOwn(payload, "userId")) nonEmptyStringOf(payload.userId, `${path}.userId`);
            return;
        }

        case "run.resumed": {
            const payload = exactObject(value, path, ["trigger"], ["userId"]);
            if (payload.trigger !== "input" && payload.trigger !== "resume") fail(`${path}.trigger`, "must be input or resume");
            if (Object.hasOwn(payload, "userId")) nonEmptyStringOf(payload.userId, `${path}.userId`);
            return;
        }

        case "room.opened": {
            const payload = exactObject(value, path, ["name", "origin"]);
            roomNameOf(payload.name, `${path}.name`);
            if (payload.origin !== null) roomNameOf(payload.origin, `${path}.origin`);
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
            ], ["forkOf", "description", "room"]);
            actorIdOf(payload.agentId, `${path}.agentId`);
            if (payload.room !== undefined) roomNameOf(payload.room, `${path}.room`);
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
            ], ["presentation", "origin"]);
            if (payload.presentation !== undefined && payload.presentation !== "background")
                fail(`${path}.presentation`, "must be background");
            if (payload.origin !== undefined && payload.origin !== "human")
                fail(`${path}.origin`, "must be human");
            if (subscriptionInput && Object.hasOwn(payload, "origin"))
                fail(`${path}.origin`, "is not supported for a subscription input");
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

        case "model.input.presented": {
            const payload = exactObject(value, path, ["turnId", "inputId", "content"]);
            stringOf(payload.turnId, `${path}.turnId`);
            nullableStringOf(payload.inputId, `${path}.inputId`);

            if (typeof payload.content !== "string")
                arrayOf(payload.content, `${path}.content`, modelInputPartOf);

            return;
        }

        case "model.step.completed": {
            const payload = exactObject(
                value,
                path,
                ["turnId", "api", "provider", "model", "usage", "stopReason", "timestamp", "content"],
                ["responseModel", "responseId", "errorMessage", "diagnostics"],
            );
            stringOf(payload.turnId, `${path}.turnId`);
            nonEmptyStringOf(payload.api, `${path}.api`);
            nonEmptyStringOf(payload.provider, `${path}.provider`);
            nonEmptyStringOf(payload.model, `${path}.model`);
            optionalStringOf(payload, "responseModel", path);
            optionalStringOf(payload, "responseId", path);
            optionalStringOf(payload, "errorMessage", path);
            modelStepUsageOf(payload.usage, `${path}.usage`);

            if (!["stop", "length", "toolUse", "error"].includes(payload.stopReason as string))
                fail(`${path}.stopReason`, "must be stop, length, toolUse or error");

            finiteNumberOf(payload.timestamp, `${path}.timestamp`);
            arrayOf(payload.content, `${path}.content`, modelStepBlockOf);

            if (Object.hasOwn(payload, "diagnostics"))
                arrayOf(payload.diagnostics, `${path}.diagnostics`, assertJsonValue);

            return;
        }

        case "model.tool-result.presented": {
            const payload = exactObject(value, path, ["turnId", "toolCallId", "toolName", "isError"], ["content"]);
            stringOf(payload.turnId, `${path}.turnId`);
            nonEmptyStringOf(payload.toolCallId, `${path}.toolCallId`);
            stringOf(payload.toolName, `${path}.toolName`);
            booleanOf(payload.isError, `${path}.isError`);

            if (Object.hasOwn(payload, "content"))
                arrayOf(payload.content, `${path}.content`, modelToolResultPartOf);

            return;
        }

        case "context.compacted": {
            const payload = exactObject(value, path, [
                "turnId",
                "summary",
                "firstKeptEventId",
                "tokensBefore",
                "provider",
                "model",
                "readFiles",
                "modifiedFiles",
            ], ["threshold"]);
            stringOf(payload.turnId, `${path}.turnId`);
            nonEmptyStringOf(payload.summary, `${path}.summary`);
            nonEmptyStringOf(payload.firstKeptEventId, `${path}.firstKeptEventId`);
            nonNegativeIntegerOf(payload.tokensBefore, `${path}.tokensBefore`);
            nonEmptyStringOf(payload.provider, `${path}.provider`);
            nonEmptyStringOf(payload.model, `${path}.model`);
            stringArrayOf(payload.readFiles, `${path}.readFiles`);
            stringArrayOf(payload.modifiedFiles, `${path}.modifiedFiles`);

            if (Object.hasOwn(payload, "threshold")) {
                const threshold = exactObject(payload.threshold, `${path}.threshold`, ["tokens", "source"]);
                if (!Number.isSafeInteger(threshold.tokens))
                    fail(`${path}.threshold.tokens`, "must be a safe integer");
                if (threshold.source !== "model" && threshold.source !== "catalog")
                    fail(`${path}.threshold.source`, "must be model or catalog");
            }

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
            stringOf(payload.owner, `${path}.owner`);
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

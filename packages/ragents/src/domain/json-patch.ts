import { assertJsonValue, type JsonValue, type JsonChange, type JsonPath } from "./json.ts";

const object = (value: JsonValue): value is { [key: string]: JsonValue | undefined } =>
    value !== null && typeof value === "object" && !Array.isArray(value);

export function jsonChanges(before: JsonValue, after: JsonValue, path: JsonPath = []): JsonChange[] {
    if (before === after) return [];
    if (Array.isArray(before) && Array.isArray(after)) {
        const changes: JsonChange[] = [];
        for (let index = 0; index < after.length; index++)
            changes.push(...(index < before.length
                ? jsonChanges(before[index]!, after[index]!, [...path, index])
                : [{ op: "set" as const, path: [...path, index], value: after[index]! }]));
        for (let index = before.length - 1; index >= after.length; index--)
            changes.push({ op: "remove", path: [...path, index] });
        return changes;
    }
    if (object(before) && object(after)) {
        const changes: JsonChange[] = [];
        for (const key of Object.keys(before))
            if (!Object.hasOwn(after, key)) changes.push({ op: "remove", path: [...path, key] });
        for (const key of Object.keys(after))
            changes.push(...(Object.hasOwn(before, key)
                ? jsonChanges(before[key]!, after[key]!, [...path, key])
                : [{ op: "set" as const, path: [...path, key], value: after[key]! }]));
        return changes;
    }
    return [{ op: "set", path, value: after }];
}

export function assertJsonChanges(value: unknown): asserts value is JsonChange[] {
    assertJsonValue(value, "changes");
    if (!Array.isArray(value)) throw new Error("JSON changes must be an array.");
    for (const change of value) {
        if (!change || typeof change !== "object" || Array.isArray(change)
            || (change.op !== "set" && change.op !== "remove")
            || !Array.isArray(change.path)
            || change.path.some((part) => typeof part !== "string" && !(typeof part === "number" && Number.isSafeInteger(part) && part >= 0))
            || Object.keys(change).length !== (change.op === "set" ? 3 : 2)
            || !Object.hasOwn(change, "op") || !Object.hasOwn(change, "path")
            || (change.op === "set" && (!Object.hasOwn(change, "value") || change.value === undefined))
            || (change.op === "remove" && change.path.length === 0))
            throw new Error("Invalid JSON state change.");
    }
}

function apply(value: JsonValue, change: JsonChange, depth: number): JsonValue {
    if (depth === change.path.length) {
        if (change.op !== "set") throw new Error("Cannot remove the JSON state root.");
        return change.value;
    }
    const key = change.path[depth]!;
    const last = depth === change.path.length - 1;
    if (Array.isArray(value)) {
        if (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0
            || key > value.length || (key === value.length && (!last || change.op !== "set")))
            throw new Error("JSON state change has an invalid array index.");
        const result = [...value];
        if (last && change.op === "remove") result.splice(key, 1);
        else result[key] = last ? (change as Extract<JsonChange, { op: "set" }>).value : apply(value[key]!, change, depth + 1);
        return result;
    }
    if (!object(value) || typeof key !== "string"
        || ((!last || change.op === "remove") && !Object.hasOwn(value, key)))
        throw new Error("JSON state change has an invalid object path.");
    const result = { ...value };
    if (last && change.op === "remove") delete result[key];
    else Object.defineProperty(result, key, {
        value: last ? (change as Extract<JsonChange, { op: "set" }>).value : apply(value[key]!, change, depth + 1),
        enumerable: true, writable: true, configurable: true,
    });
    return result;
}

export function applyJsonChanges(state: JsonValue, changes: readonly JsonChange[]): JsonValue {
    return changes.reduce((value, change) => apply(value, change, 0), state);
}

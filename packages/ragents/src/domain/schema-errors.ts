import { Value } from "typebox/value";

const valueAt = (input: unknown, pointer: string): unknown => {
    let current: unknown = input;

    for (const part of pointer.split("/").slice(1)) {
        if (current === null || typeof current !== "object")
            return undefined;
        current = (current as Record<string, unknown>)[part.replaceAll("~1", "/").replaceAll("~0", "~")];
    }

    return current;
};

const shortJson = (value: unknown) => {
    const text = JSON.stringify(value);

    return text === undefined ? "undefined" : text.length > 120 ? `${text.slice(0, 120)}...` : text;
};

const stringsOf = (params: unknown, key: string): string[] => {
    const value = (params as Record<string, unknown>)[key];

    return Array.isArray(value) ? value.map(String) : [];
};

export const schemaComplaints = (schema: unknown, input: unknown): string => {
    const errors = [...Value.Errors(schema as Parameters<typeof Value.Errors>[0], input)];
    const byPath = new Map<string, typeof errors>();

    for (const error of errors)
        byPath.set(error.instancePath, [...(byPath.get(error.instancePath) ?? []), error]);

    const lines: string[] = [];

    for (const [pointer, group] of byPath) {
        const path = pointer.split("/").slice(1).join(".") || "input";
        const allowed = group.flatMap((entry) =>
            entry.keyword === "const" ? [String((entry.params as Record<string, unknown>).allowedValue)] : []);
        const missing = group.flatMap((entry) => (entry.keyword === "required" ? stringsOf(entry.params, "requiredProperties") : []));
        const unknown = group.flatMap((entry) =>
            entry.keyword === "additionalProperties" ? stringsOf(entry.params, "additionalProperties") : []);

        if (missing.length)
            lines.push(`${path} is missing required field ${missing.join(", ")}`);
        if (unknown.length)
            lines.push(`${path} has unknown field ${unknown.join(", ")}`);
        if (allowed.length)
            lines.push(`${path} got ${shortJson(valueAt(input, pointer))}, allowed values: ${allowed.join(", ")}`);
        if (!missing.length && !unknown.length && !allowed.length && group[0])
            lines.push(`${path} ${group[0].message}, got ${shortJson(valueAt(input, pointer))}`);
    }

    return lines.slice(0, 8).join("; ");
};


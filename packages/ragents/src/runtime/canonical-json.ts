export const canonicalJson = (value: unknown, parents: ReadonlySet<object> = new Set<object>()): string => {
    if (value === null)
        return "null";

    if (typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);

    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Canonical values cannot contain non-finite numbers.");

        return JSON.stringify(value);
    }

    if (typeof value !== "object")
        throw new Error(`Canonical values cannot contain ${typeof value}.`);

    if (parents.has(value))
        throw new Error("Canonical values cannot contain cycles.");

    const nextParents = new Set(parents).add(value);

    if (Array.isArray(value))
        return `[${value.map((entry) => canonicalJson(entry, nextParents)).join(",")}]`;

    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null)
        throw new Error("Canonical values must contain plain objects only.");

    if (Object.getOwnPropertySymbols(value).length > 0)
        throw new Error("Canonical values cannot contain symbol properties.");

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], nextParents)}`);

    return `{${entries.join(",")}}`;
};

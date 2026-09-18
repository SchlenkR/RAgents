const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 10_000;

type JsonSchemaRecord = Record<string, unknown>;

interface SchemaContext {
    readonly active: WeakSet<object>;
    readonly definitions: JsonSchemaRecord[];
    readonly aliases?: { prefix: string; names: Map<object, string>; declarations: string[] };
    remaining: number;
}

const isRecord = (value: unknown): value is JsonSchemaRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const literalType = (value: unknown): string => {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "unknown";
};

const unionOf = (types: readonly string[]): string => {
    if (types.includes("unknown")) return "unknown";
    const distinct = [...new Set(types.filter((type) => type !== "never"))].sort();
    if (distinct.length === 0) return "never";
    return distinct.length === 1 ? distinct[0]! : distinct.map((type) => `(${type})`).join(" | ");
};

const intersectionOf = (types: readonly string[]): string => {
    if (types.includes("never")) return "never";
    const distinct = [...new Set(types.filter((type) => type !== "unknown"))].sort();
    if (distinct.length === 0) return "unknown";
    return distinct.length === 1 ? distinct[0]! : distinct.map((type) => `(${type})`).join(" & ");
};

const arrayType = (schema: JsonSchemaRecord, context: SchemaContext, depth: number): string => {
    const tuple = Array.isArray(schema.prefixItems)
        ? schema.prefixItems
        : Array.isArray(schema.items)
            ? schema.items
            : undefined;
    if (tuple) {
        const entries = tuple.map((entry) => schemaType(entry, context, depth + 1));
        if (schema.items === false) return `[${entries.join(", ")}]`;
        const rest = isRecord(schema.items) || typeof schema.items === "boolean"
            ? schemaType(schema.items, context, depth + 1)
            : "unknown";
        return `[${[...entries, `...Array<${rest}>`].join(", ")}]`;
    }
    if (schema.items === false) return "[]";
    return `Array<${schemaType(schema.items, context, depth + 1)}>`;
};

const documentation = (schema: unknown): string => {
    const description = isRecord(schema) && typeof schema.description === "string" ? schema.description.trim() : "";
    return description ? `/** ${description.replace(/\*\//g, "* /").replace(/\s+/g, " ")} */ ` : "";
};

const objectType = (schema: JsonSchemaRecord, context: SchemaContext, depth: number): string => {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === "string")
        : []);
    const fields = Object.keys(properties).sort().map((name) => {
        const optional = required.has(name) ? "" : "?";
        return `${documentation(properties[name])}${JSON.stringify(name)}${optional}: ${schemaType(properties[name], context, depth + 1)};`;
    });
    const declared = fields.length > 0 ? `{ ${fields.join(" ")} }` : undefined;
    const additional = schema.additionalProperties;
    if (additional === false) return declared ?? "{ [key: string]: never }";
    const additionalType = additional === undefined || additional === true
        ? "unknown"
        : schemaType(additional, context, depth + 1);
    const indexed = `{ [key: string]: ${additionalType} }`;
    return declared ? intersectionOf([declared, indexed]) : indexed;
};

const typedSchema = (type: string, schema: JsonSchemaRecord, context: SchemaContext, depth: number): string => {
    switch (type) {
        case "null": return "null";
        case "boolean": return "boolean";
        case "integer":
        case "number": return "number";
        case "string": return "string";
        case "array": return arrayType(schema, context, depth);
        case "object": return objectType(schema, context, depth);
        default: return "unknown";
    }
};

const schemaType = (schema: unknown, context: SchemaContext, depth: number): string => {
    context.remaining -= 1;
    if (context.remaining < 0 || depth > MAX_SCHEMA_DEPTH) return "unknown";
    if (schema === true) return "unknown";
    if (schema === false) return "never";
    if (!isRecord(schema)) return "unknown";
    if (context.active.has(schema)) return "unknown";

    context.active.add(schema);
    const definitions = isRecord(schema.$defs) ? schema.$defs : undefined;
    if (definitions) context.definitions.push(definitions);
    try {
        if (typeof schema.$ref === "string") {
            const reference = schema.$ref.replace(/^#\/\$defs\//, "").replace(/~1/g, "/").replace(/~0/g, "~");
            const target = [...context.definitions].reverse().find((entry) => Object.hasOwn(entry, reference))?.[reference];
            if (!isRecord(target)) return "unknown";
            if (!context.aliases) return schemaType(target, context, depth + 1);
            const existing = context.aliases.names.get(target);
            if (existing) return existing;
            const name = `${context.aliases.prefix}Reference${context.aliases.names.size}`;
            context.aliases.names.set(target, name);
            const type = schemaType(target, context, depth + 1);
            context.aliases.declarations.push(`type ${name} = ${type};`);
            return name;
        }
        if (Object.hasOwn(schema, "const")) return literalType(schema.const);
        if (Object.hasOwn(schema, "enum")) {
            return Array.isArray(schema.enum) ? unionOf(schema.enum.map(literalType)) : "unknown";
        }

        const alternatives = Array.isArray(schema.anyOf)
            ? schema.anyOf
            : Array.isArray(schema.oneOf)
                ? schema.oneOf
                : undefined;
        if (alternatives) {
            const result = unionOf(alternatives.map((entry) => schemaType(entry, context, depth + 1)));
            return schema.nullable === true ? unionOf([result, "null"]) : result;
        }
        if (Array.isArray(schema.allOf)) {
            const result = intersectionOf(schema.allOf.map((entry) => schemaType(entry, context, depth + 1)));
            return schema.nullable === true ? unionOf([result, "null"]) : result;
        }

        const types = Array.isArray(schema.type)
            ? schema.type.map((entry) => typeof entry === "string"
                ? typedSchema(entry, schema, context, depth + 1)
                : "unknown")
            : typeof schema.type === "string"
                ? [typedSchema(schema.type, schema, context, depth + 1)]
                : schema.properties !== undefined || schema.additionalProperties !== undefined
                    ? [objectType(schema, context, depth + 1)]
                    : schema.items !== undefined || schema.prefixItems !== undefined
                        ? [arrayType(schema, context, depth + 1)]
                        : ["unknown"];
        const result = unionOf(types);
        return schema.nullable === true ? unionOf([result, "null"]) : result;
    } finally {
        if (definitions) context.definitions.pop();
        context.active.delete(schema);
    }
};

export const typeScriptTypeFromSchema = (schema: unknown): string => {
    try {
        return schemaType(schema, {
            active: new WeakSet<object>(),
            definitions: [],
            remaining: MAX_SCHEMA_NODES,
        }, 0);
    } catch {
        return "unknown";
    }
};

export const typeScriptTypesFromSchema = (schema: unknown, prefix: string): { type: string; declarations: string[] } => {
    const aliases = { prefix, names: new Map<object, string>(), declarations: [] as string[] };
    const type = schemaType(schema, {
        active: new WeakSet<object>(),
        definitions: [],
        aliases,
        remaining: MAX_SCHEMA_NODES,
    }, 0);
    return { type, declarations: aliases.declarations };
};

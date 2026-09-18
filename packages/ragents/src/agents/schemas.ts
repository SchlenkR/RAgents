import { Type, type Static, type TLiteral, type TSchema } from "typebox";

import { agentDriverKinds } from "../domain/driver.ts";
import { capabilityNames } from "../domain/vocabulary.ts";
import type { VirtualTypeScriptDiagnostic } from "../typescript/compiler.ts";

type Literals<Values extends readonly string[]> = { -readonly [Key in keyof Values]: TLiteral<Values[Key] & string> };

export const literalUnion = <const Values extends readonly string[]>(values: Values) =>
    Type.Union(values.map((value) => Type.Literal(value)) as Literals<Values>);

export const capabilitySchema = literalUnion(capabilityNames);
export const driverKindSchema = literalUnion(agentDriverKinds);

export const scopeSchema = Type.Union([
    Type.Object({ kind: Type.Literal("run") }),
    Type.Object({ kind: Type.Literal("workspace"), path: Type.String({ minLength: 1 }) }),
]);

export const grantSchema = Type.Object({
    capability: capabilitySchema,
    scope: scopeSchema,
    delegable: Type.Boolean(),
    usable: Type.Optional(Type.Boolean({ description: "false = darf nur weitergegeben, nicht selbst benutzt werden" })),
});

export const namedValuesSchema = Type.Array(Type.Object({ name: Type.String({ minLength: 1 }), value: Type.String() }));

const positionSchema = Type.Object({
    line: Type.Integer(),
    column: Type.Integer(),
}, { additionalProperties: false });

export const typeScriptDiagnosticSchema = Type.Object({
    code: Type.Integer(),
    category: Type.Union([
        Type.Literal("warning"),
        Type.Literal("error"),
        Type.Literal("suggestion"),
        Type.Literal("message"),
    ]),
    message: Type.String(),
    fileName: Type.Optional(Type.String()),
    start: Type.Optional(positionSchema),
    end: Type.Optional(positionSchema),
}, { additionalProperties: false });

export type JsonTypeScriptDiagnostic = Static<typeof typeScriptDiagnosticSchema>;

export const jsonTypeScriptDiagnostics = (
    diagnostics: readonly VirtualTypeScriptDiagnostic[],
): JsonTypeScriptDiagnostic[] => diagnostics.map((entry) => ({
    code: entry.code,
    category: entry.category,
    message: entry.message,
    ...(entry.fileName ? { fileName: entry.fileName } : {}),
    ...(entry.start ? { start: { line: entry.start.line, column: entry.start.column } } : {}),
    ...(entry.end ? { end: { line: entry.end.line, column: entry.end.column } } : {}),
}));

export const recordOf = (entries: readonly { name: string; value: string }[] | undefined) =>
    Object.fromEntries((entries ?? []).map((entry) => [entry.name, entry.value]));

export type SchemaOf<Schema extends TSchema> = Static<Schema>;

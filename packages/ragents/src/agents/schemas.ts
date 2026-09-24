import { Type, type TLiteral } from "typebox";

import { agentDriverKinds } from "../domain/driver.ts";
import { capabilityNames } from "../domain/vocabulary.ts";

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

export const recordOf = (entries: readonly { name: string; value: string }[] | undefined) =>
    Object.fromEntries((entries ?? []).map((entry) => [entry.name, entry.value]));

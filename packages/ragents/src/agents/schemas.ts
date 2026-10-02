import { Type, type TLiteral } from "typebox";

import { capabilityNames } from "../domain/vocabulary.ts";

type Literals<Values extends readonly string[]> = { -readonly [Key in keyof Values]: TLiteral<Values[Key] & string> };

export const literalUnion = <const Values extends readonly string[]>(values: Values) =>
    Type.Union(values.map((value) => Type.Literal(value)) as Literals<Values>);

export const capabilitySchema = literalUnion(capabilityNames);

export const scopeSchema = Type.Union([
    Type.Object({ kind: Type.Literal("run") }),
    Type.Object({ kind: Type.Literal("workspace"), path: Type.String({ minLength: 1 }) }),
]);

export const grantSchema = Type.Object({
    capability: capabilitySchema,
    scope: scopeSchema,
    delegable: Type.Boolean(),
    usable: Type.Optional(Type.Boolean({ description: "false = may only be passed on, not used directly" })),
});


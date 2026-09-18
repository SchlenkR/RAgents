import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Static, TSchema } from "typebox";

import { DomainError } from "../runtime/domain-error.ts";

const commandFields = {
    commandId: Type.String({ minLength: 1 }),
    correlationId: Type.Optional(Type.String({ minLength: 1 })),
    causationId: Type.Optional(Type.String({ minLength: 1 })),
};

const command = <Properties extends Record<string, TSchema>>(properties: Properties) =>
    Type.Object({ ...commandFields, ...properties }, { additionalProperties: false });

export const parseBody = <Schema extends TSchema>(schema: Schema, body: unknown): Static<Schema> => {
    if (Value.Check(schema, body))
        return body as Static<Schema>;

    const first = [...Value.Errors(schema, body)].at(0);

    throw new DomainError("invalid-request", first?.message ?? "The request body is invalid.", 400);
};

export const enqueueActorInputBody = command({
    content: Type.String({ minLength: 1 }),
    artifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

export const resolveActionBody = command({
    decision: Type.Union([Type.Literal("approved"), Type.Literal("dismissed")]),
    response: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const reasonBody = command({ reason: Type.String({ minLength: 1 }) });

export const optionalReasonBody = command({ reason: Type.Optional(Type.String({ minLength: 1 })) });

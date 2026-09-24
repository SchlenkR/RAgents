import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { validateToolArguments } from "@ragents/ai";

import { schemaComplaints } from "../src/agents/toolset.ts";

const schema = Type.Object({
    handle: Type.String({ minLength: 1 }),
    grants: Type.Optional(Type.Array(Type.Object({
        capability: Type.Union([Type.Literal("event.subscribe"), Type.Literal("actor.input")]),
    }, { additionalProperties: false }))),
}, { additionalProperties: false });

test("a wrong enum value is reported with path, received value and the allowed values", () => {
    const complaint = schemaComplaints(schema, { handle: "x", grants: [{ capability: "event_subscribe" }] });

    assert.match(complaint, /grants\.0\.capability got "event_subscribe"/);
    assert.match(complaint, /allowed values: event\.subscribe, actor\.input/);
});

test("missing and unknown fields are named", () => {
    const complaint = schemaComplaints(schema, { extra: 1 });

    assert.match(complaint, /missing required field handle/);
    assert.match(complaint, /unknown field extra/);
});

test("other violations carry the received value", () => {
    const complaint = schemaComplaints(schema, { handle: "" });

    assert.match(complaint, /handle .*got ""/);
});

test("the model facing argument validation names the allowed values once per path", () => {
    const tool = { name: "grant", description: "", parameters: schema };
    const call = {
        type: "toolCall" as const,
        id: "call-1",
        name: "grant",
        arguments: { handle: "x", grants: [{ capability: "in_progress" }] },
    };

    assert.throws(() => validateToolArguments(tool, call), (error: Error) => {
        assert.match(error.message, /grants\.0\.capability: got "in_progress", allowed values: event\.subscribe, actor\.input/);
        assert.equal(error.message.match(/grants\.0\.capability/g)?.length, 1);
        assert.match(error.message, /Fix the named fields/);
        return true;
    });
});

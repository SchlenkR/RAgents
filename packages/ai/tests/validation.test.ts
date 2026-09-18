import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import type { Tool } from "../src/types.ts";
import { validateToolArguments } from "../src/utils/validation.ts";

const validate = (parameters: Tool["parameters"], args: Record<string, unknown>) => validateToolArguments(
  { name: "mini_app_test", description: "", parameters },
  { type: "toolCall", id: "validation-test", name: "mini_app_test", arguments: args },
);

const nullableText = Type.Union([Type.String(), Type.Null()]);

test("mini-app test expectations preserve error null and leave the original call unchanged", () => {
  const parameters = Type.Object({ input: Type.Record(Type.String(), Type.Any()), expect: Type.Object({ error: nullableText }) });
  const args = { input: { chat: null }, expect: { error: null } };
  const actual = validate(parameters, args);
  assert.deepEqual(actual, args);
  assert.notEqual(actual, args);
  assert.notEqual(actual.expect, args.expect);
  assert.deepEqual(args, { input: { chat: null }, expect: { error: null } });
});

test("coercing an invalid sibling preserves nullable fields in nested objects and arrays", () => {
  const parameters = Type.Object({
    count: Type.Integer(),
    cases: Type.Array(Type.Object({ chat: nullableText, count: Type.Integer() })),
    labels: Type.Record(Type.String(), nullableText),
  });
  const args = { count: "3", cases: [{ chat: null, count: "2" }, { chat: "", count: 1 }], labels: { first: null, second: "0" } };
  const original = structuredClone(args);
  assert.deepEqual(validate(parameters, args), {
    count: 3, cases: [{ chat: null, count: 2 }, { chat: "", count: 1 }], labels: { first: null, second: "0" },
  });
  assert.deepEqual(args, original);
});

for (const union of ["anyOf", "oneOf"] as const) {
  test(`raw JSON Schema ${union} keeps valid strings, numbers, booleans and null during sibling conversion`, () => {
    const parameters = {
      type: "object", required: ["count", "values"],
      properties: {
        count: { type: "integer" },
        values: { type: "array", items: { [union]: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } },
      },
    } as Tool["parameters"];
    const args = { count: "3", values: [null, 0, false, "", "0", "false", 2, true] };
    assert.deepEqual(validate(parameters, args), { ...args, count: 3 });
  });
}

test("nullable fields in a tuple and schema-defined additional properties survive conversion", () => {
  const parameters = {
    type: "object", required: ["count", "tuple"],
    properties: {
      count: { type: "integer" },
      tuple: { type: "array", items: [{ anyOf: [{ type: "string" }, { type: "null" }] }, { type: "integer" }] },
    },
    additionalProperties: { anyOf: [{ type: "string" }, { type: "null" }] },
  } as Tool["parameters"];
  assert.deepEqual(validate(parameters, { count: "3", tuple: [null, "2"], extra: null }), { count: 3, tuple: [null, 2], extra: null });
});

test("necessary number and boolean conversions still work alongside valid union values", () => {
  const parameters = Type.Object({ count: Type.Integer(), enabled: Type.Boolean(), value: Type.Union([Type.String(), Type.Number()]) });
  assert.deepEqual(validate(parameters, { count: "12", enabled: "false", value: 7 }), { count: 12, enabled: false, value: 7 });
});

test("invalid arguments still fail with a field error and do not mutate the call", () => {
  const parameters = Type.Object({ chat: nullableText, count: Type.Integer() });
  const args = { chat: null, count: "not a number" };
  assert.throws(() => validate(parameters, args), /Validation failed for tool "mini_app_test":\n\s+- count:/);
  assert.deepEqual(args, { chat: null, count: "not a number" });
});

test("unknown root fields pass validation untouched so the engine can strip and report them", () => {
  const parameters = Type.Object({}, { additionalProperties: false });
  const args = { previous: "[]", __unused: "{}" };
  assert.deepEqual(validate(parameters, args), args);
  assert.deepEqual(validate(Type.Object({ target: Type.String() }, { additionalProperties: false }), { target: "Ziel", extra: 1 }), { target: "Ziel", extra: 1 });
});

test("nested unknown fields and missing required fields still fail and name the fields", () => {
  const parameters = Type.Object({
    target: Type.String(),
    options: Type.Object({ depth: Type.Integer() }, { additionalProperties: false }),
  }, { additionalProperties: false });
  assert.throws(
    () => validate(parameters, { target: "Ziel", options: { depth: 1, colour: "red", size: 2 } }),
    /Validation failed for tool "mini_app_test":\n\s+- options: unknown fields colour, size/,
  );
  assert.throws(
    () => validate(parameters, { extra: 1, options: { depth: 1 } }),
    /Validation failed for tool "mini_app_test":\n\s+- target: must have required properties target\n\s+- root: unknown fields extra/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScriptParameters } from "../../server/src/plugin-support/actor-programs/script-parameters.ts";
import type { StartOptionState } from "../../server/src/plugin-support/start-options-contract.ts";
import { buildParameters, initialDraft, modelNamesOf, ParameterForm, parameterFields } from "../src/ParameterForm.tsx";

const parameters: ScriptParameters = {
  type: "object",
  properties: {
    topic: { type: "string", title: "Topic", description: "What the round talks about", maxLength: 160 },
    notes: { type: "string", maxLength: 2000 },
    rounds: { type: "integer", minimum: 1, maximum: 5 },
    ratio: { type: "number", minimum: 0, maximum: 1 },
    mode: { anyOf: [{ type: "string", const: "short" }, { type: "string", const: "long" }] },
    tone: { enum: ["calm", "lively"] },
    verbose: { type: "boolean" },
    model: { type: "string", format: "model" },
  },
  required: ["topic", "mode"],
  additionalProperties: false,
};

test("a form has one field per parameter in declaration order, labelled by title or name", () => {
  const fields = parameterFields(parameters);
  assert.deepEqual(fields.map((field) => [field.name, field.label, field.kind, field.required]), [
    ["topic", "Topic", "string", true],
    ["notes", "notes", "string", false],
    ["rounds", "rounds", "integer", false],
    ["ratio", "ratio", "number", false],
    ["mode", "mode", "choice", true],
    ["tone", "tone", "choice", false],
    ["verbose", "verbose", "boolean", false],
    ["model", "model", "model", false],
  ]);
  assert.equal(fields[0]!.description, "What the round talks about");
  assert.deepEqual([fields[4]!.choices, fields[5]!.choices], [["short", "long"], ["calm", "lively"]]);
  assert.deepEqual([fields[2]!.minimum, fields[2]!.maximum], [1, 5]);
});

test("a parameter that is no plain value is an error", () => {
  const nested: ScriptParameters = { ...parameters, properties: { items: { type: "array" } }, required: [] };
  assert.throws(() => parameterFields(nested), /The parameter items is no string, number, integer, boolean or choice of strings/);
});

test("only filled values are built, numbers as numbers and booleans as booleans", () => {
  const fields = parameterFields(parameters);
  assert.deepEqual(buildParameters(fields, { topic: "  Night bus  ", mode: "long", rounds: "3", ratio: "0.5", verbose: true, model: "demo/fast", notes: "   ", tone: "" }),
    { values: { topic: "Night bus", mode: "long", rounds: 3, ratio: 0.5, verbose: true, model: "demo/fast" }, problems: {} });
  assert.deepEqual(buildParameters(fields, { topic: "A", mode: "short" }).values, { topic: "A", mode: "short" }, "Optional values nobody filled and booleans nobody touched are left out.");
  assert.deepEqual(buildParameters(fields, { topic: "A", mode: "short", verbose: false }).values, { topic: "A", mode: "short", verbose: false }, "A boolean that was turned off is sent.");
});

test("a required boolean is false until it is turned on", () => {
  const fields = parameterFields({ ...parameters, properties: { confirmed: { type: "boolean" } }, required: ["confirmed"] });
  assert.deepEqual(buildParameters(fields, {}), { values: { confirmed: false }, problems: {} });
});

test("missing required values and invalid numbers or choices are problems by parameter name", () => {
  const fields = parameterFields(parameters);
  const { values, problems } = buildParameters(fields, { topic: "   ", rounds: "9", ratio: "x", tone: "wild" });
  assert.deepEqual(values, {});
  assert.deepEqual(problems, {
    topic: "This field is required.",
    rounds: "Maximum: 5.",
    ratio: "Enter a valid number.",
    mode: "This field is required.",
    tone: "Choose one of the available values.",
  });
  assert.equal(buildParameters(fields, { topic: "A", mode: "short", rounds: "0" }).problems.rounds, "Minimum: 1.");
  assert.equal(buildParameters(fields, { topic: "A", mode: "short", rounds: "2.5" }).problems.rounds, "Enter a whole number.");
  assert.equal(buildParameters(fields, { topic: "A", mode: "short", ratio: "2.5" }).problems.ratio, "Maximum: 1.");
});

test("a default of the declaration prefills its field", () => {
  const fields = parameterFields({ ...parameters, properties: {
    topic: { type: "string", default: "Night bus" }, rounds: { type: "integer", default: 2 }, verbose: { type: "boolean", default: true }, mode: { enum: ["short", "long"], default: 3 },
  }, required: [] });
  assert.deepEqual(initialDraft(fields), { topic: "Night bus", rounds: "2", verbose: true });
});

const model = (presentation: unknown): StartOptionState => ({ id: "ragents.model", owner: "example", value: { model: "fast" }, presentation, selectable: true, locked: false, chosen: false });

test("the model names come from the run's model option, none without it", () => {
  assert.deepEqual(modelNamesOf([model({ kind: "model", provider: "demo", options: ["fast", "deep"], thinkingOptions: ["off"] })]), ["demo/fast", "demo/deep"]);
  assert.deepEqual(modelNamesOf([model({ kind: "model", provider: "", options: ["fast"], thinkingOptions: ["off"] })]), ["fast"]);
  assert.deepEqual(modelNamesOf([]), []);
  assert.throws(() => modelNamesOf([model({ kind: "choice" })]), /does not provide a model presentation/);
});

test("the form renders connected labels, descriptions, required marks and typed controls", () => {
  const html = renderToStaticMarkup(createElement(ParameterForm, { parameters, onCancel: () => {}, onSubmit: () => {} }));
  assert.ok(html.includes('aria-label="Parameters"'));
  assert.ok(html.includes("Topic *"));
  assert.ok(html.includes("What the round talks about"));
  assert.ok(html.includes('type="number"') && html.includes('min="1"') && html.includes('max="5"') && html.includes('step="1"'));
  assert.ok(html.includes('step="any"'), "A number that is no integer takes any step.");
  assert.equal(html.match(/<textarea/g)?.length, 1, "Only the long text is a text area.");
  assert.ok(html.includes('role="checkbox"'));
  assert.ok(html.includes("short") && html.includes("long"));
  assert.ok(!html.includes("<datalist"), "Without a model option the model parameter is a plain field.");
  for (const match of html.matchAll(/for="([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
  for (const match of html.matchAll(/aria-describedby="([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
});

test("a parameter the form cannot show is reported instead of rendered", () => {
  const html = renderToStaticMarkup(createElement(ParameterForm, { parameters: { ...parameters, properties: { items: { type: "array" } }, required: [] }, onCancel: () => {}, onSubmit: () => {} }));
  assert.ok(html.includes('role="alert"') && html.includes("The parameter items is no string"));
});

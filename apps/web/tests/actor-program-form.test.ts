import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Form, validateForm } from "../../../apps/web/src/actor-programs/client-ui/Form.tsx";
import type { FormField, FormValues } from "../../../apps/web/src/actor-programs/client-ui/form-contracts.d.ts";

const fields: readonly FormField[] = [
  { id: "name", type: "text", label: "Name", required: true, hint: "A readable name" },
  { id: "note", type: "textarea", label: "Note", rows: 4 },
  { id: "count", type: "number", label: "Count", required: true, min: 0, max: 10 },
  { id: "agreed", type: "checkbox", label: "Confirmed", required: true },
  { id: "mode", type: "select", label: "Mode", required: true, options: [{ value: "brief", label: "Short" }] },
];
const valid = Object.freeze({ name: "Anna", note: "Note", count: 0, agreed: true, mode: "brief" });

test("Form validates all field types and keeps controlled values unchanged", () => {
  assert.deepEqual(validateForm(fields, valid), {});
  const invalid = Object.freeze({ name: "  ", count: -1, agreed: false, mode: "missing" });
  const errors = validateForm(fields, invalid);
  assert.deepEqual(Object.keys(errors), ["name", "count", "agreed", "mode"]);
  assert.match(errors.count, /Minimum: 0/);
  assert.match(errors.mode, /available values/);
  assert.deepEqual(invalid, { name: "  ", count: -1, agreed: false, mode: "missing" });
  assert.match(validateForm(fields, { ...valid, count: 11 }).count, /Maximum: 10/);
  assert.match(validateForm(fields, { ...valid, count: Number.NaN }).count, /valid number/);
  assert.match(validateForm(fields, { ...valid, count: "3" }).count, /valid number/);
  assert.match(validateForm(fields, { ...valid, count: null }).count, /required/);
  assert.match(validateForm(fields, { ...valid, note: true }).note, /Enter text/);
});

test("optional empty and disabled fields do not block; additional validation clears no required errors", () => {
  assert.deepEqual(validateForm([
    { id: "text", type: "text", label: "Optional" },
    { id: "number", type: "number", label: "Optional" },
    { id: "disabled", type: "text", label: "Disabled", required: true, disabled: true },
  ], { text: "", number: null }), {});
  let seen: FormValues | undefined;
  assert.deepEqual(validateForm(fields, valid, (values) => {
    seen = values;
    return { name: "Already taken." };
  }), { name: "Already taken." });
  assert.equal(seen, valid);
  assert.match(validateForm(fields, { ...valid, name: "" }, () => ({ name: "" })).name, /required/);
});

test("Form renders connected labels, hints and the existing SelectMenu; readOnly offers no submit action", () => {
  const html = renderToStaticMarkup(createElement(Form, {
    title: "Contact", fields, values: valid, onChange: () => {}, onSubmit: async () => {},
  }));
  assert.ok(html.includes('aria-label="Contact"'));
  assert.ok(html.includes('aria-haspopup="listbox"'));
  assert.ok(html.includes('type="number"'));
  assert.ok(html.includes('min="0"'));
  assert.ok(html.includes('max="10"'));
  assert.ok(html.includes('rows="4"'));
  for (const match of html.matchAll(/for="([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
  for (const match of html.matchAll(/aria-describedby="([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
  const readonly = renderToStaticMarkup(createElement(Form, {
    fields, values: valid, readOnly: true, onChange: () => {}, onSubmit: async () => {},
  }));
  assert.ok(readonly.includes("Short"));
  assert.ok(!readonly.includes('aria-haspopup="listbox"'));
  assert.ok(!readonly.includes('type="submit"'));
  assert.ok(readonly.includes('readOnly=""'));
  assert.throws(() => renderToStaticMarkup(createElement(Form, {
    fields: [fields[0], fields[0]], values: valid, onChange: () => {},
  })), /unique/);
});

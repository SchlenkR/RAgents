import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Form, validateForm } from "../../../apps/web/src/actor-programs/client-ui/Form.tsx";
import type { FormField, FormValues } from "../../../apps/web/src/actor-programs/client-ui/form-contracts.d.ts";

const fields: readonly FormField[] = [
  { id: "name", type: "text", label: "Name", required: true, hint: "Ein lesbarer Name" },
  { id: "note", type: "textarea", label: "Notiz", rows: 4 },
  { id: "count", type: "number", label: "Anzahl", required: true, min: 0, max: 10 },
  { id: "agreed", type: "checkbox", label: "Bestätigt", required: true },
  { id: "mode", type: "select", label: "Modus", required: true, options: [{ value: "brief", label: "Kurz" }] },
];
const valid = Object.freeze({ name: "Anna", note: "Notiz", count: 0, agreed: true, mode: "brief" });

test("Form validiert alle Feldarten und bewahrt kontrollierte Werte unverändert", () => {
  assert.deepEqual(validateForm(fields, valid), {});
  const invalid = Object.freeze({ name: "  ", count: -1, agreed: false, mode: "missing" });
  const errors = validateForm(fields, invalid);
  assert.deepEqual(Object.keys(errors), ["name", "count", "agreed", "mode"]);
  assert.match(errors.count, /Mindestens 0/);
  assert.match(errors.mode, /angebotenen/);
  assert.deepEqual(invalid, { name: "  ", count: -1, agreed: false, mode: "missing" });
  assert.match(validateForm(fields, { ...valid, count: 11 }).count, /Höchstens 10/);
  assert.match(validateForm(fields, { ...valid, count: Number.NaN }).count, /gültige Zahl/);
  assert.match(validateForm(fields, { ...valid, count: "3" }).count, /gültige Zahl/);
  assert.match(validateForm(fields, { ...valid, count: null }).count, /ausfüllen/);
  assert.match(validateForm(fields, { ...valid, note: true }).note, /Text/);
});

test("optionale leere und deaktivierte Felder blockieren nicht; zusätzliche Validierung löscht keine Pflichtfehler", () => {
  assert.deepEqual(validateForm([
    { id: "text", type: "text", label: "Optional" },
    { id: "number", type: "number", label: "Optional" },
    { id: "disabled", type: "text", label: "Deaktiviert", required: true, disabled: true },
  ], { text: "", number: null }), {});
  let seen: FormValues | undefined;
  assert.deepEqual(validateForm(fields, valid, (values) => {
    seen = values;
    return { name: "Bereits vergeben." };
  }), { name: "Bereits vergeben." });
  assert.equal(seen, valid);
  assert.match(validateForm(fields, { ...valid, name: "" }, () => ({ name: "" })).name, /ausfüllen/);
});

test("Form rendert verbundene Labels, Hinweise und den vorhandenen SelectMenu; readOnly bietet keine Sendeaktion", () => {
  const html = renderToStaticMarkup(createElement(Form, {
    title: "Kontakt", fields, values: valid, onChange: () => {}, onSubmit: async () => {},
  }));
  assert.ok(html.includes('aria-label="Kontakt"'));
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
  assert.ok(readonly.includes("Kurz"));
  assert.ok(!readonly.includes('aria-haspopup="listbox"'));
  assert.ok(!readonly.includes('type="submit"'));
  assert.ok(readonly.includes('readOnly=""'));
  assert.throws(() => renderToStaticMarkup(createElement(Form, {
    fields: [fields[0], fields[0]], values: valid, onChange: () => {},
  })), /eindeutige/);
});

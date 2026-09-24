import assert from "node:assert/strict";
import test from "node:test";
import { fileSelection } from "../../../apps/web/src/actor-programs/client-ui/file-selection.ts";

const file = (name: string, type: string, size = 3) => new File(["x".repeat(size)], name, { type, lastModified: 1 });

test("Dateiauswahl prüft Endung und MIME für jeden Eingang und erhält die vorherige Auswahl bei Ablehnung", () => {
  const initial = [file("data.csv", "text/csv")];
  const image = file("photo.png", "image/png");
  const accepted = fileSelection(initial, [image], { accept: ".CSV,image/*" });
  assert.deepEqual(accepted, [...initial, image]);
  assert.deepEqual(fileSelection(accepted, [image], {}), accepted);
  assert.throws(() => fileSelection(initial, [image, file("bad.exe", "application/octet-stream")], { accept: "image/*" }), /bad.exe/);
  assert.equal(initial.length, 1);
  assert.throws(() => fileSelection(initial, [], {}), /keine lesbaren Dateien/);
});

test("Dateigrenzen gelten für die gesamte Auswahl; Einzelauswahl ersetzt statt anzuhängen", () => {
  const initial = [file("one.txt", "text/plain", 5)];
  const next = file("two.txt", "text/plain", 6);
  assert.throws(() => fileSelection(initial, [next], { maxBytes: 10 }), /überschreitet/);
  assert.throws(() => fileSelection(initial, [next], { maxFiles: 1 }), /Höchstens/);
  assert.deepEqual(fileSelection(initial, [next], { multiple: false, maxBytes: 6 }), [next]);
  assert.throws(() => fileSelection([], [...initial, next], { multiple: false }), /genau eine/);
  assert.throws(() => fileSelection([], [next], { maxFiles: 0 }), /positive/);
});

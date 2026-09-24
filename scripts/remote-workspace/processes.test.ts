import assert from "node:assert/strict";
import test from "node:test";
import { announcedUrl } from "./processes.ts";

test("die Ansage zählt erst als ganze Zeile, eine kaputte ganze Zeile ist ein benannter Fehler", () => {
  const announcement = "{\"ragents\":{\"url\":\"http://127.0.0.1:4800\",\"pid\":1}}";
  assert.equal(announcedUrl("Start\n{\"ragents\":{\"url\":\"http://127.0"), undefined);
  assert.equal(announcedUrl(`Start\n${announcement}\n`), "http://127.0.0.1:4800");
  assert.throws(() => announcedUrl("{\"ragents\":{\"pid\":1}}\n"), /nennt keine Adresse/);
  assert.throws(() => announcedUrl("{\"ragents\":kaputt\n"), SyntaxError);
});

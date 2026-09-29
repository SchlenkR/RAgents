import assert from "node:assert/strict";
import test from "node:test";
import { announcedUrl } from "./processes.ts";

test("the announcement counts only as a whole line, a broken whole line is a named error", () => {
  const announcement = "{\"ragents\":{\"url\":\"http://127.0.0.1:4800\",\"pid\":1}}";
  assert.equal(announcedUrl("Start\n{\"ragents\":{\"url\":\"http://127.0"), undefined);
  assert.equal(announcedUrl(`Start\n${announcement}\n`), "http://127.0.0.1:4800");
  assert.throws(() => announcedUrl("{\"ragents\":{\"pid\":1}}\n"), /names no address/);
  assert.throws(() => announcedUrl("{\"ragents\":broken\n"), SyntaxError);
});

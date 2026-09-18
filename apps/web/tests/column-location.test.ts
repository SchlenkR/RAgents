import assert from "node:assert/strict";
import test from "node:test";
import { parseColumnLocation } from "../src/column/column-location.ts";

test("the column reads run, host, theme and token from its address and defaults to the browser column", () => {
  assert.deepEqual(parseColumnLocation(""), { layout: "column", runId: undefined, host: "browser", theme: undefined, access: undefined });
  assert.deepEqual(parseColumnLocation("?run=run-a&host=vscode&theme=dark&access=tok"), { layout: "column", runId: "run-a", host: "vscode", theme: "dark", access: "tok" });
  assert.deepEqual(parseColumnLocation("?layout=app&run=run-a&element=board--main"), { layout: "app", runId: "run-a", elementId: "board--main", host: "browser", theme: undefined, access: undefined });
});

test("unknown layouts, hosts and themes and an app page without element are hard errors", () => {
  assert.throws(() => parseColumnLocation("?layout=grid"), /column und app/);
  assert.throws(() => parseColumnLocation("?host=electron"), /browser und vscode/);
  assert.throws(() => parseColumnLocation("?theme=blue"), /light und dark/);
  assert.throws(() => parseColumnLocation("?layout=app&run=run-a"), /run und element/);
});

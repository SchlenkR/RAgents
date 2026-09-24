import assert from "node:assert/strict";
import test from "node:test";
import { helpSampleRequest } from "../src/help-samples.ts";

const frame = {} as Window;
const origin = "https://ragents.example";
const entries = ["ragents.reference.word-game"];
const event = (data: unknown) => ({ source: frame, origin, data });

test("embedded documentation can request only an available sample", () => {
  assert.deepEqual(helpSampleRequest(event({ type: "ragents:help-ready" }), frame, origin, []), { type: "ready" });
  assert.deepEqual(helpSampleRequest(event({ type: "ragents:start-sample", entry: entries[0] }), frame, origin, entries),
    { type: "start", entry: entries[0] });
  assert.equal(helpSampleRequest(event({ type: "ragents:start-sample", entry: entries[0] }), frame, origin, []), undefined);
  assert.equal(helpSampleRequest(event({ type: "ragents:start-sample", entry: "unknown" }), frame, origin, entries), undefined);
});

test("other windows, origins and malformed help messages cannot start a run", () => {
  const valid = event({ type: "ragents:start-sample", entry: entries[0] });
  assert.equal(helpSampleRequest({ ...valid, source: {} as Window }, frame, origin, entries), undefined);
  assert.equal(helpSampleRequest({ ...valid, origin: "https://other.example" }, frame, origin, entries), undefined);
  assert.equal(helpSampleRequest(valid, null, origin, entries), undefined);
  for (const data of [null, [], "ragents:start-sample", {}, { type: "unknown" }, { type: "ragents:start-sample", entry: 1 }]) {
    assert.equal(helpSampleRequest(event(data), frame, origin, entries), undefined);
  }
});

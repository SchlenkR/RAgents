import assert from "node:assert/strict";
import test from "node:test";
import { appendPluginEvent } from "../src/lib/append-plugin-event.ts";
import type { PluginEvent } from "../src/PluginRegistry.tsx";

test("plugin events retain the latest hundred in order without changing the previous array", () => {
  const events = Array.from({ length: 100 }, (_, index) => ({ pluginId: "example", type: String(index), payload: { index } }));
  const event = { pluginId: "example", type: "100", payload: { index: 100 } };
  const appended = appendPluginEvent(events, event);
  assert.equal(appended.length, 100);
  assert.deepEqual(appended.map((entry) => entry.type), Array.from({ length: 100 }, (_, index) => String(index + 1)));
  assert.equal(appended.at(-1), event);
  assert.equal(appended[0], events[1]);
  assert.equal(events.length, 100);
  assert.equal(events[0].type, "0");
});

test("a reset starts a new plugin event history and long streams stay bounded", () => {
  let events: readonly PluginEvent[] = [];
  for (let index = 0; index < 10_000; index++) events = appendPluginEvent(events, { pluginId: "example", type: String(index) });
  assert.equal(events.length, 100);
  assert.equal(events[0].type, "9900");
  events = appendPluginEvent([], { pluginId: "example", type: "reset" });
  assert.deepEqual(events.map((entry) => entry.type), ["reset"]);
});

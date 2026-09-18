import assert from "node:assert/strict";
import test from "node:test";
import { createModelSettingsStore } from "../../../plugins/ragents.overseer/web/model-settings";
import type { OverseerSettings } from "../../../plugins/ragents.overseer/contract";

const settings: OverseerSettings = { provider: "openrouter", model: "model-a", thinking: "medium", models: [
  { provider: "openrouter", id: "model-a", label: "Model A", thinking: ["off", "medium"] },
  { provider: "openrouter", id: "model-b", label: "Model B", thinking: ["off", "high"] },
] };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("coordinator settings notify both views and preserve selection after a rejected save", async () => {
  let fail = false;
  const requests: unknown[] = [];
  const store = createModelSettingsStore(async (_url, init) => {
    if (init?.method !== "PUT") return reply(settings);
    requests.push(JSON.parse(String(init.body)));
    return fail ? reply({ error: "Reasoning nicht unterstützt" }, 400) : reply({ ...settings, ...requests.at(-1) as object });
  });
  let chatUpdates = 0;
  let settingsUpdates = 0;
  const closeChat = store.subscribe(() => { chatUpdates++; });
  const closeSettings = store.subscribe(() => { settingsUpdates++; });
  await store.load();
  await store.save({ provider: "openrouter", model: "model-b", thinking: "high" });
  assert.equal(store.read().settings?.model, "model-b");
  assert.equal(chatUpdates, settingsUpdates);
  const saved = store.read().settings;
  fail = true;
  await assert.rejects(store.save({ provider: "openrouter", model: "model-a", thinking: "high" }), /Reasoning/);
  assert.equal(store.read().settings, saved);
  assert.match(store.read().error ?? "", /Reasoning/);
  assert.deepEqual(requests[0], { provider: "openrouter", model: "model-b", thinking: "high" });
  closeChat(); closeSettings();
});

test("a stale refresh cannot overwrite a newer successful model selection", async () => {
  let refresh: ((response: Response) => void) | undefined;
  let loads = 0;
  const store = createModelSettingsStore(async (_url, init) => {
    if (init?.method === "PUT") return reply({ ...settings, model: "model-b", thinking: "high" });
    if (loads++ === 0) return reply(settings);
    return new Promise((resolve) => { refresh = resolve; });
  });
  await store.load();
  const loading = store.load();
  assert.equal(store.load(), loading);
  await store.save({ provider: "openrouter", model: "model-b", thinking: "high" });
  refresh!(reply(settings));
  await loading;
  assert.equal(store.read().settings?.model, "model-b");
});

test("malformed settings produce a visible failure instead of an incomplete selection", async () => {
  const store = createModelSettingsStore(async () => reply({ model: "model-a" }));
  await store.load();
  assert.equal(store.read().status, "failed");
  assert.match(store.read().error ?? "", /ungültige/);
});

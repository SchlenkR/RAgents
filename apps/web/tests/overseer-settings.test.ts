import assert from "node:assert/strict";
import test from "node:test";
import { createModelSettingsStore, type ModelSettingsApi } from "../../../plugins/ragents.overseer/web/model-settings";
import type { OverseerSettings } from "../../../plugins/ragents.overseer/contract";

const settings: OverseerSettings = { provider: "openrouter", model: "model-a", thinking: "medium", models: [
  { provider: "openrouter", id: "model-a", label: "Model A", thinking: ["off", "medium"] },
  { provider: "openrouter", id: "model-b", label: "Model B", thinking: ["off", "high"] },
] };

test("coordinator settings notify both views and preserve selection after a rejected save", async () => {
  let fail = false;
  const requests: unknown[] = [];
  const api: ModelSettingsApi = {
    read: async () => settings,
    save: async (selection) => {
      requests.push(selection);
      if (fail) throw new Error("Reasoning nicht unterstützt");
      return { ...settings, ...selection };
    },
  };
  const store = createModelSettingsStore(api);
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
  let refresh: ((value: OverseerSettings) => void) | undefined;
  let loads = 0;
  const store = createModelSettingsStore({
    read: async () => loads++ === 0 ? settings : new Promise<OverseerSettings>((resolve) => { refresh = resolve; }),
    save: async () => ({ ...settings, model: "model-b", thinking: "high" }),
  });
  await store.load();
  const loading = store.load();
  assert.equal(store.load(), loading);
  await store.save({ provider: "openrouter", model: "model-b", thinking: "high" });
  refresh!(settings);
  await loading;
  assert.equal(store.read().settings?.model, "model-b");
});

test("a failed load without earlier settings becomes a visible failure", async () => {
  const store = createModelSettingsStore({
    read: async () => { throw new Error("Der Server hat ungültige Koordinator-Einstellungen geliefert"); },
    save: async () => settings,
  });
  await store.load();
  assert.equal(store.read().status, "failed");
  assert.match(store.read().error ?? "", /ungültige/);
});

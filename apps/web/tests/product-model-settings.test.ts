import assert from "node:assert/strict";
import test from "node:test";
import { modelDraftOf, productModelSettingsFrom, unavailableModelDefaults } from "../src/product/model-settings.ts";

const settings = {
  profiles: [
    { name: "coordinator", description: "Run coordinator", provider: "test", model: "removed", thinking: "off" },
    { name: "standard", description: "Agents", provider: "test", model: "current", thinking: "max" },
  ],
  models: [{ id: "current", provider: "test", label: "Current model", thinking: ["off" as const] }],
};

test("role settings accept stale defaults and identify every role that still needs a valid choice", () => {
  const loaded = productModelSettingsFrom(settings);
  const draft = modelDraftOf(loaded);
  assert.deepEqual(unavailableModelDefaults(loaded, draft).map(({ name }) => name), ["coordinator", "standard"]);
  const partlyFixed = { profiles: draft.profiles.map((profile) => ({ ...profile, model: "current" })) };
  assert.deepEqual(unavailableModelDefaults(loaded, partlyFixed).map(({ name }) => name), ["standard"]);
  const fixed = { profiles: partlyFixed.profiles.map((profile) => ({ ...profile, thinking: "off" as const })) };
  assert.deepEqual(unavailableModelDefaults(loaded, fixed), []);
  assert.equal(loaded.profiles[0]!.model, "removed");
  assert.deepEqual(unavailableModelDefaults(productModelSettingsFrom({ ...settings, models: [] }), draft).map(({ name }) => name), ["coordinator", "standard"]);
});

test("malformed role settings and duplicate roles remain errors", () => {
  for (const invalid of [{}, { ...settings, profiles: [] }, { ...settings, profiles: [settings.profiles[0], settings.profiles[0]] },
    { ...settings, profiles: [{ ...settings.profiles[0], thinking: null }] },
    { ...settings, models: [{ ...settings.models[0], thinking: [] }] },
  ]) assert.throws(() => productModelSettingsFrom(invalid), /invalid|model catalog/);
});

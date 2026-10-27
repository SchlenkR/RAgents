import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { resolveExecution, StaticModelCatalog, type AgentProfile, type CatalogModel } from "@ragents/engine";
import { ProductModelSettingsStore, productModelSettingsMethods } from "../src/plugin-support/product-model-settings.ts";
import { modelStartOption } from "../src/plugin-support/product-start-options.ts";
import type { ModelChoice } from "../src/plugin-support/model-choice.ts";

const choice: ModelChoice = {
  provider: "test", options: ["current", "other"], defaultModel: "current", selectable: true,
  thinkingOptionsFor: (model) => {
    if (model === "removed") throw new Error("Removed models must not be looked up for presentation");
    return ["off", "low"];
  },
};
const profiles: AgentProfile[] = ["coordinator", "standard", "relay"].map((name) => ({
  name, description: name, driver: "agent", provider: "test", model: "current", thinking: "off", turnTimeoutMs: null, isolateWorkspace: false,
}));
const models: CatalogModel[] = choice.options.map((model) => ({ driver: "agent", provider: choice.provider, model, thinking: ["off", "low"], label: model }));
const draft = (model = "current", thinking = "off") => ({ profiles: profiles.map(({ name }) => ({ name, model, thinking })) });
const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-product-models-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "model-settings.json");
};

test("stored role defaults retain removed models and thinking levels for presentation and fail when used", async (t) => {
  const file = await fixture(t);
  for (const [model, thinking] of [["removed", "low"], ["current", "max"], ["current", "retired"]]) {
    await writeFile(file, JSON.stringify(draft(model, thinking)));
    const store = new ProductModelSettingsStore(file, choice, profiles);
    assert.equal(store.get().profiles[0]!.model, model);
    assert.equal(store.coordinatorThinking(), thinking);
    assert.equal(store.modelChoice.defaultModel, model);
    assert.deepEqual(store.modelChoice.thinkingOptionsFor(null), []);
    const offered = [...models, { ...models[0]!, provider: "other" }];
    const copiedProfiles: AgentProfile[] = JSON.parse(JSON.stringify(store.profiles()));
    assert.ok(copiedProfiles.every((profile) => profile.driver === "agent" && profile.storedDefault?.includes("model-settings.json")));
    const catalog = new StaticModelCatalog(offered, copiedProfiles);
    for (const profile of profiles) {
      const problem = new RegExp(`role ${profile.name}.*stored default.*${model === "removed" ? "test/removed" : `thinking level ${thinking}`}.*model-settings.json.*Settings, Models`);
      assert.throws(() => resolveExecution(catalog, { profile: profile.name }, "worker", models), problem);
      assert.throws(() => resolveExecution(catalog, { profile: profile.name, model }, "worker", models), problem);
      assert.deepEqual(resolveExecution(catalog, { profile: profile.name, model: "other", thinking: "off" }, "worker", models).driver,
        { kind: "agent", config: { provider: "test", model: "other", thinking: "off" } });
    }
    if (model === "current") {
      assert.throws(() => resolveExecution(catalog, { profile: "standard", provider: "other", model: "current" }, "worker", offered), /role standard.*thinking level.*Settings, Models/);
      assert.deepEqual(resolveExecution(catalog, { profile: "standard", thinking: "off" }, "worker", models).driver,
        { kind: "agent", config: { provider: "test", model: "current", thinking: "off" } });
      assert.throws(() => resolveExecution(catalog, { profile: "standard", thinking: "max" }, "worker", models), /Model current does not offer thinking max/);
    }
    const option = modelStartOption(store.modelChoice, store.coordinatorThinking);
    const context = { runId: "new", userId: null };
    const value = option.defaultValue(context);
    assert.deepEqual(value, { model, thinking });
    assert.doesNotThrow(() => option.describe(value, context));
    assert.deepEqual(option.accept({ model: "other" }, context), { model: "other", thinking: thinking === "low" ? "low" : "off" });
    await assert.rejects(store.save(draft(model, thinking)), /not available/);
    await store.save(draft());
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), draft());
    const reloaded = new ProductModelSettingsStore(file, choice, profiles);
    assert.doesNotThrow(() => resolveExecution(new StaticModelCatalog(models, reloaded.profiles()), { profile: "coordinator" }, "primary", models));
    assert.equal(productModelSettingsMethods("test.product", store).length, 2);
  }
});

test("damaged role files fail with their cause and configured defaults without a stored file stay strict", async (t) => {
  const file = await fixture(t);
  await writeFile(file, "not-json");
  assert.throws(() => new ProductModelSettingsStore(file, choice, profiles), SyntaxError);
  for (const value of [null, [], {}, { ...draft(), extra: true }, { profiles: [] },
    { profiles: [draft().profiles[0], draft().profiles[0], draft().profiles[2]] },
    { profiles: draft().profiles.map((entry) => ({ ...entry, name: "unknown" })) },
    { profiles: draft().profiles.map((entry) => ({ ...entry, extra: true })) },
    { profiles: draft().profiles.map(({ name }) => ({ name, model: "current" })) },
    { profiles: draft().profiles.map((entry) => ({ ...entry, model: 42 })) },
    { profiles: draft().profiles.map((entry) => ({ ...entry, thinking: null })) },
  ]) {
    await writeFile(file, JSON.stringify(value));
    assert.throws(() => new ProductModelSettingsStore(file, choice, profiles), /required|allowed|twice|Unknown role|strings/);
  }
  await rm(file);
  for (const [model, thinking] of [["removed", "off"], ["current", "max"]]) {
    const invalid = profiles.map((profile) => ({ ...profile, model, thinking }) as AgentProfile);
    assert.throws(() => new ProductModelSettingsStore(file, choice, invalid), /not available/);
  }
  assert.doesNotThrow(() => new ProductModelSettingsStore(file, choice, profiles));
  await writeFile(file, JSON.stringify(draft()));
  assert.throws(() => new ProductModelSettingsStore(file, choice, profiles.map((profile) => ({ ...profile, provider: "other" }) as AgentProfile)), /different provider/);
});

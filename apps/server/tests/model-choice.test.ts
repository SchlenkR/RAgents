import assert from "node:assert/strict";
import test from "node:test";

import {
  modelChoiceEnvDescriptors,
  modelChoiceFromEnvironment,
  providerCatalog,
} from "../src/plugin-support/model-choice.ts";
import { modelStartOption } from "../src/plugin-support/product-start-options.ts";
import { getSupportedThinkingLevels, type Api, type Model } from "@ragents/ai";
import { config as coreConfig } from "../../../ragents.config.core.ts";
import type { DeclaredEnvironment } from "../src/plugin-support/plugin-config.ts";
import { parseModelProviders } from "../src/plugin-support/model-providers.ts";

type Key = (typeof modelChoiceEnvDescriptors)[number]["key"];

const environment = (values: Partial<Record<Key, string | readonly string[]>>): DeclaredEnvironment<Key> => {
  const read = (key: Key): string | undefined => {
    const value = values[key];
    return Array.isArray(value) ? undefined : value;
  };
  return {
    descriptors: modelChoiceEnvDescriptors,
    value: (key, fallback) => read(key) ?? fallback,
    optional: read,
    required: (key) => {
      const value = read(key);
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    },
    list: (key) => {
      const value = values[key];
      if (Array.isArray(value)) return value;
      return value ? [value] : [];
    },
    flag: (key) => read(key) === "1",
    positiveNumber: (key, fallback) => Number(read(key) ?? fallback),
  };
};

const testModels = (ids: readonly string[]): readonly Model<Api>[] => ids.map((id) => ({
  id, name: id, provider: "test", api: "openai-completions", baseUrl: "https://models.example.invalid/v1",
  contextWindow: 131_072, maxTokens: 16_384, reasoning: true, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}));

const choice = (values: Partial<Record<Key, string | readonly string[]>>, defaultModel: string) =>
  modelChoiceFromEnvironment(environment(values), {
    selectable: true,
    provider: "test",
    defaultModel: () => defaultModel,
    catalog: () => testModels(["other-first", "coordinator-default", "twice"]),
  });

test("the coordinator default is independent from the displayed model order", () => {
  const configured = choice({ AGENT_MODELS: ["other-first", "coordinator-default"] }, "coordinator-default");

  assert.deepEqual(configured.options, ["other-first", "coordinator-default"]);
  assert.equal(configured.defaultModel, "coordinator-default");
});

test("a coordinator default outside AGENT_MODELS fails explicitly", () => {
  const configured = choice({ AGENT_MODELS: ["other-first"] }, "coordinator-default");

  assert.throws(() => configured.options, /coordinator model coordinator-default is not in AGENT_MODELS/);
  assert.throws(() => configured.defaultModel, /coordinator model coordinator-default is not in AGENT_MODELS/);
});

test("without AGENT_MODELS the selection offers every configured provider model", () => {
  const configured = choice({}, "coordinator-default");

  assert.deepEqual(configured.options, ["other-first", "coordinator-default", "twice"]);
  assert.equal(configured.defaultModel, "coordinator-default");
});

test("without AGENT_MODELS the agent and the coordinator may share one model", () => {
  const shared = modelChoiceFromEnvironment(environment({}), {
    selectable: true,
    provider: "test",
    defaultModel: () => "shared-model",
    catalog: () => testModels(["shared-model"]),
  });

  assert.deepEqual(shared.options, ["shared-model"]);
  assert.equal(shared.selectable, false);
  assert.throws(() => choice({ AGENT_MODELS: ["twice", "twice"] }, "twice").options, /AGENT_MODELS names twice more than once/);
});

const coreModels = parseModelProviders(coreConfig.host.MODEL_PROVIDERS, { OPENROUTER_API_KEY: "test-only" })[0]!.models;

const coreChoice = (reasoning?: readonly string[]) => modelChoiceFromEnvironment(environment({
  AGENT_MODELS: coreConfig["ragents.product"].AGENT_MODELS,
  ...(reasoning ? { AGENT_MODEL_REASONING: reasoning } : {}),
}), {
  selectable: true,
  provider: "openrouter",
  defaultModel: () => "z-ai/glm-5.3-flash",
  catalog: () => coreModels,
});

test("every shipped model exposes exactly its own runtime reasoning levels", () => {
  const configured = coreChoice();
  for (const id of configured.options) {
    const model = coreModels.find((entry) => entry.id === id);
    assert.ok(model);
    assert.deepEqual(configured.thinkingOptionsFor(id), getSupportedThinkingLevels(model), id);
  }
  assert.deepEqual(configured.thinkingOptionsFor("z-ai/glm-5.3-flash"), ["low", "high", "max"]);
  assert.deepEqual(configured.thinkingOptionsFor(null), ["low", "high", "max"]);
});

test("reasoning overrides may restrict actual model levels but cannot invent them", () => {
  assert.deepEqual(coreChoice(["z-ai/glm-5.3-flash: low max"]).thinkingOptionsFor("z-ai/glm-5.3-flash"), ["low", "max"]);
  assert.throws(() => coreChoice(["z-ai/glm-5.3-flash: medium"]).thinkingOptionsFor("z-ai/glm-5.3-flash"), /medium.*not available/);
  assert.throws(() => coreChoice(["z-ai/glm-5.3-flash: low low"]).thinkingOptionsFor("z-ai/glm-5.3-flash"), /more than once/);
  assert.throws(() => coreChoice().thinkingOptionsFor("missing-model"), /missing from the model catalog/);
});

test("GLM start options accept max and reject medium before creating a run", () => {
  const option = modelStartOption(coreChoice(), "low");
  assert.deepEqual(modelStartOption(coreChoice(), "medium").defaultValue(), { model: "z-ai/glm-5.3-flash", thinking: "low" });
  assert.deepEqual(option.describe({ model: "z-ai/glm-5.3-flash", thinking: "max" }).thinkingOptions, ["low", "high", "max"]);
  assert.deepEqual(option.accept({ model: "z-ai/glm-5.3-flash", thinking: "max" }), { model: "z-ai/glm-5.3-flash", thinking: "max" });
  assert.throws(() => option.accept({ model: "z-ai/glm-5.3-flash", thinking: "medium" }), /medium.*valid: low, high, max/);
});

test("direct provider names offer configured models and AGENT_MODELS restricts that selection", (t) => {
  const previous = process.env.MODEL_PROVIDERS;
  const previousKey = process.env.DIRECT_MODEL_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.MODEL_PROVIDERS;
    else process.env.MODEL_PROVIDERS = previous;
    if (previousKey === undefined) delete process.env.DIRECT_MODEL_KEY;
    else process.env.DIRECT_MODEL_KEY = previousKey;
  });
  process.env.DIRECT_MODEL_KEY = "test-only";
  process.env.MODEL_PROVIDERS = JSON.stringify([{
    id: "direct", baseUrl: "https://models.example.invalid/v1", apiKey: { kind: "environment", name: "DIRECT_MODEL_KEY" },
    models: [
      { id: "first", contextWindow: 131_072, maxTokens: 16_384, reasoning: false, input: ["text"] },
      { id: "second", contextWindow: 262_144, maxTokens: 32_768, reasoning: true, input: ["text"], thinkingLevelMap: { max: "max" } },
    ],
  }]);
  const directChoice = (models?: readonly string[]) => modelChoiceFromEnvironment(environment(models ? { AGENT_MODELS: models } : {}), {
    selectable: true, provider: "direct", defaultModel: () => "second",
  });
  assert.deepEqual(providerCatalog("direct")().map((model) => model.id), ["first", "second"]);
  assert.deepEqual(directChoice().options, ["first", "second"]);
  assert.deepEqual(directChoice().thinkingOptionsFor("first"), ["off"]);
  assert.deepEqual(directChoice().thinkingOptionsFor("second"), ["off", "minimal", "low", "medium", "high", "max"]);
  assert.deepEqual(directChoice(["second"]).options, ["second"]);
  assert.equal(directChoice(["second"]).selectable, false);
  assert.throws(() => directChoice(["missing"]).options, /AGENT_MODELS: model missing is not configured for provider direct; configured model ids: first, second/);
  assert.throws(() => providerCatalog("openrouter")(), /AGENT_PROVIDER: provider openrouter is not configured; declare it in MODEL_PROVIDERS or set AGENT_PROVIDER/);
  assert.throws(() => providerCatalog("openrouter", "COMPACTION_PROVIDER")(), /COMPACTION_PROVIDER: provider openrouter is not configured; declare it in MODEL_PROVIDERS or set COMPACTION_PROVIDER/);
});

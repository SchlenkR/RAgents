import assert from "node:assert/strict";
import test from "node:test";

import {
  modelChoiceEnvDescriptors,
  modelChoiceFromEnvironment,
} from "../src/plugin-support/model-choice.ts";
import { modelStartOption } from "../src/plugin-support/product-start-options.ts";
import { getSupportedThinkingLevels } from "@aicontainer/ai";
import { getBuiltinModels } from "@aicontainer/ai/providers/all";
import { config as coreConfig } from "../../../ragents.config.core.ts";
import type { DeclaredEnvironment } from "../src/plugin-support/plugin-config.ts";

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

const choice = (values: Partial<Record<Key, string | readonly string[]>>, defaultModel: string) =>
  modelChoiceFromEnvironment(environment(values), {
    selectable: true,
    provider: "test",
    defaultModel: () => defaultModel,
    fallback: () => [defaultModel],
  });

test("the coordinator default is independent from the displayed model order", () => {
  const configured = choice({ AGENT_MODELS: ["other-first", "coordinator-default"] }, "coordinator-default");

  assert.deepEqual(configured.options, ["other-first", "coordinator-default"]);
  assert.equal(configured.defaultModel, "coordinator-default");
});

test("a coordinator default outside AGENT_MODELS fails explicitly", () => {
  const configured = choice({ AGENT_MODELS: ["other-first"] }, "coordinator-default");

  assert.throws(() => configured.options, /Koordinator-Modell coordinator-default steht nicht in AGENT_MODELS/);
  assert.throws(() => configured.defaultModel, /Koordinator-Modell coordinator-default steht nicht in AGENT_MODELS/);
});

test("the fallback model list also carries the explicit coordinator default", () => {
  const configured = choice({}, "coordinator-default");

  assert.deepEqual(configured.options, ["coordinator-default"]);
  assert.equal(configured.defaultModel, "coordinator-default");
});

const coreChoice = (reasoning?: readonly string[]) => modelChoiceFromEnvironment(environment({
  AGENT_MODELS: coreConfig["ragents.product"].AGENT_MODELS,
  ...(reasoning ? { AGENT_MODEL_REASONING: reasoning } : {}),
}), {
  selectable: true,
  provider: "openrouter",
  defaultModel: () => "z-ai/glm-5.3-flash",
  fallback: () => [],
});

test("every shipped model exposes exactly its own runtime reasoning levels", () => {
  const configured = coreChoice();
  for (const id of configured.options) {
    const model = getBuiltinModels("openrouter").find((entry) => entry.id === id);
    assert.ok(model);
    assert.deepEqual(configured.thinkingOptionsFor(id), getSupportedThinkingLevels(model), id);
  }
  assert.deepEqual(configured.thinkingOptionsFor("z-ai/glm-5.3-flash"), ["low", "high", "max"]);
  assert.deepEqual(configured.thinkingOptionsFor(null), ["low", "high", "max"]);
});

test("reasoning overrides may restrict actual model levels but cannot invent them", () => {
  assert.deepEqual(coreChoice(["z-ai/glm-5.3-flash: low max"]).thinkingOptionsFor("z-ai/glm-5.3-flash"), ["low", "max"]);
  assert.throws(() => coreChoice(["z-ai/glm-5.3-flash: medium"]).thinkingOptionsFor("z-ai/glm-5.3-flash"), /medium.*nicht verfügbar/);
  assert.throws(() => coreChoice(["z-ai/glm-5.3-flash: low low"]).thinkingOptionsFor("z-ai/glm-5.3-flash"), /mehrfach/);
  assert.throws(() => coreChoice().thinkingOptionsFor("missing-model"), /fehlt im Modellkatalog/);
});

test("GLM start options accept max and reject medium before creating a run", () => {
  const option = modelStartOption(coreChoice(), "low");
  assert.deepEqual(modelStartOption(coreChoice(), "medium").defaultValue(), { model: "z-ai/glm-5.3-flash", thinking: "low" });
  assert.deepEqual(option.describe({ model: "z-ai/glm-5.3-flash", thinking: "max" }).thinkingOptions, ["low", "high", "max"]);
  assert.deepEqual(option.accept({ model: "z-ai/glm-5.3-flash", thinking: "max" }), { model: "z-ai/glm-5.3-flash", thinking: "max" });
  assert.throws(() => option.accept({ model: "z-ai/glm-5.3-flash", thinking: "medium" }), /medium.*gültig: low, high, max/);
});

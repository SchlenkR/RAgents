import assert from "node:assert/strict";
import test from "node:test";
import { ModelRuntime } from "@ragents/agent";
import { getSupportedThinkingLevels, type AssistantMessage, type Context } from "@ragents/ai";
import { ALIAS_PROVIDER, aliasCatalog, displayProvider, modelLabel, parseModelAliases } from "../src/plugin-support/model-aliases.ts";
import { modelChoiceEnvDescriptors, modelChoiceFromEnvironment } from "../src/plugin-support/model-choice.ts";
import { modelStartOption } from "../src/plugin-support/product-start-options.ts";
import { declaredEnvironment } from "../src/plugin-support/plugin-config.ts";
import { roleThinkingLevel } from "../src/plugin-support/thinking-level.ts";

const aliases = parseModelAliases([
  "standard=openrouter/qwen/qwen3.8-27b",
  "strong=openrouter/z-ai/glm-5.3",
  "fast=openrouter/z-ai/glm-5.3-flash",
  "reasoning=openrouter/deepseek/deepseek-v4.1-flash",
]);

/** Die Stufen, die OpenRouter je Zielmodell im reasoning-Block von /api/v1/models nennt; "off" nur, wo Reasoning nicht Pflicht ist. */
const expectedLevels: Record<string, readonly string[]> = {
  standard: ["off", "low", "medium", "xhigh"],
  strong: ["low", "high", "max"],
  fast: ["low", "high", "max"],
  reasoning: ["off", "low", "high", "max"],
};

const runtime = (): ModelRuntime => {
  const created = ModelRuntime.create();
  created.registerAliases(ALIAS_PROVIDER, aliases);
  return created;
};

const context = (messages: Context["messages"] = [{ role: "user", content: "Hallo", timestamp: 1 }]): Context => ({ messages });

const capturedPayload = async (models: ModelRuntime, alias: string, reasoning: string, history?: Context["messages"]) => {
  let payload: Record<string, unknown> | undefined;
  const result = await models.completeSimple(models.getModel(ALIAS_PROVIDER, alias)!, context(history), {
    apiKey: "test-only",
    ...(reasoning === "off" ? {} : { reasoning: reasoning as "low" }),
    onPayload: (value) => { payload = structuredClone(value) as Record<string, unknown>; throw new Error("captured before network"); },
  });
  assert.match(result.errorMessage ?? "", /captured before network/);
  return { payload: payload!, result };
};

test("MODEL_ALIASES bildet Aliasse auf Modelle eingebauter Kataloge ab und zeigt keinen Anbieter", () => {
  assert.throws(() => parseModelAliases(["kein-alias"]), /MODEL_ALIASES: "kein-alias" hat nicht das Format/);
  assert.throws(() => parseModelAliases(["x=openrouter/z-ai/glm-5.3@sehr"]), /unbekannte Denktiefe "sehr"/);
  assert.deepEqual(parseModelAliases(["x=openrouter/z-ai/glm-5.3@high"]), [{ alias: "x", upstream: "openrouter", model: "z-ai/glm-5.3", thinking: "high" }]);
  assert.throws(() => aliasCatalog(parseModelAliases(["x=openrouter/z-ai/glm-5.3@medium"])), /Denktiefe medium gibt es für x nicht \(gültig: low, high, max\)/);
  assert.throws(() => aliasCatalog([]), /braucht MODEL_ALIASES im Abschnitt host/);
  assert.throws(() => aliasCatalog(parseModelAliases(["x=openrouter/vendor/unknown"])), /vendor\/unknown hinter x fehlt im Katalog von openrouter/);
  const catalog = aliasCatalog(aliases);
  assert.deepEqual(catalog.map((model) => [model.provider, model.id, model.name]), aliases.map((entry) => [ALIAS_PROVIDER, entry.alias, entry.alias]));
  for (const model of catalog) assert.deepEqual(getSupportedThinkingLevels(model), expectedLevels[model.id], model.id);
  assert.equal(displayProvider(ALIAS_PROVIDER), "");
  assert.equal(modelLabel(ALIAS_PROVIDER, "standard"), "standard");
  assert.equal(modelLabel("openrouter", "qwen/qwen3.8-27b"), "openrouter/qwen/qwen3.8-27b");
});

test("die Modellwahl des Anbieters alias bietet alle Aliasse mit den Stufen und der Denktiefe ihres Zielmodells an", (t) => {
  const withThinking: Record<string, string> = { standard: "@medium", strong: "@high", fast: "@low" };
  process.env.MODEL_ALIASES = JSON.stringify(aliases.map((entry) => `${entry.alias}=${entry.upstream}/${entry.model}${withThinking[entry.alias] ?? ""}`));
  t.after(() => { delete process.env.MODEL_ALIASES; });
  const choice = modelChoiceFromEnvironment(declaredEnvironment(modelChoiceEnvDescriptors), {
    selectable: true,
    provider: ALIAS_PROVIDER,
    defaultModel: () => "standard",
    fallback: () => ["standard"],
  });
  assert.deepEqual(choice.options, ["standard", "strong", "fast", "reasoning"]);
  assert.equal(choice.selectable, true);
  for (const alias of choice.options) assert.deepEqual(choice.thinkingOptionsFor(alias), expectedLevels[alias], alias);
  const option = modelStartOption(choice, "xhigh");
  const presentation = option.describe({ model: "strong" }, { runId: "run", userId: null }) as { provider: string; options: string[]; thinkingOptions: string[] };
  assert.equal(presentation.provider, "");
  assert.deepEqual(presentation.thinkingOptions, ["low", "high", "max"]);
  assert.equal(JSON.stringify(presentation).includes("openrouter"), false);
  const context = { runId: "run", userId: null };
  assert.deepEqual(option.defaultValue(context), { model: "standard", thinking: "xhigh" });
  assert.deepEqual(option.accept({ model: "fast" }, context), { model: "fast", thinking: "low" });
  assert.deepEqual(option.accept({ model: "strong" }, context), { model: "strong", thinking: "high" });
  assert.deepEqual(option.accept({ model: "reasoning" }, context), { model: "reasoning", thinking: "off" });
  assert.deepEqual(option.accept({ model: "fast", thinking: "max" }, context), { model: "fast", thinking: "max" });
  assert.equal(roleThinkingLevel(undefined, "AGENT_THINKING", ALIAS_PROVIDER, "standard"), "medium");
  assert.equal(roleThinkingLevel("low", "AGENT_REVIEWER_THINKING", ALIAS_PROVIDER, "standard"), "low");
  assert.equal(roleThinkingLevel(undefined, "AGENT_THINKING", ALIAS_PROVIDER, "reasoning"), "high");
  assert.equal(roleThinkingLevel(undefined, "AGENT_THINKING", "openrouter", "z-ai/glm-5.3"), "high");
});

test("die Modelllaufzeit schickt je Stufe das Zielmodell mit genau der gewählten Stufe an OpenRouter", async () => {
  const models = runtime();
  assert.deepEqual(models.getModels(ALIAS_PROVIDER).map((model) => model.id), ["standard", "strong", "fast", "reasoning"]);
  for (const entry of aliases) {
    const alias = models.getModel(ALIAS_PROVIDER, entry.alias)!;
    assert.deepEqual(getSupportedThinkingLevels(alias), expectedLevels[entry.alias], entry.alias);
    for (const level of expectedLevels[entry.alias]!) {
      const { payload, result } = await capturedPayload(models, entry.alias, level);
      assert.equal(payload.model, entry.model, `${entry.alias} ${level}`);
      assert.deepEqual(payload.reasoning, { effort: level === "off" ? "none" : level }, `${entry.alias} ${level}`);
      assert.equal(result.provider, ALIAS_PROVIDER);
      assert.equal(result.model, entry.alias);
    }
  }
});

test("Antworten tragen nur den Alias, und frühere Antworten des Alias gelten beim Ziel als eigene", async (t) => {
  const models = runtime();
  const alias = models.getModel(ALIAS_PROVIDER, "reasoning")!;
  const events = [
    { id: "r", object: "chat.completion.chunk", created: 1, model: "deepseek/deepseek-v4.1-flash-20260910", provider: "Upstream", choices: [{ index: 0, delta: { content: "Hallo" }, finish_reason: null }] },
    { id: "r", object: "chat.completion.chunk", created: 1, model: "deepseek/deepseek-v4.1-flash-20260910", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  t.mock.method(globalThis, "fetch", async () => new Response(body, { headers: { "content-type": "text/event-stream" } }));
  const partials: AssistantMessage[] = [];
  const stream = models.streamSimple(alias, context(), { apiKey: "test-only" });
  for await (const event of stream) if (event.type === "text_delta") partials.push(event.partial);
  const result = await stream.result();
  assert.equal(result.errorMessage, undefined);
  assert.deepEqual([result.provider, result.model, result.responseModel], [ALIAS_PROVIDER, "reasoning", "reasoning"]);
  assert.ok(partials.length > 0);
  assert.equal(JSON.stringify([result, ...partials]).includes("deepseek"), false);
  t.mock.restoreAll();

  const earlier: AssistantMessage = {
    role: "assistant", api: alias.api, provider: ALIAS_PROVIDER, model: "reasoning", stopReason: "stop", timestamp: 2,
    content: [
      { type: "thinking", thinking: "Überlegung", thinkingSignature: JSON.stringify([{ type: "reasoning.text", text: "Überlegung", signature: "signatur-1" }]) },
      { type: "text", text: "Antwort" },
    ],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const { payload } = await capturedPayload(models, "reasoning", "high", [
    { role: "user", content: "Frage", timestamp: 1 }, earlier, { role: "user", content: "Weiter", timestamp: 3 },
  ]);
  assert.ok(JSON.stringify(payload.messages).includes("signatur-1"));
});

test("Aliasse brauchen ein konfiguriertes Ziel und einen eigenen Anbieternamen", async () => {
  const models = ModelRuntime.create();
  assert.throws(() => models.registerAliases(ALIAS_PROVIDER, parseModelAliases(["x=openrouter/vendor/unknown"])), /Alias x: model openrouter\/vendor\/unknown is not configured/);
  assert.throws(() => models.registerAliases("openrouter", aliases), /collides with a registered provider/);
  models.registerAliases(ALIAS_PROVIDER, aliases);
  assert.throws(() => models.registerAliases(ALIAS_PROVIDER, aliases), /already registered/);
  assert.throws(() => models.registerProvider(ALIAS_PROVIDER, { apiKey: "k" }), /is the alias provider/);
  assert.equal(models.getModel(ALIAS_PROVIDER, "qwen/qwen3.8-27b"), undefined);
  assert.ok(models.getModels().some((model) => model.provider === ALIAS_PROVIDER && model.id === "standard"));
});

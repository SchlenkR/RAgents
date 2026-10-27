import assert from "node:assert/strict";
import test, { after } from "node:test";
import { ModelRuntime } from "@ragents/agent";
import { getSupportedThinkingLevels, registerFauxProvider, type AssistantMessage, type Context } from "@ragents/ai";
import { ALIAS_PROVIDER, aliasCatalog, displayProvider, modelLabel, parseModelAliases, validatedAliasModel } from "../src/plugin-support/model-aliases.ts";
import { modelChoiceEnvDescriptors, modelChoiceFromEnvironment } from "../src/plugin-support/model-choice.ts";
import { modelStartOption } from "../src/plugin-support/product-start-options.ts";
import { declaredEnvironment } from "../src/plugin-support/plugin-config.ts";
import { roleThinkingLevel } from "../src/plugin-support/thinking-level.ts";
import { configuredModelProviders } from "../src/plugin-support/model-providers.ts";

const originalProviders = process.env.MODEL_PROVIDERS;
const originalKey = process.env.ALIAS_MODEL_KEY;
after(() => {
  if (originalProviders === undefined) delete process.env.MODEL_PROVIDERS;
  else process.env.MODEL_PROVIDERS = originalProviders;
  if (originalKey === undefined) delete process.env.ALIAS_MODEL_KEY;
  else process.env.ALIAS_MODEL_KEY = originalKey;
});
process.env.ALIAS_MODEL_KEY = "test-only";
process.env.MODEL_PROVIDERS = JSON.stringify([{
  id: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: { kind: "environment", name: "ALIAS_MODEL_KEY" },
  models: [
    { id: "standard-target", contextWindow: 262_144, maxTokens: 65_536, reasoning: true, input: ["text"],
      thinkingLevelMap: { off: "none", minimal: null, high: null, xhigh: "xhigh" } },
    { id: "strong-target", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, input: ["text"],
      thinkingLevelMap: { off: null, minimal: null, medium: null, max: "max" } },
    { id: "fast-target", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, input: ["text"],
      thinkingLevelMap: { off: null, minimal: null, medium: null, max: "max" } },
    { id: "reasoning-target", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, input: ["text"],
      thinkingLevelMap: { off: "none", minimal: null, medium: null, max: "max" } },
    { id: "mapped-target", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, input: ["text"],
      thinkingLevelMap: { minimal: null, low: null, medium: null, xhigh: "xhigh" } },
    { id: "limited-output", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: false, input: ["text"] },
  ],
}]);

const compaction = { threshold: 160_000, keepRecentTokens: 24_000, summaryTokens: 16_000 };

const aliasEntry = (alias: string, model: string, extra: Record<string, unknown> = {}) => ({ alias, model, compaction, ...extra });

const aliases = parseModelAliases([
  aliasEntry("standard", "openrouter/standard-target"),
  aliasEntry("strong", "openrouter/strong-target"),
  aliasEntry("fast", "openrouter/fast-target"),
  aliasEntry("reasoning", "openrouter/reasoning-target"),
]);

const expectedLevels: Record<string, readonly string[]> = {
  standard: ["off", "low", "medium", "xhigh"],
  strong: ["low", "high", "max"],
  fast: ["low", "high", "max"],
  reasoning: ["off", "low", "high", "max"],
};

const configuredRuntime = (): ModelRuntime => {
  const created = ModelRuntime.create();
  for (const provider of configuredModelProviders()) {
    created.registerProvider(provider.id, { apiKey: provider.apiKey, baseUrl: provider.baseUrl, models: provider.models });
  }
  return created;
};

const runtime = (): ModelRuntime => {
  const created = configuredRuntime();
  created.registerAliases(ALIAS_PROVIDER, aliases);
  return created;
};

const context = (messages: Context["messages"] = [{ role: "user", content: "Hello", timestamp: 1 }]): Context => ({ messages });

test("reasoning replay is an explicit model alias option and rejects unknown policies", () => {
  const entry = parseModelAliases([aliasEntry("worker", "openrouter/standard-target", { reasoningReplay: "current-turn" })])[0]!;
  assert.equal(aliasCatalog([entry])[0]!.reasoningReplay, "current-turn");
  const models = configuredRuntime();
  models.registerAliases(ALIAS_PROVIDER, [entry]);
  assert.equal(models.getModel(ALIAS_PROVIDER, "worker")!.reasoningReplay, "current-turn");
  assert.equal(aliasCatalog(aliases)[0]!.reasoningReplay, undefined);
  assert.throws(() => parseModelAliases([aliasEntry("worker", "openrouter/standard-target", { reasoningReplay: "none" })]), /reasoningReplay must be "all" or "current-turn"/);
});

test("startup rejects a threshold that cannot reserve the offered reasoning level and names a valid threshold", (t) => {
  const faux = registerFauxProvider({ models: [{ id: "reserve-validation", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" }, contextWindow: 264_000, maxTokens: 131_072 }] });
  t.after(() => faux.unregister());
  const target = { ...faux.getModel(), thinkingLevelMap: { xhigh: "xhigh" } };
  const entry = parseModelAliases([{ alias: "worker", model: `${target.provider}/${target.id}`,
    compaction: { threshold: 250_000, keepRecentTokens: 24_000, summaryTokens: 12_000 } }])[0]!;
  assert.throws(() => validatedAliasModel(entry, target), /MODEL_ALIASES: worker.*reasoning\/output reserve \(24576\).*at most 239424/);
  const models = configuredRuntime();
  models.registerProvider(target.provider, { apiKey: "faux-key", api: faux.api, models: [target] });
  assert.throws(() => models.registerAliases(ALIAS_PROVIDER, [entry]), /Alias worker:.*reasoning\/output reserve/);
  const mapped = { ...entry, thinkingLevels: { off: "off" as const, xhigh: "low" as const } };
  assert.doesNotThrow(() => validatedAliasModel(mapped, target));
  models.registerAliases(ALIAS_PROVIDER, [mapped]);
});

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

test("MODEL_ALIASES maps aliases to models of configured providers and shows no provider", () => {
  assert.throws(() => parseModelAliases("x"), /MODEL_ALIASES must be a list of aliases/);
  assert.throws(() => parseModelAliases(["x=openrouter/strong-target"]), /MODEL_ALIASES\[0\] must be an object with alias, model, compaction and optionally thinking/);
  assert.throws(() => parseModelAliases([aliasEntry("X", "openrouter/strong-target")]), /MODEL_ALIASES\[0\]\.alias needs 1 to 64 lowercase letters/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "z-ai")]), /MODEL_ALIASES\[0\]\.model of x needs the form "provider\/model"/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinking: "very" })]), /unknown thinking level "very"/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { reserve: 1 })]), /MODEL_ALIASES\[0\]\.reserve is not supported/);
  assert.throws(() => parseModelAliases([{ alias: "x", model: "openrouter/strong-target" }]), /MODEL_ALIASES\[0\], x: compaction needs threshold, keepRecentTokens and summaryTokens/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { compaction: { ...compaction, summaryTokens: 0 } })]), /compaction\.summaryTokens must be a positive integer/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { compaction: { ...compaction, keepRecentTokens: 150_000 } })]), /keepRecentTokens plus summaryTokens \(166000\) must stay below threshold \(160000\)/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/a/b"), aliasEntry("x", "openrouter/c/d")]), /names the alias x more than once/);
  assert.deepEqual(parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinking: "high" })]), [{ alias: "x", upstream: "openrouter", model: "strong-target", thinking: "high", compaction }]);
  assert.throws(() => aliasCatalog(parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinking: "medium" })])), /thinking level medium does not exist for x \(valid: low, high, max\)/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinkingLevels: ["low"] })]), /MODEL_ALIASES\[0\], x: thinkingLevels needs an object from offered to target level/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinkingLevels: {} })]), /MODEL_ALIASES\[0\], x: thinkingLevels needs at least one level/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinkingLevels: { very: "low" } })]), /thinkingLevels\.very is not a thinking level/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinkingLevels: { low: "very" } })]), /thinkingLevels\.low names the unknown thinking level "very"/);
  assert.throws(() => parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinkingLevels: { off: "low", low: "off" } })]), /thinkingLevels\.low maps to off, which only off may do/);
  assert.throws(() => aliasCatalog(parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinkingLevels: { off: "off", low: "low" } })])), /x on openrouter\/strong-target: thinkingLevels\.off maps to off, which the target does not offer \(valid: low, high, max\)/);
  assert.throws(() => aliasCatalog(parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinking: "high", thinkingLevels: { low: "low", medium: "high" } })])), /thinking level high does not exist for x \(valid: low, medium\)/);
  assert.throws(() => aliasCatalog([]), /needs MODEL_ALIASES in the host section/);
  assert.throws(() => aliasCatalog(parseModelAliases([aliasEntry("x", "openrouter/vendor/unknown")])), /vendor\/unknown behind x is missing from configured provider openrouter/);
  const oversized = { threshold: 250_000, keepRecentTokens: 24_000, summaryTokens: 16_000 };
  assert.throws(() => aliasCatalog(parseModelAliases([aliasEntry("x", "openrouter/standard-target", { compaction: oversized })])), /x on openrouter\/standard-target: compaction: threshold plus summaryTokens \(266000\) must stay below the context window \(262144\)/);
  const longSummary = { threshold: 700_000, keepRecentTokens: 24_000, summaryTokens: 140_000 };
  assert.throws(() => aliasCatalog(parseModelAliases([aliasEntry("x", "openrouter/limited-output", { compaction: longSummary })])), /summaryTokens \(140000\) exceeds the output limit \(131072\)/);
  const catalog = aliasCatalog(aliases);
  assert.deepEqual(catalog.map((model) => [model.provider, model.id, model.name]), aliases.map((entry) => [ALIAS_PROVIDER, entry.alias, entry.alias]));
  assert.deepEqual(catalog.map((model) => model.compaction), aliases.map(() => compaction));
  for (const model of catalog) assert.deepEqual(getSupportedThinkingLevels(model), expectedLevels[model.id], model.id);
  assert.equal(displayProvider(ALIAS_PROVIDER), "");
  assert.equal(modelLabel(ALIAS_PROVIDER, "standard"), "standard");
  assert.equal(modelLabel("openrouter", "standard-target"), "openrouter/standard-target");
});

test("the model choice of the alias provider offers all aliases with the levels and thinking depth of their target model", (t) => {
  const withThinking: Record<string, string> = { standard: "medium", strong: "high", fast: "low" };
  process.env.MODEL_ALIASES = JSON.stringify(aliases.map((entry) => aliasEntry(entry.alias, `${entry.upstream}/${entry.model}`,
    withThinking[entry.alias] ? { thinking: withThinking[entry.alias] } : {})));
  t.after(() => { delete process.env.MODEL_ALIASES; });
  const choice = modelChoiceFromEnvironment(declaredEnvironment(modelChoiceEnvDescriptors), {
    selectable: true,
    provider: ALIAS_PROVIDER,
    defaultModel: () => "standard",
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
  assert.equal(roleThinkingLevel(undefined, "AGENT_THINKING", "openrouter", "strong-target"), "high");
});

test("the model runtime sends the target model with exactly the chosen level to OpenRouter for every level", async () => {
  const models = runtime();
  assert.deepEqual(models.getModels(ALIAS_PROVIDER).map((model) => model.id), ["standard", "strong", "fast", "reasoning"]);
  assert.deepEqual(models.getModels(ALIAS_PROVIDER).map((model) => model.compaction), aliases.map(() => compaction));
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

/** The levels an alias offers and what OpenRouter receives as reasoning per level; without a target value of its own for off, off turns reasoning off. */
const mappedReasoning: Record<string, Record<string, unknown>> = {
  standard: { off: { effort: "none" }, low: { effort: "low" }, medium: { effort: "medium" }, xhigh: { effort: "xhigh" } },
  strong: { off: { effort: "low" }, low: { effort: "high" }, medium: { effort: "high" }, xhigh: { effort: "max" } },
  reasoning: { off: { enabled: false }, medium: { effort: "high" }, xhigh: { effort: "xhigh" } },
};

const mappedAliases = parseModelAliases([
  aliasEntry("standard", "openrouter/standard-target", { thinking: "medium", thinkingLevels: { off: "off", low: "low", medium: "medium", xhigh: "xhigh" } }),
  aliasEntry("strong", "openrouter/strong-target", { thinking: "medium", thinkingLevels: { off: "low", low: "high", medium: "high", xhigh: "max" } }),
  aliasEntry("reasoning", "openrouter/mapped-target", { thinkingLevels: { off: "off", medium: "high", xhigh: "xhigh" } }),
]);

test("an alias with thinkingLevels offers exactly these levels and sends the mapped level of its target for every level", async () => {
  const catalog = aliasCatalog(mappedAliases);
  const models = configuredRuntime();
  models.registerAliases(ALIAS_PROVIDER, mappedAliases);
  for (const entry of mappedAliases) {
    const offered = Object.keys(mappedReasoning[entry.alias]!);
    assert.deepEqual(getSupportedThinkingLevels(catalog.find((model) => model.id === entry.alias)!), offered, entry.alias);
    assert.deepEqual(getSupportedThinkingLevels(models.getModel(ALIAS_PROVIDER, entry.alias)!), offered, entry.alias);
    for (const level of offered) {
      const { payload, result } = await capturedPayload(models, entry.alias, level);
      assert.equal(payload.model, entry.model, `${entry.alias} ${level}`);
      assert.deepEqual(payload.reasoning, mappedReasoning[entry.alias]![level], `${entry.alias} ${level}`);
      assert.equal(result.model, entry.alias);
    }
  }
  assert.deepEqual(catalog.find((model) => model.id === "strong")!.thinkingLevelMap, { off: "low", minimal: null, low: "high", medium: "high", high: null, xhigh: "max", max: null });
  // A level the alias does not offer moves up to the next higher offered level before the mapping.
  assert.deepEqual((await capturedPayload(models, "reasoning", "low")).payload.reasoning, { effort: "high" });
  assert.deepEqual((await capturedPayload(models, "reasoning", "high")).payload.reasoning, { effort: "xhigh" });
});

test("answers carry only the alias, and earlier answers of the alias count as the target's own", async (t) => {
  const models = runtime();
  const alias = models.getModel(ALIAS_PROVIDER, "reasoning")!;
  const events = [
    { id: "r", object: "chat.completion.chunk", created: 1, model: "reasoning-target-20260910", provider: "Upstream", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
    { id: "r", object: "chat.completion.chunk", created: 1, model: "reasoning-target-20260910", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
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
  assert.equal(JSON.stringify([result, ...partials]).includes("reasoning-target"), false);
  t.mock.restoreAll();

  const earlier: AssistantMessage = {
    role: "assistant", api: alias.api, provider: ALIAS_PROVIDER, model: "reasoning", stopReason: "stop", timestamp: 2,
    content: [
      { type: "thinking", thinking: "Consideration", thinkingSignature: JSON.stringify([{ type: "reasoning.text", text: "Consideration", signature: "signature-1" }]) },
      { type: "text", text: "Answer" },
    ],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const { payload } = await capturedPayload(models, "reasoning", "high", [
    { role: "user", content: "Question", timestamp: 1 }, earlier, { role: "user", content: "Continue", timestamp: 3 },
  ]);
  assert.ok(JSON.stringify(payload.messages).includes("signature-1"));
});

test("aliases need a configured target and a provider name of their own", async () => {
  const models = configuredRuntime();
  assert.throws(() => models.registerAliases(ALIAS_PROVIDER, parseModelAliases([aliasEntry("x", "openrouter/vendor/unknown")])), /Alias x: model openrouter\/vendor\/unknown is not configured/);
  const oversized = parseModelAliases([aliasEntry("x", "openrouter/standard-target", { compaction: { ...compaction, threshold: 250_000 } })]);
  assert.throws(() => models.registerAliases(ALIAS_PROVIDER, oversized), /Alias x: compaction: threshold plus summaryTokens \(266000\) must stay below the context window \(262144\)/);
  const unsupported = parseModelAliases([aliasEntry("x", "openrouter/strong-target", { thinkingLevels: { low: "low", medium: "medium" } })]);
  assert.throws(() => models.registerAliases(ALIAS_PROVIDER, unsupported), /Alias x: thinkingLevels\.medium maps to medium, which the target does not offer \(valid: low, high, max\)/);
  assert.throws(() => models.registerAliases("openrouter", aliases), /collides with a registered provider/);
  models.registerAliases(ALIAS_PROVIDER, aliases);
  assert.throws(() => models.registerAliases(ALIAS_PROVIDER, aliases), /already registered/);
  assert.throws(() => models.registerProvider(ALIAS_PROVIDER, { apiKey: "k" }), /is the alias provider/);
  assert.equal(models.getModel(ALIAS_PROVIDER, "standard-target"), undefined);
  assert.ok(models.getModels().some((model) => model.provider === ALIAS_PROVIDER && model.id === "standard"));
});

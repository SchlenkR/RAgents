import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ModelRuntime } from "@ragents/agent";
import { getSupportedThinkingLevels } from "@ragents/ai";
import { ALIAS_PROVIDER, aliasCatalog, parseModelAliases } from "../src/plugin-support/model-aliases.ts";
import { aliasCompletionModel } from "../src/plugin-support/model-completion.ts";
import { configuredModelProviders, modelProviderRegistration, parseModelProviders } from "../src/plugin-support/model-providers.ts";
import { catalogEntryOf, resolveAliases } from "../../../plugins/ragents.model-relay/server/relay.ts";
import { modelRelayConfig } from "../../../plugins/ragents.model-relay/server/config.ts";

const environment = { EXAMPLE_API_KEY: "example-key" };
const exampleModel = { id: "example-model", contextWindow: 131_072, maxTokens: 16_384, reasoning: true, input: ["text"], thinkingLevelMap: { xhigh: "xhigh" } };
const provider = (extra: Record<string, unknown> = {}) => ({
  id: "local", baseUrl: "http://localhost:8000/v1", apiKey: { kind: "environment", name: "EXAMPLE_API_KEY" },
  compat: { thinkingFormat: "qwen-chat-template" }, models: [exampleModel], ...extra,
});
const alias = { alias: "local-model", model: "local/example-model", thinking: "medium",
  thinkingLevels: { off: "off", low: "low", medium: "medium", xhigh: "xhigh" },
  compaction: { threshold: 100_000, keepRecentTokens: 16_000, summaryTokens: 8_000 } };

const withProfile = (t: TestContext): void => {
  const previous = { MODEL_PROVIDERS: process.env.MODEL_PROVIDERS, MODEL_ALIASES: process.env.MODEL_ALIASES, EXAMPLE_API_KEY: process.env.EXAMPLE_API_KEY };
  process.env.MODEL_PROVIDERS = JSON.stringify([provider()]);
  process.env.MODEL_ALIASES = JSON.stringify([alias]);
  process.env.EXAMPLE_API_KEY = environment.EXAMPLE_API_KEY;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
};

const runtimeOf = (): ModelRuntime => {
  const runtime = ModelRuntime.create();
  for (const registration of configuredModelProviders().map(modelProviderRegistration)) runtime.registerProvider(registration.id, registration.config);
  runtime.registerAliases(ALIAS_PROVIDER, parseModelAliases([alias]));
  return runtime;
};

test("MODEL_PROVIDERS accepts OpenAI-compatible servers only with an env key and complete model data", () => {
  const parse = (entry: unknown) => parseModelProviders([entry], environment);
  assert.throws(() => parseModelProviders("x", environment), /MODEL_PROVIDERS must be a list of providers/);
  assert.throws(() => parse(provider({ headers: {} })), /MODEL_PROVIDERS\[0\]\.headers is not supported/);
  assert.throws(() => parse(provider({ id: "Local" })), /\.id needs 1 to 64 lowercase letters/);
  assert.throws(() => parse(provider({ id: "openrouter" })), /openrouter is already a provider of the host/);
  assert.throws(() => parse(provider({ id: "relay" })), /relay is already a provider of the host/);
  assert.throws(() => parse(provider({ baseUrl: "http://localhost:8000/v1/" })), /baseUrl needs an http or https address without a trailing slash/);
  assert.throws(() => parse(provider({ apiKey: "plain-key" })), /apiKey must be env\("NAME"\); a key never appears in plain text/);
  assert.throws(() => parse(provider({ apiKey: { kind: "environment", name: "UNSET_EXAMPLE_KEY" } })), /env\("UNSET_EXAMPLE_KEY"\) to an environment variable that is not set/);
  assert.throws(() => parse(provider({ compat: { thinkingFormat: "chat-template" } })), /thinkingFormat "chat-template" is not supported; supported are qwen-chat-template/);
  assert.throws(() => parse(provider({ compat: { supportsStore: true } })), /compat\.supportsStore is not supported/);
  assert.throws(() => parse(provider({ models: [] })), /models needs at least one model/);
  assert.throws(() => parse(provider({ models: [{ ...exampleModel, contextWindow: 0 }] })), /models\[0\]\.contextWindow must be a positive integer/);
  assert.throws(() => parse(provider({ models: [{ ...exampleModel, maxTokens: 200_000 }] })), /maxTokens \(200000\) exceeds the contextWindow \(131072\)/);
  assert.throws(() => parse(provider({ models: [{ ...exampleModel, input: ["image"] }] })), /input needs "text"/);
  assert.throws(() => parse(provider({ models: [{ ...exampleModel, reasoning: false }] })), /thinkingLevelMap needs reasoning: true/);
  assert.throws(() => parse(provider({ models: [{ ...exampleModel, thinkingLevelMap: { extreme: "x" } }] })), /thinkingLevelMap\.extreme is not a thinking level/);
  assert.throws(() => parse(provider({ models: [{ ...exampleModel, cost: 1 }] })), /models\[0\]\.cost is not supported/);
  assert.throws(() => parse(provider({ models: [exampleModel, exampleModel] })), /names the model example-model more than once/);
  assert.throws(() => parseModelProviders([provider(), provider()], environment), /names the provider local more than once/);
  const [parsed] = parse(provider());
  assert.equal(parsed!.apiKey, "example-key");
  assert.deepEqual(parsed!.models[0], {
    id: "example-model", name: "example-model", api: "openai-completions", provider: "local", baseUrl: "http://localhost:8000/v1",
    reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131_072, maxTokens: 16_384,
    thinkingLevelMap: { xhigh: "xhigh" }, compat: { thinkingFormat: "qwen-chat-template" },
  });
});

test("an alias names a model of a profile provider and its thinking levels reach that server", async (t) => {
  withProfile(t);
  const [offered] = aliasCatalog();
  assert.deepEqual(getSupportedThinkingLevels(offered!), ["off", "low", "medium", "xhigh"]);
  const runtime = runtimeOf();
  const model = runtime.getModel(ALIAS_PROVIDER, "local-model")!;
  const requests: { url: string; authorization: string | null; body: Record<string, any> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "example-model", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
  for (const reasoning of ["off", "xhigh"] as const) {
    const result = await runtime.completeSimple(model, { messages: [{ role: "user", content: "Hello", timestamp: 1 }] }, reasoning === "off" ? {} : { reasoning });
    assert.equal(result.errorMessage, undefined);
    assert.equal(result.model, "local-model");
  }
  assert.deepEqual(requests.map((request) => [request.url, request.authorization, request.body.model]),
    Array(2).fill(["http://localhost:8000/v1/chat/completions", "Bearer example-key", "example-model"]));
  assert.deepEqual(requests.map((request) => [request.body.chat_template_kwargs.enable_thinking, request.body.reasoning_effort, "reasoning" in request.body]),
    [[false, undefined, false], [true, "xhigh", false]]);
});

test("plugins complete over a profile alias with its offered levels; the relay forwards to the profile provider", async (t) => {
  withProfile(t);
  const runtime = runtimeOf();
  const payloads: Record<string, any>[] = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)));
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "example-model", choices: [{ index: 0, delta: { content: "Paris" }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
  assert.equal(aliasCompletionModel(() => Promise.resolve(runtime), "unknown"), undefined);
  const completion = aliasCompletionModel(() => Promise.resolve(runtime), "local-model")!;
  assert.deepEqual(completion.thinkingLevels, ["off", "low", "medium", "xhigh"]);
  assert.deepEqual(await completion.complete({ systemPrompt: "Be brief.", text: "Capital of France?", thinking: "low",
    temperature: 0, maxTokens: 64, timeoutMs: 5_000, signal: new AbortController().signal }), { kind: "text", text: "Paris" });
  assert.equal(payloads[0]!.model, "example-model");
  assert.equal(payloads[0]!.reasoning_effort, "low");
  const [resolved] = resolveAliases(modelRelayConfig.aliases(), modelRelayConfig.upstreams([]));
  assert.equal(resolved!.upstream.baseUrl, "http://localhost:8000/v1");
  assert.deepEqual(catalogEntryOf(resolved!).catalog.compat, { thinkingFormat: "qwen-chat-template" });
});

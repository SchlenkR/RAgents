import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ModelRuntime } from "@ragents/agent";
import { runtimeCompletionModel, type TextCompletionRequest } from "../src/plugin-support/model-completion.ts";

const runtime = (): ModelRuntime => {
  const models = ModelRuntime.create();
  models.registerProvider("openrouter", { apiKey: "configured-completion-key", baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions",
    models: [{ id: "test-model", name: "test-model", contextWindow: 131_072, maxTokens: 16_384, reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, medium: null, max: "max" }, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  return models;
};
const configuredCompletion = (id = "test-model") => runtimeCompletionModel(runtime(), "openrouter", id);

const request = (overrides: Partial<TextCompletionRequest> = {}): TextCompletionRequest => ({
  systemPrompt: "Answer briefly.", text: "What time is it?", thinking: "low",
  temperature: 0, maxTokens: 64, timeoutMs: 5_000, signal: new AbortController().signal, ...overrides,
});

const answering = (t: TestContext, delta: object, finishReason: string, status = 200) => {
  const payloads: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer configured-completion-key");
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (status !== 200) return new Response("unavailable", { status });
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason: finishReason }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
  return payloads;
};

test("a completion model asks one question without history or tools over the fastest provider", async (t) => {
  const payloads = answering(t, { content: "Noon" }, "stop");
  const model = configuredCompletion();
  assert.ok(model);
  assert.deepEqual(model.thinkingLevels, ["low", "high", "max"]);
  assert.deepEqual(await model.complete(request()), { kind: "text", text: "Noon" });
  assert.equal(payloads.length, 1);
  const [payload] = payloads;
  assert.equal(payload!.model, "test-model");
  assert.deepEqual(payload!.provider, { sort: "latency" });
  assert.deepEqual(payload!.messages, [
    { role: "system", content: [{ type: "text", text: "Answer briefly." }] },
    { role: "user", content: "What time is it?" },
  ]);
  assert.equal(payload!.tools, undefined);
  assert.equal(payload!.temperature, 0);
  assert.equal(payload!.max_tokens, 64);
  assert.deepEqual(payload!.reasoning, { effort: "low" });
  assert.equal(configuredCompletion("unknown/model"), undefined);
});

test("unfinished answers, tool calls and failed requests are no text and are never retried", async (t) => {
  const model = configuredCompletion()!;
  const cut = answering(t, { content: "Noo" }, "length");
  assert.deepEqual(await model.complete(request()), { kind: "unfinished" });
  assert.equal(cut.length, 1);
  t.mock.restoreAll();
  answering(t, { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } }] }, "tool_calls");
  assert.deepEqual(await model.complete(request()), { kind: "unfinished" });
  t.mock.restoreAll();
  const failed = answering(t, {}, "stop", 503);
  assert.deepEqual(await model.complete(request()), { kind: "unfinished" });
  assert.equal(failed.length, 1);
});

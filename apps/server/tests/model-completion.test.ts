import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { openRouterCompletionModel, type TextCompletionRequest } from "../src/plugin-support/model-completion.ts";

const request = (overrides: Partial<TextCompletionRequest> = {}): TextCompletionRequest => ({
  systemPrompt: "Antworte knapp.", text: "Wie spät ist es?", thinking: "low",
  temperature: 0, maxTokens: 64, timeoutMs: 5_000, signal: new AbortController().signal, ...overrides,
});

const answering = (t: TestContext, delta: object, finishReason: string, status = 200) => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "completion-test-only";
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  });
  const payloads: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (status !== 200) return new Response("unavailable", { status });
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason: finishReason }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
  return payloads;
};

test("a completion model asks one question without history or tools over the fastest provider", async (t) => {
  const payloads = answering(t, { content: "Mittag" }, "stop");
  const model = openRouterCompletionModel("z-ai/glm-5.3-flash");
  assert.ok(model);
  assert.deepEqual(model.thinkingLevels, ["low", "high", "max"]);
  assert.deepEqual(await model.complete(request()), { kind: "text", text: "Mittag" });
  assert.equal(payloads.length, 1);
  const [payload] = payloads;
  assert.equal(payload!.model, "z-ai/glm-5.3-flash");
  assert.deepEqual(payload!.provider, { sort: "latency" });
  assert.deepEqual(payload!.messages, [
    { role: "system", content: [{ type: "text", text: "Antworte knapp." }] },
    { role: "user", content: "Wie spät ist es?" },
  ]);
  assert.equal(payload!.tools, undefined);
  assert.equal(payload!.temperature, 0);
  assert.equal(payload!.max_tokens, 64);
  assert.deepEqual(payload!.reasoning, { effort: "low" });
  assert.equal(openRouterCompletionModel("unknown/model"), undefined);
});

test("unfinished answers, tool calls and failed requests are no text and are never retried", async (t) => {
  const model = openRouterCompletionModel("z-ai/glm-5.3-flash")!;
  const cut = answering(t, { content: "Mitt" }, "length");
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

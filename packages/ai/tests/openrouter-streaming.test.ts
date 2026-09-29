import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { stream, streamSimple } from "../src/api/ai-sdk.ts";
import type { Model } from "../src/types.ts";

const model: Model<"openai-completions"> = {
  id: "test/stream", name: "Stream test", api: "openai-completions", provider: "openrouter",
  baseUrl: "https://example.invalid/api/v1", reasoning: true, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024,
};

test("OpenRouter explicitly disables reasoning for off and retains the requested effort", async () => {
  for (const reasoning of ["off", "low", "high"] as const) {
    let payload: unknown;
    const result = await streamSimple(model, { messages: [{ role: "user", content: "Hello", timestamp: 1 }] }, {
      apiKey: "test-only", reasoning,
      onPayload: (value) => { payload = structuredClone(value); throw new Error("captured before network"); },
    }).result();
    assert.match(result.errorMessage ?? "", /captured before network/);
    assert.deepEqual((payload as { reasoning: unknown }).reasoning, reasoning === "off" ? { enabled: false } : { effort: reasoning });
  }
});

test("interleaved tool arguments retain Unicode across JSON fragments and single-byte SSE chunks", async (t) => {
  const values = [{ text: "Umlauts and more: äöü ÄÖÜ ß 🚀" }, { text: "Greetings with \\ and \"quote\" plus\nlines" }];
  const argumentsText = values.map((value) => JSON.stringify(value));
  const chunks: string[] = [];
  const send = (delta: unknown, finish_reason: string | null = null) => {
    chunks.push(`data: ${JSON.stringify({ id: "response", object: "chat.completion.chunk", created: 1, model: model.id, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  };
  for (let index = 0; index < values.length; index += 1) {
    send({ tool_calls: [{ index, id: `call-${index}`, type: "function", function: { name: "echo", arguments: "" } }] });
  }
  for (let offset = 0; offset < Math.max(...argumentsText.map((value) => value.length)); offset += 1) {
    for (let index = 0; index < argumentsText.length; index += 1) {
      const fragment = argumentsText[index]![offset];
      if (fragment !== undefined) send({ tool_calls: [{ index, function: { arguments: fragment } }] });
    }
  }
  send({}, "tool_calls");
  chunks.push("data: [DONE]\n\n");
  const bytes = new TextEncoder().encode(chunks.join(""));
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    let offset = 0;
    return new Response(new ReadableStream({ pull(controller) {
      if (offset === bytes.length) controller.close();
      else controller.enqueue(bytes.slice(offset, ++offset));
    } }), { headers: { "content-type": "text/event-stream" } });
  });
  const response = stream(model, {
    messages: [{ role: "user", content: "Echo", timestamp: 1 }],
    tools: [{ name: "echo", description: "Echo", parameters: Type.Object({ text: Type.String() }) }],
  }, { apiKey: "test-only" });
  const result = await response.result();
  assert.equal(requests, 1);
  assert.equal(result.errorMessage, undefined);
  assert.equal(result.stopReason, "toolUse");
  assert.deepEqual(result.content.filter((part) => part.type === "toolCall").map((part) => part.arguments), values);
});

test("qwen-chat-template switches thinking through chat_template_kwargs, sends the mapped effort verbatim and replays thinking as reasoning_content", async () => {
  const qwen: Model<"openai-completions"> = {
    ...model, provider: "local", baseUrl: "http://localhost:8000/v1", thinkingLevelMap: { xhigh: "xhigh", high: null },
    compat: { thinkingFormat: "qwen-chat-template" },
  };
  const history = [
    { role: "user" as const, content: "Hello", timestamp: 1 },
    { role: "assistant" as const, content: [{ type: "thinking" as const, thinking: "Earlier thought" }, { type: "text" as const, text: "Hi" }],
      api: "openai-completions" as const, provider: "local", model: qwen.id, stopReason: "stop" as const, timestamp: 2,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    { role: "user" as const, content: "Again", timestamp: 3 },
  ];
  for (const [reasoning, effort] of [["off", undefined], ["low", "low"], ["xhigh", "xhigh"]] as const) {
    let payload: Record<string, any> | undefined;
    const result = await streamSimple(qwen, { messages: history }, {
      apiKey: "test-only", reasoning,
      onPayload: (value) => { payload = structuredClone(value) as Record<string, any>; throw new Error("captured before network"); },
    }).result();
    assert.match(result.errorMessage ?? "", /captured before network/);
    assert.equal("reasoning" in payload!, false);
    assert.deepEqual(payload!.chat_template_kwargs, { enable_thinking: effort !== undefined, preserve_thinking: true });
    assert.equal(payload!.reasoning_effort, effort);
    const assistant = payload!.messages.find((message: { role: string }) => message.role === "assistant");
    assert.equal(assistant.reasoning_content, "Earlier thought");
    assert.equal("reasoning" in assistant, false);
    assert.equal("reasoning_details" in assistant, false);
  }
  let withoutReasoning: Record<string, any> | undefined;
  await streamSimple({ ...qwen, reasoning: false }, { messages: [{ role: "user", content: "Hello", timestamp: 1 }] }, {
    apiKey: "test-only", reasoning: "high",
    onPayload: (value) => { withoutReasoning = structuredClone(value) as Record<string, any>; throw new Error("captured before network"); },
  }).result();
  assert.deepEqual(withoutReasoning!.chat_template_kwargs, { enable_thinking: false, preserve_thinking: true });
  assert.equal(withoutReasoning!.reasoning_effort, undefined);
});

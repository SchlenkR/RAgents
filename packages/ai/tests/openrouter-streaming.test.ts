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
    const result = await streamSimple(model, { messages: [{ role: "user", content: "Hallo", timestamp: 1 }] }, {
      apiKey: "test-only", reasoning,
      onPayload: (value) => { payload = structuredClone(value); throw new Error("captured before network"); },
    }).result();
    assert.match(result.errorMessage ?? "", /captured before network/);
    assert.deepEqual((payload as { reasoning: unknown }).reasoning, reasoning === "off" ? { enabled: false } : { effort: reasoning });
  }
});

test("interleaved tool arguments retain Unicode across JSON fragments and single-byte SSE chunks", async (t) => {
  const values = [{ text: "Größe für außerhalb: äöü ÄÖÜ ß 🚀" }, { text: "Grüße mit \\ und \"Zitat\" sowie\nZeilen" }];
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

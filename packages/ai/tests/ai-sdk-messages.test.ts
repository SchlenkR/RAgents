import assert from "node:assert/strict";
import test from "node:test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { convertMessages } from "../src/api/ai-sdk-messages.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";

const model: Model<"openai-completions"> = {
  id: "test/messages", name: "Messages", api: "openai-completions", provider: "openrouter",
  baseUrl: "https://example.invalid/api/v1", reasoning: true, input: ["text", "image", "video", "file"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024,
};

const assistant = (content: AssistantMessage["content"]): AssistantMessage => ({
  role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop", timestamp: 1,
});

async function payloadOf(context: Context): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown> | undefined;
  const provider = createOpenRouter({ apiKey: "test-only", fetch: async (_url, options) => {
    payload = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ id: "response", model: model.id,
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "content-type": "application/json" } });
  } });
  await generateText({ model: provider.chat(model.id), messages: convertMessages(context, model), maxRetries: 0 });
  assert.ok(payload);
  return payload;
}

test("SDK provider preserves ordinary reasoning on the wire", async () => {
  const context: Context = { messages: [assistant([
    { type: "thinking", thinking: "Überlege kurz.", thinkingSignature: "reasoning" },
    { type: "text", text: "Antwort" },
  ]), { role: "user", content: "Weiter", timestamp: 2 }] };
  const payload = await payloadOf(context);
  assert.deepEqual((payload.messages as Record<string, unknown>[])[0], {
    role: "assistant", content: "Antwort", reasoning: "Überlege kurz.",
    reasoning_details: [{ type: "reasoning.text", text: "Überlege kurz.", format: "unknown" }],
  });
});

test("reasoning details from message and tool signatures survive deduplicated without changing history", () => {
  const encrypted = { type: "reasoning.encrypted", id: "call", data: "opaque", format: "google-gemini-v1" };
  const summary = { type: "reasoning.summary", summary: "Überlegt" };
  const context: Context = { messages: [assistant([
    { type: "thinking", thinking: "", redacted: true, thinkingSignature: JSON.stringify([encrypted, summary]) },
    { type: "toolCall", id: "call", name: "echo", arguments: { text: "Hallo" }, thoughtSignature: JSON.stringify(encrypted) },
  ])] };
  const original = structuredClone(context);
  const messages = convertMessages(context, model);
  assert.deepEqual(messages[0]?.providerOptions?.openrouter?.reasoning_details, [encrypted, summary]);
  assert.deepEqual(context, original);
  assert.equal(messages[1]?.role, "tool");
});

test("SDK provider replays encrypted tool reasoning and summary from an empty thinking block", async () => {
  const encrypted = { type: "reasoning.encrypted", id: "call", data: "opaque", format: "google-gemini-v1" };
  const summary = { type: "reasoning.summary", summary: "Überlegt" };
  const payload = await payloadOf({ messages: [assistant([
    { type: "thinking", thinking: "", redacted: true, thinkingSignature: JSON.stringify([encrypted, summary]) },
    { type: "toolCall", id: "call", name: "echo", arguments: { text: "Hallo" }, thoughtSignature: JSON.stringify(encrypted) },
  ]), { role: "toolResult", toolCallId: "call", toolName: "echo", timestamp: 2, isError: false,
    content: [{ type: "text", text: "Hallo" }] }] });
  assert.deepEqual((payload.messages as Record<string, unknown>[])[0]?.reasoning_details, [encrypted, summary]);
});

test("model changes remove opaque reasoning while retaining ordinary thinking as text", () => {
  const encrypted = { type: "reasoning.encrypted", id: "call", data: "opaque" };
  const messages = convertMessages({ messages: [assistant([
    { type: "thinking", thinking: "", redacted: true, thinkingSignature: JSON.stringify([encrypted]) },
    { type: "thinking", thinking: "Gedanke", thinkingSignature: "reasoning" },
    { type: "text", text: "Antwort" },
  ])] }, { ...model, id: "another/model" });
  assert.equal(messages[0]?.providerOptions, undefined);
  assert.deepEqual(messages[0]?.content, [{ type: "text", text: "Gedanke" }, { type: "text", text: "Antwort" }]);
});

test("SDK provider carries native user media and filenames without empty text", async () => {
  const payload = await payloadOf({ messages: [{ role: "user", timestamp: 1, content: [
    { type: "text", text: "" },
    { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    { type: "video", data: "dmlkZW8=", mimeType: "video/mp4" },
    { type: "file", data: "cGRm", mimeType: "application/pdf", filename: "Entwurf.pdf" },
  ] }] });
  assert.deepEqual(payload.messages, [{ role: "user", content: [
    { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
    { type: "video_url", video_url: { url: "data:video/mp4;base64,dmlkZW8=" } },
    { type: "file", file: { filename: "Entwurf.pdf", file_data: "data:application/pdf;base64,cGRm" } },
  ] }]);
});

test("cache mark retains reasoning details and skips media-only messages", () => {
  const cacheControl = { type: "ephemeral", ttl: "1h" } as const;
  const messages = convertMessages({ messages: [assistant([
    { type: "thinking", thinking: "Gedanke" }, { type: "text", text: "Antwort" },
  ]), { role: "user", timestamp: 2, content: [{ type: "video", data: "dmlkZW8=", mimeType: "video/mp4" }] }] }, model, cacheControl);
  assert.deepEqual(messages[0]?.providerOptions?.openrouter?.cacheControl, cacheControl);
  assert.ok(messages[0]?.providerOptions?.openrouter?.reasoning_details);
  assert.equal(messages[1]?.providerOptions, undefined);
});

test("tool images follow all consecutive tool results and unsupported media fails", () => {
  const context: Context = { messages: [
    assistant([{ type: "toolCall", id: "one", name: "image", arguments: {} }, { type: "toolCall", id: "two", name: "image", arguments: {} }]),
    { role: "toolResult", toolCallId: "one", toolName: "image", timestamp: 2, isError: false,
      content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }] },
    { role: "toolResult", toolCallId: "two", toolName: "image", timestamp: 2, isError: true,
      content: [{ type: "text", text: "Fehlgeschlagen" }] },
  ] };
  const messages = convertMessages(context, model);
  assert.deepEqual(messages.map((message) => message.role), ["assistant", "tool", "tool", "user"]);
  assert.throws(() => convertMessages(context, { ...model, input: ["text"] }), /does not support image input/);
});

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

async function payloadOf(context: Context, cacheControl?: { type: "ephemeral"; ttl?: "1h" }): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown> | undefined;
  const provider = createOpenRouter({ apiKey: "test-only", fetch: async (_url, options) => {
    payload = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ id: "response", model: model.id,
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "content-type": "application/json" } });
  } });
  const converted = convertMessages(context, model, cacheControl);
  await generateText({ model: provider.chat(model.id), system: converted.filter((message) => message.role === "system"),
    messages: converted.filter((message) => message.role !== "system"), maxRetries: 0 });
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

test("the cache mark sits on the last block of the request, also on a media-only message, and keeps reasoning details", () => {
  const cacheControl = { type: "ephemeral", ttl: "1h" } as const;
  const messages = convertMessages({ messages: [assistant([
    { type: "thinking", thinking: "Gedanke" }, { type: "text", text: "Antwort" },
  ]), { role: "user", timestamp: 2, content: [{ type: "video", data: "dmlkZW8=", mimeType: "video/mp4" }] }] }, model, cacheControl);
  assert.equal(messages[0]?.providerOptions?.openrouter?.cacheControl, undefined);
  assert.ok(messages[0]?.providerOptions?.openrouter?.reasoning_details);
  const last = messages[1];
  assert.ok(last?.role === "user" && Array.isArray(last.content));
  assert.deepEqual(last.content.at(-1)?.providerOptions?.openrouter?.cacheControl, cacheControl);
});

test("in a tool loop the cache mark follows the newest tool result instead of staying on the last text", async () => {
  const cacheControl = { type: "ephemeral" } as const;
  const context: Context = { systemPrompt: "Regeln", messages: [
    { role: "user", content: "Schlage k1 und k2 nach.", timestamp: 1 },
    assistant([{ type: "toolCall", id: "one", name: "lookup", arguments: { key: "k1" } }]),
    { role: "toolResult", toolCallId: "one", toolName: "lookup", timestamp: 2, isError: false, content: [{ type: "text", text: "eins" }] },
    assistant([{ type: "toolCall", id: "two", name: "lookup", arguments: { key: "k2" } }]),
    { role: "toolResult", toolCallId: "two", toolName: "lookup", timestamp: 3, isError: false, content: [{ type: "text", text: "zwei" }] },
  ] };
  const payload = await payloadOf(context, cacheControl);
  const marked = (payload.messages as Array<Record<string, unknown>>).flatMap((message, index) => [
    ...(message.cache_control ? [`${index}:${String(message.role)}`] : []),
    ...(Array.isArray(message.content) ? message.content.filter((part: { cache_control?: unknown }) => part.cache_control).map(() => `${index}:${String(message.role)}:part`) : []),
  ]);
  assert.deepEqual(marked, ["0:system:part", "5:tool"]);

  const withImage = await payloadOf({ ...context, messages: [...context.messages.slice(0, -1), {
    ...context.messages.at(-1)!, content: [{ type: "text", text: "zwei" }, { type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
  } as Context["messages"][number]] }, cacheControl);
  const last = (withImage.messages as Array<{ role: string; content: Array<{ type: string; cache_control?: unknown }> }>).at(-1)!;
  assert.equal(last.role, "user");
  assert.deepEqual(last.content.map((part) => [part.type, part.cache_control ?? null]), [["text", null], ["image_url", cacheControl]]);
});

test("a note for one request stays behind the cache boundary, which marks the last lasting message", async () => {
	const context: Context = { systemPrompt: "Regeln", messages: [
		{ role: "user", content: "Schlage k1 nach.", timestamp: 1 },
		assistant([{ type: "toolCall", id: "one", name: "lookup", arguments: { key: "k1" } }]),
		{ role: "toolResult", toolCallId: "one", toolName: "lookup", timestamp: 2, isError: false, content: [{ type: "text", text: "eins" }] },
		{ role: "user", content: [{ type: "text", text: "Hinweis nur für diese Anfrage." }], timestamp: 3, transient: true },
	] };
	const payload = await payloadOf(context, { type: "ephemeral" });
	const marked = (payload.messages as Array<Record<string, unknown>>).flatMap((message, index) => [
		...(message.cache_control ? [`${index}:${String(message.role)}`] : []),
		...(Array.isArray(message.content) ? message.content.filter((part: { cache_control?: unknown }) => part.cache_control).map(() => `${index}:${String(message.role)}:part`) : []),
	]);
	assert.deepEqual(marked, ["0:system:part", "3:tool"]);
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

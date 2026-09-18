import assert from "node:assert/strict";
import test from "node:test";
import { stream } from "../src/api/ai-sdk.ts";
import { transformMessages } from "../src/api/transform-messages.ts";
import type { Context, Model, UserAttachment } from "../src/types.ts";

const model: Model<"openai-completions"> = {
  id: "test/native", name: "Native input test", api: "openai-completions", provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1", reasoning: false, input: ["text", "image", "video", "file"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024,
};
const attachments: UserAttachment[] = [
  { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  { type: "video", data: "dmlkZW8=", mimeType: "video/mp4" },
  { type: "file", data: "cGRm", mimeType: "application/pdf", filename: "Entwurf.pdf" },
];

test("OpenRouter payload carries native image, video and named PDF bytes and pins native PDF handling", async () => {
  const context: Context = { messages: [{ role: "user", content: [{ type: "text", text: "Vergleiche die Anhänge." }, ...attachments], timestamp: 1 }] };
  let payload: unknown;
  const result = await stream(model, context, {
    apiKey: "payload-only",
    onPayload: (value) => { payload = structuredClone(value); throw new Error("payload captured before network"); },
  }).result();
  assert.match(result.errorMessage ?? "", /payload captured/);
  assert.deepEqual((payload as { messages: unknown[] }).messages, [{ role: "user", content: [
    { type: "text", text: "Vergleiche die Anhänge." },
    { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
    { type: "video_url", video_url: { url: "data:video/mp4;base64,dmlkZW8=" } },
    { type: "file", file: { filename: "Entwurf.pdf", file_data: "data:application/pdf;base64,cGRm" } },
  ] }]);
  assert.deepEqual((payload as { plugins: unknown[] }).plugins, [{ id: "file-parser", pdf: { engine: "native" } }]);
  assert.deepEqual(context.messages[0]?.content, [{ type: "text", text: "Vergleiche die Anhänge." }, ...attachments]);
});

test("unsupported media fails before provider payload instead of being dropped or interpreted as an image", async () => {
  for (const attachment of attachments) {
    let reachedPayload = false;
    const result = await stream({ ...model, input: ["text"] }, {
      messages: [{ role: "user", content: [attachment], timestamp: 1 }],
    }, { apiKey: "payload-only", onPayload: () => { reachedPayload = true; throw new Error("unexpected payload"); } }).result();
    assert.equal(reachedPayload, false);
    assert.match(result.errorMessage ?? "", new RegExp(`does not support ${attachment.type} input`));
  }
});

test("follow-up context preserves all original media without rewriting source messages", () => {
  const context: Context = { messages: [
    { role: "user", content: attachments, timestamp: 1 },
    { role: "user", content: "Nun die zweite Szene.", timestamp: 2 },
  ] };
  assert.deepEqual(transformMessages(context.messages, model), context.messages);
});

test("attachment-only requests omit the empty text block added by the session", async () => {
  let payload: unknown;
  await stream(model, { messages: [{ role: "user", content: [{ type: "text", text: "" }, attachments[1]!], timestamp: 1 }] }, {
    apiKey: "payload-only", onPayload: (value) => { payload = value; throw new Error("captured"); },
  }).result();
  assert.deepEqual((payload as { messages: unknown[] }).messages, [{ role: "user", content: [
    { type: "video_url", video_url: { url: "data:video/mp4;base64,dmlkZW8=" } },
  ] }]);
  assert.equal("plugins" in (payload as object), false);
});

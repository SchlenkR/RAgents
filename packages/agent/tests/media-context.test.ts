import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage, registerFauxProvider } from "../../ai/src/index.ts";
import type { Context, ImageContent, UserAttachment } from "../../ai/src/types.ts";
import { Agent } from "../src/loop/agent.ts";
import { generateSummary, estimateTokens } from "../src/core/compaction/compaction.ts";
import { collectUserAttachments, serializeConversation } from "../src/core/compaction/utils.ts";
import { convertToLlm } from "../src/core/messages.ts";

const image: ImageContent = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
const video: UserAttachment = { type: "video", data: "dmlkZW8=", mimeType: "video/mp4" };
const file: UserAttachment = { type: "file", data: "cGRm", mimeType: "application/pdf", filename: "Notizen.pdf" };

test("prompt, steered input and a later prompt keep native attachments in the context", async () => {
  const faux = registerFauxProvider({ models: [{ id: "media", input: ["text", "image", "video", "file"] }], tokensPerSecond: 100000 });
  try {
    const agent = new Agent({ initialState: { model: faux.getModel() }, getApiKey: () => "faux-key", convertToLlm });
    const contexts: Context[] = [];
    let started!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    faux.setResponses([
      async (context) => { contexts.push(structuredClone(context)); started(); await gate; return fauxAssistantMessage("Gesehen."); },
      (context) => { contexts.push(structuredClone(context)); return fauxAssistantMessage("Video gesehen."); },
      (context) => { contexts.push(structuredClone(context)); return fauxAssistantMessage("Datei gesehen."); },
    ]);
    const steered = [{ role: "user" as const, content: [{ type: "text" as const, text: "Video" }, video], timestamp: Date.now() }];
    let released = false;
    let delivered = false;
    agent.steeringSource = async () => {
      if (delivered || !released) return [];
      delivered = true;
      return steered;
    };
    const first = agent.prompt({ role: "user", content: [{ type: "text", text: "Anhänge" }, image, file], timestamp: Date.now() });
    await waiting;
    released = true;
    release();
    await first;
    await agent.prompt({ role: "user", content: [{ type: "text", text: "Datei" }, file], timestamp: Date.now() });
    assert.equal(contexts.length, 3);
    assert.deepEqual(collectUserAttachments(contexts[0]!.messages), [image, file]);
    assert.deepEqual(collectUserAttachments(contexts[1]!.messages), [image, file, video]);
    assert.deepEqual(collectUserAttachments(contexts[2]!.messages), [image, file, video, file]);
    assert.equal(contexts[0]!.messages[0]?.role, "user");
    assert.match(serializeConversation(contexts[0]!.messages), /Anhänge/);
  } finally {
    faux.unregister();
  }
});

test("compaction summarizes original media and explicit file metadata, never just omitted attachment text", async () => {
  const faux = registerFauxProvider({ models: [{ id: "summary-media", input: ["text", "image", "video", "file"] }], tokensPerSecond: 100000 });
  const messages: Context["messages"] = [{ role: "user", content: [image, video, file], timestamp: 1 }];
  let request: Context | undefined;
  faux.setResponses([(context) => { request = structuredClone(context); return fauxAssistantMessage("Anhänge zusammengefasst."); }]);
  const summary = await generateSummary(messages, faux.getModel(), 4096, "faux-key");
  assert.equal(summary, "Anhänge zusammengefasst.");
  assert.deepEqual(collectUserAttachments(request!.messages), [image, video, file]);
  assert.match(serializeConversation(request!.messages), /Notizen\.pdf/);
  assert.ok(estimateTokens(messages[0]!) >= 3600);
});

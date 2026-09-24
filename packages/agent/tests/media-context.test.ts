import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, registerFauxProvider } from "../../ai/src/index.ts";
import type { Context, ImageContent, UserAttachment } from "../../ai/src/types.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { generateSummary, estimateTokens } from "../src/core/compaction/compaction.ts";
import { collectUserAttachments, serializeConversation } from "../src/core/compaction/utils.ts";
import { convertToLlm } from "../src/core/messages.ts";

const image: ImageContent = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
const video: UserAttachment = { type: "video", data: "dmlkZW8=", mimeType: "video/mp4" };
const file: UserAttachment = { type: "file", data: "cGRm", mimeType: "application/pdf", filename: "Notizen.pdf" };

test("prompt, steered input and a reopened session preserve native attachments", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ragents-native-media-"));
  const faux = registerFauxProvider({ models: [{ id: "media", input: ["text", "image", "video", "file"] }], tokensPerSecond: 100000 });
  const model = faux.getModel();
  const startAttachments: (UserAttachment[] | undefined)[] = [];
  const resourceLoader = new DefaultResourceLoader({
    extensionFactories: [(api) => {
      api.on("before_agent_start", (event) => { startAttachments.push(event.attachments); });
    }],
  });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const modelRuntime = ModelRuntime.create();
    modelRuntime.registerProvider(model.provider, { api: faux.api, apiKey: "faux-key", baseUrl: model.baseUrl, models: [model] });
    await resourceLoader.reload();
    const sessionManager = SessionManager.create(directory, join(directory, "sessions"));
    ({ session } = await createAgentSession({ cwd: directory, modelRuntime, model,
      settings: { compaction: { enabled: false } }, sessionManager, resourceLoader, tools: [] }));
    await session.bindExtensions({});
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
    session.agent.steeringSource = async () => {
      if (delivered || !released) return [];
      delivered = true;
      return steered;
    };
    const first = session.prompt("Anhänge", { attachments: [image, file] });
    await waiting;
    released = true;
    release();
    await first;
    await session.prompt("Datei", { attachments: [file] });
    assert.equal(contexts.length, 3);
    assert.deepEqual(startAttachments, [[image, file], [file]]);
    assert.deepEqual(collectUserAttachments(contexts[0]!.messages), [image, file]);
    assert.deepEqual(collectUserAttachments(contexts[1]!.messages), [image, file, video]);
    assert.deepEqual(collectUserAttachments(contexts[2]!.messages), [image, file, video, file]);
    assert.equal(contexts[0]!.messages[0]?.role, "user");
    assert.match(serializeConversation(contexts[0]!.messages), /Anhänge/);
    const restored = SessionManager.open(sessionManager.getSessionFile()!, join(directory, "sessions"));
    assert.deepEqual(collectUserAttachments(convertToLlm(restored.buildSessionContext().messages)), [image, file, video, file]);
  } finally {
    session?.dispose();
    rmSync(directory, { recursive: true, force: true });
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

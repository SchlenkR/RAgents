import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "../../ai/src/index.ts";
import type { Context } from "../../ai/src/types.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

for (const fails of [false, true]) {
  test(`steering leaves tools running and delivers their later ${fails ? "error" : "capped result"}`, { timeout: 10000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-background-steering-"));
    const faux = registerFauxProvider({ models: [{ id: "steering", reasoning: false }], tokensPerSecond: 100000 });
    const model = faux.getModel();
    const started = deferred();
    const release = deferred();
    const delivered = deferred();
    const contexts: Context[] = [];
    let toolSignal: AbortSignal | undefined;
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      const modelRuntime = ModelRuntime.create();
      modelRuntime.registerProvider(model.provider, { api: faux.api, apiKey: "faux-key", baseUrl: model.baseUrl, models: [model] });
          const resourceLoader = new DefaultResourceLoader({});
      await resourceLoader.reload();
      ({ session } = await createAgentSession({
        cwd: directory, modelRuntime, model, settings: { compaction: { enabled: false } }, resourceLoader,
        sessionManager: SessionManager.inMemory(directory),
        tools: ["slow_tool"],
        customTools: [{ name: "slow_tool", label: "Slow", description: "Wait for a test gate", parameters: Type.Object({}),
          execute: async (_id, _args, signal) => {
            toolSignal = signal;
            started.resolve();
            await release.promise;
            if (fails) throw new Error("Später Fehler");
            return { content: [{ type: "text", text: "ü".repeat(35000) + "UNREACHABLE_TAIL" }], details: {} };
          },
        }],
      }));
      await session.bindExtensions({});
      unsubscribe = session.subscribe((event) => {
        if (event.type === "queue_update" && event.steering.some((text) => text.includes("<background-tool-result"))) delivered.resolve();
      });
      faux.setResponses([
        () => fauxAssistantMessage([fauxToolCall("slow_tool", {}, { id: "slow-call" })]),
        (context) => { contexts.push({ messages: structuredClone(context.messages) }); return fauxAssistantMessage("Neue Richtung verstanden."); },
        (context) => { contexts.push({ messages: structuredClone(context.messages) }); return fauxAssistantMessage("Ergebnis gesehen."); },
      ]);
      const running = session.prompt("Los");
      await started.promise;
      await session.steer("Neue Richtung");
      await running;
      assert.equal(contexts.length, 1, JSON.stringify(session.agent.state.messages));
      assert.equal(toolSignal?.aborted, false);
      const interim = contexts[0]!.messages.find((message) => message.role === "toolResult");
      assert.ok(interim && interim.role === "toolResult");
      assert.equal(interim.isError, false);
      assert.equal(JSON.stringify(interim.content).includes("background"), true);
      assert.match(JSON.stringify(contexts[0]!.messages), /Neue Richtung/);
      release.resolve();
      await delivered.promise;
      assert.equal(session.getSteeringMessages().length, 1);
      const body = session.getSteeringMessages()[0]!;
      assert.match(body, /<background-tool-result name="slow_tool" callId="slow-call"/);
      if (fails) {
        assert.match(body, /status="error"[\s\S]*Später Fehler/);
      } else {
        assert.equal(body.includes("ü".repeat(30000)), true);
        assert.equal(body.includes("ü".repeat(30001)), false);
        assert.equal(body.includes("UNREACHABLE_TAIL"), false);
        assert.match(body, /truncated/);
      }
      await session.prompt("Weiter");
      assert.ok(contexts[1]!.messages.some((message) => message.role === "user" && Array.isArray(message.content)
        && message.content.some((part) => part.type === "text" && part.text === body)));
      assert.equal(session.getSteeringMessages().length, 0);
    } finally {
      release.resolve();
      unsubscribe?.();
      session?.dispose();
      faux.unregister();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

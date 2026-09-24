import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "../../ai/src/index.ts";
import type { AssistantMessage, Context } from "../../ai/src/types.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import type { AgentMessage } from "../src/loop/types.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const userText = (text: string): AgentMessage => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });

const textsOf = (context: Context) => context.messages.flatMap((message) => {
  if (message.role === "toolResult") return [`tool:${message.content.map((part) => part.type === "text" ? part.text : "").join("")}`];
  if (message.role !== "user") return [];
  return [typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : "").join("")];
});

const withSession = async (
  name: string,
  tool: (signal: AbortSignal | undefined) => Promise<string>,
  run: (session: Awaited<ReturnType<typeof createAgentSession>>["session"], faux: ReturnType<typeof registerFauxProvider>) => Promise<void>,
) => {
  const directory = mkdtempSync(join(tmpdir(), "ragents-steering-"));
  const faux = registerFauxProvider({ models: [{ id: name, reasoning: false }], tokensPerSecond: 100000 });
  const model = faux.getModel();
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const modelRuntime = ModelRuntime.create();
    modelRuntime.registerProvider(model.provider, { api: faux.api, apiKey: "faux-key", baseUrl: model.baseUrl, models: [model] });
    const resourceLoader = new DefaultResourceLoader({});
    await resourceLoader.reload();
    ({ session } = await createAgentSession({
      cwd: directory, modelRuntime, model, settings: { compaction: { enabled: false }, retry: { enabled: false } }, resourceLoader,
      sessionManager: SessionManager.inMemory(directory),
      tools: ["slow_tool"],
      customTools: [{ name: "slow_tool", label: "Slow", description: "Wait for a test gate", parameters: Type.Object({}),
        execute: async (_id, _args, signal) => ({ content: [{ type: "text", text: await tool(signal) }], details: {} }),
      }],
    }));
    await session.bindExtensions({});
    await run(session, faux);
  } finally {
    session?.dispose();
    faux.unregister();
    rmSync(directory, { recursive: true, force: true });
  }
};

test("steering waits for the running tool and reaches the next model request in order", { timeout: 10000 }, async () => {
  const started = deferred();
  const release = deferred();
  let toolSignal: AbortSignal | undefined;
  await withSession("steering-tool", async (signal) => {
    toolSignal = signal;
    started.resolve();
    await release.promise;
    return "Werkzeug fertig";
  }, async (session, faux) => {
    const contexts: Context[] = [];
    const queued: AgentMessage[] = [];
    let polls = 0;
    session.agent.steeringSource = async () => {
      polls++;
      return queued.splice(0);
    };
    faux.setResponses([
      () => fauxAssistantMessage([fauxToolCall("slow_tool", {}, { id: "slow-call" })]),
      (context) => { contexts.push({ messages: structuredClone(context.messages) }); return fauxAssistantMessage("Neue Richtung verstanden."); },
    ]);
    const running = session.prompt("Los");
    await started.promise;
    queued.push(userText("Erste Korrektur"), userText("Zweite Korrektur"));
    release.resolve();
    await running;
    assert.equal(toolSignal?.aborted, false);
    assert.equal(contexts.length, 1);
    assert.deepEqual(textsOf(contexts[0]!), ["Los", "tool:Werkzeug fertig", "Erste Korrektur", "Zweite Korrektur"]);
    assert.equal(polls, 3, "vor der ersten Anfrage, nach dem Werkzeug und nach der Antwort");
  });
});

test("steering after a final answer continues the same run with another model request", { timeout: 10000 }, async () => {
  await withSession("steering-answer", async () => "unbenutzt", async (session, faux) => {
    const contexts: Context[] = [];
    const queued: AgentMessage[] = [];
    session.agent.steeringSource = async () => queued.splice(0);
    faux.setResponses([
      () => {
        queued.push(userText("Noch ein Nachtrag"));
        return fauxAssistantMessage("Erste Antwort.");
      },
      (context) => { contexts.push({ messages: structuredClone(context.messages) }); return fauxAssistantMessage("Nachtrag gelesen."); },
    ]);
    let endings = 0;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_end") endings++;
    });
    await session.prompt("Frage");
    unsubscribe();
    assert.equal(endings, 1, "ein einziger Lauf");
    assert.deepEqual(textsOf(contexts[0]!), ["Frage", "Noch ein Nachtrag"]);
    const last = session.messages.at(-1) as AssistantMessage;
    assert.equal(last.content[0]?.type === "text" ? last.content[0].text : "", "Nachtrag gelesen.");
  });
});

test("a failing steering source ends the run with its cause instead of another model request", { timeout: 10000 }, async () => {
  await withSession("steering-failure", async () => "Werkzeug fertig", async (session, faux) => {
    let polls = 0;
    session.agent.steeringSource = async () => {
      polls++;
      if (polls > 1) throw new Error("Eingabe nicht lesbar");
      return [];
    };
    let requests = 0;
    faux.setResponses([
      () => { requests++; return fauxAssistantMessage([fauxToolCall("slow_tool", {}, { id: "call" })]); },
      () => { requests++; return fauxAssistantMessage("Nie erreicht."); },
    ]);
    await session.prompt("Los");
    assert.equal(requests, 1);
    const last = session.messages.at(-1) as AssistantMessage;
    assert.equal(last.stopReason, "error");
    assert.equal(last.errorMessage, "Eingabe nicht lesbar");
  });
});

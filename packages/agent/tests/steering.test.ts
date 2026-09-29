import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "../../ai/src/index.ts";
import type { AssistantMessage, Context } from "../../ai/src/types.ts";
import { Agent } from "../src/loop/agent.ts";
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

const withAgent = async (
  name: string,
  tool: (signal: AbortSignal | undefined) => Promise<string>,
  run: (agent: Agent, faux: ReturnType<typeof registerFauxProvider>) => Promise<void>,
) => {
  const faux = registerFauxProvider({ models: [{ id: name, reasoning: false }], tokensPerSecond: 100000 });
  try {
    const agent = new Agent({
      initialState: {
        model: faux.getModel(),
        tools: [{ name: "slow_tool", label: "Slow", description: "Wait for a test gate", parameters: Type.Object({}),
          execute: async (_id, _args, signal) => ({ content: [{ type: "text", text: await tool(signal) }], details: {} }),
        }],
      },
      getApiKey: () => "faux-key",
    });
    await run(agent, faux);
  } finally {
    faux.unregister();
  }
};

test("steering waits for the running tool and reaches the next model request in order", { timeout: 10000 }, async () => {
  const started = deferred();
  const release = deferred();
  let toolSignal: AbortSignal | undefined;
  await withAgent("steering-tool", async (signal) => {
    toolSignal = signal;
    started.resolve();
    await release.promise;
    return "Tool done";
  }, async (agent, faux) => {
    const contexts: Context[] = [];
    const queued: AgentMessage[] = [];
    let polls = 0;
    agent.steeringSource = async () => {
      polls++;
      return queued.splice(0);
    };
    faux.setResponses([
      () => fauxAssistantMessage([fauxToolCall("slow_tool", {}, { id: "slow-call" })]),
      (context) => { contexts.push({ messages: structuredClone(context.messages) }); return fauxAssistantMessage("New direction understood."); },
    ]);
    const running = agent.prompt(userText("Go"));
    await started.promise;
    queued.push(userText("First correction"), userText("Second correction"));
    release.resolve();
    await running;
    assert.equal(toolSignal?.aborted, false);
    assert.equal(contexts.length, 1);
    assert.deepEqual(textsOf(contexts[0]!), ["Go", "tool:Tool done", "First correction", "Second correction"]);
    assert.equal(polls, 3, "before the first request, after the tool and after the answer");
  });
});

test("steering after a final answer continues the same run with another model request", { timeout: 10000 }, async () => {
  await withAgent("steering-answer", async () => "unused", async (agent, faux) => {
    const contexts: Context[] = [];
    const queued: AgentMessage[] = [];
    agent.steeringSource = async () => queued.splice(0);
    faux.setResponses([
      () => {
        queued.push(userText("One more addendum"));
        return fauxAssistantMessage("First answer.");
      },
      (context) => { contexts.push({ messages: structuredClone(context.messages) }); return fauxAssistantMessage("Addendum read."); },
    ]);
    let endings = 0;
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === "agent_end") endings++;
    });
    await agent.prompt(userText("Question"));
    unsubscribe();
    assert.equal(endings, 1, "a single run");
    assert.deepEqual(textsOf(contexts[0]!), ["Question", "One more addendum"]);
    const last = agent.state.messages.at(-1) as AssistantMessage;
    assert.equal(last.content[0]?.type === "text" ? last.content[0].text : "", "Addendum read.");
  });
});

test("a failing steering source ends the run with its cause instead of another model request", { timeout: 10000 }, async () => {
  await withAgent("steering-failure", async () => "Tool done", async (agent, faux) => {
    let polls = 0;
    agent.steeringSource = async () => {
      polls++;
      if (polls > 1) throw new Error("Input not readable");
      return [];
    };
    let requests = 0;
    faux.setResponses([
      () => { requests++; return fauxAssistantMessage([fauxToolCall("slow_tool", {}, { id: "call" })]); },
      () => { requests++; return fauxAssistantMessage("Never reached."); },
    ]);
    await agent.prompt(userText("Go"));
    assert.equal(requests, 1);
    const last = agent.state.messages.at(-1) as AssistantMessage;
    assert.equal(last.stopReason, "error");
    assert.equal(last.errorMessage, "Input not readable");
  });
});

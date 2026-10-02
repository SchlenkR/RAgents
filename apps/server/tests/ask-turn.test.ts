import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Context } from "@ragents/ai";
import {
  AgentLoopDriver,
  FixedWorkspaces,
  resolveExecution,
  StaticModelCatalog,
  thinkingLevels,
  ToolRegistry,
  TurnScheduler,
  type CatalogModel,
} from "@ragents/engine";
import { applyEvent, type Message } from "quassel/events";
import { SUPERSEDED_ANSWER } from "../../../plugins/ragents.ask/ask-payload.ts";
import { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { QUESTION_POSED } from "../../../plugins/ragents.ask/server/ask-tool.ts";
import type { AskService } from "../../../plugins/ragents.ask/server/contract.ts";
import { createAskToolContributor } from "../../../plugins/ragents.ask/server/tool-contributor.ts";
import { chatHistoryOf } from "../src/ragents/chat-projection.ts";
import { allGrants, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

const askStep = fauxAssistantMessage(
  [fauxToolCall("ask_user", { question: "Which branch?", options: ["main", "release"] }, { id: "call-ask" })],
  { stopReason: "toolUse" },
);

const textOf = (message: Context["messages"][number] | undefined) =>
  message === undefined || message.role === "assistant" ? "" : typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.type === "text" ? part.text : "").join("");

/** ask_user on the agent loop with a scripted model; `wrap` changes what happens around the call. */
const scripted = (t: TestContext, wrap: (service: RuntimeAskService) => AskService = (service) => service) => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-ask-turn-"));
  const faux = registerFauxProvider({ models: [{ id: "ask-turn-model", reasoning: false }], tokensPerSecond: 100000 });
  const modelRuntime = ModelRuntime.create();
  const model = faux.getModel();
  modelRuntime.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
    apiKey: "faux-key",
    api: faux.api,
    models: faux.models.map((entry) => ({
      id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning, input: entry.input, cost: entry.cost,
      contextWindow: entry.contextWindow, maxTokens: entry.maxTokens, baseUrl: entry.baseUrl,
    })),
  });
  const models: CatalogModel[] = [{ driver: "agent", provider: model.provider, model: model.id, label: `${model.provider}/${model.id}`, thinking: thinkingLevels }];
  const catalog = new StaticModelCatalog(models, [{
    name: "agent", description: "Faux", driver: "agent", provider: model.provider, model: model.id, turnTimeoutMs: 600_000, isolateWorkspace: false,
  }]);
  const setup = setupRun({ grants: allGrants(), execution: resolveExecution(catalog, { profile: "agent", isolateWorkspace: false }, "worker", models) });
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const driver = new AgentLoopDriver({ modelRuntime });
  const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
    drivers: { agent: driver }, catalog, registry: new ToolRegistry().register(createAskToolContributor(wrap(service))), workspaces: new FixedWorkspaces(directory),
  });
  t.after(async () => {
    await scheduler.stop();
    await driver.shutdown().catch(() => undefined);
    faux.unregister();
    setup.journal.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const contexts: Context[] = [];
  const answer = (text: string) => (context: Context) => {
    contexts.push({ messages: structuredClone(context.messages) });
    return fauxAssistantMessage(text);
  };
  const view = () => setup.runtime.view(setup.view.id);
  const message = (commandId: string, content: string) => setup.runtime.enqueueInput(
    { actorId: setup.view.ownerId, commandId }, setup.view.id, { actorId: setup.agent.id, content, origin: "human" });
  const chat = () => {
    const events = setup.runtime.events(setup.view.id);
    return chatHistoryOf(events, {
      conversationId: events[0]!.eventId,
      primaryActorId: setup.agent.id,
      ownerId: setup.view.ownerId,
      labelOf: () => undefined,
      turnOf: (turnId) => view().turns.find((turn) => turn.id === turnId)!,
      interruptedByCommand: () => false,
    });
  };
  return { ...setup, service, faux, scheduler, contexts, answer, view, message, chat };
};

test("the asking turn ends without a second model request, and the answer starts the next turn", async (t) => {
  const run = scripted(t);
  run.faux.setResponses([askStep, run.answer("Merging into main.")]);
  postTo(run.runtime, run.view(), run.agent.id, "start", "Merge the change.");
  run.scheduler.start();
  await run.scheduler.waitForIdle();

  assert.equal(run.faux.state.callCount, 1, "the question ends the turn, no request for a closing text");
  const asked = run.view();
  assert.deepEqual(asked.turns.map((turn) => turn.status), ["completed"]);
  assert.deepEqual(asked.turns[0]!.toolCalls.map((call) => [call.name, call.status]), [["ask_user", "completed"]]);
  assert.equal(asked.actions[0]?.status, "pending");
  const chat = run.chat();
  assert.deepEqual(chat.map((event) => event.kind), ["user", "tool", "action", "tool-result", "turn-done"], "the chat shows the turn as finished");
  const messages = chat.reduce(applyEvent, [] as Message[]);
  assert.deepEqual(messages.map((entry) => [entry.role, entry.tool?.result ?? entry.text]),
    [["user", "Merge the change."], ["tool", QUESTION_POSED], ["action", "Which branch?"]]);
  assert.equal(messages[1]!.tool?.isError, false);

  run.service.answer(run.view().id, asked.actions[0]!.id, { answer: "main" });
  await settled();
  await run.scheduler.waitForIdle();

  assert.equal(run.faux.state.callCount, 2);
  assert.deepEqual(run.view().turns.map((turn) => turn.status), ["completed", "completed"]);
  const context = run.contexts[0]!;
  assert.deepEqual(context.messages.map((entry) => entry.role), ["user", "assistant", "toolResult", "user"]);
  assert.equal(textOf(context.messages[2]), QUESTION_POSED);
  assert.equal(textOf(context.messages[3]), "Answer to your question: Which branch?\nAnswer: main");
});

test("a person's message during the ask_user call closes the question and still reaches the asker in the same turn", async (t) => {
  const run = scripted(t, (service) => ({
    pose: (call, request) => {
      const posed = service.pose(call, request);
      run.message("during", "Use the release branch.");
      return posed;
    },
    ask: (...args) => service.ask(...args),
    withdraw: (...args) => service.withdraw(...args),
  }));
  run.faux.setResponses([askStep, run.answer("Release branch it is.")]);
  postTo(run.runtime, run.view(), run.agent.id, "start", "Merge the change.");
  run.scheduler.start();
  await run.scheduler.waitForIdle();
  await settled();

  assert.equal(run.faux.state.callCount, 2, "the waiting message gets its model request");
  const view = run.view();
  assert.equal(view.turns.length, 1);
  assert.deepEqual(view.inputs.at(-1)?.lifecycle, { kind: "claimed", turnId: view.turns[0]!.id, steered: true });
  assert.deepEqual(view.actions[0]?.result, { supersededBy: view.inputs.at(-1)!.id });
  assert.deepEqual(run.contexts[0]!.messages.slice(-2).map(textOf), [QUESTION_POSED, "Use the release branch."]);
});

test("a question not asked because a message already waits hands the turn on to that message", async (t) => {
  const run = scripted(t, (service) => ({
    pose: (call, request) => {
      run.message("before", "Use the release branch.");
      return service.pose(call, request);
    },
    ask: (...args) => service.ask(...args),
    withdraw: (...args) => service.withdraw(...args),
  }));
  run.faux.setResponses([askStep, run.answer("Release branch it is.")]);
  postTo(run.runtime, run.view(), run.agent.id, "start", "Merge the change.");
  run.scheduler.start();
  await run.scheduler.waitForIdle();

  assert.equal(run.faux.state.callCount, 2);
  assert.equal(run.view().turns.length, 1);
  assert.deepEqual(run.view().actions, []);
  assert.deepEqual(run.contexts[0]!.messages.slice(-2).map(textOf), [SUPERSEDED_ANSWER, "Use the release branch."]);
});

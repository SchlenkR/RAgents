import assert from "node:assert/strict";
import test from "node:test";
import { askPayloadOf, ASK_PLUGIN_ID, SUPERSEDED_ANSWER } from "../../../plugins/ragents.ask/ask-payload.ts";
import { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { DISMISSED_ANSWER } from "../../../plugins/ragents.ask/server/contract.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { allGrants, manualExecution, setupRun } from "../../../packages/ragents/tests/support.ts";

const setupAsk = () => {
  const setup = setupRun({ grants: allGrants() });
  const turn = enqueueAndClaim(setup.runtime, setup.view, setup.agent.id, "input", "Bitte frage nach.", "turn");
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const ask = (commandId: string, multi = false) => service.ask(
    { runId: setup.view.id, agentId: setup.agent.id, turnId: turn.turnId, commandId },
    { question: "Welcher nächste Schritt?", options: ["Weiter", "Pause"], multi },
    undefined,
  );
  return { ...setup, service, ask, turn };
};

const enqueueUnderOwner = (setup: ReturnType<typeof setupAsk>, commandId: string, input: { actorId?: string; origin?: "human" } = {}) =>
  setup.runtime.enqueueInput({ actorId: setup.view.ownerId, commandId }, setup.view.id, {
    actorId: input.actorId ?? setup.agent.id,
    content: "Run the tests first.",
    ...(input.origin ? { origin: input.origin } : {}),
  });

test("ask_user legt eine generische Aktion mit dem eigenen Payload an", async () => {
  const setup = setupAsk();
  try {
    const pending = setup.ask("frage");
    const action = setup.runtime.view(setup.view.id).actions[0];
    assert.ok(action);
    assert.equal(action.owner, ASK_PLUGIN_ID);
    assert.equal(action.title, "Welcher nächste Schritt?");
    assert.equal(action.status, "pending");
    assert.deepEqual(askPayloadOf(action.payload), { question: "Welcher nächste Schritt?", options: ["Weiter", "Pause"], multi: false });
    assert.equal("kind" in action, false);
    setup.service.answer(setup.view.id, action.id, { answer: "Weiter" });
    assert.equal(await pending, "Weiter");
    assert.equal(setup.runtime.view(setup.view.id).actions[0]?.result, "Weiter");
  } finally {
    setup.journal.close();
  }
});

test("Verwerfen liefert dem Werkzeug den Verwurfstext, eine fremde Aktion kennt der Dienst nicht", async () => {
  const setup = setupAsk();
  try {
    const pending = setup.ask("frage");
    const action = setup.runtime.view(setup.view.id).actions[0];
    assert.ok(action);
    const fremd = setup.runtime.proposeAction(
      { actorId: setup.agent.id, commandId: "fremd", turnId: setup.turn.turnId },
      setup.view.id,
      { owner: "ragents.todo", title: "Fremde Aktion" },
    ).actions.find((entry) => entry.owner === "ragents.todo");
    assert.ok(fremd);
    assert.throws(() => setup.service.answer(setup.view.id, fremd.id, { answer: "x" }), /existiert nicht/);
    setup.service.answer(setup.view.id, action.id, { dismiss: true });
    assert.equal(await pending, DISMISSED_ANSWER);
    assert.equal(setup.runtime.view(setup.view.id).actions[0]?.status, "dismissed");
  } finally {
    setup.journal.close();
  }
});

test("ein Payload ohne Frage oder Optionen wird nicht als Rückfrage gelesen", () => {
  assert.equal(askPayloadOf(null), undefined);
  assert.equal(askPayloadOf({ question: "Was?" }), undefined);
  assert.equal(askPayloadOf({ question: "Was?", options: [1, 2] }), undefined);
  assert.deepEqual(askPayloadOf({ question: "Was?", options: [], multi: true }), { question: "Was?", options: [], multi: true });
});

test("a person's message supersedes an open question that blocks the asker's turn", async () => {
  const setup = setupAsk();
  try {
    const pending = setup.ask("question");
    const before = setup.runtime.view(setup.view.id).inputs.length;
    const message = enqueueUnderOwner(setup, "message", { origin: "human" }).inputs.at(-1);
    assert.ok(message);
    assert.equal(await pending, SUPERSEDED_ANSWER);
    await new Promise((resolve) => setImmediate(resolve));
    const view = setup.runtime.view(setup.view.id);
    assert.equal(view.actions[0]?.status, "dismissed");
    assert.deepEqual(view.actions[0]?.result, { supersededBy: message.id });
    assert.deepEqual(view.inputs.slice(before).map((input) => [input.id, input.lifecycle.kind]), [[message.id, "pending"]]);
    assert.equal(setup.runtime.events(setup.view.id).filter((event) => event.type === "action.resolved").length, 1);
  } finally {
    setup.journal.close();
  }
});

test("a person's message that waits before the question means the question is not asked", async () => {
  const setup = setupAsk();
  try {
    enqueueUnderOwner(setup, "message", { origin: "human" });
    assert.equal(await setup.ask("question"), SUPERSEDED_ANSWER);
    assert.deepEqual(setup.runtime.view(setup.view.id).actions, []);
  } finally {
    setup.journal.close();
  }
});

test("an input the system enqueues under the owner leaves the question open", async () => {
  const setup = setupAsk();
  try {
    enqueueUnderOwner(setup, "notice-before");
    const pending = setup.ask("question");
    enqueueUnderOwner(setup, "notice-after");
    await new Promise((resolve) => setImmediate(resolve));
    const question = setup.runtime.view(setup.view.id).actions[0];
    assert.equal(question?.status, "pending");
    setup.service.answer(setup.view.id, question.id, { answer: "Weiter" });
    assert.equal(await pending, "Weiter");
  } finally {
    setup.journal.close();
  }
});

test("a question without a turn stays open when a person writes to its recipient", async () => {
  const setup = setupAsk();
  try {
    enqueueUnderOwner(setup, "message-before", { origin: "human" });
    const pending = setup.service.ask(
      { runId: setup.view.id, agentId: setup.view.ownerId, turnId: null, commandId: "start-question" },
      { question: "Which solution should load?", options: ["app.sln", "tools.sln"], recipient: setup.agent.id },
      undefined,
    );
    enqueueUnderOwner(setup, "message-after", { origin: "human" });
    await new Promise((resolve) => setImmediate(resolve));
    const question = setup.runtime.view(setup.view.id).actions[0];
    assert.equal(question?.status, "pending");
    setup.service.answer(setup.view.id, question.id, { answer: "app.sln" });
    assert.equal(await pending, "app.sln");
  } finally {
    setup.journal.close();
  }
});

test("a person's message to a different actor leaves the question open", async () => {
  const setup = setupAsk();
  try {
    const reviewer = setup.runtime.spawnAgent({ actorId: setup.view.ownerId, commandId: "spawn-reviewer" }, setup.view.id, {
      handle: "reviewer", displayName: "Reviewer", prompt: "Review the change.", execution: manualExecution(), grants: [], toolNames: [],
    }).actors.find((actor) => actor.handle === "reviewer");
    assert.ok(reviewer);
    enqueueUnderOwner(setup, "message-before", { actorId: reviewer.id, origin: "human" });
    const pending = setup.ask("question");
    enqueueUnderOwner(setup, "message-after", { actorId: reviewer.id, origin: "human" });
    await new Promise((resolve) => setImmediate(resolve));
    const question = setup.runtime.view(setup.view.id).actions[0];
    assert.equal(question?.status, "pending");
    setup.service.answer(setup.view.id, question.id, { answer: "Pause" });
    assert.equal(await pending, "Pause");
  } finally {
    setup.journal.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import type { ToolScope } from "@ragents/engine";
import { askPayloadOf, ASK_PLUGIN_ID, SUPERSEDED_ANSWER } from "../../../plugins/ragents.ask/ask-payload.ts";
import { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { createAskTool, QUESTION_POSED } from "../../../plugins/ragents.ask/server/ask-tool.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { allGrants, manualExecution, setupRun } from "../../../packages/ragents/tests/support.ts";

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

const setupAsk = () => {
  const setup = setupRun({ grants: allGrants() });
  const turn = enqueueAndClaim(setup.runtime, setup.view, setup.agent.id, "input", "Please ask.", "turn");
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const tool = createAskTool(service);
  const scope = {
    caller: { runId: setup.view.id, actorId: setup.agent.id, turnId: turn.turnId },
    context: (toolCallId: string) => ({ actorId: setup.agent.id, commandId: `tool:${toolCallId}`, turnId: turn.turnId }),
  } as unknown as ToolScope;
  const ask = (toolCallId: string, question = "Which next step?") =>
    tool.run(scope, toolCallId, { question, options: ["Continue", "Pause"] } as never);
  const finishTurn = () => setup.runtime.finishTurn(
    { actorId: setup.agent.id, commandId: "finish", turnId: turn.turnId },
    setup.view.id,
    setup.agent.id,
    { turnId: turn.turnId, outcome: "completed" },
  );
  const question = (title = "Which next step?") => {
    const found = setup.runtime.view(setup.view.id).actions.find((action) => action.title === title);
    assert.ok(found, `The question "${title}" exists`);
    return found;
  };
  const inputCount = () => setup.runtime.view(setup.view.id).inputs.length;
  const inputsSince = (count: number) => setup.runtime.view(setup.view.id).inputs.slice(count);
  return { ...setup, service, tool, ask, turn, finishTurn, question, inputCount, inputsSince };
};

const enqueueUnderOwner = (setup: ReturnType<typeof setupAsk>, commandId: string, input: { actorId?: string; origin?: "human" } = {}) =>
  setup.runtime.enqueueInput({ actorId: setup.view.ownerId, commandId }, setup.view.id, {
    actorId: input.actorId ?? setup.agent.id,
    content: "Run the tests first.",
    ...(input.origin ? { origin: input.origin } : {}),
  });

test("ask_user shows a generic action with its own payload, returns at once and ends the turn", () => {
  const setup = setupAsk();
  try {
    assert.equal(setup.ask("question"), QUESTION_POSED);
    assert.equal(setup.tool.endsTurn?.(QUESTION_POSED), true);
    const action = setup.question();
    assert.equal(action.owner, ASK_PLUGIN_ID);
    assert.equal(action.askedBy, setup.agent.id);
    assert.equal(action.status, "pending");
    assert.deepEqual(askPayloadOf(action.payload), { question: "Which next step?", options: ["Continue", "Pause"], multi: false });
    assert.equal("kind" in action, false);
  } finally {
    setup.journal.close();
  }
});

test("the answer reaches the asker as a new input after its turn ended", async () => {
  const setup = setupAsk();
  try {
    setup.ask("question");
    setup.finishTurn();
    const before = setup.inputCount();
    setup.service.answer(setup.view.id, setup.question().id, { answer: "Continue" });
    await settled();
    assert.equal(setup.question().result, "Continue");
    const [answer, ...rest] = setup.inputsSince(before);
    assert.deepEqual(rest, []);
    assert.equal(answer?.actorId, setup.agent.id);
    assert.equal(answer?.content, "Answer to your question: Which next step?\nAnswer: Continue");
    assert.equal(answer?.origin, undefined);
    assert.equal(answer?.lifecycle.kind, "pending");
  } finally {
    setup.journal.close();
  }
});

test("a dismissal reaches the asker as an input, the service does not know a foreign action", async () => {
  const setup = setupAsk();
  try {
    setup.ask("question");
    const foreign = setup.runtime.proposeAction(
      { actorId: setup.agent.id, commandId: "foreign", turnId: setup.turn.turnId },
      setup.view.id,
      { owner: "ragents.todo", title: "Foreign action" },
    ).actions.find((entry) => entry.owner === "ragents.todo");
    assert.ok(foreign);
    assert.throws(() => setup.service.answer(setup.view.id, foreign.id, { answer: "x" }), /does not exist/);
    const before = setup.inputCount();
    setup.service.answer(setup.view.id, setup.question().id, { dismiss: true });
    await settled();
    assert.equal(setup.question().status, "dismissed");
    assert.equal(setup.question().result, null, "a dismissal by the user carries no result");
    assert.deepEqual(setup.inputsSince(before).map((input) => input.content),
      ["Answer to your question: Which next step?\nAnswer: The user dismissed the question."]);
  } finally {
    setup.journal.close();
  }
});

test("a payload without a question or options is not read as a question", () => {
  assert.equal(askPayloadOf(null), undefined);
  assert.equal(askPayloadOf({ question: "What?" }), undefined);
  assert.equal(askPayloadOf({ question: "What?", options: [1, 2] }), undefined);
  assert.deepEqual(askPayloadOf({ question: "What?", options: [], multi: true }), { question: "What?", options: [], multi: true });
});

test("a person's message during the asking turn closes the question without an answer input", async () => {
  const setup = setupAsk();
  try {
    setup.ask("question");
    const before = setup.inputCount();
    const message = enqueueUnderOwner(setup, "message", { origin: "human" }).inputs.at(-1);
    assert.ok(message);
    await settled();
    assert.equal(setup.question().status, "dismissed");
    assert.deepEqual(setup.question().result, { supersededBy: message.id });
    assert.deepEqual(setup.inputsSince(before).map((input) => [input.id, input.lifecycle.kind]), [[message.id, "pending"]]);
    assert.equal(setup.runtime.events(setup.view.id).filter((event) => event.type === "action.resolved").length, 1);
  } finally {
    setup.journal.close();
  }
});

test("a person's later message closes every question still open after the turn ended", async () => {
  const setup = setupAsk();
  try {
    setup.ask("first", "Which branch?");
    setup.ask("second");
    setup.finishTurn();
    await settled();
    assert.deepEqual([setup.question("Which branch?").status, setup.question().status], ["pending", "pending"], "a new question leaves the earlier one open");
    const before = setup.inputCount();
    const message = enqueueUnderOwner(setup, "message", { origin: "human" }).inputs.at(-1);
    assert.ok(message);
    await settled();
    for (const title of ["Which branch?", "Which next step?"]) {
      assert.equal(setup.question(title).status, "dismissed");
      assert.deepEqual(setup.question(title).result, { supersededBy: message.id });
    }
    assert.deepEqual(setup.inputsSince(before).map((input) => input.id), [message.id]);
  } finally {
    setup.journal.close();
  }
});

test("answering one of several questions leaves the others open", async () => {
  const setup = setupAsk();
  try {
    setup.ask("first", "Which branch?");
    setup.ask("second");
    setup.finishTurn();
    const before = setup.inputCount();
    setup.service.answer(setup.view.id, setup.question().id, { answer: "Pause" });
    await settled();
    assert.equal(setup.question("Which branch?").status, "pending");
    assert.deepEqual(setup.inputsSince(before).map((input) => input.content), ["Answer to your question: Which next step?\nAnswer: Pause"]);
  } finally {
    setup.journal.close();
  }
});

test("a person's message that waits before the question means the question is not asked and the turn goes on", () => {
  const setup = setupAsk();
  try {
    enqueueUnderOwner(setup, "message", { origin: "human" });
    assert.equal(setup.ask("question"), SUPERSEDED_ANSWER);
    assert.equal(setup.tool.endsTurn?.(SUPERSEDED_ANSWER), false);
    assert.deepEqual(setup.runtime.view(setup.view.id).actions, []);
  } finally {
    setup.journal.close();
  }
});

test("system inputs under the owner and messages to another actor leave the question open", async () => {
  const setup = setupAsk();
  try {
    const reviewer = setup.runtime.spawnAgent({ actorId: setup.view.ownerId, commandId: "spawn-reviewer" }, setup.view.id, {
      handle: "reviewer", displayName: "Reviewer", prompt: "Review the change.", execution: manualExecution(), grants: [], toolNames: [],
    }).actors.find((actor) => actor.handle === "reviewer");
    assert.ok(reviewer);
    enqueueUnderOwner(setup, "notice-before");
    enqueueUnderOwner(setup, "message-before", { actorId: reviewer.id, origin: "human" });
    assert.equal(setup.ask("question"), QUESTION_POSED);
    enqueueUnderOwner(setup, "notice-after");
    enqueueUnderOwner(setup, "message-after", { actorId: reviewer.id, origin: "human" });
    await settled();
    assert.equal(setup.question().status, "pending");
  } finally {
    setup.journal.close();
  }
});

test("questions of the owner stay open when a person writes to the agent and still resolve the waiting call", async () => {
  const setup = setupAsk();
  try {
    const owner = (commandId: string, question: string, recipient?: string) => setup.service.ask(
      { runId: setup.view.id, agentId: setup.view.ownerId, turnId: null, commandId },
      { question, options: ["Yes", "No"], ...(recipient ? { recipient } : {}) },
      undefined,
    );
    const forAgent = owner("start-question", "Which solution should load?", setup.agent.id);
    const confirmation = owner("confirm", "Run the function?");
    enqueueUnderOwner(setup, "message", { origin: "human" });
    await settled();
    assert.equal(setup.question("Which solution should load?").status, "pending");
    assert.equal(setup.question("Run the function?").status, "pending");
    const before = setup.inputCount();
    setup.service.answer(setup.view.id, setup.question("Which solution should load?").id, { answer: "Yes" });
    setup.service.answer(setup.view.id, setup.question("Run the function?").id, { answer: "No" });
    assert.equal(await forAgent, "Yes");
    assert.equal(await confirmation, "No");
    await settled();
    assert.equal(setup.inputCount(), before, "a waiting call takes the answer, nobody gets an input");
  } finally {
    setup.journal.close();
  }
});

test("a question from an earlier process is closed by a person's message to its asker", async () => {
  const setup = setupAsk();
  try {
    setup.runtime.proposeAction({ actorId: setup.agent.id, commandId: "restored-question", turnId: setup.turn.turnId }, setup.view.id, {
      owner: ASK_PLUGIN_ID, payload: { question: "Resume?", options: ["Continue"], multi: false }, title: "Resume?", input: { label: "Answer", placeholder: null, required: true },
    });
    setup.finishTurn();
    const message = enqueueUnderOwner(setup, "message", { origin: "human" }).inputs.at(-1);
    await settled();
    assert.deepEqual(setup.question("Resume?").result, { supersededBy: message?.id });
  } finally {
    setup.journal.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import type { ToolScope } from "@ragents/engine";
import {
  answerComplaints,
  askPayloadComplaints,
  askPayloadOf,
  ASK_PLUGIN_ID,
  SUPERSEDED_ANSWER,
  type AskQuestion,
} from "../../../plugins/ragents.ask/ask-payload.ts";
import { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { createAskTool, QUESTION_POSED } from "../../../plugins/ragents.ask/server/ask-tool.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { allGrants, manualExecution, setupRun } from "../../../packages/ragents/tests/support.ts";

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

const nextStep: AskQuestion = {
  question: "Which next step?",
  header: "Next step",
  options: [{ label: "Continue", description: "Keep working on the change" }, { label: "Pause", description: "Stop until tomorrow" }],
  multiSelect: false,
};

const checks: AskQuestion = {
  question: "Which checks should run?",
  header: "Checks",
  options: [{ label: "lint", description: "Style rules" }, { label: "tests", description: "Unit tests" }, { label: "build", description: "" }],
  multiSelect: true,
};

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
  const ask = (toolCallId: string, questions: readonly AskQuestion[] = [nextStep]) =>
    tool.run(scope, toolCallId, { questions } as never);
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

test("the tool schema takes the questions of the common harnesses and describes every field", () => {
  const { schema } = createAskTool(new RuntimeAskService());
  const valid = { questions: [nextStep, checks] };
  assert.equal(Value.Check(schema, valid), true);
  assert.equal(Value.Check(schema, { question: "Which next step?", options: ["Continue", "Pause"] }), false, "the former shape is not accepted");
  assert.equal(Value.Check(schema, { questions: [] }), false);
  assert.equal(Value.Check(schema, { questions: [nextStep, checks, nextStep, checks, nextStep] }), false, "at most four questions");
  assert.equal(Value.Check(schema, { questions: [{ ...nextStep, header: "A header too long" }] }), false, "the chip has at most twelve characters");
  assert.equal(Value.Check(schema, { questions: [{ ...nextStep, options: [nextStep.options[0]] }] }), false, "at least two options");
  assert.equal(Value.Check(schema, { questions: [{ ...checks, options: [...checks.options, ...nextStep.options] }] }), false, "at most four options");
  const { multiSelect: _, ...withoutMultiSelect } = nextStep;
  assert.equal(Value.Check(schema, { questions: [withoutMultiSelect] }), false, "multiSelect is required");
  const undescribed: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    const record = node as { properties?: Record<string, { description?: string }>; items?: unknown };
    for (const [name, child] of Object.entries(record.properties ?? {})) {
      if (!child.description) undescribed.push(`${path}.${name}`);
      visit(child, `${path}.${name}`);
    }
    visit(record.items, `${path}[]`);
  };
  visit(schema, "input");
  assert.deepEqual(undescribed, []);
});

test("ask_user shows all questions as one generic action with its own payload, returns at once and ends the turn", () => {
  const setup = setupAsk();
  try {
    assert.equal(setup.ask("question", [nextStep, checks]), QUESTION_POSED);
    assert.equal(setup.tool.endsTurn?.(QUESTION_POSED), true);
    const action = setup.question("Which next step?\nWhich checks should run?");
    assert.equal(action.owner, ASK_PLUGIN_ID);
    assert.equal(action.askedBy, setup.agent.id);
    assert.equal(action.status, "pending");
    assert.deepEqual(askPayloadOf(action.payload), { questions: [nextStep, checks] });
    assert.equal("kind" in action, false);
  } finally {
    setup.journal.close();
  }
});

test("questions that break the shared rules are rejected with every path and reason before anything is shown", () => {
  const setup = setupAsk();
  try {
    const twice = { ...nextStep, options: [nextStep.options[0]!, nextStep.options[0]!] };
    assert.throws(() => setup.ask("twice", [twice, nextStep]), (error: Error) =>
      /questions\.0\.options name the label "Continue" more than once/.test(error.message)
      && /questions ask "Which next step\?" more than once/.test(error.message));
    assert.throws(() => setup.ask("blank", [{ ...nextStep, header: " " }]), /questions\.0\.header must be a non-empty text/);
    assert.deepEqual(setup.runtime.view(setup.view.id).actions, []);
  } finally {
    setup.journal.close();
  }
});

test("all answers reach the asker as one input with one line per question after its turn ended", async () => {
  const setup = setupAsk();
  try {
    setup.ask("question", [nextStep, checks]);
    setup.finishTurn();
    const before = setup.inputCount();
    const action = setup.question("Which next step?\nWhich checks should run?");
    setup.service.answer(setup.view.id, action.id, { answers: [{ selected: ["Continue"] }, { selected: ["lint", "tests"] }] });
    await settled();
    assert.deepEqual(setup.question(action.title).result, { answers: [{ selected: ["Continue"] }, { selected: ["lint", "tests"] }] });
    const [answer, ...rest] = setup.inputsSince(before);
    assert.deepEqual(rest, []);
    assert.equal(answer?.actorId, setup.agent.id);
    assert.equal(answer?.content, [
      "The user answered your questions:",
      "\"Which next step?\" = \"Continue\"",
      "\"Which checks should run?\" = \"lint\", \"tests\"",
    ].join("\n"));
    assert.equal(answer?.origin, undefined);
    assert.equal(answer?.lifecycle.kind, "pending");
  } finally {
    setup.journal.close();
  }
});

test("a free answer replaces the options of its question and is marked as such", async () => {
  const setup = setupAsk();
  try {
    setup.ask("question");
    const before = setup.inputCount();
    setup.service.answer(setup.view.id, setup.question().id, { answers: [{ text: "Ask me again after lunch." }] });
    await settled();
    assert.deepEqual(setup.inputsSince(before).map((input) => input.content),
      ["The user answered your question:\n\"Which next step?\" = free answer \"Ask me again after lunch.\""]);
  } finally {
    setup.journal.close();
  }
});

test("answers that do not fit the questions are rejected with the allowed labels and leave the question open", () => {
  const setup = setupAsk();
  try {
    setup.ask("question", [nextStep, checks]);
    const action = setup.question("Which next step?\nWhich checks should run?");
    const reject = (answers: unknown, pattern: RegExp) =>
      assert.throws(() => setup.service.answer(setup.view.id, action.id, { answers } as never), pattern);
    reject([{ selected: ["Continue"] }], /answers has 1 entries, but there are 2 questions/);
    reject([{ selected: ["Stop"] }, { text: "all" }], /answers\.0\.selected\.0 is "Stop", allowed labels: "Continue", "Pause"/);
    reject([{ selected: ["Continue", "Pause"] }, { text: "all" }], /answers\.0\.selected names 2 options, but the question allows only one/);
    reject([{ selected: [] }, { text: "all" }], /answers\.0\.selected must name at least 1 option/);
    reject([{ selected: ["Continue"] }, { text: "  " }], /answers\.1\.text must be a non-empty text/);
    reject([{ selected: ["Continue"], text: "and more" }, { text: "all" }], /answers\.0 has unknown field selected/);
    assert.equal(setup.question(action.title).status, "pending");
  } finally {
    setup.journal.close();
  }
});

test("a dismissal reaches the asker as an input, the service does not know a foreign action", async () => {
  const setup = setupAsk();
  try {
    setup.ask("question", [nextStep, checks]);
    const foreign = setup.runtime.proposeAction(
      { actorId: setup.agent.id, commandId: "foreign", turnId: setup.turn.turnId },
      setup.view.id,
      { owner: "ragents.todo", title: "Foreign action" },
    ).actions.find((entry) => entry.owner === "ragents.todo");
    assert.ok(foreign);
    assert.throws(() => setup.service.answer(setup.view.id, foreign.id, { answers: [{ text: "x" }] }), /does not exist/);
    const before = setup.inputCount();
    const action = setup.question("Which next step?\nWhich checks should run?");
    setup.service.answer(setup.view.id, action.id, { dismiss: true });
    await settled();
    assert.equal(setup.question(action.title).status, "dismissed");
    assert.equal(setup.question(action.title).result, null, "a dismissal by the user carries no result");
    assert.deepEqual(setup.inputsSince(before).map((input) => input.content),
      ["The user dismissed your questions without an answer:\n\"Which next step?\"\n\"Which checks should run?\""]);
  } finally {
    setup.journal.close();
  }
});

test("the payload rules name every violated path, including the removed single-question shape", () => {
  assert.deepEqual(askPayloadComplaints({ questions: [nextStep], recipient: "agent-1" }), []);
  assert.deepEqual(askPayloadComplaints(null), ["the payload must be an object with questions"]);
  assert.deepEqual(askPayloadComplaints({ question: "What?", options: ["A", "B"], multi: false }), [
    "payload has unknown field question",
    "payload has unknown field options",
    "payload has unknown field multi",
    "questions must list at least 1 question",
  ]);
  assert.deepEqual(askPayloadComplaints({ questions: [{ question: "What?", header: "What", options: [{ label: "A", description: "" }], multiSelect: "no" }] }), [
    "questions.0.options must list at least 2 options",
    "questions.0.multiSelect must be true or false, got \"no\"",
  ]);
  assert.throws(() => askPayloadOf({ questions: [] }), /The questions of ragents\.ask are invalid: questions must list at least 1 question/);
  assert.deepEqual(answerComplaints([checks], [{ selected: ["lint", "lint"] }]), ["answers.0.selected names \"lint\" more than once"]);
  assert.deepEqual(answerComplaints([checks], "lint"), ["answers must be a list with one answer per question"]);
});

test("a person's message during the asking turn closes the questions without an answer input", async () => {
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

test("a person's later message closes every call still open after the turn ended", async () => {
  const setup = setupAsk();
  try {
    setup.ask("first", [checks]);
    setup.ask("second");
    setup.finishTurn();
    await settled();
    assert.deepEqual([setup.question("Which checks should run?").status, setup.question().status], ["pending", "pending"], "a new call leaves the earlier one open");
    const before = setup.inputCount();
    const message = enqueueUnderOwner(setup, "message", { origin: "human" }).inputs.at(-1);
    assert.ok(message);
    await settled();
    for (const title of ["Which checks should run?", "Which next step?"]) {
      assert.equal(setup.question(title).status, "dismissed");
      assert.deepEqual(setup.question(title).result, { supersededBy: message.id });
    }
    assert.deepEqual(setup.inputsSince(before).map((input) => input.id), [message.id]);
  } finally {
    setup.journal.close();
  }
});

test("answering one of several calls leaves the others open", async () => {
  const setup = setupAsk();
  try {
    setup.ask("first", [checks]);
    setup.ask("second");
    setup.finishTurn();
    const before = setup.inputCount();
    setup.service.answer(setup.view.id, setup.question().id, { answers: [{ selected: ["Pause"] }] });
    await settled();
    assert.equal(setup.question("Which checks should run?").status, "pending");
    assert.deepEqual(setup.inputsSince(before).map((input) => input.content), ["The user answered your question:\n\"Which next step?\" = \"Pause\""]);
  } finally {
    setup.journal.close();
  }
});

test("a person's message that waits before the questions means they are not asked and the turn goes on", () => {
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

test("system inputs under the owner and messages to another actor leave the questions open", async () => {
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
      { questions: [{ ...nextStep, question, options: [{ label: "Yes", description: "" }, { label: "No", description: "" }] }], ...(recipient ? { recipient } : {}) },
      undefined,
    );
    const forAgent = owner("start-question", "Which solution should load?", setup.agent.id);
    const confirmation = owner("confirm", "Run the function?");
    enqueueUnderOwner(setup, "message", { origin: "human" });
    await settled();
    assert.equal(setup.question("Which solution should load?").status, "pending");
    assert.equal(setup.question("Run the function?").status, "pending");
    const before = setup.inputCount();
    setup.service.answer(setup.view.id, setup.question("Which solution should load?").id, { answers: [{ selected: ["Yes"] }] });
    setup.service.answer(setup.view.id, setup.question("Run the function?").id, { answers: [{ text: "Only after the review" }] });
    assert.deepEqual(await forAgent, { kind: "answered", answers: [{ selected: ["Yes"] }] });
    assert.deepEqual(await confirmation, { kind: "answered", answers: [{ text: "Only after the review" }] });
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
      owner: ASK_PLUGIN_ID, payload: { questions: [{ ...nextStep, question: "Resume?" }] } as never, title: "Resume?", input: { label: "Answer", placeholder: null, required: true },
    });
    setup.finishTurn();
    const message = enqueueUnderOwner(setup, "message", { origin: "human" }).inputs.at(-1);
    await settled();
    assert.deepEqual(setup.question("Resume?").result, { supersededBy: message?.id });
  } finally {
    setup.journal.close();
  }
});

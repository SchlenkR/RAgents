import assert from "node:assert/strict";
import test from "node:test";
import { TurnScheduler } from "@ragents/engine";
import { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { DISMISSED_ANSWER } from "../../../plugins/ragents.ask/server/contract.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { allGrants, catalog, FakeDriver, noUsage, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

const setupAsk = () => {
  const setup = setupRun({ grants: allGrants() });
  const turn = enqueueAndClaim(setup.runtime, setup.view, setup.agent.id, "input", "Please ask.", "turn");
  const initialInputs = setup.runtime.view(setup.view.id).inputs;
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const pose = (commandId: string, question = "Which next step?") => service.pose(
    { runId: setup.view.id, agentId: setup.agent.id, turnId: turn.turnId, commandId },
    { question, options: ["Continue", "Pause"] },
  );
  const askAsOwner = (commandId: string, signal?: AbortSignal, recipient?: string) => service.ask(
    { runId: setup.view.id, agentId: setup.view.ownerId, turnId: null, commandId },
    { question: "Run the function?", options: ["Run", "Cancel"], ...(recipient ? { recipient } : {}) },
    signal,
  );
  const status = (actionId: string | undefined) => setup.runtime.view(setup.view.id).actions.find((action) => action.id === actionId)?.status;
  return { ...setup, service, pose, askAsOwner, status, turn, initialInputs };
};

test("aborting a waiting call dismisses the question without an answer input", async () => {
  const setup = setupAsk();
  const controller = new AbortController();
  try {
    const pending = setup.askAsOwner("question", controller.signal);
    const rejected = assert.rejects(pending, /cancelled/);
    controller.abort();
    await rejected;
    await settled();
    const view = setup.runtime.view(setup.view.id);
    assert.equal(view.actions[0]?.status, "dismissed");
    assert.deepEqual(view.inputs, setup.initialInputs);
    assert.equal(setup.runtime.events(setup.view.id).filter((event) => event.type === "action.resolved").length, 1);
  } finally {
    setup.journal.close();
  }
});

test("an already aborted signal cannot produce an answer input", async () => {
  const setup = setupAsk();
  try {
    await assert.rejects(setup.askAsOwner("question", AbortSignal.abort()), /cancelled/);
    await settled();
    assert.equal(setup.runtime.view(setup.view.id).actions[0]?.status, "dismissed");
    assert.deepEqual(setup.runtime.view(setup.view.id).inputs, setup.initialInputs);
  } finally {
    setup.journal.close();
  }
});

test("a user dismissal and a withdrawal reach the waiting call exactly once", async () => {
  const setup = setupAsk();
  try {
    const dismissed = setup.askAsOwner("dismissed");
    setup.service.answer(setup.view.id, setup.runtime.view(setup.view.id).actions[0].id, { dismiss: true });
    assert.equal(await dismissed, DISMISSED_ANSWER);
    const withdrawn = setup.askAsOwner("withdrawn");
    setup.service.withdraw(setup.view.id, setup.runtime.view(setup.view.id).actions[1].id);
    assert.equal(await withdrawn, DISMISSED_ANSWER);
    await settled();
    assert.deepEqual(setup.runtime.view(setup.view.id).inputs, setup.initialInputs);
  } finally {
    setup.journal.close();
  }
});

test("stopping the asker withdraws its own questions without an input and keeps the owner's", async () => {
  const setup = setupAsk();
  try {
    const own = setup.pose("question");
    const forAgent = setup.askAsOwner("start-question", undefined, setup.agent.id);
    const before = setup.runtime.view(setup.view.id).inputs.length;
    setup.runtime.stopActor({ actorId: setup.view.ownerId, commandId: "stop-worker" }, setup.view.id, setup.agent.id, "Stopped by the user");
    await settled();
    assert.equal(setup.status(own), "dismissed");
    const ownerQuestion = setup.runtime.view(setup.view.id).actions.find((action) => action.id !== own);
    assert.ok(ownerQuestion);
    assert.equal(ownerQuestion.status, "pending");
    assert.equal(setup.runtime.view(setup.view.id).inputs.length, before);
    setup.service.answer(setup.view.id, ownerQuestion.id, { answer: "Run" });
    assert.equal(await forAgent, "Run");
  } finally {
    setup.journal.close();
  }
});

test("a run stop withdraws the agents' questions and keeps the questions asked for the system", async () => {
  const setup = setupAsk();
  try {
    const first = setup.pose("first", "Which branch?");
    const second = setup.pose("second");
    const confirmation = setup.askAsOwner("confirm");
    const before = setup.runtime.view(setup.view.id).inputs.length;
    const resolvedCount = () => setup.runtime.events(setup.view.id).filter((event) => event.type === "action.resolved").length;
    setup.service.stopRun(setup.view.id);
    await settled();
    assert.deepEqual([setup.status(first), setup.status(second)], ["dismissed", "dismissed"]);
    assert.equal(setup.runtime.view(setup.view.id).inputs.length, before);
    assert.equal(resolvedCount(), 2);
    setup.service.stopRun(setup.view.id);
    assert.equal(resolvedCount(), 2, "a second stop changes nothing");
    const pending = setup.runtime.view(setup.view.id).actions.filter((action) => action.status === "pending");
    assert.equal(pending.length, 1);
    setup.service.answer(setup.view.id, pending[0].id, { answer: "Cancel" });
    assert.equal(await confirmation, "Cancel");
    assert.doesNotThrow(() => setup.service.stopRun("run-already-deleted"), "a removed journal does not block a deletion");
  } finally {
    setup.journal.close();
  }
});

test("the asking turn ends at once and the answer starts the asker's next turn", async () => {
  const setup = setupRun({ grants: allGrants() });
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const posed: Array<string | undefined> = [];
  const driver = new FakeDriver(async (request) => {
    if (driver.requests.length === 1) {
      posed.push(service.pose(
        { runId: request.runId, agentId: request.agentId, turnId: request.turnId, commandId: "question" },
        { question: "Resume?", options: ["Yes", "No"] },
      ));
    }
    return { failure: null, usage: noUsage() };
  });
  const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: { agent: driver }, catalog });
  try {
    postTo(setup.runtime, setup.view, setup.agent.id, "input", "Please ask.");
    scheduler.start();
    await scheduler.waitForIdle();
    const asked = setup.runtime.view(setup.view.id);
    assert.deepEqual(asked.turns.map((turn) => turn.status), ["completed"]);
    assert.equal(asked.actions[0]?.id, posed[0]);
    assert.equal(asked.actions[0]?.status, "pending");
    service.answer(setup.view.id, asked.actions[0].id, { answer: "Yes" });
    await settled();
    await scheduler.waitForIdle();
    const answered = setup.runtime.view(setup.view.id);
    assert.deepEqual(answered.turns.map((turn) => turn.status), ["completed", "completed"]);
    assert.equal(driver.requests[1]?.input.content, "Answer to your question: Resume?\nAnswer: Yes");
  } finally {
    await scheduler.stop();
    setup.journal.close();
  }
});

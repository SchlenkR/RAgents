import assert from "node:assert/strict";
import test from "node:test";
import type { AskQuestion } from "../../../plugins/ragents.ask/ask-payload.ts";
import { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { allGrants, setupRun } from "../../../packages/ragents/tests/support.ts";

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

const question = (text: string, labels: readonly string[]): AskQuestion =>
  ({ question: text, header: "Decision", options: labels.map((label) => ({ label, description: "" })), multiSelect: false });

const setupAsk = () => {
  const setup = setupRun({ grants: allGrants() });
  const turn = enqueueAndClaim(setup.runtime, setup.view, setup.agent.id, "input", "Please ask.", "turn");
  const initialInputs = setup.runtime.view(setup.view.id).inputs;
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const pose = (commandId: string, text = "Which next step?") => service.pose(
    { runId: setup.view.id, agentId: setup.agent.id, turnId: turn.turnId, commandId },
    { questions: [question(text, ["Continue", "Pause"])] },
  );
  const askAsOwner = (commandId: string, signal?: AbortSignal, recipient?: string) => service.ask(
    { runId: setup.view.id, agentId: setup.view.ownerId, turnId: null, commandId },
    { questions: [question("Run the function?", ["Run", "Cancel"])], ...(recipient ? { recipient } : {}) },
    signal,
  );
  const action = (actionId: string | undefined) => setup.runtime.view(setup.view.id).actions.find((entry) => entry.id === actionId);
  const status = (actionId: string | undefined) => action(actionId)?.status;
  return { ...setup, service, pose, askAsOwner, action, status, turn, initialInputs };
};

test("aborting a waiting call withdraws the question without an answer input", async () => {
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
    assert.deepEqual(view.actions[0]?.result, { withdrawn: true });
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

test("a user dismissal and a withdrawal reach the waiting call exactly once, and only the withdrawal is recorded as such", async () => {
  const setup = setupAsk();
  try {
    const dismissed = setup.askAsOwner("dismissed");
    setup.service.answer(setup.view.id, setup.runtime.view(setup.view.id).actions[0].id, { dismiss: true });
    assert.deepEqual(await dismissed, { kind: "dismissed" });
    const withdrawn = setup.askAsOwner("withdrawn");
    setup.service.withdraw(setup.view.id, setup.runtime.view(setup.view.id).actions[1].id);
    assert.deepEqual(await withdrawn, { kind: "dismissed" });
    assert.deepEqual(setup.runtime.view(setup.view.id).actions.map((action) => action.result), [null, { withdrawn: true }]);
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
    assert.deepEqual(setup.action(own)?.result, { withdrawn: true });
    const ownerQuestion = setup.runtime.view(setup.view.id).actions.find((action) => action.id !== own);
    assert.ok(ownerQuestion);
    assert.equal(ownerQuestion.status, "pending");
    assert.equal(setup.runtime.view(setup.view.id).inputs.length, before);
    setup.service.answer(setup.view.id, ownerQuestion.id, { answers: [{ selected: ["Run"] }] });
    assert.deepEqual(await forAgent, { kind: "answered", answers: [{ selected: ["Run"] }] });
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
    assert.deepEqual([setup.action(first)?.result, setup.action(second)?.result], [{ withdrawn: true }, { withdrawn: true }]);
    assert.equal(setup.runtime.view(setup.view.id).inputs.length, before);
    assert.equal(resolvedCount(), 2);
    setup.service.stopRun(setup.view.id);
    assert.equal(resolvedCount(), 2, "a second stop changes nothing");
    const pending = setup.runtime.view(setup.view.id).actions.filter((action) => action.status === "pending");
    assert.equal(pending.length, 1);
    setup.service.answer(setup.view.id, pending[0].id, { answers: [{ selected: ["Cancel"] }] });
    assert.deepEqual(await confirmation, { kind: "answered", answers: [{ selected: ["Cancel"] }] });
    assert.doesNotThrow(() => setup.service.stopRun("run-already-deleted"), "a removed journal does not block a deletion");
  } finally {
    setup.journal.close();
  }
});

test("an approval past the answer method with a result outside the contract rejects the waiting call instead of hanging", async () => {
  const setup = setupAsk();
  try {
    const waiting = setup.askAsOwner("confirm");
    const actionId = setup.runtime.view(setup.view.id).actions[0]!.id;
    setup.runtime.resolveAction({ actorId: setup.view.ownerId, commandId: "generic-approval" }, setup.view.id, actionId, { decision: "approved", result: "Run" });
    await assert.rejects(waiting, /The stored answers of ragents\.ask are invalid: answers must be a list with one answer per question/);
  } finally {
    setup.journal.close();
  }
});

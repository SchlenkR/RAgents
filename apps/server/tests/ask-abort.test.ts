import assert from "node:assert/strict";
import test from "node:test";
import { TurnScheduler } from "@ragents/engine";
import { RuntimeAskService, DISMISSED_ANSWER } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { allGrants, catalog, deferred, FakeDriver, noUsage, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";

const setupAsk = () => {
  const setup = setupRun({ grants: allGrants() });
  const turn = enqueueAndClaim(setup.runtime, setup.view, setup.agent.id, "input", "Bitte frage nach.", "turn");
  const initialInputs = setup.runtime.view(setup.view.id).inputs;
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const ask = (commandId: string, signal?: AbortSignal) => service.ask({ runId: setup.view.id, agentId: setup.agent.id, turnId: turn.turnId, commandId }, { question: "Welcher nächste Schritt?", options: ["Weiter", "Pause"] }, signal);
  return { ...setup, service, ask, turn, initialInputs };
};

test("aborting a waiting question dismisses its UI without enqueuing a discarded answer", async () => {
  const setup = setupAsk();
  const controller = new AbortController();
  try {
    const pending = setup.ask("question", controller.signal);
    const rejected = assert.rejects(pending, /abgebrochen/);
    controller.abort();
    await rejected;
    await new Promise((resolve) => setImmediate(resolve));
    const view = setup.runtime.view(setup.view.id);
    assert.equal(view.actions[0]?.status, "dismissed");
    assert.deepEqual(view.inputs, setup.initialInputs);
    assert.equal(setup.runtime.events(setup.view.id).filter((event) => event.type === "action.resolved").length, 1);
  } finally {
    setup.journal.close();
  }
});

test("an already aborted question cannot produce a fallback actor input", async () => {
  const setup = setupAsk();
  try {
    await assert.rejects(setup.ask("question", AbortSignal.abort()), /abgebrochen/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(setup.runtime.view(setup.view.id).inputs, setup.initialInputs);
  } finally {
    setup.journal.close();
  }
});

test("an explicit user dismissal still reaches the active waiter exactly once", async () => {
  const setup = setupAsk();
  try {
    const pending = setup.ask("question");
    const question = setup.runtime.view(setup.view.id).actions[0];
    setup.service.answer(setup.view.id, question.id, { dismiss: true });
    assert.equal(await pending, DISMISSED_ANSWER);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(setup.runtime.view(setup.view.id).inputs, setup.initialInputs);
  } finally {
    setup.journal.close();
  }
});

test("an ordinary answer to a restored question without an active waiter remains an actor input", async () => {
  const setup = setupAsk();
  try {
    setup.runtime.proposeAction({ actorId: setup.agent.id, commandId: "restored-question", turnId: setup.turn.turnId }, setup.view.id, {
      owner: "ragents.ask", payload: { question: "Fortsetzen?", options: ["Weiter"], multi: false }, title: "Fortsetzen?", input: { label: "Antwort", placeholder: null, required: true },
    });
    const question = setup.runtime.view(setup.view.id).actions[0];
    setup.service.answer(setup.view.id, question.id, { answer: "Weiter" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(setup.runtime.view(setup.view.id).inputs.length, 2);
    assert.match(setup.runtime.view(setup.view.id).inputs[1].content, /Antwort: Weiter$/);
  } finally {
    setup.journal.close();
  }
});

test("stopping the scheduler while ask_user waits leaves no synthetic answer or follow-up turn", async () => {
  const setup = setupRun({ grants: allGrants() });
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const waiting = deferred();
  const driver = new FakeDriver(async (request, signal) => {
    const answer = service.ask({ runId: request.runId, agentId: request.agentId, turnId: request.turnId, commandId: "question" }, { question: "Fortsetzen?", options: ["Ja"] }, signal);
    waiting.resolve();
    await answer;
    return { failure: null, usage: noUsage() };
  });
  const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: { agent: driver }, catalog });
  try {
    postTo(setup.runtime, setup.view, setup.agent.id, "input", "Bitte frage nach.");
    scheduler.start();
    await waiting.promise;
    await scheduler.stopRun(setup.view.id);
    await scheduler.waitForIdle();
    const view = setup.runtime.view(setup.view.id);
    assert.equal(view.turns.length, 1);
    assert.equal(view.turns[0].status, "interrupted");
    assert.equal(view.actions[0].status, "dismissed");
    assert.equal(view.inputs.length, 1);
    assert.equal(driver.requests.length, 1);
  } finally {
    await scheduler.stop();
    setup.journal.close();
  }
});

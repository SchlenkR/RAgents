import assert from "node:assert/strict";
import test from "node:test";
import { askPayloadOf, ASK_PLUGIN_ID } from "../../../plugins/ragents.ask/ask-payload.ts";
import { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { DISMISSED_ANSWER } from "../../../plugins/ragents.ask/server/contract.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { allGrants, setupRun } from "../../../packages/ragents/tests/support.ts";

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

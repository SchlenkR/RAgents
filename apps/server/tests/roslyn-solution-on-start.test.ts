import assert from "node:assert/strict";
import test from "node:test";
import type { SessionStartedContext } from "@ragents/engine";
import type { LanguageServerSolutions } from "@ragents/workspace-executor";
import { askPayloadOf } from "../../../plugins/ragents.ask/ask-payload.ts";
import { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { DISMISSED_ANSWER, type AskService } from "../../../plugins/ragents.ask/server/contract.ts";
import {
  createSolutionOnStart,
  NO_SOLUTION,
  SOLUTION_QUESTION,
  solutionAnswer,
  solutionStartStep,
} from "../../../plugins/ragents.lsp-roslyn/server/solution-on-start.ts";
import { chatHistoryOf } from "../src/ragents/chat-projection.ts";
import type { SandboxServices } from "../src/plugin-support/workspace-sandbox-host.ts";
import { allGrants, setupRun } from "../../../packages/ragents/tests/support.ts";

const solution = (path: string, state: LanguageServerSolutions["solutions"][number]["state"] = null) =>
  ({ path, root: `/workspace/${path}`, state });

const listing = (paths: readonly string[], opened = false): LanguageServerSolutions =>
  ({ source: "git", solutions: paths.map((path) => solution(path)), opened });

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

const fixture = (solutions: LanguageServerSolutions) => {
  const setup = setupRun({ grants: allGrants() });
  const runId = setup.view.id;
  setup.runtime.selectPrimaryActor({ actorId: setup.view.ownerId, commandId: "primary" }, runId, setup.agent.id);
  const calls: Array<{ operation: string; input: unknown }> = [];
  const sandbox = {
    execute: async (_runId: string, operation: string, input: unknown) => {
      calls.push({ operation, input });
      return operation === "roslyn_solutions" ? solutions : "geladen";
    },
  } as unknown as SandboxServices;
  const service = new RuntimeAskService();
  service.bind(setup.runtime);
  const questions: Array<Parameters<AskService["ask"]>> = [];
  const ask: AskService = {
    ask: (...args) => { questions.push(args); return service.ask(...args); },
    withdraw: (...args) => service.withdraw(...args),
  };
  const create = () => createSolutionOnStart({
    pluginId: "ragents.lsp-roslyn",
    adapterId: "roslyn",
    sandbox: () => sandbox,
    runtime: () => setup.runtime,
    ask: () => ask,
  });
  const start = (startEntry: SessionStartedContext["startEntry"] = null, startup = create()) =>
    startup.lifecycle.sessionStarted!({ runId, startEntry });
  const pendingQuestion = () => setup.runtime.view(runId).actions.find((action) => action.status === "pending");
  return { ...setup, runId, calls, service, questions, create, start, pendingQuestion };
};

test("the start step loads a single solution, asks for several and does nothing without one or with an open instance", () => {
  assert.deepEqual(solutionStartStep(listing([])), { kind: "none" });
  assert.deepEqual(solutionStartStep(listing(["src/Demo.sln"])), { kind: "open", path: "src/Demo.sln" });
  assert.deepEqual(solutionStartStep(listing(["src/Demo.sln", "tools/Acme.slnx"])),
    { kind: "ask", options: ["src/Demo.sln", "tools/Acme.slnx", NO_SOLUTION] });
  assert.deepEqual(solutionStartStep(listing(["src/Demo.sln"], true)), { kind: "none" });
  assert.deepEqual(solutionStartStep(listing(["src/Demo.sln", "tools/Acme.slnx"], true)), { kind: "none" });
});

test("an answer opens a listed solution, none and a dismissal load nothing, free text goes on", () => {
  const options = ["src/Demo.sln", "tools/Acme.slnx", NO_SOLUTION];
  assert.deepEqual(solutionAnswer(options, " tools\\Acme.slnx "), { kind: "open", path: "tools/Acme.slnx" });
  assert.deepEqual(solutionAnswer(options, NO_SOLUTION), { kind: "none" });
  assert.deepEqual(solutionAnswer(options, DISMISSED_ANSWER), { kind: "none" });
  assert.deepEqual(solutionAnswer(options, "beide bitte"), { kind: "forward" });
});

test("a run script start never lists, opens or asks and still marks the run", async () => {
  const f = fixture(listing(["src/Demo.sln"]));
  try {
    await f.start({ id: "acme.setup", action: "script" });
    await settled();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.questions, []);
    const marker = f.runtime.view(f.runId).pluginStates.find((entry) => entry.pluginId === "ragents.lsp-roslyn");
    assert.deepEqual(marker?.state, { version: 1, startEntry: "acme.setup" });
    await f.start(null);
    await settled();
    assert.deepEqual(f.calls, [], "a later start of the same run stays a script run");
  } finally {
    f.journal.close();
  }
});

test("a single solution is loaded only if nothing is open or opening, once per run and across restarts", async () => {
  const f = fixture(listing(["src/Demo.sln"]));
  try {
    await f.start({ id: "acme.skill", action: "skill" });
    await settled();
    assert.deepEqual(f.calls, [
      { operation: "roslyn_solutions", input: null },
      { operation: "roslyn_open", input: { root: "src/Demo.sln", ifNoneOpen: true } },
    ]);
    await f.start(null);
    await f.start(null, f.create());
    await settled();
    assert.equal(f.calls.length, 2, "neither the same contribution nor one after a restart starts again");
  } finally {
    f.journal.close();
  }
});

test("an instance someone already opened suppresses question and load", async () => {
  const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"], true));
  try {
    await f.start(null);
    await settled();
    assert.deepEqual(f.calls.map((call) => call.operation), ["roslyn_solutions"]);
    assert.deepEqual(f.questions, []);
    assert.equal(f.pendingQuestion(), undefined);
  } finally {
    f.journal.close();
  }
});

test("several solutions ask the coordinator's chat before the start returns and load the answer", async () => {
  const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"]));
  try {
    await f.start(null);
    const question = f.pendingQuestion();
    assert.ok(question, "the question exists when the start hook returns");
    const state = f.runtime.state(f.runId);
    assert.equal(question.askedBy, state.ownerId, "only the owner may ask outside a turn");
    assert.equal(askPayloadOf(question.payload)?.recipient, f.agent.id);
    assert.equal(question.title, SOLUTION_QUESTION);
    assert.deepEqual(f.questions[0]?.[0], { runId: f.runId, agentId: state.ownerId, turnId: null, commandId: `ragents.lsp-roslyn.solution-question:${f.runId}` });
    assert.deepEqual(f.questions[0]?.[1].options, ["src/Demo.sln", "tools/Acme.slnx", NO_SOLUTION]);
    const chat = chatHistoryOf(f.runtime.events(f.runId), {
      conversationId: "run",
      primaryActorId: f.agent.id,
      ownerId: state.ownerId,
      labelOf: () => "fremd",
      turnOf: (turnId) => state.turns.get(turnId)!,
      interruptedByCommand: () => false,
    });
    assert.deepEqual(chat.filter((event) => event.kind === "action").map((event) => event.kind === "action" && event.text), [SOLUTION_QUESTION]);
    f.service.answer(f.runId, question.id, { answer: "tools/Acme.slnx" });
    await settled();
    assert.deepEqual(f.calls.at(-1), { operation: "roslyn_open", input: { root: "tools/Acme.slnx", ifNoneOpen: false } });
    assert.equal(f.runtime.view(f.runId).inputs.length, 0);
  } finally {
    f.journal.close();
  }
});

test("no load for none, a free answer reaches the coordinator, stopping the run dismisses the question", async (t) => {
  await t.test("none", async () => {
    const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"]));
    try {
      await f.start(null);
      f.service.answer(f.runId, f.pendingQuestion()!.id, { answer: NO_SOLUTION });
      await settled();
      assert.deepEqual(f.calls.map((call) => call.operation), ["roslyn_solutions"]);
    } finally {
      f.journal.close();
    }
  });
  await t.test("free text", async () => {
    const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"]));
    try {
      await f.start(null);
      f.service.answer(f.runId, f.pendingQuestion()!.id, { answer: "beide bitte" });
      await settled();
      assert.deepEqual(f.calls.map((call) => call.operation), ["roslyn_solutions"]);
      const [input] = f.runtime.view(f.runId).inputs;
      assert.equal(input?.actorId, f.agent.id);
      assert.match(input?.content ?? "", /beide bitte/);
      assert.match(input?.content ?? "", /roslyn_open/);
    } finally {
      f.journal.close();
    }
  });
  await t.test("orphaned after a restart", async () => {
    const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"]));
    try {
      await f.start(null);
      const restarted = new RuntimeAskService();
      restarted.bind(f.runtime);
      const question = f.pendingQuestion()!;
      f.service.answer(f.runId, question.id, { answer: "src/Demo.sln" });
      await settled();
      const inputs = f.runtime.view(f.runId).inputs;
      assert.equal(inputs.length, 1, "the service without a waiter hands the answer to the coordinator");
      assert.equal(inputs[0]?.actorId, f.agent.id);
      assert.match(inputs[0]?.content ?? "", /Antwort auf die Frage: .*\nAntwort: src\/Demo\.sln/);
    } finally {
      f.journal.close();
    }
  });
  await t.test("stop", async () => {
    const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"]));
    const startup = f.create();
    try {
      await f.start(null, startup);
      const question = f.pendingQuestion()!;
      await startup.lifecycle.stopSession!({ runId: f.runId, signal: new AbortController().signal });
      await settled();
      assert.equal(f.runtime.view(f.runId).actions.find((action) => action.id === question.id)?.status, "dismissed");
      assert.deepEqual(f.calls.map((call) => call.operation), ["roslyn_solutions"]);
    } finally {
      f.journal.close();
    }
  });
});

test("an instance opened elsewhere withdraws the pending start question without loading or forwarding", async (t) => {
  await t.test("while the start waits for the answer", async () => {
    const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"]));
    const startup = f.create();
    try {
      await f.start(null, startup);
      const question = f.pendingQuestion()!;
      startup.opened(f.runId);
      await settled();
      assert.equal(f.runtime.view(f.runId).actions.find((action) => action.id === question.id)?.status, "dismissed");
      assert.deepEqual(f.calls.map((call) => call.operation), ["roslyn_solutions"]);
      assert.equal(f.runtime.view(f.runId).inputs.length, 0);
      startup.opened(f.runId);
      assert.equal(f.runtime.view(f.runId).actions.length, 1, "a second open changes nothing");
    } finally {
      f.journal.close();
    }
  });
  await t.test("after a restart without a waiting call", async () => {
    const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"]));
    try {
      await f.start(null);
      const question = f.pendingQuestion()!;
      const restarted = new RuntimeAskService();
      restarted.bind(f.runtime);
      createSolutionOnStart({
        pluginId: "ragents.lsp-roslyn",
        adapterId: "roslyn",
        sandbox: () => { throw new Error("nicht gefragt"); },
        runtime: () => f.runtime,
        ask: () => restarted,
      }).opened(f.runId);
      await settled();
      assert.equal(f.runtime.view(f.runId).actions.find((action) => action.id === question.id)?.status, "dismissed");
      assert.deepEqual(f.calls.map((call) => call.operation), ["roslyn_solutions"]);
      assert.equal(f.runtime.view(f.runId).inputs.length, 0, "neither service hands the withdrawal to the coordinator");
    } finally {
      f.journal.close();
    }
  });
  await t.test("an answered question stays answered", async () => {
    const f = fixture(listing(["src/Demo.sln", "tools/Acme.slnx"]));
    const startup = f.create();
    try {
      await f.start(null, startup);
      f.service.answer(f.runId, f.pendingQuestion()!.id, { answer: "src/Demo.sln" });
      startup.opened(f.runId);
      await settled();
      assert.equal(f.runtime.view(f.runId).actions[0]?.status, "approved");
      assert.deepEqual(f.calls.at(-1), { operation: "roslyn_open", input: { root: "src/Demo.sln", ifNoneOpen: false } });
    } finally {
      f.journal.close();
    }
  });
});

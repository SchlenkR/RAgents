import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { manualExecution, setupRun, textStep } from "../../../packages/ragents/tests/support.ts";
import { WATCH_PLUGIN_ID } from "../../../plugins/ragents.watch/contract.ts";
import { compileWatchCondition } from "../../../plugins/ragents.watch/server/condition.ts";
import { WatchService } from "../../../plugins/ragents.watch/server/service.ts";

const turnEnded = "return now.source.completedTurns > before.source.completedTurns ? \"Builder finished a turn\" : undefined;";
const reportsDone = "return now.source.lastOutput?.includes(\"DONE\") ? \"Builder reports done\" : undefined;";

const fixture = (t: TestContext) => {
  const setup = setupRun();
  const { runtime } = setup;
  const runId = setup.view.id;
  const owner = setup.view.ownerId;
  const spawn = (handle: string) => {
    const actor = runtime.spawnAgent({ actorId: owner, commandId: `spawn-${handle}` }, runId, {
      handle, displayName: handle, prompt: "", execution: manualExecution(), grants: [], toolNames: [],
    }).actors.find((entry) => entry.handle === handle);
    assert.ok(actor);
    return actor;
  };
  const builder = spawn("builder");
  const lead = spawn("lead");
  const failures: unknown[] = [];
  const service = new WatchService({
    runtime: () => runtime,
    compile: (condition, signal) => compileWatchCondition(condition, signal),
    observe: async () => null,
    operationExists: () => false,
    debounceMs: 0,
    log: (message, error) => failures.push([message, error]),
  });
  t.after(() => {
    service.shutdown();
    setup.journal.close();
  });
  let commands = 0;
  const next = (name: string) => `${name}-${++commands}`;
  const enqueue = (actorId: string, content: string) =>
    runtime.enqueueInput({ actorId: owner, commandId: next("input") }, runId, { actorId, content });
  const start = (actorId: string) => {
    const input = runtime.view(runId).inputs.find((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending");
    assert.ok(input, `No pending input for ${actorId}`);
    const actor = runtime.startTurn({ actorId, commandId: next("turn") }, runId, actorId, input.id).actors.find((entry) => entry.id === actorId);
    assert.ok(actor && actor.kind !== "human" && actor.lifecycle.kind === "running");
    return actor.lifecycle.turnId;
  };
  const finish = (actorId: string, turnId: string, text?: string) => {
    if (text !== undefined)
      runtime.completeModelStep({ actorId, commandId: next("step"), turnId }, runId, actorId, { turnId, step: textStep(text) });
    runtime.finishTurn({ actorId, commandId: next("finish"), turnId }, runId, actorId, { turnId, outcome: "completed" });
  };
  const work = (actorId: string, text: string) => {
    enqueue(actorId, "Go on.");
    finish(actorId, start(actorId), text);
  };
  const unrelatedEvent = () => runtime.retitleRun({ actorId: owner, commandId: next("title") }, runId, `Title ${commands}`);
  const wakesOf = (actorId: string) => runtime.view(runId).inputs
    .filter((input) => input.actorId === actorId && input.content.startsWith("The watch wakes you:"));
  const stored = () => (runtime.view(runId).pluginStates.find((entry) => entry.pluginId === WATCH_PLUGIN_ID)?.state as
    { watches: Array<{ baseline?: { source: { completedTurns: number } }; wakes: number; history: Array<{ wake: boolean }> }> } | undefined)?.watches[0];
  const settled = async () => {
    let seen = -1;
    while (seen !== runtime.events(runId).length) {
      seen = runtime.events(runId).length;
      for (let round = 0; round < 3; round += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(failures, []);
  };
  const watch = async (condition: string) => {
    const created = await service.create(runId, lead.id, { source: "@builder", condition });
    await settled();
    return created;
  };
  return { runtime, runId, owner, builder, lead, service, enqueue, start, finish, work, unrelatedEvent, wakesOf, stored, settled, watch };
};

test("a watch stores the first observation as its baseline and does not wake without a change", async (t) => {
  const f = fixture(t);
  await f.watch(turnEnded);

  assert.equal(f.stored()?.baseline?.source.completedTurns, 0);
  f.unrelatedEvent();
  await f.settled();

  assert.deepEqual(f.wakesOf(f.lead.id), []);
  assert.equal(f.service.list(f.runId)[0]?.lastVerdict, undefined);
});

test("a watch wakes its target once when the condition holds for a change, and not again for the same state", async (t) => {
  const f = fixture(t);
  await f.watch(turnEnded);

  f.work(f.builder.id, "Built.");
  await f.settled();

  const wakes = f.wakesOf(f.lead.id);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0]?.presentation, "background");
  assert.match(wakes[0]!.content, /^The watch wakes you: Builder finished a turn\n/);
  assert.match(wakes[0]!.content, /source\.completedTurns: 0 -> 1/);
  assert.equal(f.service.list(f.runId)[0]?.wakes, 1);
  assert.equal(f.stored()?.baseline?.source.completedTurns, 1);

  f.finish(f.lead.id, f.start(f.lead.id));
  f.unrelatedEvent();
  await f.settled();

  assert.equal(f.wakesOf(f.lead.id).length, 1);
  assert.equal(f.service.list(f.runId)[0]?.wakes, 1);
});

test("a change that does not meet the condition is judged once, and the next one is judged against the same baseline", async (t) => {
  const f = fixture(t);
  await f.watch(reportsDone);

  f.work(f.builder.id, "Still working.");
  await f.settled();
  f.unrelatedEvent();
  await f.settled();

  assert.deepEqual(f.wakesOf(f.lead.id), []);
  assert.deepEqual(f.stored()?.history.map((verdict) => verdict.wake), [false]);

  f.work(f.builder.id, "DONE.");
  await f.settled();

  const wakes = f.wakesOf(f.lead.id);
  assert.equal(wakes.length, 1);
  assert.match(wakes[0]!.content, /source\.completedTurns: 0 -> 2/);
  assert.deepEqual(f.stored()?.history.map((verdict) => verdict.wake), [false, true]);
});

test("a watch does not wake a target with a running turn or a waiting input; the wake follows once it is free", async (t) => {
  const f = fixture(t);
  await f.watch(turnEnded);
  f.enqueue(f.lead.id, "First task.");
  const leadTurn = f.start(f.lead.id);
  f.enqueue(f.lead.id, "Second task.");

  f.work(f.builder.id, "Built.");
  await f.settled();
  assert.deepEqual(f.wakesOf(f.lead.id), []);

  f.finish(f.lead.id, leadTurn);
  await f.settled();
  assert.deepEqual(f.wakesOf(f.lead.id), []);
  assert.equal(f.service.list(f.runId)[0]?.lastVerdict, undefined);

  f.finish(f.lead.id, f.start(f.lead.id));
  await f.settled();

  const wakes = f.wakesOf(f.lead.id);
  assert.equal(wakes.length, 1);
  assert.match(wakes[0]!.content, /source\.completedTurns: 0 -> 1/);
});

const askAsLead = (f: ReturnType<typeof fixture>) => {
  f.enqueue(f.lead.id, "Plan the work.");
  const turnId = f.start(f.lead.id);
  const proposed = f.runtime.proposeAction({ actorId: f.lead.id, commandId: "lead-question", turnId }, f.runId, {
    owner: "test.questions", title: "Which variant?", input: { label: "Answer", placeholder: null, required: true },
  });
  f.finish(f.lead.id, turnId);
  const question = proposed.actions.find((action) => action.askedBy === f.lead.id && action.status === "pending");
  assert.ok(question);
  return question.id;
};

test("a watch does not wake a target with its own open question, and wakes after the answer is processed without a further change", async (t) => {
  const f = fixture(t);
  await f.watch(turnEnded);
  const questionId = askAsLead(f);

  f.work(f.builder.id, "Built.");
  await f.settled();
  assert.deepEqual(f.wakesOf(f.lead.id), []);
  assert.equal(f.service.list(f.runId)[0]?.lastVerdict, undefined);

  f.runtime.resolveAction({ actorId: f.owner, commandId: "answer" }, f.runId, questionId, { decision: "approved", result: "Variant B" });
  f.enqueue(f.lead.id, "Answer to your question: Which variant?\nAnswer: Variant B");
  await f.settled();
  assert.deepEqual(f.wakesOf(f.lead.id), []);

  f.finish(f.lead.id, f.start(f.lead.id));
  await f.settled();

  const wakes = f.wakesOf(f.lead.id);
  assert.equal(wakes.length, 1);
  assert.match(wakes[0]!.content, /source\.completedTurns: 0 -> 1/);
});

test("a question withdrawn without an answer input releases the held wake with its resolution", async (t) => {
  const f = fixture(t);
  await f.watch(turnEnded);
  const questionId = askAsLead(f);

  f.work(f.builder.id, "Built.");
  await f.settled();
  assert.deepEqual(f.wakesOf(f.lead.id), []);

  f.runtime.resolveAction({ actorId: f.owner, commandId: "withdraw" }, f.runId, questionId, { decision: "dismissed", result: null });
  await f.settled();

  assert.equal(f.wakesOf(f.lead.id).length, 1);
});

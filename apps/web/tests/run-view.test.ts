import assert from "node:assert/strict";
import test from "node:test";

import {
  isPendingRunActorInput,
  runArtifactContentUrl,
  runTurnOutputs,
  runViewFrom,
  type RunActorInput,
  type RunTurn,
} from "../src/run-view.ts";

const view = (overrides: Record<string, unknown> = {}) => ({
  id: "run-1",
  revision: 3,
  title: "Run",
  ownerId: "actor-1",
  primaryActorId: "actor-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  forkedFrom: null,
  actors: [],
  inputs: [],
  turns: [],
  subscriptions: [],
  pluginStates: [],
  actions: [],
  artifacts: [],
  ...overrides,
});

const input = (overrides: Partial<RunActorInput> = {}): RunActorInput => ({
  id: "input-1",
  actorId: "actor-1",
  content: "Hello",
  artifactIds: [],
  sourceEventIds: [],
  subscriptionId: null,
  enqueuedBy: "actor-1",
  enqueuedAt: "2026-01-01T00:00:00.000Z",
  sequence: 1,
  lifecycle: { kind: "pending" },
  ...overrides,
});

const turn = (overrides: Partial<RunTurn> = {}): RunTurn => ({
  id: "turn-1",
  actorId: "actor-1",
  inputId: "input-1",
  status: "completed",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:02.000Z",
  reason: null,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
  ...overrides,
});

test("a complete run view is passed through unchanged", () => {
  const value = view();

  assert.equal(runViewFrom(value), value);
});

test("a missing primary actor is allowed, a wrong type is not", () => {
  assert.ok(runViewFrom(view({ primaryActorId: null })));
  assert.equal(runViewFrom(view({ primaryActorId: 7 })), undefined);
});

test("if one of the lists is missing, the view is invalid", () => {
  const lists = ["actors", "inputs", "turns", "subscriptions", "pluginStates", "actions", "artifacts"];

  for (const list of lists) {
    assert.equal(runViewFrom(view({ [list]: undefined })), undefined, list);
    assert.equal(runViewFrom(view({ [list]: {} })), undefined, list);
  }
});

test("what is not a run view yields none", () => {
  assert.equal(runViewFrom(undefined), undefined);
  assert.equal(runViewFrom(null), undefined);
  assert.equal(runViewFrom("run-1"), undefined);
  assert.equal(runViewFrom(view({ id: 1 })), undefined);
  assert.equal(runViewFrom(view({ ownerId: undefined })), undefined);
});

test("an input is pending only without a turn and without being discarded", () => {
  assert.equal(isPendingRunActorInput(input()), true);
  assert.equal(isPendingRunActorInput(input({ lifecycle: { kind: "claimed", turnId: "turn-1", steered: false } })), false);
  assert.equal(
    isPendingRunActorInput(input({
      lifecycle: { kind: "discarded", at: "2026-01-01T00:00:01.000Z", reason: "Over" },
    })),
    false,
  );
});

test("model responses of a turn come sorted by sequence", () => {
  const outputs = runTurnOutputs(turn({
    outputs: [
      { text: "second", sequence: 9, occurredAt: "2026-01-01T00:00:02.000Z" },
      { text: "first", sequence: 4, occurredAt: "2026-01-01T00:00:01.000Z" },
    ],
  }));

  assert.deepEqual(outputs.map((output) => output.text), ["first", "second"]);
});

test("a turn without or with an unusable response field yields no responses", () => {
  assert.deepEqual(runTurnOutputs(turn()), []);
  assert.deepEqual(runTurnOutputs(turn({ outputs: undefined })), []);
  assert.deepEqual(runTurnOutputs({ ...turn(), outputs: "broken" } as unknown as RunTurn), []);
  assert.deepEqual(runTurnOutputs({ ...turn(), outputs: [{ text: 1 }] } as unknown as RunTurn), []);
});

test("a run view stays valid even when turns carry no responses", () => {
  assert.ok(runViewFrom(view({ turns: [turn()] })));
  assert.ok(runViewFrom(view({ turns: [turn({ outputs: [] })] })));
});

test("identifiers in delivery paths are encoded", () => {
  assert.equal(runArtifactContentUrl("run/1", "a b"), "/files/runs/run%2F1/artifacts/a%20b");
});

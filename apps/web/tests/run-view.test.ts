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
  content: "Hallo",
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

test("eine vollständige Run-Ansicht wird unverändert durchgereicht", () => {
  const value = view();

  assert.equal(runViewFrom(value), value);
});

test("ein fehlender primärer Actor ist erlaubt, ein falscher Typ nicht", () => {
  assert.ok(runViewFrom(view({ primaryActorId: null })));
  assert.equal(runViewFrom(view({ primaryActorId: 7 })), undefined);
});

test("fehlt eine der Listen, ist die Ansicht ungültig", () => {
  const lists = ["actors", "inputs", "turns", "subscriptions", "pluginStates", "actions", "artifacts"];

  for (const list of lists) {
    assert.equal(runViewFrom(view({ [list]: undefined })), undefined, list);
    assert.equal(runViewFrom(view({ [list]: {} })), undefined, list);
  }
});

test("was keine Run-Ansicht ist, ergibt keine", () => {
  assert.equal(runViewFrom(undefined), undefined);
  assert.equal(runViewFrom(null), undefined);
  assert.equal(runViewFrom("run-1"), undefined);
  assert.equal(runViewFrom(view({ id: 1 })), undefined);
  assert.equal(runViewFrom(view({ ownerId: undefined })), undefined);
});

test("offen ist eine Eingabe nur ohne Turn und ohne Verwurf", () => {
  assert.equal(isPendingRunActorInput(input()), true);
  assert.equal(isPendingRunActorInput(input({ lifecycle: { kind: "claimed", turnId: "turn-1", steered: false } })), false);
  assert.equal(
    isPendingRunActorInput(input({
      lifecycle: { kind: "discarded", at: "2026-01-01T00:00:01.000Z", reason: "Vorbei" },
    })),
    false,
  );
});

test("Modellantworten eines Turns kommen nach sequence sortiert", () => {
  const outputs = runTurnOutputs(turn({
    outputs: [
      { text: "zweitens", sequence: 9, occurredAt: "2026-01-01T00:00:02.000Z" },
      { text: "erstens", sequence: 4, occurredAt: "2026-01-01T00:00:01.000Z" },
    ],
  }));

  assert.deepEqual(outputs.map((output) => output.text), ["erstens", "zweitens"]);
});

test("ein Turn ohne oder mit unbrauchbarem Antwortfeld ergibt keine Antworten", () => {
  assert.deepEqual(runTurnOutputs(turn()), []);
  assert.deepEqual(runTurnOutputs(turn({ outputs: undefined })), []);
  assert.deepEqual(runTurnOutputs({ ...turn(), outputs: "kaputt" } as unknown as RunTurn), []);
  assert.deepEqual(runTurnOutputs({ ...turn(), outputs: [{ text: 1 }] } as unknown as RunTurn), []);
});

test("eine Run-Ansicht bleibt gültig, auch wenn Turns keine Antworten tragen", () => {
  assert.ok(runViewFrom(view({ turns: [turn()] })));
  assert.ok(runViewFrom(view({ turns: [turn({ outputs: [] })] })));
});

test("Kennungen in Auslieferungspfaden werden kodiert", () => {
  assert.equal(runArtifactContentUrl("run/1", "a b"), "/files/runs/run%2F1/artifacts/a%20b");
});

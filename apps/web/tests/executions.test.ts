import assert from "node:assert/strict";
import test from "node:test";
import type { EventPayloads, JournalEvent } from "../../../packages/ragents/src/domain/events.ts";
import { executionDuration, executionEventsFrom, filterExecutions, projectExecutions } from "../../../plugins/ragents.orchestration/web/executions.ts";
import type { RunTurn, RunView } from "../src/run-view.ts";

const at = (sequence: number) => new Date(Date.UTC(2026, 8, 12, 12, 0, sequence)).toISOString();
const event = <T extends keyof EventPayloads>(sequence: number, type: T, payload: EventPayloads[T], actorId = "builder"): JournalEvent => ({
  eventId: `event-${actorId}-${sequence}`, runId: "run", sequence, schemaVersion: 3, occurredAt: at(sequence), actorId,
  commandId: `command-${sequence}`, correlationId: null, causationId: null, type, payload,
}) as JournalEvent;

const started = (sequence: number, input: EventPayloads["tool.call.started"]["input"], turnId = "turn", actorId = "builder", toolCallId = "eval") => event(sequence, "tool.call.started", { turnId, toolCallId, name: "typescript_eval", input }, actorId);
const complete = (sequence: number, output: EventPayloads["tool.call.completed"]["output"], turnId = "turn", actorId = "builder", toolCallId = "eval") => event(sequence, "tool.call.completed", { turnId, toolCallId, name: "typescript_eval", output }, actorId);
const view = (turns: RunTurn[] = []): Pick<RunView, "id" | "actors" | "turns"> => ({
  id: "run", actors: [{ id: "builder", handle: "builder", displayName: "Aufbau", kind: "agent", grants: [], createdAt: at(0) }], turns,
});
const turn = (overrides: Partial<RunTurn> = {}): RunTurn => ({
  id: "turn", actorId: "builder", inputId: "input", status: "running", startedAt: at(0), finishedAt: null, reason: null,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, ...overrides,
});

test("inline executions include original code, JSON results and logs without mutating the journal", () => {
  const events = [started(1, { code: "context.log('Hallo'); return { value: 3 };" }), complete(3, { result: { value: 3 }, logs: ["Hallo"] })];
  const original = structuredClone(events);
  const [execution] = projectExecutions(events, view());
  assert.equal(execution?.actorName, "Aufbau");
  assert.equal(execution?.status, "completed");
  assert.equal(execution?.code, "context.log('Hallo'); return { value: 3 };");
  assert.equal(execution?.path, null);
  assert.deepEqual(execution?.result, { value: 3 });
  assert.deepEqual(execution?.logs, ["Hallo"]);
  assert.equal(executionDuration(execution!, Date.parse(at(8))), "2 s");
  assert.deepEqual(events, original);
});

test("path calls retain their source snapshot even when compilation fails", () => {
  const [execution] = projectExecutions([
    started(1, { path: "@actors/example/setup.ts" }),
    event(2, "tool.call.source", { turnId: "turn", toolCallId: "eval", path: "@actors/example/setup.ts", code: "const total: number = 'invalid';" }),
    event(3, "tool.call.failed", { turnId: "turn", toolCallId: "eval", name: "typescript_eval", error: "TypeScript-Prüfung fehlgeschlagen." }),
  ], view());
  assert.equal(execution?.status, "failed");
  assert.equal(execution?.code, "const total: number = 'invalid';");
  assert.equal(execution?.path, "@actors/example/setup.ts");
  assert.equal(execution?.error, "TypeScript-Prüfung fehlgeschlagen.");
});

test("old path-only calls remain explicitly without historical source", () => {
  const [execution] = projectExecutions([started(1, { path: "setup.ts" }), complete(2, { result: null, logs: [] })]);
  assert.equal(execution?.code, null);
  assert.equal(execution?.path, "setup.ts");
  assert.equal(execution?.result, null);
});

test("all actors and repeated tool-call IDs across turns remain separate and newest comes first", () => {
  const first = started(1, { code: "return 1;" });
  const events = [
    first, first,
    complete(2, { result: 1, logs: [] }),
    started(3, { code: "return 2;" }, "other-turn"),
    started(4, { code: "return 3;" }, "turn", "another-actor"),
    complete(5, { result: 3, logs: [] }, "turn", "another-actor"),
    event(6, "tool.call.started", { turnId: "turn", toolCallId: "lookup", name: "actor_list", input: {} }),
    complete(7, { result: 2, logs: [] }, "other-turn"),
  ];
  const executions = projectExecutions(events.reverse(), view());
  assert.equal(executions.length, 3);
  assert.equal(new Set(executions.map((execution) => execution.key)).size, 3);
  assert.deepEqual(executions.map((execution) => execution.result), [3, 2, 1]);
  assert.deepEqual(executions.map((execution) => execution.sequence), [4, 3, 1]);
});

test("the composite execution key cannot collide when identifiers contain separators", () => {
  const executions = projectExecutions([
    started(1, { code: "return 1;" }, "b:c", "a", "d"),
    started(2, { code: "return 2;" }, "c", "a:b", "d"),
  ]);
  assert.equal(new Set(executions.map((execution) => execution.key)).size, 2);
});

test("turn interruption closes pending evaluations and preserves the reason", () => {
  const [execution] = projectExecutions([
    started(1, { code: "await new Promise(() => {});" }),
    event(6, "turn.interrupted", { turnId: "turn", reason: "Vom Benutzer gestoppt." }),
  ], view());
  assert.equal(execution?.status, "interrupted");
  assert.equal(execution?.finishedAt, at(6));
  assert.equal(execution?.error, "Vom Benutzer gestoppt.");
});

test("current turn-call projection and turn end close calls without terminal tool events", () => {
  const current = turn({ toolCalls: [{ id: "eval", name: "typescript_eval", status: "interrupted", startedAt: at(1), finishedAt: at(4) }], reason: "Unterbrochen." });
  assert.equal(projectExecutions([started(1, { code: "return 0;" })], view([current]))[0]?.status, "interrupted");
  const finished = turn({ status: "failed", finishedAt: at(5), reason: "Turn fehlgeschlagen." });
  const [execution] = projectExecutions([started(1, { code: "return 0;" })], view([finished]));
  assert.equal(execution?.status, "interrupted");
  assert.equal(execution?.finishedAt, at(5));
  assert.equal(execution?.error, "Turn fehlgeschlagen.");
});

test("a completed evaluation remains completed when its surrounding turn fails later", () => {
  const [execution] = projectExecutions([
    started(1, { code: "return false;" }), complete(2, { result: false, logs: [] }),
    event(3, "turn.finished", { turnId: "turn", outcome: "failed", reason: "Späterer Fehler." }),
  ], view([turn({ status: "failed", finishedAt: at(3), reason: "Späterer Fehler." })]));
  assert.equal(execution?.status, "completed");
  assert.equal(execution?.result, false);
  assert.equal(execution?.error, null);
});

test("search includes actor, code, path, logs, errors and JSON results and combines with status", () => {
  const executions = projectExecutions([
    started(1, { path: "setup.ts" }),
    event(2, "tool.call.source", { turnId: "turn", toolCallId: "eval", path: "setup.ts", code: "return { count: 42 };" }),
    complete(3, { result: { count: 42 }, logs: ["Bereit"] }),
    started(4, { code: "throw new Error('Kaputt');" }, "failed-turn"),
    event(5, "tool.call.failed", { turnId: "failed-turn", toolCallId: "eval", name: "typescript_eval", error: "Kaputt" }),
  ], view());
  for (const query of ["setup.ts", " COUNT ", "42", "Bereit"]) assert.equal(filterExecutions(executions, query, "completed").length, 1);
  assert.equal(filterExecutions(executions, "Aufbau", "all").length, 2);
  assert.equal(filterExecutions(executions, "Kaputt", "failed").length, 1);
  assert.equal(filterExecutions(executions, "Kaputt", "completed").length, 0);
});

test("journal responses reject malformed source and foreign runs", () => {
  const valid = [started(1, { code: "return 1;" })];
  assert.deepEqual(executionEventsFrom(valid, "run"), valid);
  assert.throws(() => executionEventsFrom(valid, "another-run"), /kein gültiges Journal/);
  const source = event(2, "tool.call.source", { turnId: "turn", toolCallId: "eval", code: "return 1;", path: null });
  for (const invalid of [null, {}, [{ ...source, payload: { ...source.payload, code: 4 } }], [{ ...source, occurredAt: "invalid" }]]) {
    assert.throws(() => executionEventsFrom(invalid, "run"), /kein gültiges Journal/);
  }
  assert.deepEqual(projectExecutions(valid, { ...view(), id: "another-run" }), []);
});

test("running durations update while completed durations stay fixed", () => {
  assert.equal(executionDuration({ startedAt: at(1), finishedAt: null }, Date.parse(at(3))), "2 s");
  assert.equal(executionDuration({ startedAt: at(1), finishedAt: at(4) }, Date.parse(at(100))), "3 s");
  assert.equal(executionDuration({ startedAt: at(1), finishedAt: null }, Date.parse(at(62))), "1 min 1 s");
});

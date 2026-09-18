import assert from "node:assert/strict";
import test from "node:test";
import { journalLines, usageByActor } from "./run-driver.ts";

const records = [
  { command: { actorId: "agent_coordinator" }, events: [
    { sequence: 1, type: "model.output.completed", payload: { text: "Hallo\nRonald", usage: { inputTokens: 100, cacheReadTokens: 50, outputTokens: 10, costUsd: 0.001 } } },
    { sequence: 2, type: "tool.call.started", payload: { name: "typescript_eval", input: { code: "return 1;" } } },
    { sequence: 3, type: "tool.call.failed", payload: { name: "typescript_eval", error: "kaputt" } },
  ] },
  { command: { actorId: "agent_coordinator" }, events: [
    { sequence: 4, type: "model.output.completed", payload: { text: "Fertig", usage: { inputTokens: 200, cacheReadTokens: 0, outputTokens: 20, costUsd: 0.002 } } },
  ] },
  { command: { actorId: "human_ronald" }, events: [
    { sequence: 5, type: "actor.input.enqueued", payload: { actorId: "agent_coordinator", text: "Bitte weiter" } },
  ] },
];

test("usageByActor summiert Modellaufrufe je Actor", () => {
  const usage = usageByActor(records);
  assert.deepEqual(usage.get("agent_coordinator"), { calls: 2, inputTokens: 300, cacheReadTokens: 50, outputTokens: 30, costUsd: 0.003 });
  assert.equal(usage.has("human_ronald"), false);
});

test("journalLines filtert nach Modus und Sequenz", () => {
  assert.deepEqual(journalLines(records, "chat", 0), [
    "[1] agent_coordina: Hallo Ronald",
    "[3] tool.call.failed agent_coordina: {\"name\":\"typescript_eval\",\"error\":\"kaputt\"}",
    "[4] agent_coordina: Fertig",
    "[5] INPUT -> agent_coordina: Bitte weiter",
    "-- letzte Sequenz: 5",
  ]);
  assert.deepEqual(journalLines(records, "tools", 3), [
    "[3] failed agent_coordina typescript_eval: \"kaputt\"",
    "-- letzte Sequenz: 5",
  ]);
  assert.equal(journalLines(records, "all", 0).length, 6);
});

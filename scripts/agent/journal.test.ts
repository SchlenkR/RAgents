import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { JournalReader, journalLines, readJournal, usageByActor, type JournalEvent } from "./journal.ts";

const record = (actorId: string, events: readonly { sequence: number; type: string; payload?: unknown }[], occurredAt = "2026-09-21T10:00:00.000Z"): string =>
  `${JSON.stringify({ runId: "r", command: { actorId }, occurredAt, events })}\n`;

const events: readonly JournalEvent[] = [
  ...[
    { sequence: 1, type: "model.output.completed", payload: { text: "Hello\nAlice", usage: { inputTokens: 100, cacheReadTokens: 50, outputTokens: 10, costUsd: 0.001 } } },
    { sequence: 2, type: "tool.call.started", payload: { name: "typescript_eval", input: { code: "return 1;" } } },
    { sequence: 3, type: "tool.call.failed", payload: { name: "typescript_eval", error: "broken" } },
    { sequence: 4, type: "model.output.completed", payload: { text: "Done", usage: { inputTokens: 200, cacheReadTokens: 0, outputTokens: 20, costUsd: 0.002 } } },
  ].map((entry) => ({ ...entry, actorId: "agent_coordinator", occurredAt: "2026-09-21T10:00:00.000Z" })),
  { sequence: 5, type: "actor.input.enqueued", actorId: "human_alice", occurredAt: "2026-09-21T10:00:01.000Z", payload: { actorId: "agent_coordinator", subscriptionId: null, content: "Please continue" } },
  { sequence: 6, type: "model.step.completed", actorId: "agent_coordinator", occurredAt: "2026-09-21T10:00:02.000Z", payload: { usage: { input: 5, output: 1 } } },
  { sequence: 7, type: "context.compacted", actorId: "agent_coordinator", occurredAt: "2026-09-21T10:00:03.000Z", payload: { tokensBefore: 1200, threshold: { tokens: 160000, source: "model" } } },
  { sequence: 8, type: "actor.input.enqueued", actorId: "agent_coordinator", occurredAt: "2026-09-21T10:00:04.000Z", payload: { actorId: "agent_watcher", subscriptionId: "sub-1", sourceEventIds: ["event-4"] } },
];

test("usageByActor sums model calls per actor", () => {
  const usage = usageByActor(events);
  assert.deepEqual(usage.get("agent_coordinator"), { calls: 2, inputTokens: 300, cacheReadTokens: 50, outputTokens: 30, costUsd: 0.003 });
  assert.equal(usage.has("human_alice"), false);
});

test("journalLines filters by mode and sequence", () => {
  assert.deepEqual(journalLines(events, "chat", 0), [
    "[1] agent_coordina: Hello Alice",
    "[3] tool.call.failed agent_coordina: {\"name\":\"typescript_eval\",\"error\":\"broken\"}",
    "[4] agent_coordina: Done",
    "[5] INPUT -> agent_coordina: Please continue",
    "[7] CONTEXT COMPACTED agent_coordina: about 1200 tokens summarized (threshold 160000 from model)",
    "[8] INPUT -> agent_watcher: [event event-4]",
    "-- last sequence: 8",
  ]);
  assert.deepEqual(journalLines(events, "tools", 3), [
    "[3] failed agent_coordina typescript_eval: \"broken\"",
    "-- last sequence: 8",
  ]);
  assert.equal(journalLines(events, "all", 0).length, 8);
});

test("the reader returns only what was added since the last call", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-journal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runId = "run-1";
  mkdirSync(path.join(directory, "runs", runId), { recursive: true });
  const file = path.join(directory, "runs", runId, "journal.jsonl");
  await writeFile(file, record("human_alice", [{ sequence: 1, type: "run.created", payload: {} }]));

  const reader = new JournalReader(directory, runId);
  assert.deepEqual(reader.next().map((event) => event.sequence), [1]);
  assert.deepEqual(reader.next(), []);

  await appendFile(file, record("agent_coordinator", [{ sequence: 2, type: "turn.started", payload: { turnId: "t1" } }], "2026-09-21T10:00:05.000Z"));
  const added = reader.next();
  assert.deepEqual(added.map((event) => [event.sequence, event.actorId, event.occurredAt]), [[2, "agent_coordinator", "2026-09-21T10:00:05.000Z"]]);
  assert.deepEqual(reader.next(), []);
  assert.equal(readJournal(directory, runId).length, 2);
});

test("a missing journal and an unclean run id are errors", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-journal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.throws(() => readJournal(directory, "run-2"), /Journal missing/);
  assert.throws(() => readJournal(directory, "../escape"), /Invalid run id/);
});

import assert from "node:assert/strict";
import test from "node:test";

process.env.PRODUCT_ID ??= "ragents";
process.env.PRODUCT_TITLE ??= "RAgents";

const { layout } = await import("../src/layout.ts");

test("agent chat paths reject unsafe and non-canonical IDs", () => {
  assert.match(layout.agentChatDir("r".repeat(64), "a".repeat(64)), /sessions\/r+\/chat\/a+$/);

  for (const runId of ["../../run", "run.", "con", "r".repeat(65)]) {
    assert.throws(() => layout.agentChatDir(runId, "agent"), /Run ID must be a lowercase portable ID/);
  }
  for (const actorId of ["../../agent", "Agent", "agent.", "com1", "a".repeat(65)]) {
    assert.throws(() => layout.agentChatDir("run", actorId), /Actor ID must be a lowercase portable ID/);
  }
});

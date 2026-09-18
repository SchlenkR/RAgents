import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { allGrants, setupRun } from "../../../packages/ragents/tests/support.ts";
import { compactTranscript, createTranscriptTool } from "../../../plugins/ragents.transcript/server/transcript.ts";

const fixture = (t: TestContext) => {
  const setup = setupRun({ grants: allGrants() });
  t.after(() => setup.journal.close());
  const { runtime, agent } = setup;
  const runId = setup.view.id;
  const owner = setup.view.ownerId;
  const queued = runtime.enqueueInput({ actorId: owner, commandId: "input" }, runId, { actorId: agent.id, content: "Bitte  prüfen\n\nund melden" });
  const turnId = runtime.startTurn({ actorId: agent.id, commandId: "start" }, runId, agent.id, queued.inputs.at(-1)!.id).turns.at(-1)!.id;
  const command = (id: string) => ({ actorId: agent.id, turnId, commandId: id });
  runtime.appendModelReasoning(command("reasoning"), runId, agent.id, { turnId, text: "Geheimes Nachdenken" });
  runtime.startToolCall(command("read-start"), runId, agent.id, { turnId, toolCallId: "c1", name: "read", input: { path: "a.ts" } });
  runtime.completeToolCall(command("read-done"), runId, agent.id, { turnId, toolCallId: "c1", name: "read", output: "x".repeat(1000) });
  runtime.startToolCall(command("bash-start"), runId, agent.id, { turnId, toolCallId: "c2", name: "bash", input: { command: "ls" } });
  runtime.failToolCall(command("bash-failed"), runId, agent.id, { turnId, toolCallId: "c2", name: "bash", error: "nicht erlaubt" });
  runtime.appendModelOutput(command("output"), runId, agent.id, { turnId, text: "Fertig geprüft." });
  runtime.finishTurn(command("finish"), runId, agent.id, { turnId, outcome: "completed" });
  return { runtime, runId, agent };
};

test("the compact transcript keeps inputs, answers and one-line tool calls and drops reasoning", (t) => {
  const f = fixture(t);
  const transcript = compactTranscript(f.runtime.events(f.runId), f.agent.id);
  const lines = transcript.text.split("\n");
  assert.deepEqual([lines[0], lines[1], lines[3], lines[4], lines[5]], ["> Bitte prüfen und melden", '[read] {"path":"a.ts"}', '[bash] {"command":"ls"}', "  -> Fehler: nicht erlaubt", "Fertig geprüft."]);
  assert.match(lines[2]!, /^ {2}-> x+\.\.\.$/);
  assert.equal(lines[2]!.length, 305);
  assert.equal(lines.length, 6);
  assert.equal(transcript.lines, 6);
  assert.equal(transcript.truncated, false);
  assert.doesNotMatch(transcript.text, /Geheimes/);
  assert.equal(compactTranscript(f.runtime.events(f.runId), "nobody").text, "");
});

test("a tight budget drops the oldest lines first and says so", (t) => {
  const f = fixture(t);
  const transcript = compactTranscript(f.runtime.events(f.runId), f.agent.id, 400);
  assert.equal(transcript.truncated, true);
  assert.ok(transcript.text.length <= 400);
  assert.match(transcript.text, /^\[\.\.\. 3 frühere Zeilen ausgelassen\]\n\[bash\]/);
  assert.match(transcript.text, /Fertig geprüft\.$/);
  assert.equal(transcript.lines, 3);
});

test("the run function resolves handles and ids and refuses unknown actors", async (t) => {
  const f = fixture(t);
  const tool = createTranscriptTool(() => f.runtime);
  const scope = { caller: { runId: f.runId, actorId: f.agent.id } } as never;
  const byHandle = await tool.run(scope, "call-1", { actor: "@worker" }) as { actorId: string; handle: string; text: string; truncated: boolean };
  assert.equal(byHandle.actorId, f.agent.id);
  assert.equal(byHandle.handle, "worker");
  assert.match(byHandle.text, /Fertig geprüft\./);
  const byId = await tool.run(scope, "call-2", { actor: f.agent.id, maxChars: 400 }) as { text: string; truncated: boolean };
  assert.equal(byId.truncated, true);
  assert.equal(byId.text, compactTranscript(f.runtime.events(f.runId), f.agent.id, 400).text);
  await assert.rejects(Promise.resolve().then(() => tool.run(scope, "call-3", { actor: "nobody" })), /Unbekannter Actor/);
});

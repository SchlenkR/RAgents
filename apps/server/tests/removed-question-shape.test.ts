import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Journal, Orchestration, type CommandRecord } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { assertCurrentQuestionShape } from "../src/plugin-support/removed-question-shape.ts";

const error = /question of ragents\.ask in the removed single-question shape \(action action-1\).*Start a new run; the original files are kept/;
const proposed = (owner: string, payload: unknown) =>
  ({ events: [{ type: "action.proposed", payload: { actionId: "action-1", owner, title: "Which branch?", payload } }] }) as unknown as CommandRecord;
const current = { questions: [{ question: "Which branch?", header: "Branch", options: [{ label: "main", description: "" }, { label: "release", description: "" }], multiSelect: false }] };

test("rejects exactly the former single question of ragents.ask and nothing else", () => {
  assert.throws(() => assertCurrentQuestionShape(proposed("ragents.ask", { question: "Which branch?", options: ["main", "release"], multi: false })), error);
  assert.throws(() => assertCurrentQuestionShape(proposed("ragents.ask", { question: "Which branch?", options: ["main"], recipient: "agent-1" })), error);
  assert.doesNotThrow(() => assertCurrentQuestionShape(proposed("ragents.ask", current)));
  assert.doesNotThrow(() => assertCurrentQuestionShape(proposed("ragents.ask", null)), "the core keeps payloads opaque; the plugin reports other invalid payloads itself");
  assert.doesNotThrow(() => assertCurrentQuestionShape(proposed("demo.review", { question: "Approve?", options: ["Yes"] })));
  assert.doesNotThrow(() => assertCurrentQuestionShape({ events: [{ type: "action.resolved", payload: { actionId: "action-1", decision: "approved", result: "main" } }] } as unknown as CommandRecord));
});

const filesIn = (directory: string): Record<string, string> => Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap((entry): [string, string][] => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? Object.entries(filesIn(file)).map(([name, value]) => [`${entry.name}/${name}`, value]) : [[entry.name, readFileSync(file).toString("base64")]];
}));

test("loading a journal with a former question locks only its run, keeps its files, and new questions in the former shape are refused", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-removed-question-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const services = testServices();
  const original = new Journal(directory, services);
  const runtime = new Orchestration(original, services);
  const old = runtime.createRun({ commandId: "old" }, { title: "Old", ownerHandle: "alice", ownerDisplayName: "Alice" });
  const healthy = runtime.createRun({ commandId: "healthy" }, { title: "Healthy", ownerHandle: "alice", ownerDisplayName: "Alice" });
  const question = runtime.proposeAction({ actorId: old.ownerId, commandId: "former-question" }, old.id, {
    owner: "ragents.ask", title: "Which branch?", payload: { question: "Which branch?", options: ["main", "release"], multi: false },
  }).actions[0]!;
  runtime.resolveAction({ actorId: old.ownerId, commandId: "former-answer" }, old.id, question.id, { decision: "approved", result: "main" });
  runtime.proposeAction({ actorId: healthy.ownerId, commandId: "current-question" }, healthy.id, { owner: "ragents.ask", title: "Which branch?", payload: current });
  original.close();
  const before = filesIn(path.join(directory, old.id));
  const loaded = new Journal(directory, services, { validateRecord: assertCurrentQuestionShape, onLoadError: () => {} });
  t.after(() => loaded.close());
  assert.equal(loaded.stateOf(old.id), null);
  assert.deepEqual(loaded.unavailableRuns().map(({ runId }) => runId), [old.id]);
  assert.match(loaded.unavailableRuns()[0]!.message, /removed single-question shape .*Start a new run; the original files are kept/);
  assert.ok(loaded.stateOf(healthy.id));
  const reopened = new Orchestration(loaded, services);
  assert.throws(() => reopened.proposeAction({ actorId: healthy.ownerId, commandId: "former-again" }, healthy.id, {
    owner: "ragents.ask", title: "Which branch?", payload: { question: "Which branch?", options: ["main"] },
  }), /removed single-question shape/);
  assert.equal(reopened.view(healthy.id).actions.length, 1);
  assert.deepEqual(filesIn(path.join(directory, old.id)), before);
});

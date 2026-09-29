import assert from "node:assert/strict";
import test from "node:test";
import { discussRun, preparedRunInput } from "../src/run-preparation.ts";
import type { RunPreparationMessage } from "../../server/src/run-preparation-contract.ts";

interface PrepareCall { id: number; method: string; params: Record<string, unknown> }

const prepareCall = (init: RequestInit | undefined): PrepareCall => JSON.parse(String(init?.body)) as PrepareCall;
const prepared = (call: PrepareCall, value: unknown) => Response.json({ jsonrpc: "2.0", id: call.id, result: value });

test("direct creation takes the edited prompt and local attachments", () => {
  const attachments = [{ name: "notes.txt", mediaType: "text/plain", data: "SGFsbG8=" }];
  assert.deepEqual(preparedRunInput([], "  My adjusted task  ", attachments), {
    text: "My adjusted task", attachments,
  });
  assert.throws(() => preparedRunInput([], " \n "), /empty/);
});

test("the run receives the entire discussed task and also the last unsent addition", () => {
  const earlier = { name: "brief.txt", mediaType: "text/plain", data: "QQ==" };
  const latest = { name: "example.txt", mediaType: "text/plain", data: "Qg==" };
  const history: RunPreparationMessage[] = [
    { role: "user", text: "Create a plan.", attachments: [earlier] },
    { role: "assistant", text: "I suggest three steps." },
    { role: "user", text: "Only two steps, please." },
    { role: "assistant", text: "Then I will merge the last two." },
  ];
  const result = preparedRunInput(history, "And everything in German.", [latest]);
  assert.match(result.text, /Assistant responses are suggestions, not work already done/);
  for (const message of history) assert.ok(result.text.includes(message.text));
  assert.ok(result.text.endsWith("User:\nAnd everything in German."));
  assert.deepEqual(result.attachments, [earlier, latest]);
  assert.deepEqual(preparedRunInput(history, "").attachments, [earlier]);
  assert.equal(history.length, 4);
});

test("preparation sends only the dialog to the draft method and passes cancellation on", async (t) => {
  const controller = new AbortController();
  const messages: RunPreparationMessage[] = [{ role: "user", text: "Let us clarify the task." }];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const call = prepareCall(init);
    assert.equal(call.method, "ragents.runs.prepare");
    assert.deepEqual(call.params, { runId: "draft/one", messages });
    return prepared(call, { kind: "reply", text: "What should be built?" });
  });
  assert.deepEqual(await discussRun("draft/one", messages, controller.signal), { kind: "reply", text: "What should be built?" });
  controller.abort();
  await assert.rejects(discussRun("draft/one", messages, controller.signal), /Cancelled/);
});

test("errors and empty answers stay explicit", async (t) => {
  const request = [{ role: "user" as const, text: "A task" }];
  const fetch = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) =>
    Response.json({ jsonrpc: "2.0", id: prepareCall(init).id, error: { code: -32000, message: "Model unavailable" } }));
  await assert.rejects(discussRun("draft", request, new AbortController().signal), /Model unavailable/);
  fetch.mock.mockImplementation(async (_url: string, init: RequestInit) => prepared(prepareCall(init), { kind: "reply", text: " " }));
  await assert.rejects(discussRun("draft", request, new AbortController().signal), /did not return an answer/);
});


test("a start response takes the server-side task and sends the selected skill", async (t) => {
  const messages: RunPreparationMessage[] = [{ role: "user", text: "Go ahead." }];
  const input = { text: "Use the skill discussion. Task with the full history.", attachments: [
    { name: "brief.txt", mediaType: "text/plain", data: "QQ==" },
  ] };
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const call = prepareCall(init);
    assert.deepEqual(call.params, { runId: "draft", messages, skillName: "discussion" });
    return prepared(call, { kind: "start", input });
  });
  assert.deepEqual(await discussRun("draft", messages, new AbortController().signal, "discussion"), { kind: "start", input });
});

test("a start response without a task is rejected", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => prepared(prepareCall(init), { kind: "start" }));
  const messages: RunPreparationMessage[] = [{ role: "user", text: "Go ahead." }];
  await assert.rejects(discussRun("draft", messages, new AbortController().signal), /start task is missing/);
  fetch.mock.mockImplementation(async (_url: string, init: RequestInit) => prepared(prepareCall(init), { kind: "start", input: { text: " " } }));
  await assert.rejects(discussRun("draft", messages, new AbortController().signal), /start task is missing/);
});

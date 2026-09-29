import assert from "node:assert/strict";
import test from "node:test";
import type { ChatSnapshot, Message } from "@ragents/client/ui";
import { answerInput, createSender, deriveConversation, retryMarker, startMarker } from "../src/conversation.ts";

const user = (key: string, text: string): Message => ({ key, role: "user", text });
const assistant = (key: string, text: string, closed = true): Message => ({ key, role: "assistant", text, closed });
const failure = (text = "The model is unreachable."): Message => ({ key: "failure", role: "system", text, closed: true });
const snapshot = (messages: Message[], running = false): ChatSnapshot => ({ messages, running });
const initial = [user("start", startMarker), assistant("question-1", "How big is your balcony?")];
const transcript = (answers: number): Message[] => [...initial, ...Array.from({ length: answers }, (_, index) => [
  user("answer-" + index, answerInput(index, "My details")),
  assistant("response-" + index, index === 4 ? "Your recommendation: lavender." : "The next question?"),
]).flat()];

test("waits before the initial synchronization and starts only with explicit input", () => {
  assert.equal(deriveConversation(undefined).phase, "loading");
  assert.equal(deriveConversation(snapshot([])).phase, "start");
  assert.equal(deriveConversation(snapshot([user("start", startMarker)])).phase, "waiting");
});

test("shows exactly five questions and evaluates only after the fifth answer", () => {
  for (let answers = 0; answers < 5; answers++) {
    const state = deriveConversation(snapshot(transcript(answers)));
    assert.equal(state.phase, "question");
    assert.equal(state.answers, answers);
  }
  const messages = [...transcript(4), user("answer-5", answerInput(4, "Low maintenance"))];
  assert.equal(deriveConversation(snapshot(messages)).phase, "evaluating");
  assert.equal(deriveConversation(snapshot(messages)).text, "");
  messages.push(assistant("result", "Plant lavender.", false));
  assert.equal(deriveConversation(snapshot(messages, true)).text, "");
  assert.equal(deriveConversation(snapshot(messages)).phase, "evaluating");
  messages[messages.length - 1] = assistant("result", "Plant lavender.");
  assert.equal(deriveConversation(snapshot(messages, true)).phase, "evaluating");
  assert.equal(deriveConversation(snapshot(messages)).phase, "complete");
  assert.equal(deriveConversation(snapshot(messages)).text, "Plant lavender.");
});

test("restores question, error, and result from the transcript after a reload", () => {
  const restore = (messages: Message[]) => deriveConversation(JSON.parse(JSON.stringify(snapshot(messages))) as ChatSnapshot);
  assert.equal(restore(transcript(3)).answers, 3);
  assert.equal(restore(transcript(3)).phase, "question");
  assert.equal(restore([...transcript(2), user("answer-3", answerInput(2, "Herbs")), failure()]).phase, "error");
  assert.equal(restore(transcript(5)).phase, "complete");
});

test("hides old and incomplete model texts and does not interpret done as completion", () => {
  const early = [...initial, assistant("early", "Done: Here is a first recommendation.")];
  assert.equal(deriveConversation(snapshot(early)).phase, "question");
  const messages = [...initial, user("answer", answerInput(0, "Four square meters")), assistant("partial", "Which", false)];
  assert.equal(deriveConversation(snapshot(messages)).phase, "waiting");
  assert.equal(deriveConversation(snapshot(messages)).text, "");
  assert.equal(deriveConversation(snapshot(transcript(2), true)).text, "");
});

test("a model abort after a partial answer shows the error and allows a retry without an additional answer", () => {
  const messages = [...transcript(4), user("answer-5", answerInput(4, "Little care")), assistant("partial", "Recommendation", false), failure()];
  const failed = deriveConversation(snapshot(messages));
  assert.equal(failed.phase, "error");
  assert.equal(failed.answers, 5);
  assert.equal(failed.text, "");
  assert.equal(failed.canRetry, true);
  messages.push(user("retry", retryMarker));
  assert.equal(deriveConversation(snapshot(messages)).phase, "evaluating");
  assert.equal(deriveConversation(snapshot(messages)).answers, 5);
  assert.equal(deriveConversation(snapshot(messages)).error, undefined);
  messages.push(assistant("final", "Lavender and a small table."));
  assert.equal(deriveConversation(snapshot(messages)).phase, "complete");
});

test("retrying a failed question does not increase the answer counter", () => {
  const messages = [...initial, user("answer-1", answerInput(0, "Four square meters")), failure(), user("retry", retryMarker)];
  assert.equal(deriveConversation(snapshot(messages)).answers, 1);
  assert.equal(deriveConversation(snapshot(messages)).phase, "waiting");
  messages.push(assistant("question-2", "Which colors do you like?"));
  assert.equal(deriveConversation(snapshot(messages)).phase, "question");
  assert.equal(deriveConversation(snapshot(messages)).answers, 1);
});

test("snapshot errors are visible and read-only or running actors offer no retry", () => {
  const state = deriveConversation({ ...snapshot(transcript(3)), error: "Connection interrupted" });
  assert.equal(state.phase, "error");
  assert.equal(state.text, "");
  assert.equal(state.error, "Connection interrupted");
  assert.equal(state.canRetry, true);
  assert.equal(deriveConversation({ ...snapshot(transcript(3)), error: "Stopped", readOnly: true }).canRetry, false);
  assert.equal(deriveConversation({ ...snapshot(transcript(3), true), error: "Connection interrupted" }).canRetry, false);
});

test("counts only complete numbered user inputs in the intended order", () => {
  const messages = [...initial, assistant("marker", "ANSWER 1/5\nModel text"), user("empty", "ANSWER 1/5\n "),
    user("answer", answerInput(0, "Four square meters")), user("duplicate", answerInput(0, "Four square meters")), user("retry", retryMarker)];
  assert.equal(deriveConversation(snapshot(messages)).answers, 1);
  assert.equal(answerInput(1, "  Herbs  "), "ANSWER 2/5\nHerbs");
  assert.throws(() => answerInput(5, "Too many"), /exactly five/);
  assert.throws(() => answerInput(0, " "), /enter an answer/);
});

test("the send lock prevents double clicks until acknowledgment and a new journal input", async () => {
  const calls: string[] = [];
  let accept!: () => void;
  const sender = createSender(async (text) => { calls.push(text); await new Promise<void>((resolve) => { accept = resolve; }); });
  const before = snapshot(initial);
  const pending = sender.send(before, answerInput(0, "Four square meters"));
  assert.equal(sender.pending, true);
  assert.equal(await sender.send(before, answerInput(0, "Duplicate")), false);
  accept();
  assert.equal(await pending, true);
  assert.equal(sender.pending, true);
  assert.equal(await sender.send(before, answerInput(0, "Duplicate after acknowledgment")), false);
  sender.observe(snapshot([...initial, user("answer", answerInput(0, "Four square meters"))], true));
  assert.equal(sender.pending, false);
  assert.equal(calls.length, 1);
});

test("an early journal delivery does not release the lock before the send confirmation", async () => {
  let accept!: () => void;
  const sender = createSender(async () => new Promise<void>((resolve) => { accept = resolve; }));
  const pending = sender.send(snapshot(initial), answerInput(0, "South"));
  const after = snapshot([...initial, user("answer", answerInput(0, "South"))]);
  sender.observe(after);
  assert.equal(sender.pending, true);
  assert.equal(await sender.send(after, "Duplicate"), false);
  accept();
  await pending;
  assert.equal(sender.pending, false);
});

test("send errors keep the draft and allow sending again", async () => {
  let attempts = 0;
  let draft = "My unsent text";
  const sender = createSender(async () => { if (++attempts === 1) throw new Error("Sending failed"); });
  const sendDraft = async () => { if (await sender.send(snapshot(initial), answerInput(0, draft))) draft = ""; };
  await assert.rejects(sendDraft, /Sending failed/);
  assert.equal(draft, "My unsent text");
  assert.equal(sender.pending, false);
  await sendDraft();
  assert.equal(draft, "");
  assert.equal(attempts, 2);
});

test("the sender blocks missing snapshots, running and read-only actors, and knows the final answer", async () => {
  let calls = 0;
  const sender = createSender(async () => { calls++; });
  assert.equal(await sender.send(undefined, startMarker), false);
  assert.equal(await sender.send(snapshot(initial, true), retryMarker), false);
  assert.equal(await sender.send({ ...snapshot(initial), readOnly: true }, retryMarker), false);
  assert.equal(calls, 0);
  await sender.send(snapshot(transcript(4)), answerInput(4, "Little care"));
  assert.equal(sender.finalAnswer, true);
  sender.observe({ ...snapshot(transcript(4)), error: "Connection interrupted" });
  assert.equal(sender.pending, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { ChatEvent, ChatJournalCursor } from "../../server/src/chat-events";
import { OVERSEER_PLUGIN_ID, QUICK_ANSWER_MAX_LENGTH } from "../../../plugins/ragents.overseer/contract";
import { createQuickAnswers } from "../../../plugins/ragents.overseer/web/quick-answers";

type PluginEvent = Extract<ChatEvent, { kind: "plugin" }>;
const answer = (sequence: number, text = `Antwort ${sequence}`, conversationId = "conversation-a"): PluginEvent => ({
  kind: "plugin", pluginId: OVERSEER_PLUGIN_ID, type: "state-replaced",
  payload: { scope: { kind: "run" }, state: { kind: "quick-answer", question: "Kurze Frage?", text } },
  journal: { conversationId, eventId: `${conversationId}:${sequence}`, sequence },
});
const ready = () => {
  const state = createQuickAnswers();
  state.event({ kind: "reset", conversationId: "conversation-a" });
  state.event(answer(3));
  state.event({ kind: "replay-end", conversationId: "conversation-a" });
  return state;
};

test("initial replay records historical quick answers without displaying a toast", () => {
  const state = createQuickAnswers();
  assert.equal(state.event({ kind: "reset", conversationId: "conversation-a" }), undefined);
  assert.equal(state.event(answer(3)), undefined);
  assert.equal(state.event(answer(8)), undefined);
  assert.equal(state.event({ kind: "replay-end", conversationId: "conversation-a" }), undefined);
  assert.equal(state.event(answer(8)), undefined);
  assert.deepEqual(state.event(answer(9)), { question: "Kurze Frage?", id: "conversation-a:9", text: "Antwort 9" });
});

test("each newer live answer is emitted once with its stable journal identity", () => {
  const state = ready();
  const event = answer(8, "Der Run ist fertig.");
  assert.deepEqual(state.event(event), { question: "Kurze Frage?", id: "conversation-a:8", text: "Der Run ist fertig." });
  assert.equal(state.event(event), undefined);
  assert.equal(state.event(answer(5)), undefined);
  assert.deepEqual(state.event(answer(12, "Der Run ist fertig.")), { question: "Kurze Frage?", id: "conversation-a:12", text: "Der Run ist fertig." });
});

test("reconnect replays already displayed answers without showing them again", () => {
  const state = ready();
  state.event(answer(8));
  state.event({ kind: "reset", conversationId: "conversation-a" });
  assert.equal(state.event(answer(3)), undefined);
  assert.equal(state.event(answer(8)), undefined);
  assert.equal(state.event({ kind: "replay-end", conversationId: "conversation-a" }), undefined);
  assert.equal(state.event(answer(8)), undefined);
});

test("reconnect emits only the latest missed quick answer once the replay finishes", () => {
  const state = ready();
  state.event({ kind: "reset", conversationId: "conversation-a" });
  assert.equal(state.event(answer(3)), undefined);
  assert.equal(state.event(answer(8)), undefined);
  assert.equal(state.event(answer(12)), undefined);
  assert.deepEqual(state.event({ kind: "replay-end", conversationId: "conversation-a" }), { question: "Kurze Frage?", id: "conversation-a:12", text: "Antwort 12" });
  assert.equal(state.event(answer(8)), undefined);
  assert.equal(state.event(answer(12)), undefined);
});

test("an interrupted replay does not mark a pending toast as already displayed", () => {
  const state = ready();
  state.event({ kind: "reset", conversationId: "conversation-a" });
  assert.equal(state.event(answer(8)), undefined);
  state.event({ kind: "reset", conversationId: "conversation-a" });
  assert.equal(state.event(answer(3)), undefined);
  assert.equal(state.event(answer(8)), undefined);
  assert.deepEqual(state.event({ kind: "replay-end", conversationId: "conversation-a" }), { question: "Kurze Frage?", id: "conversation-a:8", text: "Antwort 8" });
  state.event({ kind: "reset", conversationId: "conversation-a" });
  state.event(answer(8));
  assert.equal(state.event({ kind: "replay-end", conversationId: "conversation-a" }), undefined);
});

test("a changed remote conversation discards pending old notices and starts its own sequence", () => {
  const state = ready();
  state.event(answer(100));
  state.event({ kind: "reset", conversationId: "conversation-a" });
  state.event(answer(110));
  state.event({ kind: "reset", conversationId: "conversation-b" });
  assert.equal(state.event(answer(2, "Neuer Run", "conversation-b")), undefined);
  assert.deepEqual(state.event({ kind: "replay-end", conversationId: "conversation-b" }), { question: "Kurze Frage?", id: "conversation-b:2", text: "Neuer Run" });
  assert.equal(state.event(answer(111)), undefined);
  assert.deepEqual(state.event(answer(3, "Nächste Antwort", "conversation-b")), { question: "Kurze Frage?", id: "conversation-b:3", text: "Nächste Antwort" });
});

test("an explicit reset clears sequence and pending notices even with an unchanged identity", () => {
  const state = ready();
  state.event(answer(100));
  state.event({ kind: "reset", conversationId: "conversation-a", reason: "conversation-reset" });
  assert.equal(state.event({ kind: "replay-end", conversationId: "conversation-a" }), undefined);
  assert.deepEqual(state.event(answer(2)), { question: "Kurze Frage?", id: "conversation-a:2", text: "Antwort 2" });
});

test("the first live answer after an initially empty stream is announced and establishes identity", () => {
  const state = createQuickAnswers();
  state.event({ kind: "reset", conversationId: null });
  assert.equal(state.event({ kind: "replay-end", conversationId: null }), undefined);
  assert.deepEqual(state.event(answer(2)), { question: "Kurze Frage?", id: "conversation-a:2", text: "Antwort 2" });
  assert.equal(state.event(answer(3, "Fremd", "conversation-b")), undefined);
  state.event({ kind: "reset", conversationId: "conversation-a" });
  state.event(answer(2));
  assert.equal(state.event({ kind: "replay-end", conversationId: "conversation-a" }), undefined);
});

test("unrelated extension states and actor-scoped states never create a quick-answer toast", () => {
  const state = ready();
  const event = answer(8);
  const ignored: ChatEvent[] = [
    { kind: "status", running: true },
    { kind: "user", text: "Kurzantwort" },
    { ...event, pluginId: "ragents.other" },
    { ...event, type: "other" },
    { ...event, payload: undefined },
    { ...event, payload: { scope: { kind: "run" }, state: { kind: "other", text: "Anderer Zustand" } } },
    { ...event, payload: { scope: { kind: "actor", actorId: "helper" }, state: { kind: "quick-answer", text: "Actor-Zustand" } } },
  ];
  for (const ignoredEvent of ignored) assert.equal(state.event(ignoredEvent), undefined);
  assert.deepEqual(state.event(event), { question: "Kurze Frage?", id: "conversation-a:8", text: "Antwort 8" });
});

test("invalid quick-answer text fails loudly without consuming the valid event position", () => {
  const state = ready();
  const event = answer(8);
  for (const text of [undefined, null, 7, "", " \n\t", "x".repeat(QUICK_ANSWER_MAX_LENGTH + 1)]) {
    assert.throws(() => state.event({ ...event, payload: { scope: { kind: "run" }, state: { kind: "quick-answer", question: "Kurze Frage?", text } } }), /Kurzantwort/);
  }
  const boundary = "x".repeat(QUICK_ANSWER_MAX_LENGTH);
  assert.deepEqual(state.event(answer(8, boundary)), { question: "Kurze Frage?", id: "conversation-a:8", text: boundary });
});

test("missing or malformed journal positions fail before they can corrupt deduplication", () => {
  const state = ready();
  const event = answer(8);
  const valid = event.journal!;
  const malformed: unknown[] = [
    undefined, null, {},
    { ...valid, conversationId: "" }, { ...valid, conversationId: 7 },
    { ...valid, eventId: "" }, { ...valid, eventId: null },
    { ...valid, sequence: undefined }, { ...valid, sequence: "8" },
    { ...valid, sequence: Number.NaN }, { ...valid, sequence: Number.POSITIVE_INFINITY },
    { ...valid, sequence: 0 }, { ...valid, sequence: -1 }, { ...valid, sequence: 1.5 },
    { ...valid, sequence: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const journal of malformed) {
    assert.throws(() => state.event({ ...event, journal: journal as ChatJournalCursor }), undefined, JSON.stringify(journal));
  }
  assert.deepEqual(state.event(event), { question: "Kurze Frage?", id: "conversation-a:8", text: "Antwort 8" });
  assert.equal(state.event(event), undefined);
});

test("historical notices need no current presentation fields and are never reannounced", () => {
  const state = createQuickAnswers();
  const historical = { ...answer(3), payload: { scope: { kind: "run" }, state: { kind: "quick-answer", text: "Frühere Antwort" } } } as PluginEvent;
  state.event({ kind: "reset", conversationId: "conversation-a" });
  assert.equal(state.event(historical), undefined);
  assert.equal(state.event({ kind: "replay-end", conversationId: "conversation-a" }), undefined);
  state.event({ kind: "reset", conversationId: "conversation-a" });
  assert.equal(state.event(historical), undefined);
  assert.equal(state.event({ kind: "replay-end", conversationId: "conversation-a" }), undefined);
});

test("new notices require a short question and answer without consuming invalid positions", () => {
  const state = ready();
  for (const question of [undefined, null, "", " ", "Frage\nFrage", "x".repeat(QUICK_ANSWER_MAX_LENGTH + 1)]) {
    assert.throws(() => state.event({ ...answer(8), payload: { scope: { kind: "run" }, state: { kind: "quick-answer", question, text: "Antwort" } } }), /Kurzfrage/);
  }
  assert.deepEqual(state.event(answer(8)), { id: "conversation-a:8", question: "Kurze Frage?", text: "Antwort 8" });
});

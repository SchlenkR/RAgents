import assert from "node:assert/strict";
import test from "node:test";
import type { ChatSnapshot, Message } from "@ragents/client/ui";
import { answerInput, createSender, deriveConversation, retryMarker, startMarker } from "../src/conversation.ts";

const user = (key: string, text: string): Message => ({ key, role: "user", text });
const assistant = (key: string, text: string, closed = true): Message => ({ key, role: "assistant", text, closed });
const failure = (text = "Das Modell ist nicht erreichbar."): Message => ({ key: "failure", role: "system", text, closed: true });
const snapshot = (messages: Message[], running = false): ChatSnapshot => ({ messages, running });
const initial = [user("start", startMarker), assistant("question-1", "Wie groß ist dein Balkon?")];
const transcript = (answers: number): Message[] => [...initial, ...Array.from({ length: answers }, (_, index) => [
  user("answer-" + index, answerInput(index, "Meine Angaben")),
  assistant("response-" + index, index === 4 ? "Deine Empfehlung: Lavendel." : "Die nächste Frage?"),
]).flat()];

test("wartet vor der initialen Synchronisierung und startet nur mit ausdrücklicher Eingabe", () => {
  assert.equal(deriveConversation(undefined).phase, "loading");
  assert.equal(deriveConversation(snapshot([])).phase, "start");
  assert.equal(deriveConversation(snapshot([user("start", startMarker)])).phase, "waiting");
});

test("zeigt genau fünf Fragen und wertet erst nach der fünften Antwort aus", () => {
  for (let answers = 0; answers < 5; answers++) {
    const state = deriveConversation(snapshot(transcript(answers)));
    assert.equal(state.phase, "question");
    assert.equal(state.answers, answers);
  }
  const messages = [...transcript(4), user("answer-5", answerInput(4, "Geringer Pflegeaufwand"))];
  assert.equal(deriveConversation(snapshot(messages)).phase, "evaluating");
  assert.equal(deriveConversation(snapshot(messages)).text, "");
  messages.push(assistant("result", "Pflanze Lavendel.", false));
  assert.equal(deriveConversation(snapshot(messages, true)).text, "");
  assert.equal(deriveConversation(snapshot(messages)).phase, "evaluating");
  messages[messages.length - 1] = assistant("result", "Pflanze Lavendel.");
  assert.equal(deriveConversation(snapshot(messages, true)).phase, "evaluating");
  assert.equal(deriveConversation(snapshot(messages)).phase, "complete");
  assert.equal(deriveConversation(snapshot(messages)).text, "Pflanze Lavendel.");
});

test("stellt Frage, Fehler und Ergebnis nach Neuladen aus dem Transcript wieder her", () => {
  const restore = (messages: Message[]) => deriveConversation(JSON.parse(JSON.stringify(snapshot(messages))) as ChatSnapshot);
  assert.equal(restore(transcript(3)).answers, 3);
  assert.equal(restore(transcript(3)).phase, "question");
  assert.equal(restore([...transcript(2), user("answer-3", answerInput(2, "Kräuter")), failure()]).phase, "error");
  assert.equal(restore(transcript(5)).phase, "complete");
});

test("blendet alte und unvollständige Modelltexte aus und interpretiert fertig nicht als Abschluss", () => {
  const early = [...initial, assistant("early", "Fertig: Hier ist eine erste Empfehlung.")];
  assert.equal(deriveConversation(snapshot(early)).phase, "question");
  const messages = [...initial, user("answer", answerInput(0, "Vier Quadratmeter")), assistant("partial", "Welche", false)];
  assert.equal(deriveConversation(snapshot(messages)).phase, "waiting");
  assert.equal(deriveConversation(snapshot(messages)).text, "");
  assert.equal(deriveConversation(snapshot(transcript(2), true)).text, "");
});

test("Modellabbruch nach Teilantwort zeigt den Fehler und erlaubt eine Wiederholung ohne zusätzliche Antwort", () => {
  const messages = [...transcript(4), user("answer-5", answerInput(4, "Wenig Pflege")), assistant("partial", "Empfehlung", false), failure()];
  const failed = deriveConversation(snapshot(messages));
  assert.equal(failed.phase, "error");
  assert.equal(failed.answers, 5);
  assert.equal(failed.text, "");
  assert.equal(failed.canRetry, true);
  messages.push(user("retry", retryMarker));
  assert.equal(deriveConversation(snapshot(messages)).phase, "evaluating");
  assert.equal(deriveConversation(snapshot(messages)).answers, 5);
  assert.equal(deriveConversation(snapshot(messages)).error, undefined);
  messages.push(assistant("final", "Lavendel und ein kleiner Tisch."));
  assert.equal(deriveConversation(snapshot(messages)).phase, "complete");
});

test("Wiederholung einer fehlgeschlagenen Frage erhöht den Antwortzähler nicht", () => {
  const messages = [...initial, user("answer-1", answerInput(0, "Vier Quadratmeter")), failure(), user("retry", retryMarker)];
  assert.equal(deriveConversation(snapshot(messages)).answers, 1);
  assert.equal(deriveConversation(snapshot(messages)).phase, "waiting");
  messages.push(assistant("question-2", "Welche Farben magst du?"));
  assert.equal(deriveConversation(snapshot(messages)).phase, "question");
  assert.equal(deriveConversation(snapshot(messages)).answers, 1);
});

test("Snapshot-Fehler sind sichtbar und schreibgeschützte oder laufende Actors bieten keine Wiederholung", () => {
  const state = deriveConversation({ ...snapshot(transcript(3)), error: "Verbindung unterbrochen" });
  assert.equal(state.phase, "error");
  assert.equal(state.text, "");
  assert.equal(state.error, "Verbindung unterbrochen");
  assert.equal(state.canRetry, true);
  assert.equal(deriveConversation({ ...snapshot(transcript(3)), error: "Gestoppt", readOnly: true }).canRetry, false);
  assert.equal(deriveConversation({ ...snapshot(transcript(3), true), error: "Verbindung unterbrochen" }).canRetry, false);
});

test("zählt nur vollständige nummerierte Nutzereingaben in der vorgesehenen Reihenfolge", () => {
  const messages = [...initial, assistant("marker", "ANSWER 1/5\nModelltext"), user("empty", "ANSWER 1/5\n "),
    user("answer", answerInput(0, "Vier Quadratmeter")), user("duplicate", answerInput(0, "Vier Quadratmeter")), user("retry", retryMarker)];
  assert.equal(deriveConversation(snapshot(messages)).answers, 1);
  assert.equal(answerInput(1, "  Kräuter  "), "ANSWER 2/5\nKräuter");
  assert.throws(() => answerInput(5, "Zu viel"), /genau fünf/);
  assert.throws(() => answerInput(0, " "), /Antwort eingeben/);
});

test("die Sendesperre verhindert Doppelclicks bis Quittung und neuer Journaleingabe", async () => {
  const calls: string[] = [];
  let accept!: () => void;
  const sender = createSender(async (text) => { calls.push(text); await new Promise<void>((resolve) => { accept = resolve; }); });
  const before = snapshot(initial);
  const pending = sender.send(before, answerInput(0, "Vier Quadratmeter"));
  assert.equal(sender.pending, true);
  assert.equal(await sender.send(before, answerInput(0, "Doppelt")), false);
  accept();
  assert.equal(await pending, true);
  assert.equal(sender.pending, true);
  assert.equal(await sender.send(before, answerInput(0, "Nach Quittung doppelt")), false);
  sender.observe(snapshot([...initial, user("answer", answerInput(0, "Vier Quadratmeter"))], true));
  assert.equal(sender.pending, false);
  assert.equal(calls.length, 1);
});

test("eine frühe Journalzustellung hebt die Sperre vor der Sendebestätigung nicht auf", async () => {
  let accept!: () => void;
  const sender = createSender(async () => new Promise<void>((resolve) => { accept = resolve; }));
  const pending = sender.send(snapshot(initial), answerInput(0, "Süden"));
  const after = snapshot([...initial, user("answer", answerInput(0, "Süden"))]);
  sender.observe(after);
  assert.equal(sender.pending, true);
  assert.equal(await sender.send(after, "Duplikat"), false);
  accept();
  await pending;
  assert.equal(sender.pending, false);
});

test("Sendefehler lassen den Entwurf erhalten und geben einen erneuten Versand frei", async () => {
  let attempts = 0;
  let draft = "Mein nicht gesendeter Text";
  const sender = createSender(async () => { if (++attempts === 1) throw new Error("Senden fehlgeschlagen"); });
  const sendDraft = async () => { if (await sender.send(snapshot(initial), answerInput(0, draft))) draft = ""; };
  await assert.rejects(sendDraft, /Senden fehlgeschlagen/);
  assert.equal(draft, "Mein nicht gesendeter Text");
  assert.equal(sender.pending, false);
  await sendDraft();
  assert.equal(draft, "");
  assert.equal(attempts, 2);
});

test("Sender sperrt fehlende Snapshots, laufende und schreibgeschützte Actors und kennt die finale Antwort", async () => {
  let calls = 0;
  const sender = createSender(async () => { calls++; });
  assert.equal(await sender.send(undefined, startMarker), false);
  assert.equal(await sender.send(snapshot(initial, true), retryMarker), false);
  assert.equal(await sender.send({ ...snapshot(initial), readOnly: true }, retryMarker), false);
  assert.equal(calls, 0);
  await sender.send(snapshot(transcript(4)), answerInput(4, "Wenig Pflege"));
  assert.equal(sender.finalAnswer, true);
  sender.observe({ ...snapshot(transcript(4)), error: "Verbindung unterbrochen" });
  assert.equal(sender.pending, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { discussRun, preparedRunInput } from "../src/run-preparation.ts";
import type { RunPreparationMessage } from "../../server/src/run-preparation-contract.ts";

test("direktes Erstellen übernimmt den bearbeiteten Prompt und lokale Anhänge", () => {
  const attachments = [{ name: "notes.txt", mediaType: "text/plain", data: "SGFsbG8=" }];
  assert.deepEqual(preparedRunInput([], "  Mein angepasster Auftrag  ", attachments), {
    text: "Mein angepasster Auftrag", attachments,
  });
  assert.throws(() => preparedRunInput([], " \n "), /leer/);
});

test("Run erhält den gesamten besprochenen Auftrag und auch die letzte ungesendete Ergänzung", () => {
  const earlier = { name: "brief.txt", mediaType: "text/plain", data: "QQ==" };
  const latest = { name: "example.txt", mediaType: "text/plain", data: "Qg==" };
  const history: RunPreparationMessage[] = [
    { role: "user", text: "Erstelle einen Plan.", attachments: [earlier] },
    { role: "assistant", text: "Ich schlage drei Schritte vor." },
    { role: "user", text: "Bitte nur zwei Schritte." },
    { role: "assistant", text: "Dann fasse ich die letzten beiden zusammen." },
  ];
  const result = preparedRunInput(history, "Und alles auf Deutsch.", [latest]);
  assert.match(result.text, /Assistentenantworten sind Vorschläge und keine bereits erledigte Arbeit/);
  for (const message of history) assert.ok(result.text.includes(message.text));
  assert.ok(result.text.endsWith("Benutzer:\nUnd alles auf Deutsch."));
  assert.deepEqual(result.attachments, [earlier, latest]);
  assert.deepEqual(preparedRunInput(history, "").attachments, [earlier]);
  assert.equal(history.length, 4);
});

test("Vorbereitung sendet ausschließlich den Dialog an den Entwurfsendpunkt und reicht Abbruch weiter", async (t) => {
  const controller = new AbortController();
  const messages: RunPreparationMessage[] = [{ role: "user", text: "Lass uns den Auftrag klären." }];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/chat/draft%2Fone/prepare");
    assert.equal(init.method, "POST");
    assert.equal(init.signal, controller.signal);
    assert.deepEqual(JSON.parse(String(init.body)), { messages });
    return Response.json({ kind: "reply", text: "Was soll entstehen?" });
  });
  assert.deepEqual(await discussRun("draft/one", messages, controller.signal), { kind: "reply", text: "Was soll entstehen?" });
});

test("Fehler und leere Antworten bleiben explizit", async (t) => {
  const request = [{ role: "user" as const, text: "Ein Auftrag" }];
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Modell nicht verfügbar" }, { status: 400 }));
  await assert.rejects(discussRun("draft", request, new AbortController().signal), /Modell nicht verfügbar/);
  fetch.mock.mockImplementation(async () => Response.json({ kind: "reply", text: " " }));
  await assert.rejects(discussRun("draft", request, new AbortController().signal), /keine Antwort/);
});


test("Startantwort übernimmt den serverseitigen Auftrag und sendet den ausgewählten Skill", async (t) => {
  const messages: RunPreparationMessage[] = [{ role: "user", text: "Leg los." }];
  const input = { text: "Nutze den Skill discussion. Auftrag mit vollständigem Verlauf.", attachments: [
    { name: "brief.txt", mediaType: "text/plain", data: "QQ==" },
  ] };
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init.body)), { messages, skillName: "discussion" });
    return Response.json({ kind: "start", input });
  });
  assert.deepEqual(await discussRun("draft", messages, new AbortController().signal, "discussion"), { kind: "start", input });
});

test("Startantwort ohne Auftrag wird abgewiesen", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ kind: "start" }));
  const messages: RunPreparationMessage[] = [{ role: "user", text: "Leg los." }];
  await assert.rejects(discussRun("draft", messages, new AbortController().signal), /Startauftrag fehlt/);
  fetch.mock.mockImplementation(async () => Response.json({ kind: "start", input: { text: " " } }));
  await assert.rejects(discussRun("draft", messages, new AbortController().signal), /Startauftrag fehlt/);
});

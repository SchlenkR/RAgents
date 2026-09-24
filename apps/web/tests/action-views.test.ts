import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages } from "../src/chat/ChatMessages.tsx";
import { PluginRegistry, type SessionContext, type WebPlugin } from "../src/PluginRegistry.tsx";
import { applyEvent, type Message, type PendingAction } from "../src/chat/types.ts";

const waiting = (owner: string | null): Message[] => applyEvent([], {
  kind: "action", actionId: "action-1", owner, text: "Welche Farbe?",
  payload: { question: "Welche Farbe?", options: ["Blau", "Rot"], multi: false },
});

const registryWith = (views: WebPlugin["actionViews"]) => new PluginRegistry({
  brand: { title: "Test" }, product: { id: "test", title: "Test" }, startEntries: [],
  plugins: [{ id: "ragents.ask", actionViews: views }],
});

const render = (messages: Message[], props: Partial<Parameters<typeof ChatMessages>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChatMessages, { messages, ...props }));

test("eine Aktion ohne registrierte Darstellung erscheint generisch mit Titel, Hinweis und Verwerfen", () => {
  const html = render(waiting("ragents.ask"), { onDismissAction: () => {} });
  assert.match(html, /Welche Farbe\?/);
  assert.match(html, /data-action="waiting"/);
  assert.match(html, /wartet auf Eingabe/);
  assert.match(html, /<button[^>]*>Verwerfen<\/button>/);
  assert.doesNotMatch(html, /Blau|Rot|Rückfrage/);
  assert.doesNotMatch(render(waiting("ragents.ask")), /Verwerfen/);
});

test("eine beantwortete Aktion bleibt als Beleg ohne Bedienung stehen", () => {
  const resolved = applyEvent(waiting("ragents.ask"), { kind: "action-resolved", actionId: "action-1", status: "approved", result: "Blau" });
  const html = render(resolved, { onDismissAction: () => {} });
  assert.match(html, /data-action="resolved"/);
  assert.match(html, /Blau/);
  assert.doesNotMatch(html, /Verwerfen|wartet auf Eingabe/);
  const dismissed = applyEvent(waiting("ragents.ask"), { kind: "action-resolved", actionId: "action-1", status: "dismissed", result: null });
  assert.match(render(dismissed), /verworfen/);
});

test("die Darstellung des Eigentümers ersetzt die generische Karte, eine fremde Aktion bleibt generisch", () => {
  const registry = registryWith([{ owner: "ragents.ask", View: ({ action }) => createElement("p", null, `Optionen: ${JSON.stringify((action.payload as { options: string[] }).options)}`) }]);
  const renderAction = (action: PendingAction, text: string) => {
    const View = registry.actionViewFor(action.owner)?.View;
    return View ? createElement(View, { action, text, session: {} as SessionContext }) : undefined;
  };
  const own = render(waiting("ragents.ask"), { renderAction, onDismissAction: () => {} });
  assert.match(own, /Optionen: \[&quot;Blau&quot;,&quot;Rot&quot;\]/);
  assert.doesNotMatch(own, /wartet auf Eingabe|Verwerfen/);
  const foreign = render(waiting("ragents.todo"), { renderAction, onDismissAction: () => {} });
  assert.match(foreign, /wartet auf Eingabe/);
  const ownerless = render(waiting(null), { renderAction, onDismissAction: () => {} });
  assert.match(ownerless, /wartet auf Eingabe/);
});

test("zwei Darstellungen für denselben Eigentümer sind ein harter Fehler", () => {
  const view = { owner: "ragents.ask", View: () => null };
  assert.throws(() => registryWith([view, view]), /Aktionsdarstellung/);
});

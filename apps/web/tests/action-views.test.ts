import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages, applyEvent, type Message, type PendingAction } from "quassel";
import { PluginRegistry, type SessionContext, type WebPlugin } from "../src/PluginRegistry.tsx";

const waiting = (owner: string | null): Message[] => applyEvent([], {
  kind: "action", actionId: "action-1", owner, text: "Which color?",
  payload: { question: "Which color?", options: ["Blue", "Red"], multi: false },
});

const registryWith = (views: WebPlugin["actionViews"]) => new PluginRegistry({
  brand: { title: "Test" }, product: { id: "test", title: "Test" }, startEntries: [],
  plugins: [{ id: "ragents.ask", actionViews: views }],
});

const render = (messages: Message[], props: Partial<Parameters<typeof ChatMessages>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChatMessages, { messages, ...props }));

test("an action without a registered view appears generically with title, notice and dismiss", () => {
  const html = render(waiting("ragents.ask"), { onDismissAction: () => {} });
  assert.match(html, /Which color\?/);
  assert.match(html, /data-action="waiting"/);
  assert.match(html, /waiting for input/);
  assert.match(html, /<button[^>]*>Dismiss<\/button>/);
  assert.doesNotMatch(html, /Blue|Red|Question/);
  assert.doesNotMatch(render(waiting("ragents.ask")), /Dismiss/);
});

test("an answered action stays as a receipt without controls", () => {
  const resolved = applyEvent(waiting("ragents.ask"), { kind: "action-resolved", actionId: "action-1", status: "approved", result: "Blue" });
  const html = render(resolved, { onDismissAction: () => {} });
  assert.match(html, /data-action="resolved"/);
  assert.match(html, /Blue/);
  assert.doesNotMatch(html, /Dismiss|waiting for input/);
  const dismissed = applyEvent(waiting("ragents.ask"), { kind: "action-resolved", actionId: "action-1", status: "dismissed", result: null });
  assert.match(render(dismissed), /dismissed/);
});

test("the owner's view replaces the generic card, a foreign action stays generic", () => {
  const registry = registryWith([{ owner: "ragents.ask", View: ({ action }) => createElement("p", null, `Options: ${JSON.stringify((action.payload as { options: string[] }).options)}`) }]);
  const renderAction = (action: PendingAction, text: string) => {
    const View = registry.actionViewFor(action.owner)?.View;
    return View ? createElement(View, { action, text, session: {} as SessionContext }) : undefined;
  };
  const own = render(waiting("ragents.ask"), { renderAction, onDismissAction: () => {} });
  assert.match(own, /Options: \[&quot;Blue&quot;,&quot;Red&quot;\]/);
  assert.doesNotMatch(own, /waiting for input|Dismiss/);
  const foreign = render(waiting("ragents.todo"), { renderAction, onDismissAction: () => {} });
  assert.match(foreign, /waiting for input/);
  const ownerless = render(waiting(null), { renderAction, onDismissAction: () => {} });
  assert.match(ownerless, /waiting for input/);
});

test("two views for the same owner are a hard error", () => {
  const view = { owner: "ragents.ask", View: () => null };
  assert.throws(() => registryWith([view, view]), /Action view/);
});

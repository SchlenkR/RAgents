import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAccessContext, unrestrictedAccess } from "../../../packages/ragents/src/access.ts";
import { PluginRegistry, type StartEntry } from "../src/PluginRegistry.tsx";
import { connectionEntriesOf, StartTiles } from "../src/StartTiles.tsx";
import type { ConnectionEntry } from "../src/panel/contract.ts";

const entry = (id: string, kind: "skill" | "script", category: string, guided = false): ConnectionEntry =>
  ({ id, title: id, description: `Description ${id}`, kind, category, ...(guided ? { guided: true } : {}) });
const entries = [entry("board", "skill", "Mini-apps"), entry("decision", "skill", "Discuss", true), entry("word", "script", "Games")];
const render = (props: Partial<Parameters<typeof StartTiles>[0]> = {}) => renderToStaticMarkup(createElement(StartTiles, {
  entries, label: "Templates", onNewChat: () => {}, onStart: () => { throw new Error("Rendering starts nothing"); }, ...props,
}));
const titles = (html: string) => [...html.matchAll(/data-tile="([^"]+)"/g)].map((match) => match[1]);

test("New omits unlisted skills and scripts while plugins keep them and permission checks still apply", () => {
  const catalog: StartEntry[] = [
    { id: "test.skill", owner: "test", title: "Skill", description: "A task", action: "skill", skill: "example", category: "Examples", prompt: "Task", listed: false },
    { id: "test.internal", owner: "test", title: "Internal", description: "A row action", action: "script", coordinator: false, listed: false },
    { id: "test.script", owner: "test", title: "Script", description: "A setup", action: "script", coordinator: false, listed: true },
    { id: "test.default", owner: "test", title: "Default", description: "A setup", action: "script", coordinator: false },
  ];
  const registry = new PluginRegistry({ product: { id: "test", title: "Test" }, brand: { title: "Test" }, plugins: [{ id: "test" }], startEntries: catalog });
  const visible = connectionEntriesOf(registry, unrestrictedAccess);
  assert.deepEqual(visible.map((entry) => entry.id), ["test.script", "test.default"]);
  assert.equal(registry.startEntries.find((entry) => entry.id === "test.internal")?.listed, false);
  const restricted = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.write"], startEntries: ["test.internal", "test.default"] } });
  assert.deepEqual(connectionEntriesOf(registry, restricted).map((entry) => entry.id), ["test.default"]);
  const html = render({ entries: visible, defaultEntry: "test.internal" });
  assert.deepEqual(titles(html), ["New chat", "Script", "Default"]);
});

test("without a default template New chat comes first, then the templates in their order", () => {
  const html = render();
  assert.deepEqual(titles(html), ["New chat", "board", "decision", "word"]);
  assert.match(html, /aria-label="New chat"/);
  assert.doesNotMatch(html, /No template/);
});

test("the default template replaces New chat and comes first, only once and marked", () => {
  const html = render({ defaultEntry: "word" });
  assert.deepEqual(titles(html), ["word", "board", "decision"]);
  assert.match(html, /Default/);
});

test("without the right to free runs New chat is missing, a template with a guide is called Set up", () => {
  const html = render({ onNewChat: undefined });
  assert.deepEqual(titles(html), ["board", "decision", "word"]);
  assert.match(html, /aria-label="Set up decision"/);
  assert.equal((html.match(/aria-label="Start [^"]+"/g) ?? []).length, 2);
});

test("compact tiles contain a title, description and action, without categories or a start bar", () => {
  const html = render();
  assert.doesNotMatch(html, />Mini-apps<|>Discuss<|>Games<|>Start<|>Set up</);
  assert.deepEqual([...html.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]), ["chat", "start", "setup", "start"]);
  assert.equal((html.match(/data-slot="start-title"/g) ?? []).length, 4);
  assert.equal((html.match(/data-slot="start-description"/g) ?? []).length, 4);
  assert.equal((html.match(/data-slot="start-action"/g) ?? []).length, 4);
});

test("without descriptions every tile keeps only its title row", () => {
  const html = render({ descriptions: false });
  assert.equal((html.match(/data-slot="start-title"/g) ?? []).length, 4);
  assert.equal((html.match(/data-slot="start-action"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /data-slot="start-description"|Description board|Empty run/);
});

test("while a start is running, all tiles are locked", () => {
  const buttons = render({ disabled: true }).match(/<button\b[^>]*>/g) ?? [];
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every((button) => button.includes('disabled=""')));
});

test("the tile whose start is under way says Starting with a spinner, all tiles stay locked", () => {
  const html = render({ starting: { entryId: "word" } });
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every((button) => button.includes('disabled=""')), "no second start while one is running");
  assert.deepEqual(buttons.filter((button) => button.includes('aria-busy="true"')).map((button) => button.match(/data-tile="([^"]+)"/)?.[1]), ["word"]);
  assert.equal((html.match(/Starting \.\.\./g) ?? []).length, 1);
  assert.equal((html.match(/data-slot="spinner"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Start word"/, "the action name stays intact during a start");
  assert.match(html, /data-slot="start-action">(?:(?!<\/span>).)*data-slot="spinner"(?:(?!<\/span>).)*Starting \.\.\./s);
  const chat = render({ starting: {} });
  assert.match(chat, /<button\b(?=[^>]*aria-busy="true")(?=[^>]*data-tile="New chat")[^>]*>/, "a start without template is the New chat tile");
  assert.equal((chat.match(/Starting \.\.\./g) ?? []).length, 1);
});

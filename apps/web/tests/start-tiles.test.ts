import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StartTiles, startTileCount } from "../src/StartTiles.tsx";
import type { ConnectionEntry } from "../src/panel/contract.ts";

const entry = (id: string, kind: "skill" | "script", category: string, guided = false): ConnectionEntry =>
  ({ id, title: id, description: `Description ${id}`, kind, category, ...(guided ? { guided: true } : {}) });
const entries = [entry("board", "skill", "Mini-apps"), entry("decision", "skill", "Discuss", true), entry("word", "script", "Games")];
const render = (props: Partial<Parameters<typeof StartTiles>[0]> = {}) => renderToStaticMarkup(createElement(StartTiles, {
  entries, label: "Templates", onNewChat: () => {}, onStart: () => { throw new Error("Rendering starts nothing"); }, ...props,
}));
const titles = (html: string) => [...html.matchAll(/title="([^"]+)"/g)].map((match) => match[1]);

test("without a default template New chat comes first, then the templates in their order", () => {
  const html = render();
  assert.deepEqual(titles(html), ["New chat", "board", "decision", "word"]);
  assert.match(html, /No template/);
  assert.equal(startTileCount(entries, undefined, true), 4);
});

test("the default template replaces New chat and comes first, only once and marked", () => {
  const html = render({ defaultEntry: "word" });
  assert.deepEqual(titles(html), ["word", "board", "decision"]);
  assert.match(html, /Default/);
  assert.equal(startTileCount(entries, "word", true), 3);
});

test("without the right to free runs New chat is missing, a template with a guide is called Set up", () => {
  const html = render({ onNewChat: undefined });
  assert.deepEqual(titles(html), ["board", "decision", "word"]);
  assert.equal(startTileCount(entries, undefined, false), 3);
  assert.equal((html.match(/Set up/g) ?? []).length, 1);
  assert.equal((html.match(/Start/g) ?? []).length, 2);
});

test("while a start is running, all tiles are locked", () => {
  const buttons = render({ disabled: true }).match(/<button\b[^>]*>/g) ?? [];
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every((button) => button.includes('disabled=""')));
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StartTiles, startTileCount } from "../src/StartTiles.tsx";
import type { ConnectionEntry } from "../src/panel/contract.ts";

const entry = (id: string, kind: "skill" | "script", category: string, guided = false): ConnectionEntry =>
  ({ id, title: id, description: `Beschreibung ${id}`, kind, category, ...(guided ? { guided: true } : {}) });
const entries = [entry("board", "skill", "Mini-Apps"), entry("decision", "skill", "Besprechen", true), entry("word", "script", "Spiele")];
const render = (props: Partial<Parameters<typeof StartTiles>[0]> = {}) => renderToStaticMarkup(createElement(StartTiles, {
  entries, label: "Vorlagen", onNewChat: () => {}, onStart: () => { throw new Error("Rendern startet nichts"); }, ...props,
}));
const titles = (html: string) => [...html.matchAll(/title="([^"]+)"/g)].map((match) => match[1]);

test("ohne Standard-Vorlage steht Neuer Chat zuerst, danach die Vorlagen in ihrer Reihenfolge", () => {
  const html = render();
  assert.deepEqual(titles(html), ["Neuer Chat", "board", "decision", "word"]);
  assert.match(html, /Ohne Vorlage/);
  assert.equal(startTileCount(entries, undefined, true), 4);
});

test("die Standard-Vorlage ersetzt Neuer Chat und steht zuerst, nur einmal und gekennzeichnet", () => {
  const html = render({ defaultEntry: "word" });
  assert.deepEqual(titles(html), ["word", "board", "decision"]);
  assert.match(html, /Standard/);
  assert.equal(startTileCount(entries, "word", true), 3);
});

test("ohne das Recht auf freie Runs fehlt Neuer Chat, eine Vorlage mit Leitfaden heißt Einrichten", () => {
  const html = render({ onNewChat: undefined });
  assert.deepEqual(titles(html), ["board", "decision", "word"]);
  assert.equal(startTileCount(entries, undefined, false), 3);
  assert.equal((html.match(/Einrichten/g) ?? []).length, 1);
  assert.equal((html.match(/Starten/g) ?? []).length, 2);
});

test("solange ein Start läuft, sind alle Kacheln gesperrt", () => {
  const buttons = render({ disabled: true }).match(/<button\b[^>]*>/g) ?? [];
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every((button) => button.includes('disabled=""')));
});

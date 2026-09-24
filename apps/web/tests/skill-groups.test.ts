import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StartEntryLibrary } from "../src/StartSelection.tsx";
import type { SkillStartEntry } from "../src/PluginRegistry.tsx";

const card = (id: string, category: string, order: number, owner = "example"): SkillStartEntry => ({
  id, owner, action: "skill", skill: id, category, order, title: id, description: "Ein freier Auftrag", prompt: "Ich hätte gern Hilfe.",
});

test("die Startseite gruppiert nach freiem Kategorietext über Plugin-Grenzen hinweg", () => {
  const html = renderToStaticMarkup(createElement(StartEntryLibrary, {
    skills: [card("später", "Mini-Apps", 30), card("eigener", "Meine frei benannte Gruppe", 20), card("früher", "Mini-Apps", 10, "other")],
    scripts: [], hasGuide: () => false,
    launchDisabled: false,
    onOpen: () => { throw new Error("Rendern darf keinen Auftrag übernehmen"); },
  }));
  assert.equal((html.match(/aria-label="\d+ Einträge"/g) ?? []).length, 2);
  assert.match(html, /Mini-Apps<span[^>]*aria-label="2 Einträge">2<\/span>/);
  assert.match(html, /Meine frei benannte Gruppe<span[^>]*aria-label="1 Einträge">1<\/span>/);
  assert.ok(html.indexOf(">früher<") < html.indexOf(">später<"));
  assert.ok(html.indexOf(">später<") < html.indexOf("Meine frei benannte Gruppe"));
  assert.match(html, /In Auftrag übernehmen/);
  assert.match(html, /Ich hätte gern Hilfe/);
});

test("eine leere Trefferliste erzeugt keine erfundene Kategorie", () => {
  const html = renderToStaticMarkup(createElement(StartEntryLibrary, {
    skills: [], scripts: [], launchDisabled: false, onOpen: () => {}, hasGuide: () => false,
  }));
  assert.doesNotMatch(html, /aria-label="\d+ Einträge"/);
  assert.match(html, /Kein passender Skill/);
});

test("fehlende Startbereitschaft sperrt weder Skillauswahl noch lokale Übernahme", () => {
  const html = renderToStaticMarkup(createElement(StartEntryLibrary, {
    skills: [card("erstes", "Mini-Apps", 10), card("zweites", "Mini-Apps", 20)], scripts: [],
    launchDisabled: true, hasGuide: () => false,
    onOpen: () => { throw new Error("Rendern darf keine Vorbereitung öffnen"); },
  }));
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  assert.equal(buttons.filter((button) => button.includes("aria-pressed=")).length, 2);
  assert.ok(buttons.every((button) => !button.includes(" disabled=\"\"")));
  assert.match(html, /In Auftrag übernehmen/);
});

test("Run-Scripts bleiben auswählbar, während ihre Ausführung noch gesperrt ist", () => {
  const html = renderToStaticMarkup(createElement(StartEntryLibrary, {
    skills: [], scripts: [{ id: "script", action: "script", owner: "example", title: "Ein Script", description: "Ein Ablauf", coordinator: true }],
    launchDisabled: true, hasGuide: () => false,
    onOpen: () => { throw new Error("Rendern darf keinen Run starten"); },
  }));
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  assert.ok(buttons.filter((button) => button.includes("aria-pressed=")).every((button) => !button.includes(" disabled=\"\"")));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Aufbauen<\/button>/);
});

test("die Vorschau einer Vorlage zeigt, was sie an Startoptionen festlegt, nur bei einer solchen Vorlage", () => {
  const fixed = { "ragents.workspace.binding": { machine: "server", folder: "fresh" } };
  const render = (fixedStartOptions?: typeof fixed) => renderToStaticMarkup(createElement(StartEntryLibrary, {
    skills: [], hasGuide: () => false, launchDisabled: false, onOpen: () => {},
    scripts: [{ id: "script", action: "script", owner: "example", title: "Im Worktree", description: "Ein Ablauf", coordinator: true, ...(fixedStartOptions ? { fixedStartOptions } : {}) }],
    fixedOptions: (entry) => createElement("span", { "data-fixed-for": entry.id }, JSON.stringify(entry.fixedStartOptions)),
  }));
  assert.match(render(fixed), /aria-label="Von der Vorlage festgelegt"[^>]*><span data-fixed-for="script">/);
  assert.doesNotMatch(render(), /Von der Vorlage festgelegt/);
});

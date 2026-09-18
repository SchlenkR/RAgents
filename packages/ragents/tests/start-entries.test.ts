import assert from "node:assert/strict";
import test from "node:test";

import { StartEntryContributionRegistry } from "../src/plugin-host.ts";

const skill = (owner: string, folder: string) => ({
  id: `${owner}.${folder}`,
  owner,
  audiences: ["coordinator" as const],
  paths: [`/plugins/${owner}/skills/${folder}`],
});

const skillEntry = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "test.product.feature-run",
  action: "skill" as const,
  title: "Feature umsetzen",
  description: "Work Item auswählen und den Lauf starten.",
  skill: "feature-run",
  category: "Entwicklung",
  prompt: "Setze ein Feature um.",
  guide: "test.product.work-item",
  order: 10,
  ...overrides,
});

const simpleSkillEntry = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "ragents.reference.demo",
  action: "skill" as const, category: "Beispiele",
  skill: "demo",
  title: "Demo",
  description: "Eine Karte.",
  prompt: "Frei",
  order: 20,
  ...overrides,
});

const scriptEntry = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "ragents.reference.setup",
  action: "script" as const,
  title: "Vorgebaut",
  description: "Ein Run aus einem Script.",
  order: 5,
  script: {
    handle: "setup",
    coordinator: true,
    files: [{path: "package.json", content: '{"private":true}'}, {path: "src/server.ts", content: "export const program = {};"}],
    programs: [],
  },
  ...overrides,
});

const registered = (...entries: Array<Record<string, unknown>>) => {
  const registry = new StartEntryContributionRegistry();
  registry.register("test.plugin", entries as never);
  return registry;
};

test("Einstiege beider Aktionen werden mit Besitzer beschrieben und nach Ordnung sortiert", () => {
  const registry = registered(skillEntry(), simpleSkillEntry(), scriptEntry());
  assert.deepEqual(registry.describe().map((entry) => [entry.id, entry.owner, entry.action, entry.guide]), [
    ["ragents.reference.setup", "test.plugin", "script", undefined],
    ["test.product.feature-run", "test.plugin", "skill", "test.product.work-item"],
    ["ragents.reference.demo", "test.plugin", "skill", undefined],
  ]);
  const script = registry.describe().find((entry) => entry.action === "script");
  assert.ok(script && script.action === "script");
  assert.equal(script.coordinator, true);
  assert.equal("source" in script, false);
  assert.equal("files" in script, false);
});

test("das Run-Script-Paket bleibt serverseitig und ist nur für Script-Einstiege abrufbar", () => {
  const registry = registered(skillEntry(), scriptEntry());
  const found = registry.scriptPackage("ragents.reference.setup");
  assert.ok(found);
  assert.deepEqual(found.files, scriptEntry().script.files);
  assert.equal(found.entry.owner, "test.plugin");
  assert.equal(registry.scriptPackage("test.product.feature-run"), undefined);
  assert.equal(registry.scriptPackage("nirgends"), undefined);
});

test("fremde Felder, leere Pflichtfelder und falsche Kennungen sind harte Fehler", () => {
  assert.throws(() => registered(skillEntry({ skill: "" })), /kein gültiges skill/);
  assert.throws(() => registered(skillEntry({ skill: "Falscher Name" })), /Skill-Namen/);
  assert.throws(() => registered(skillEntry({ instructions: "b" })), /unbekannte Felder/);
  assert.throws(() => registered(skillEntry({ guide: "Leitfaden!" })), /Leitfaden-Kennung/);
  assert.throws(() => registered(simpleSkillEntry({ prompt: " " })), /kein gültiges prompt/);
  assert.throws(() => registered(simpleSkillEntry({ prompts: { technical: "a", free: "b" } })), /unbekannte Felder: prompts/);
  assert.throws(() => registered(simpleSkillEntry({ action: "magic" })), /unbekannte Aktion magic/);
});

test("ein Run-Script braucht Paketdateien mit eindeutigen relativen Pfaden", () => {
  const withScript = (script: Record<string, unknown>) => scriptEntry({ script: { ...scriptEntry().script, ...script } });
  assert.throws(() => registered(withScript({ files: [] })), /files braucht Paketdateien/);
  assert.throws(() => registered(withScript({ files: [{path: "src/server.ts", content: ""}] })), /package.json fehlt/);
  assert.throws(() => registered(withScript({ files: [{path: "../package.json", content: ""}] })), /ungültiger Paketpfad/);
  assert.throws(() => registered(withScript({ files: [{path: "package.json", content: ""}, {path: "package.json", content: ""}] })), /ist doppelt/);
  assert.throws(() => registered(withScript({ programs: [{name: "setup", files: scriptEntry().script.files}] })), /Programm setup ist doppelt/);
  assert.throws(() => registered(withScript({ coordinator: "yes" })), /coordinator muss true oder false/);
  assert.throws(() => registered(withScript({ handle: "Set Up" })), /handle muss ein Handle/);
  assert.throws(() => registered(withScript({ source: "legacy" })), /unbekannte Felder: source/);
});

test("ein Skill-Einstieg darf nur auf einen registrierten Skill zeigen", () => {
  const registry = registered(skillEntry(), scriptEntry());
  registry.assertSkillsKnown([skill("test.product", "feature-run")]);
  assert.throws(() => registry.assertSkillsKnown([skill("test.product", "release-md")]), /unbekannten Skill feature-run/);
});

test("Skill-Einstiege veröffentlichen genau eine freie Kategorie und leiten sie nicht aus Tags ab", () => {
  const registry = registered(simpleSkillEntry({ category: "Meine eigene Gruppe", tags: ["Anderes Schlagwort"] }));
  const card = registry.describe()[0]!;
  assert.equal(card.action, "skill");
  assert.equal(card.action === "skill" && card.category, "Meine eigene Gruppe");
  for (const category of [undefined, null, "", " ", " führend", ["Eine", "Zwei"], 1]) {
    assert.throws(() => registered(simpleSkillEntry({ category })), /category/);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { Type } from "typebox";
import { PluginHost, StartEntryContributionRegistry, StartOptionContributionRegistry } from "../src/plugin-host.ts";

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
  description: "Work Item auswählen und den Run starten.",
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

test("Vorlagen beider Aktionen werden mit Besitzer beschrieben und nach Ordnung sortiert", () => {
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

test("das Run-Script-Paket bleibt serverseitig und ist nur für Script-Vorlagen abrufbar", () => {
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

test("eine Skill-Vorlage darf nur auf einen registrierten Skill zeigen", () => {
  const registry = registered(skillEntry(), scriptEntry());
  registry.assertSkillsKnown([skill("test.product", "feature-run")]);
  assert.throws(() => registry.assertSkillsKnown([skill("test.product", "release-md")]), /unbekannten Skill feature-run/);
});

test("Skill-Vorlagen veröffentlichen genau eine freie Kategorie und leiten sie nicht aus Tags ab", () => {
  const registry = registered(simpleSkillEntry({ category: "Meine eigene Gruppe", tags: ["Anderes Schlagwort"] }));
  const card = registry.describe()[0]!;
  assert.equal(card.action, "skill");
  assert.equal(card.action === "skill" && card.category, "Meine eigene Gruppe");
  for (const category of [undefined, null, "", " ", " führend", ["Eine", "Zwei"], 1]) {
    assert.throws(() => registered(simpleSkillEntry({ category })), /category/);
  }
});

const sourceOption = {
  id: "example.source",
  schema: Type.Union([Type.Literal("empty"), Type.Literal("clone")]),
  selectable: () => true,
  defaultValue: () => "empty",
  accept: (value: unknown) => value === "clone" ? "clone" : "empty",
  describe: () => ({ kind: "choice", label: "Quelle", options: [] }),
};

test("eine Vorlage legt Startoptionen fest, die das Web mit ihr sieht", () => {
  const registry = registered(scriptEntry({ fixedStartOptions: { "example.source": "clone" } }), simpleSkillEntry());
  assert.deepEqual(registry.entry("ragents.reference.setup")?.fixedStartOptions, { "example.source": "clone" });
  assert.deepEqual(registry.scriptPackage("ragents.reference.setup")?.entry.fixedStartOptions, { "example.source": "clone" });
  assert.equal(registry.entry("ragents.reference.demo")?.fixedStartOptions, undefined);
  assert.equal(registry.entry("nirgends"), undefined);
  const options = new StartOptionContributionRegistry();
  options.register("example.plugin", [sourceOption]);
  registry.assertFixedStartOptionsKnown(options);
});

test("festgelegte Startoptionen brauchen ein Objekt mit gültigen Kennungen und JSON-Werten", () => {
  for (const fixedStartOptions of [{}, [], "clone", null]) {
    assert.throws(() => registered(simpleSkillEntry({ fixedStartOptions })), /fixedStartOptions muss mindestens eine Startoption/, JSON.stringify(fixedStartOptions));
  }
  assert.throws(() => registered(simpleSkillEntry({ fixedStartOptions: { "Keine Id": "x" } })), /ungültige Startoption-Id Keine Id/);
  assert.throws(() => registered(simpleSkillEntry({ fixedStartOptions: { "example.source": () => "clone" } })), /fixedStartOptions\.example\.source/);
});

test("eine festgelegte Startoption muss beim Versiegeln registriert sein und ihrem Schema genügen", () => {
  const hostWith = (fixed: Record<string, unknown>, withOption = true) => {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/unused", storageModes: { sessionsRoot: 0o700, session: 0o700 } });
    host.register({ manifest: { id: "example.plugin" }, register: (registration) => {
      if (withOption) registration.startOptions(sourceOption);
      registration.startEntries(simpleSkillEntry({ fixedStartOptions: fixed }) as never);
    } });
    return host;
  };
  assert.throws(() => hostWith({ "example.source": "clone" }, false).seal(), /legt die nicht registrierte Startoption example\.source fest/);
  assert.throws(() => hostWith({ "example.source": "anders" }).seal(), /festgelegter Wert der Vorlage ragents\.reference\.demo/);
  hostWith({ "example.source": "clone" }).seal();
});

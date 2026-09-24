import assert from "node:assert/strict";
import test from "node:test";

import { StartEntryContributionRegistry, type PublicStartEntry } from "@ragents/engine";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { skillsFromDirectory } from "../src/plugin-support/skills.ts";
import { runScriptsFromDirectory } from "../src/plugin-support/run-scripts.ts";
import { startEntryFrom, type StartEntry } from "../src/plugin-support/start-entries-contract.ts";

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// The wire contract the web parses is exactly what the plugin host publishes.
const wireMatchesEngine: Mutual<PublicStartEntry, StartEntry> = true;
void wireMatchesEngine;

const base = { id: "x.one", owner: "x", title: "Eins", description: "Ein Einstieg" };

test("example tags survive both asset loaders, publication and web parsing", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "ragents-entry-tags-"));
  try {
    const skills = path.join(scratch, "skills");
    const example = path.join(skills, "example");
    const scripts = path.join(scratch, "scripts");
    const setup = path.join(scripts, "example");
    mkdirSync(example, { recursive: true });
    mkdirSync(setup, { recursive: true });
    const header = "---\ntitle: Beispiel\ndescription: Geführter Einstieg\ntags: Anwendungsfall, Konzeptdemo, Startleitfaden\n";
    writeFileSync(path.join(example, "SKILL.md"), `${header}name: example
start: true
category: Beispiele\n---\nFreier Auftrag\n`);
    writeFileSync(path.join(setup, "RUN.md"), `${header}---\n`);
    writeFileSync(path.join(setup, "package.json"), JSON.stringify({private: true, ragents: {title: "Setup", backend: "src/server.ts"}}));
    mkdirSync(path.join(setup, "src"));
    writeFileSync(path.join(setup, "src/server.ts"), "export default {};\n");
    const registry = new StartEntryContributionRegistry();
    registry.register("example", [
      ...skillsFromDirectory(skills, "example.skill").startEntries,
      ...runScriptsFromDirectory(scripts, "example.script"),
    ]);
    const entries = registry.describe().map(startEntryFrom);
    assert.equal(entries.length, 2);
    for (const entry of entries) assert.deepEqual(entry.tags, ["Anwendungsfall", "Konzeptdemo", "Startleitfaden"]);
    writeFileSync(path.join(example, "SKILL.md"), `${header.replace("Anwendungsfall, Konzeptdemo, Startleitfaden", "Konzeptdemo, Konzeptdemo")}name: example\nstart: true\ncategory: Beispiele\n---\nF\n`);
    assert.throws(() => skillsFromDirectory(skills, "example"), /tags müssen eindeutige/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("invalid tags fail at plugin registration and at the web boundary", () => {
  for (const tags of ["Konzeptdemo", [""], [" "], [" doppelt"], ["doppelt", "doppelt"], [1]]) {
    const entry = { ...base, action: "skill", skill: "example", category: "Beispiele", prompt: "F", tags };
    assert.throws(() => startEntryFrom(entry), /tags müssen eindeutige/);
    const { owner: _, ...contribution } = entry;
    assert.throws(() => new StartEntryContributionRegistry().register("x", [contribution as never]), /tags müssen eindeutige/);
  }
});

test("startEntryFrom nimmt beide Aktionen an und lehnt alles andere benannt ab", () => {
  const prompt = startEntryFrom({ ...base, action: "skill", skill: "example", category: "Beispiele", prompt: "F", order: 3 });
  assert.equal(prompt.action, "skill");
  assert.equal(prompt.prompt, "F");
  assert.equal(prompt.order, 3);
  const skill = startEntryFrom({ ...base, action: "skill", skill: "decision-brief", category: "Entwicklung", prompt: "Feature umsetzen", guide: "test.plugin.decision" });
  assert.equal(skill.action, "skill");
  assert.equal(skill.guide, "test.plugin.decision");
  const script = startEntryFrom({ ...base, action: "script", coordinator: false });
  assert.deepEqual(script, { ...base, action: "script", coordinator: false });

  assert.throws(() => startEntryFrom({ ...base, action: "magic" }), /unbekannte Aktion magic/);
  for (const text of [undefined, "", " ", 42]) {
    assert.throws(() => startEntryFrom({ ...base, action: "skill", skill: "example", category: "Beispiele", prompt: text }), /prompt fehlt oder ist leer/);
  }
  assert.throws(() => startEntryFrom({ ...base, action: "skill", skill: "example", category: "Beispiele", prompts: { technical: "T", free: "F" } }), /unbekannte Felder prompts/);
  assert.throws(() => startEntryFrom({ ...base, action: "skill" }), /skill fehlt/);
  assert.throws(() => startEntryFrom({ ...base, action: "script", coordinator: "ja" }), /coordinator muss true oder false/);
  assert.throws(() => startEntryFrom({ ...base, action: "script", coordinator: true, source: "x" }), /unbekannte Felder source/);
  assert.throws(() => startEntryFrom({ ...base, id: "" }), /id fehlt/);
  assert.throws(() => startEntryFrom({ ...base, action: "skill", skill: "s", order: "1" }), /order ist keine Zahl/);
});

test("ein Run-Script darf eine eigene Kategorie tragen; ohne bleibt es ohne", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "ragents-entry-category-"));
  try {
    const scripts = path.join(scratch, "scripts");
    const withCategory = path.join(scripts, "moderation");
    const without = path.join(scripts, "schlicht");
    for (const directory of [withCategory, without]) {
      mkdirSync(path.join(directory, "src"), { recursive: true });
      writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, ragents: {title: "Setup", backend: "src/server.ts"}}));
      writeFileSync(path.join(directory, "src/server.ts"), "export default {};\n");
    }
    writeFileSync(path.join(withCategory, "RUN.md"), "---\ntitle: Moderierte Runde\ndescription: Ein Ablauf\ncategory: Moderation\n---\n");
    writeFileSync(path.join(without, "RUN.md"), "---\ntitle: Schlicht\ndescription: Ein Ablauf\n---\n");
    const registry = new StartEntryContributionRegistry();
    registry.register("example", runScriptsFromDirectory(scripts, "example.script"));
    const entries = registry.describe().map(startEntryFrom);
    assert.deepEqual(entries.map((entry) => [entry.id, (entry as { category?: string }).category]), [
      ["example.script.moderation", "Moderation"],
      ["example.script.schlicht", undefined],
    ]);
    writeFileSync(path.join(without, "RUN.md"), "---\ntitle: Schlicht\ndescription: Ein Ablauf\ncategory:  \n---\n");
    assert.throws(() => runScriptsFromDirectory(scripts, "example.script"), /category ist leer/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  assert.deepEqual(startEntryFrom({ ...base, action: "script", coordinator: true, category: "Spiele" }),
    { ...base, action: "script", coordinator: true, category: "Spiele" });
  for (const category of ["", " ", " führend", ["A"], 1]) {
    assert.throws(() => startEntryFrom({ ...base, action: "script", coordinator: true, category }), /category/);
  }
});

test("die HTTP-Grenze erhält freie Skillkategorien und lehnt fehlende oder mehrfache Kategorien ab", () => {
  const prompt = { ...base, action: "skill", skill: "example", prompt: "F", category: "Frei gewählte Gruppe" };
  assert.equal((startEntryFrom(prompt) as { category: string }).category, prompt.category);
  for (const category of [undefined, null, "", " ", " führend", ["A", "B"], 1]) {
    assert.throws(() => startEntryFrom({ ...prompt, category }), /category/);
  }
});

test("RUN.md legt Startoptionen als JSON-Objekt fest; Registry, Veröffentlichung und Web tragen sie weiter", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "ragents-entry-fixed-"));
  try {
    const setup = path.join(scratch, "scripts", "worktree-setup");
    mkdirSync(path.join(setup, "src"), { recursive: true });
    writeFileSync(path.join(setup, "package.json"), JSON.stringify({private: true, ragents: {title: "Setup", backend: "src/server.ts"}}));
    writeFileSync(path.join(setup, "src/server.ts"), "export default {};\n");
    const runFile = (fixed: string) => writeFileSync(path.join(setup, "RUN.md"),
      `---\ntitle: Im Worktree\ndescription: Arbeitet nur im Ordner je Run\nfixed-start-options: ${fixed}\n---\n`);
    runFile('{"ragents.workspace.binding": {"kind": "fresh"}}');
    const [entry] = runScriptsFromDirectory(path.join(scratch, "scripts"), "example");
    assert.deepEqual(entry?.fixedStartOptions, { "ragents.workspace.binding": { kind: "fresh" } });
    const registry = new StartEntryContributionRegistry();
    registry.register("example", [entry!]);
    const [published] = registry.describe().map(startEntryFrom);
    assert.deepEqual(published?.fixedStartOptions, { "ragents.workspace.binding": { kind: "fresh" } });
    runFile("{kind: fresh}");
    assert.throws(() => runScriptsFromDirectory(path.join(scratch, "scripts"), "example"), /fixed-start-options ist kein JSON/);
    runFile('["ragents.workspace.binding"]');
    assert.throws(() => runScriptsFromDirectory(path.join(scratch, "scripts"), "example"), /fixed-start-options muss ein JSON-Objekt/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const fixedStartOptions of [{}, [], "fresh"]) {
    assert.throws(() => startEntryFrom({ ...base, action: "script", coordinator: true, fixedStartOptions }), /fixedStartOptions muss mindestens eine Startoption/);
  }
});

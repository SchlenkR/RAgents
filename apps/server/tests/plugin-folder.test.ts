import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type {
  PluginRegistration,
  RAgentsPlugin,
  SkillContribution,
  StartEntryContribution,
} from "@aicontainer/ragents";

import {
  folderSkills,
  folderRunScripts,
  folderSkillPaths,
  folderSystemPrompts,
  pluginFolder,
  withFolderAssets,
} from "../src/plugin-support/plugin-folder.ts";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/plugin-folder/${name}`, import.meta.url));

const registered = (plugin: RAgentsPlugin) => {
  const startEntries: StartEntryContribution[] = [];
  const skills: SkillContribution[] = [];
  const registration = {
    startEntries: (...entries: readonly StartEntryContribution[]) => startEntries.push(...entries),
    skills: (...entries: readonly SkillContribution[]) => skills.push(...entries),
  } as unknown as PluginRegistration;
  withFolderAssets(plugin).register(registration);
  return { startEntries, skillEntries: startEntries.filter((entry) => entry.action === "skill"), skills };
};

test("a plugin without asset folders contributes nothing by convention", () => {
  const folder = pluginFolder("ragents.ask");

  assert.deepEqual(folderSkills(folder, "ragents.ask").startEntries, []);
  assert.deepEqual(folderRunScripts(folder, "ragents.ask"), []);
  assert.deepEqual(folderSkillPaths(folder), []);
  assert.deepEqual(folderSystemPrompts(folder), []);
});

test("a plugin folder contributes its skill starters, skills and system prompts", () => {
  const folder = fixture("complete");
  const cards = folderSkills(folder, "test.plugin").startEntries;

  assert.deepEqual(cards.map((card) => card.id), ["test.plugin.10-example"]);
  assert.equal(cards[0]?.title, "Beispielkarte");
  assert.equal(cards[0]?.prompt, "Ich hätte gern einen Beleg, dass diese Karte aus dem Plugin-Ordner stammt.");
  const scripts = folderRunScripts(folder, "test.plugin");
  assert.deepEqual(scripts.map((script) => [script.id, script.script.handle, script.script.coordinator]), [
    ["test.plugin.example-run", "example-run", false],
  ]);
  assert.equal(scripts[0]?.guide, "test.guide");
  assert.deepEqual(scripts[0]?.script.files.map((file) => file.path), ["package.json", "src/server.ts", "tests/start.test.ts"]);
  assert.deepEqual(scripts[0]?.script.programs.map((program) => program.name), ["demo"]);
  assert.deepEqual(folderSkillPaths(folder), [path.join(folder, "skills", "10-example"), path.join(folder, "skills", "example-skill")]);
  assert.deepEqual(
    folderSystemPrompts(folder).map((option) => ({ id: option.id, label: option.label })),
    [{ id: "example", label: "Beispielprompt" }],
  );
});

test("the reference plugin owns its skill starters", () => {
  const cards = folderSkills(pluginFolder("ragents.reference"), "ragents.reference").startEntries;

  assert.ok(cards.length > 0);
  assert.ok(cards.every((card) => card.id.startsWith("ragents.reference.")));
  assert.ok(cards.some((card) => card.id === "ragents.reference.20-circle-of-four"));
});

test("a broken skill starter in a plugin folder is a hard error", () => {
  assert.throws(
    () => folderSkills(fixture("broken-card"), "test.plugin").startEntries,
    /es fehlt der ---Kopf mit name und description/,
  );
});

test("a run script package rejects missing package metadata, stray files and legacy headers", () => {
  assert.throws(() => folderRunScripts(fixture("broken-run-script"), "test.plugin"), /fehlt die Datei package\.json/);
  assert.throws(() => folderRunScripts(fixture("stray-run-script"), "test.plugin"), /Dateien statt Run-Script-Ordner/);
  assert.throws(() => folderRunScripts(fixture("legacy-run-script"), "test.plugin"), /unbekannte Kopfzeilen capabilities/);
});

test("a skill folder without SKILL.md is a hard error", () => {
  assert.throws(() => folderSkillPaths(fixture("skill-without-manifest")), /fehlt die SKILL\.md/);
});

test("a plugin without its own folder is a hard error", () => {
  assert.throws(() => pluginFolder("ragents.nowhere"), /hat keinen Ordner/);
});

test("the convention does not register a card the plugin already declared itself", () => {
  const claimed = folderSkills(pluginFolder("ragents.reference"), "ragents.reference").startEntries[0]!.id;
  const plugin: RAgentsPlugin = {
    manifest: { id: "ragents.reference" },
    register: (host) => host.startEntries({
      id: claimed,
      action: "skill", skill: "test-skill", category: "Beispiele",
      title: "Ausdrücklich angemeldet",
      description: "Diese Karte meldet das Plugin selbst an.",
      prompt: "Freie Fassung",
      order: 10,
    }),
  };

  const { skillEntries, startEntries } = registered(plugin);
  const ids = skillEntries.map((card) => card.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(skillEntries.filter((card) => card.id === claimed).length, 1);
  assert.equal(skillEntries.find((card) => card.id === claimed)?.title, "Ausdrücklich angemeldet");
  assert.equal(
    skillEntries.length,
    folderSkills(pluginFolder("ragents.reference"), "ragents.reference").startEntries.length,
  );
  assert.deepEqual(
    startEntries.filter((entry) => entry.action === "script").map((entry) => entry.id),
    folderRunScripts(pluginFolder("ragents.reference"), "ragents.reference").map((entry) => entry.id),
  );
});

test("the convention leaves a skill the plugin registered with its own audience alone", async () => {
  const folder = pluginFolder("ragents.reference");
  const explicit = path.join(folder, "skills", "95-hello-world");
  const plugin: RAgentsPlugin = {
    manifest: { id: "ragents.reference" },
    register: (host) => host.skills({
      id: "ragents.reference.hello-world.skill",
      audiences: ["coordinator"],
      paths: () => [explicit],
    }),
  };

  const { skills } = registered(plugin);
  const folderSkills = skills.find((skill) => skill.id === "ragents.reference.folder-skills");
  assert.ok(folderSkills);

  const paths = await folderSkills.paths(undefined);
  assert.ok(!paths.includes(explicit));
  assert.deepEqual(paths, folderSkillPaths(folder).filter((entry) => entry !== explicit));
});

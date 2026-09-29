import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type {
  ActorPackageContribution,
  PluginRegistration,
  RAgentsPlugin,
  SkillContribution,
  StartEntryContribution,
} from "@ragents/engine";

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
  const actorPackages: ActorPackageContribution[] = [];
  const registration = {
    startEntries: (...entries: readonly StartEntryContribution[]) => startEntries.push(...entries),
    skills: (...entries: readonly SkillContribution[]) => skills.push(...entries),
    actorPackages: (...entries: readonly ActorPackageContribution[]) => actorPackages.push(...entries),
  } as unknown as PluginRegistration;
  withFolderAssets(plugin).register(registration);
  return { startEntries, skillEntries: startEntries.filter((entry) => entry.action === "skill"), skills, actorPackages };
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
  assert.equal(cards[0]?.title, "Example card");
  assert.equal(cards[0]?.prompt, "I would like proof that this card comes from the plugin folder.");
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
    [{ id: "example", label: "Example prompt" }],
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
    /the --- header with name and description is missing/,
  );
});

test("a run script package rejects missing package metadata, stray files and legacy headers", () => {
  assert.throws(() => folderRunScripts(fixture("broken-run-script"), "test.plugin"), /is missing the file package\.json/);
  assert.throws(() => folderRunScripts(fixture("stray-run-script"), "test.plugin"), /files instead of run script folders/);
  assert.throws(() => folderRunScripts(fixture("legacy-run-script"), "test.plugin"), /unknown header lines capabilities/);
});

test("a skill folder without SKILL.md is a hard error", () => {
  assert.throws(() => folderSkillPaths(fixture("skill-without-manifest")), /is missing its SKILL\.md/);
});

test("a plugin without its own folder is a hard error", () => {
  assert.throws(() => pluginFolder("ragents.nowhere"), /has no folder/);
});

test("the convention does not register a card the plugin already declared itself", () => {
  const claimed = folderSkills(pluginFolder("ragents.reference"), "ragents.reference").startEntries[0]!.id;
  const plugin: RAgentsPlugin = {
    manifest: { id: "ragents.reference" },
    register: (host) => host.startEntries({
      id: claimed,
      action: "skill", skill: "test-skill", category: "Examples",
      title: "Explicitly registered",
      description: "The plugin registers this card itself.",
      prompt: "Free version",
      order: 10,
    }),
  };

  const { skillEntries, startEntries } = registered(plugin);
  const ids = skillEntries.map((card) => card.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(skillEntries.filter((card) => card.id === claimed).length, 1);
  assert.equal(skillEntries.find((card) => card.id === claimed)?.title, "Explicitly registered");
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

test("a skill the plugin registered for some runs only does not come back through the convention in the others", async () => {
  const folder = pluginFolder("ragents.reference");
  const explicit = path.join(folder, "skills", "95-hello-world");
  const plugin: RAgentsPlugin = {
    manifest: { id: "ragents.reference" },
    register: (host) => host.skills({
      id: "ragents.reference.hello-world.skill",
      paths: (context) => context?.runId === "without-skill" ? [] : [explicit],
    }),
  };

  const { skills } = registered(plugin);
  const folderSkills = skills.find((skill) => skill.id === "ragents.reference.folder-skills");
  assert.ok(folderSkills);

  const paths = await folderSkills.paths({ runId: "without-skill", agentId: "agent", audience: "agent", workspace: folder });
  assert.ok(!paths.includes(explicit));
});

test("the convention registers the shared actor packages of the actors folder, except one the plugin registered itself", () => {
  const convention = registered({ manifest: { id: "ragents.reference" }, register: () => undefined });
  assert.deepEqual(convention.actorPackages.map((entry) => entry.name), ["notebook"]);
  assert.ok(convention.actorPackages[0]!.files.some((file) => file.path === "tests/program.test.ts"));
  const own: ActorPackageContribution = { name: "notebook", files: [{ path: "package.json", content: "{}" }] };
  const explicit = registered({ manifest: { id: "ragents.reference" }, register: (host) => host.actorPackages(own) });
  assert.deepEqual(explicit.actorPackages, [own]);
});

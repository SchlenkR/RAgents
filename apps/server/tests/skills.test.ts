import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { StartEntryContributionRegistry } from "@ragents/engine";

import { folderSkills, pluginFolder } from "../src/plugin-support/plugin-folder.ts";
import { skillEnvDescriptors, skillsFromDirectory, skillsFromEnvironment, type SkillStartEntry } from "../src/plugin-support/skills.ts";

import { declaredEnvironment } from "../src/plugin-support/plugin-config.ts";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/skills/${name}/`, import.meta.url));

const cardOwners = ["ragents.reference"] as const;

const cardsOf = (owner: string): readonly SkillStartEntry[] =>
  folderSkills(pluginFolder(owner), owner).startEntries;

test("all reference skill starters are complete and publish in order", () => {
  const registry = new StartEntryContributionRegistry();
  const skillEntries = cardOwners.flatMap((owner) => {
    const cards = cardsOf(owner);
    const files = readdirSync(path.join(pluginFolder(owner), "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    assert.equal(cards.length, files.length);
    assert.ok(cards.length > 0);
    registry.register(owner, cards);
    return cards;
  });

  assert.equal(new Set(skillEntries.map((card) => card.id)).size, skillEntries.length);
  for (const card of skillEntries) {
    assert.match(card.id, /^ragents\.reference\.[a-z0-9-]+$/);
    assert.notEqual(card.title.trim(), "");
    assert.notEqual(card.description.trim(), "");
    assert.notEqual(card.category.trim(), "");
    assert.notEqual(card.prompt.trim(), "");
    assert.equal(typeof card.order, "number");
    assert.ok(Number.isFinite(card.order));
  }

  const ordered = registry.describe();
  assert.ok(ordered.every((card) => card.action === "skill"));
  const orders = ordered.map((card) => card.order as number);
  assert.deepEqual(orders, orders.toSorted((left, right) => left - right));
});

test("reference prompts stay short and omit API names and internal runtime terms", () => {
  const forbidden = [
    /`/,
    /\b(actorinput|actorinputs)\b/i,
    /\bsubscription(s)?\b/i,
    /\bturn(s)?\b/i,
    /\bevent(s)?\b/i,
    /\bvermittler\b/i,
    /\bcapabilit/i,
    /\bartefakt\b/i,
    /\brun-modul\b/i,
    /\bvorlage\b/i,
    /\b(agent_spawn|actor_input|actor_list|actor_stop|event_subscribe|event_unsubscribe)\b/,
    /\b(event_subscription_list|event_query|artifact_publish|artifact_read|model_list|tool_open)\b/,
    /\b(actor_program|actor_view|mini_app|script_tool|script_actor)_[a-z]+\b/,
  ];

  for (const card of cardOwners.flatMap((owner) => cardsOf(owner)).filter((entry) => /^ragents\.reference\.\d/.test(entry.id))) {
    const prompt = card.prompt;
    for (const pattern of forbidden) {
      assert.doesNotMatch(prompt, pattern, `${card.id}: der Prompt verrät ${pattern}`);
    }
    assert.ok(prompt.length <= 460, `${card.id}: der Prompt ist zu lang`);
    assert.match(prompt, /^Ich hätte gern /);
  }
});

test("a skill starter without frontmatter is rejected", () => {
  assert.throws(
    () => skillsFromDirectory(fixture("no-frontmatter"), "test.file"),
    /es fehlt der ---Kopf mit name und description/,
  );
});

test("an unknown skill frontmatter field is rejected", () => {
  assert.throws(
    () => skillsFromDirectory(fixture("unknown-field"), "test.file"),
    /unbekannte Kopfzeilen unknown/,
  );
});

test("the former text frontmatter field is rejected", () => {
  assert.throws(
    () => skillsFromDirectory(fixture("legacy-text-field"), "test.file"),
    /unbekannte Kopfzeilen text/,
  );
});

test("a skill starter keeps the complete markdown body without section markers", () => {
  const [card] = skillsFromDirectory(fixture("markdown-body"), "test.file").startEntries;
  assert.equal(
    card?.prompt,
    "Ich hätte gern eine Zusammenfassung.\n\n## Inhalt\n\nBeschreibe das Ergebnis.\n\n### Format\n\nNutze eine kurze Liste.",
  );
});

test("a skill starter with an empty body is rejected", () => {
  assert.throws(
    () => skillsFromDirectory(fixture("empty-body"), "test.file"),
    /Skill-Anleitung ist leer/,
  );
});

test("the contribution registry rejects the former prompts field", () => {
  const registry = new StartEntryContributionRegistry();
  const legacy = {
    id: "test.legacy",
    action: "skill" as const,
    skill: "test-skill",
    category: "Beispiele",
    title: "Test",
    description: "Beschreibung",
    prompts: { technical: "Technisch", free: "Frei" },
  };

  assert.throws(
    () => registry.register("test", [legacy as never]),
    /unbekannte Felder: prompts/,
  );
});

test("the contribution registry rejects missing, empty and non-text prompts", () => {
  const registry = new StartEntryContributionRegistry();
  const valid = {
    id: "test.valid",
    action: "skill" as const,
    skill: "test-skill",
    category: "Beispiele",
    title: "Test",
    description: "Beschreibung",
    prompt: "Frei",
  };

  for (const prompt of [undefined, "", "  ", 42]) {
    assert.throws(
      () => registry.register("test", [{ ...valid, prompt } as never]),
      /kein gültiges prompt/,
    );
  }
});

test("the contribution registry rejects invalid card identity and layout values", () => {
  const registry = new StartEntryContributionRegistry();
  const valid = {
    id: "test.valid",
    action: "skill" as const,
    skill: "test-skill",
    category: "Beispiele",
    title: "Test",
    description: "Beschreibung",
    prompt: "Frei",
  };

  assert.throws(
    () => registry.register("test", [{ ...valid, id: "" }]),
    /kein gültiges id/,
  );
  assert.throws(
    () => registry.register("test", [{ ...valid, wide: true } as never]),
    /unbekannte Felder: wide/,
  );
});

test("a directory without markdown skill starters is rejected", () => {
  assert.throws(
    () => skillsFromDirectory(fixture("without-markdown"), "test.file"),
    /es fehlt der ---Kopf/,
  );
});

for (const name of ["missing-category", "empty-category"]) {
  test(`a skill starter with ${name} is rejected`, () => {
    assert.throws(() => skillsFromDirectory(fixture(name), "test.file"), /category fehlt/);
  });
}


test("runtime skills remain off the start page and explicit prompts retain YAML text", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-skills-"));
  try {
    const runtime = path.join(directory, "runtime");
    const starter = path.join(directory, "starter");
    mkdirSync(runtime);
    mkdirSync(starter);
    writeFileSync(path.join(runtime, "SKILL.md"), "---\nname: runtime\ndescription: Work instruction\nmetadata:\n  author: Test\n---\nDo the work.\n");
    writeFileSync(path.join(starter, "SKILL.md"), "---\nname: starter\ndescription: Work instruction\nstart: true\ntitle: Start\ncategory: Work\nprompt: |\n  My own task.\n  With another line.\nguide: test.guide\ndisable-model-invocation: true\n---\nReusable instruction.\n");
    const catalog = skillsFromDirectory(directory, "test");
    assert.deepEqual(catalog.paths, [runtime, starter]);
    assert.equal(catalog.startEntries.length, 1);
    assert.equal(catalog.startEntries[0]?.skill, "starter");
    assert.equal(catalog.startEntries[0]?.prompt, "My own task.\nWith another line.\n");
    assert.equal(catalog.startEntries[0]?.guide, "test.guide");
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("external skills register runtime paths and templates from the same directory", () => {
  const environment = { ...declaredEnvironment(skillEnvDescriptors), optional: () => fixture("markdown-body") };
  assert.deepEqual(skillsFromEnvironment(environment, "external"), skillsFromDirectory(fixture("markdown-body"), "external"));
  assert.deepEqual(skillsFromEnvironment({ ...declaredEnvironment(skillEnvDescriptors), optional: () => undefined }, "external"), { paths: [], startEntries: [] });
});

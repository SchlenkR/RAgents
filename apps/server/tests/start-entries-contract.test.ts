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

const base = { id: "x.one", owner: "x", title: "One", description: "A template" };

test("example tags survive both asset loaders, publication and web parsing", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "ragents-entry-tags-"));
  try {
    const skills = path.join(scratch, "skills");
    const example = path.join(skills, "example");
    const scripts = path.join(scratch, "scripts");
    const setup = path.join(scripts, "example");
    mkdirSync(example, { recursive: true });
    mkdirSync(setup, { recursive: true });
    const header = "---\ntitle: Example\ndescription: Guided start\ntags: Use case, Concept demo, Start guide\n";
    writeFileSync(path.join(example, "SKILL.md"), `${header}name: example
start: true
category: Examples\n---\nFree task\n`);
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
    for (const entry of entries) assert.deepEqual(entry.tags, ["Use case", "Concept demo", "Start guide"]);
    writeFileSync(path.join(example, "SKILL.md"), `${header.replace("Use case, Concept demo, Start guide", "Concept demo, Concept demo")}name: example\nstart: true\ncategory: Examples\n---\nF\n`);
    assert.throws(() => skillsFromDirectory(skills, "example"), /tags must be unique/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("invalid tags fail at plugin registration and at the web boundary", () => {
  for (const tags of ["Concept demo", [""], [" "], [" duplicate"], ["duplicate", "duplicate"], [1]]) {
    const entry = { ...base, action: "skill", skill: "example", category: "Examples", prompt: "F", tags };
    assert.throws(() => startEntryFrom(entry), /tags must be unique/);
    const { owner: _, ...contribution } = entry;
    assert.throws(() => new StartEntryContributionRegistry().register("x", [contribution as never]), /tags must be unique/);
  }
});

test("startEntryFrom accepts both actions and rejects everything else by name", () => {
  const prompt = startEntryFrom({ ...base, action: "skill", skill: "example", category: "Examples", prompt: "F", order: 3 });
  assert.equal(prompt.action, "skill");
  assert.equal(prompt.prompt, "F");
  assert.equal(prompt.order, 3);
  const skill = startEntryFrom({ ...base, action: "skill", skill: "decision-brief", category: "Development", prompt: "Implement feature", guide: "test.plugin.decision" });
  assert.equal(skill.action, "skill");
  assert.equal(skill.guide, "test.plugin.decision");
  const script = startEntryFrom({ ...base, action: "script", coordinator: false });
  assert.deepEqual(script, { ...base, action: "script", coordinator: false });

  assert.throws(() => startEntryFrom({ ...base, action: "magic" }), /unknown action magic/);
  for (const text of [undefined, "", " ", 42]) {
    assert.throws(() => startEntryFrom({ ...base, action: "skill", skill: "example", category: "Examples", prompt: text }), /prompt is missing or empty/);
  }
  assert.throws(() => startEntryFrom({ ...base, action: "skill", skill: "example", category: "Examples", prompts: { technical: "T", free: "F" } }), /unknown fields prompts/);
  assert.throws(() => startEntryFrom({ ...base, action: "skill" }), /skill is missing/);
  assert.throws(() => startEntryFrom({ ...base, action: "script", coordinator: "yes" }), /coordinator must be true or false/);
  assert.throws(() => startEntryFrom({ ...base, action: "script", coordinator: true, source: "x" }), /unknown fields source/);
  assert.throws(() => startEntryFrom({ ...base, id: "" }), /id is missing/);
  assert.throws(() => startEntryFrom({ ...base, action: "skill", skill: "s", order: "1" }), /order is not a number/);
});

test("a run script may carry its own category; without one it stays without", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "ragents-entry-category-"));
  try {
    const scripts = path.join(scratch, "scripts");
    const withCategory = path.join(scripts, "moderation");
    const without = path.join(scripts, "plain");
    for (const directory of [withCategory, without]) {
      mkdirSync(path.join(directory, "src"), { recursive: true });
      writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, ragents: {title: "Setup", backend: "src/server.ts"}}));
      writeFileSync(path.join(directory, "src/server.ts"), "export default {};\n");
    }
    writeFileSync(path.join(withCategory, "RUN.md"), "---\ntitle: Moderated round\ndescription: A procedure\ncategory: Moderation\n---\n");
    writeFileSync(path.join(without, "RUN.md"), "---\ntitle: Plain\ndescription: A procedure\n---\n");
    const registry = new StartEntryContributionRegistry();
    registry.register("example", runScriptsFromDirectory(scripts, "example.script"));
    const entries = registry.describe().map(startEntryFrom);
    assert.deepEqual(entries.map((entry) => [entry.id, (entry as { category?: string }).category]), [
      ["example.script.moderation", "Moderation"],
      ["example.script.plain", undefined],
    ]);
    writeFileSync(path.join(without, "RUN.md"), "---\ntitle: Plain\ndescription: A procedure\ncategory:  \n---\n");
    assert.throws(() => runScriptsFromDirectory(scripts, "example.script"), /category is empty/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  assert.deepEqual(startEntryFrom({ ...base, action: "script", coordinator: true, category: "Games" }),
    { ...base, action: "script", coordinator: true, category: "Games" });
  for (const category of ["", " ", " leading", ["A"], 1]) {
    assert.throws(() => startEntryFrom({ ...base, action: "script", coordinator: true, category }), /category/);
  }
});

test("the HTTP boundary keeps free skill categories and rejects missing or multiple categories", () => {
  const prompt = { ...base, action: "skill", skill: "example", prompt: "F", category: "Freely chosen group" };
  assert.equal((startEntryFrom(prompt) as { category: string }).category, prompt.category);
  for (const category of [undefined, null, "", " ", " leading", ["A", "B"], 1]) {
    assert.throws(() => startEntryFrom({ ...prompt, category }), /category/);
  }
});

test("RUN.md fixes start options as a JSON object; registry, publication and web carry them on", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "ragents-entry-fixed-"));
  try {
    const setup = path.join(scratch, "scripts", "worktree-setup");
    mkdirSync(path.join(setup, "src"), { recursive: true });
    writeFileSync(path.join(setup, "package.json"), JSON.stringify({private: true, ragents: {title: "Setup", backend: "src/server.ts"}}));
    writeFileSync(path.join(setup, "src/server.ts"), "export default {};\n");
    const runFile = (fixed: string) => writeFileSync(path.join(setup, "RUN.md"),
      `---\ntitle: In the worktree\ndescription: Works only in the folder per run\nfixed-start-options: ${fixed}\n---\n`);
    runFile('{"ragents.workspace.binding": {"machine": "server", "folder": "fresh"}}');
    const [entry] = runScriptsFromDirectory(path.join(scratch, "scripts"), "example");
    assert.deepEqual(entry?.fixedStartOptions, { "ragents.workspace.binding": { machine: "server", folder: "fresh" } });
    const registry = new StartEntryContributionRegistry();
    registry.register("example", [entry!]);
    const [published] = registry.describe().map(startEntryFrom);
    assert.deepEqual(published?.fixedStartOptions, { "ragents.workspace.binding": { machine: "server", folder: "fresh" } });
    runFile("{kind: fresh}");
    assert.throws(() => runScriptsFromDirectory(path.join(scratch, "scripts"), "example"), /fixed-start-options is not JSON/);
    runFile('["ragents.workspace.binding"]');
    assert.throws(() => runScriptsFromDirectory(path.join(scratch, "scripts"), "example"), /fixed-start-options must be a JSON object/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const fixedStartOptions of [{}, [], "fresh"]) {
    assert.throws(() => startEntryFrom({ ...base, action: "script", coordinator: true, fixedStartOptions }), /fixedStartOptions must fix at least one start option/);
  }
});

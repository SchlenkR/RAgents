import assert from "node:assert/strict";
import test from "node:test";

import { PluginHost, StartEntryContributionRegistry, type ActorPackageContribution, type PublicStartEntry, type StartEntryContribution } from "@ragents/engine";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { skillsFromDirectory } from "../src/plugin-support/skills.ts";
import { actorPackagesFromDirectory, runScriptsFromDirectory } from "../src/plugin-support/run-scripts.ts";
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

test("RUN.md marks a script as embeddable; without the line it only starts a new run", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "ragents-entry-embeddable-"));
  try {
    const setup = path.join(scratch, "scripts", "demo-review");
    mkdirSync(path.join(setup, "src"), { recursive: true });
    writeFileSync(path.join(setup, "package.json"), JSON.stringify({private: true, ragents: {title: "Review", backend: "src/server.ts"}}));
    writeFileSync(path.join(setup, "src/server.ts"), "export default {};\n");
    const runFile = (line: string) => writeFileSync(path.join(setup, "RUN.md"), `---\ntitle: Review\ndescription: Reviews inside a run\n${line}---\n`);
    const entries = () => runScriptsFromDirectory(path.join(scratch, "scripts"), "example");
    runFile("");
    assert.equal(entries()[0]?.script.embeddable, false);
    runFile("embeddable: true\n");
    const [entry] = entries();
    const registry = new StartEntryContributionRegistry();
    registry.register("example", [entry!]);
    assert.equal(registry.scriptPackage("example.demo-review")?.embeddable, true);
    runFile("embeddable: sometimes\n");
    assert.throws(entries, /embeddable must be true or false/);
    assert.throws(() => new StartEntryContributionRegistry().register("other", [{ ...entry!, script: { ...entry!.script, embeddable: "yes" } } as never]),
      /embeddable must be true or false/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("shared actor packages come from the actors folder, a run script names them in RUN.md", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "ragents-shared-packages-"));
  try {
    const notes = path.join(scratch, "actors", "demo-notes");
    mkdirSync(path.join(notes, "src"), { recursive: true });
    writeFileSync(path.join(notes, "package.json"), JSON.stringify({ private: true, ragents: { title: "Notes", backend: "src/server.ts" } }));
    writeFileSync(path.join(notes, "src/server.ts"), "export default {};\n");
    assert.deepEqual(actorPackagesFromDirectory(path.join(scratch, "actors")).map((entry) => [entry.name, entry.files.map((file) => file.path)]),
      [["demo-notes", ["package.json", "src/server.ts"]]]);
    const review = path.join(scratch, "scripts", "demo-review");
    mkdirSync(path.join(review, "src"), { recursive: true });
    writeFileSync(path.join(review, "package.json"), JSON.stringify({ private: true, ragents: { title: "Review", backend: "src/server.ts" } }));
    writeFileSync(path.join(review, "src/server.ts"), "export default {};\n");
    const runFile = (line: string) => writeFileSync(path.join(review, "RUN.md"), `---\ntitle: Review\ndescription: Uses shared notes\n${line}---\n`);
    runFile("shared-programs: demo-notes, demo-board\n");
    assert.deepEqual(runScriptsFromDirectory(path.join(scratch, "scripts"), "demo")[0]?.script.sharedPrograms, ["demo-notes", "demo-board"]);
    for (const line of ["shared-programs: demo-notes, demo-notes\n", "shared-programs: Notes\n", "shared-programs: demo-notes,\n"]) {
      runFile(line);
      assert.throws(() => runScriptsFromDirectory(path.join(scratch, "scripts"), "demo"), /shared-programs must name each shared actor package once/, line);
    }
    writeFileSync(path.join(scratch, "actors", "stray.md"), "no package");
    assert.throws(() => actorPackagesFromDirectory(path.join(scratch, "actors")), /contains files instead of actor package folders: stray\.md/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("profile composition rejects shared package names that clash, and scripts that need a missing one", () => {
  const files = [{ path: "package.json", content: "{}" }];
  const scriptEntry = (id: string, handle: string, extra: { sharedPrograms?: string[]; programs?: string[] } = {}): StartEntryContribution => ({
    id, action: "script", title: handle, description: "A script",
    script: { handle, coordinator: false, files, programs: (extra.programs ?? []).map((name) => ({ name, files })), ...(extra.sharedPrograms ? { sharedPrograms: extra.sharedPrograms } : {}) },
  });
  const compose = (plugins: { id: string; packages?: ActorPackageContribution[]; entries?: StartEntryContribution[] }[]) => {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/private/tmp/ragents-shared-packages-host" });
    for (const plugin of plugins) host.register({ manifest: { id: plugin.id }, register: (registration) => {
      if (plugin.packages) registration.actorPackages(...plugin.packages);
      if (plugin.entries) registration.startEntries(...plugin.entries);
    } });
    host.seal();
    return host;
  };
  const notes: ActorPackageContribution = { name: "demo-notes", files };
  const composed = compose([{ id: "demo.one", packages: [notes] }, { id: "demo.two", entries: [scriptEntry("demo.two.review", "demo-review", { sharedPrograms: ["demo-notes"] })] }]);
  assert.deepEqual(composed.actorPackages.get("demo-notes")?.pluginId, "demo.one");
  assert.deepEqual(composed.startEntries.scriptPackage("demo.two.review")?.sharedPrograms, ["demo-notes"]);
  assert.throws(() => compose([{ id: "demo.one", packages: [notes] }, { id: "demo.two", packages: [notes] }]), /Shared actor package demo-notes is already provided by demo\.one/);
  assert.throws(() => compose([{ id: "demo.one", packages: [notes] }, { id: "demo.two", entries: [scriptEntry("demo.two.notes", "demo-notes")] }]),
    /Run script demo\.two\.notes uses the name demo-notes, which is also the shared actor package of demo\.one/);
  assert.throws(() => compose([{ id: "demo.one", packages: [notes] }, { id: "demo.two", entries: [scriptEntry("demo.two.review", "demo-review", { programs: ["demo-notes"] })] }]),
    /uses the name demo-notes, which is also the shared actor package/);
  assert.throws(() => compose([{ id: "demo.two", entries: [scriptEntry("demo.two.review", "demo-review", { sharedPrograms: ["demo-board"] })] }]),
    /Run script demo\.two\.review needs the shared actor packages demo-board, which no plugin of this profile provides/);
  assert.throws(() => compose([{ id: "demo.one", packages: [{ name: "Notes", files }] }]), /the name must be a package name/);
});

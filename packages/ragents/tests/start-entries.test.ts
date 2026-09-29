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
  title: "Implement feature",
  description: "Choose a work item and start the run.",
  skill: "feature-run",
  category: "Development",
  prompt: "Implement a feature.",
  guide: "test.product.work-item",
  order: 10,
  ...overrides,
});

const simpleSkillEntry = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "ragents.reference.demo",
  action: "skill" as const, category: "Examples",
  skill: "demo",
  title: "Demo",
  description: "A card.",
  prompt: "Free",
  order: 20,
  ...overrides,
});

const scriptEntry = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "ragents.reference.setup",
  action: "script" as const,
  title: "Prebuilt",
  description: "A run from a script.",
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

test("templates of both actions are described with their owner and sorted by order", () => {
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

test("the run script package stays on the server and can only be fetched for script templates", () => {
  const registry = registered(skillEntry(), scriptEntry());
  const found = registry.scriptPackage("ragents.reference.setup");
  assert.ok(found);
  assert.deepEqual(found.files, scriptEntry().script.files);
  assert.equal(found.entry.owner, "test.plugin");
  assert.equal(registry.scriptPackage("test.product.feature-run"), undefined);
  assert.equal(registry.scriptPackage("nowhere"), undefined);
});

test("foreign fields, empty required fields and wrong ids are hard errors", () => {
  assert.throws(() => registered(skillEntry({ skill: "" })), /no valid skill/);
  assert.throws(() => registered(skillEntry({ skill: "Wrong name" })), /skill name/);
  assert.throws(() => registered(skillEntry({ instructions: "b" })), /unknown fields/);
  assert.throws(() => registered(skillEntry({ guide: "Guide!" })), /guide id/);
  assert.throws(() => registered(simpleSkillEntry({ prompt: " " })), /no valid prompt/);
  assert.throws(() => registered(simpleSkillEntry({ prompts: { technical: "a", free: "b" } })), /unknown fields: prompts/);
  assert.throws(() => registered(simpleSkillEntry({ action: "magic" })), /unknown action magic/);
});

test("a run script needs package files with unique relative paths", () => {
  const withScript = (script: Record<string, unknown>) => scriptEntry({ script: { ...scriptEntry().script, ...script } });
  assert.throws(() => registered(withScript({ files: [] })), /files needs package files/);
  assert.throws(() => registered(withScript({ files: [{path: "src/server.ts", content: ""}] })), /package.json is missing/);
  assert.throws(() => registered(withScript({ files: [{path: "../package.json", content: ""}] })), /invalid package path/);
  assert.throws(() => registered(withScript({ files: [{path: "package.json", content: ""}, {path: "package.json", content: ""}] })), /is duplicated/);
  assert.throws(() => registered(withScript({ programs: [{name: "setup", files: scriptEntry().script.files}] })), /program setup is duplicated/);
  assert.throws(() => registered(withScript({ coordinator: "yes" })), /coordinator must be true or false/);
  assert.throws(() => registered(withScript({ handle: "Set Up" })), /handle must be a handle/);
  assert.throws(() => registered(withScript({ source: "legacy" })), /unknown fields: source/);
});

test("a skill template may only point to a registered skill", () => {
  const registry = registered(skillEntry(), scriptEntry());
  registry.assertSkillsKnown([skill("test.product", "feature-run")]);
  assert.throws(() => registry.assertSkillsKnown([skill("test.product", "release-md")]), /unknown skill feature-run/);
});

test("a skill name applies once in the whole profile, across audiences too, and a second folder with the same name fails at startup", async () => {
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/unused", storageModes: { sessionsRoot: 0o700, session: 0o700 } });
  for (const [owner, audience] of [["first", "coordinator"], ["second", "agent"]] as const) {
    host.register({ manifest: { id: `${owner}.plugin` }, register: (registration) =>
      registration.skills({ id: `${owner}.review`, audiences: [audience], paths: () => [`/plugins/${owner}/skills/review`] }) });
  }
  await assert.rejects(host.initialize(), /The skill name review is used more than once in the profile: \/plugins\/first\/skills\/review, \/plugins\/second\/skills\/review/);
});

test("skill templates publish exactly one free category and do not derive it from tags", () => {
  const registry = registered(simpleSkillEntry({ category: "My own group", tags: ["Other keyword"] }));
  const card = registry.describe()[0]!;
  assert.equal(card.action, "skill");
  assert.equal(card.action === "skill" && card.category, "My own group");
  for (const category of [undefined, null, "", " ", " leading", ["One", "Two"], 1]) {
    assert.throws(() => registered(simpleSkillEntry({ category })), /category/);
  }
});

const sourceOption = {
  id: "example.source",
  schema: Type.Union([Type.Literal("empty"), Type.Literal("clone")]),
  selectable: () => true,
  defaultValue: () => "empty",
  accept: (value: unknown) => value === "clone" ? "clone" : "empty",
  describe: () => ({ kind: "choice", label: "Source", options: [] }),
};

test("a template fixes start options that the web sees with it", () => {
  const registry = registered(scriptEntry({ fixedStartOptions: { "example.source": "clone" } }), simpleSkillEntry());
  assert.deepEqual(registry.entry("ragents.reference.setup")?.fixedStartOptions, { "example.source": "clone" });
  assert.deepEqual(registry.scriptPackage("ragents.reference.setup")?.entry.fixedStartOptions, { "example.source": "clone" });
  assert.equal(registry.entry("ragents.reference.demo")?.fixedStartOptions, undefined);
  assert.equal(registry.entry("nowhere"), undefined);
  const options = new StartOptionContributionRegistry();
  options.register("example.plugin", [sourceOption]);
  registry.assertFixedStartOptionsKnown(options);
});

test("fixed start options need an object with valid ids and JSON values", () => {
  for (const fixedStartOptions of [{}, [], "clone", null]) {
    assert.throws(() => registered(simpleSkillEntry({ fixedStartOptions })), /fixedStartOptions must fix at least one start option/, JSON.stringify(fixedStartOptions));
  }
  assert.throws(() => registered(simpleSkillEntry({ fixedStartOptions: { "No id": "x" } })), /invalid start option id No id/);
  assert.throws(() => registered(simpleSkillEntry({ fixedStartOptions: { "example.source": () => "clone" } })), /fixedStartOptions\.example\.source/);
});

test("a fixed start option must be registered at sealing and satisfy its schema", () => {
  const hostWith = (fixed: Record<string, unknown>, withOption = true) => {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/unused", storageModes: { sessionsRoot: 0o700, session: 0o700 } });
    host.register({ manifest: { id: "example.plugin" }, register: (registration) => {
      if (withOption) registration.startOptions(sourceOption);
      registration.startEntries(simpleSkillEntry({ fixedStartOptions: fixed }) as never);
    } });
    return host;
  };
  assert.throws(() => hostWith({ "example.source": "clone" }, false).seal(), /fixes the unregistered start option example\.source/);
  assert.throws(() => hostWith({ "example.source": "other" }).seal(), /fixed value of template ragents\.reference\.demo/);
  hostWith({ "example.source": "clone" }).seal();
});

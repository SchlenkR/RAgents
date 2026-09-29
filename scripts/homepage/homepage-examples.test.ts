import assert from "node:assert/strict";
import test from "node:test";
import { exampleCoverage, exampleAnchor, exampleWalkthroughsHtml, exampleWalkthroughsMarkdown, type ExampleEntry, type ExampleWalkthrough } from "./homepage-examples.js";

const concepts = [{ id: "team", label: "Agent teams" }];
const entry = (id: string, overrides: Partial<ExampleEntry> = {}): ExampleEntry => ({
  id, title: id, owner: "ragents.reference", action: "skill", tags: ["Concept demo", "Agent teams"], ...overrides,
});

test("both perspectives may overlap and each example counts only once", () => {
  const first = entry("one", { tags: ["Use case", "Concept demo", "Agent teams"] });
  assert.throws(() => exampleCoverage([first], concepts), /Agent teams \(1\/2\)/);
  const coverage = exampleCoverage([first, entry("two")], concepts);
  assert.deepEqual(coverage.axes.map((axis) => axis.examples.length), [1, 2]);
  assert.deepEqual(coverage.concepts[0].examples.map((example) => example.id), ["one", "two"]);
  assert.throws(() => exampleCoverage([first, first], concepts), /Duplicate reference example/);
});

test("private or foreign templates do not satisfy reference coverage", () => {
  assert.throws(() => exampleCoverage([entry("one"), entry("two", { owner: "private.product" })], concepts), /Agent teams \(1\/2\)/);
});

test("missing and unknown concept tags stop the generation", () => {
  for (const tags of [undefined, [], ["Agent teams"]]) {
    assert.throws(() => exampleCoverage([entry("one", { tags }), entry("two")], concepts), /needs the Use case or Concept demo tag/);
  }
  assert.throws(() => exampleCoverage([entry("one", { tags: ["Concept demo", "Agent team"] })], concepts), /Unknown concept tags.*Agent team/);
  assert.throws(() => exampleCoverage([entry("one", { tags: ["Concept demo"] })], concepts), /needs at least one concept/);
});

test("a script does not replace a skill demo by default; script and mixed concepts count explicitly", () => {
  const starts = [entry("skill"), entry("script", { action: "script" })];
  assert.throws(() => exampleCoverage(starts, concepts), /Agent teams \(1\/2\)/);
  assert.equal(exampleCoverage(starts, [{ ...concepts[0], entryKind: "any" }]).concepts[0].examples.length, 2);
  assert.throws(() => exampleCoverage(starts, [{ ...concepts[0], entryKind: "script" }]), /Agent teams \(1\/2\)/);
  assert.equal(exampleCoverage([...starts, entry("script-two", { action: "script" })], [{ ...concepts[0], entryKind: "script" }]).concepts[0].examples.length, 2);
});

test("skill concepts need two real skill templates", () => {
  const skills = [{ id: "skills", label: "Skills", entryKind: "skill" as const }];
  const starts = [entry("one", { action: "skill", tags: ["Use case", "Skills"] }), entry("two", { action: "script", tags: ["Concept demo", "Skills"] })];
  assert.throws(() => exampleCoverage(starts, skills), /Skills \(1\/2\)/);
  assert.equal(exampleCoverage([starts[0], { ...starts[1], action: "skill" }], skills).concepts[0].examples.length, 2);
});

test("ambiguous concept identifiers or labels are rejected", () => {
  assert.throws(() => exampleCoverage([], [...concepts, concepts[0]]), /Duplicate identifier or label/);
  assert.throws(() => exampleCoverage([], [...concepts, { id: "other", label: concepts[0].label }]), /Duplicate identifier or label/);
});

const walkthrough = (id: string): ExampleWalkthrough => ({
  id, title: "Change a setting", description: "Model selection before the next task.",
  tags: ["Concept demo", "Settings"], steps: ["Open the settings.", "Select a model."],
});
const settings = [{ id: "settings", label: "Settings", entryKind: "walkthrough" as const }];

test("operating concepts need two walkthroughs and do not change the start kinds", () => {
  assert.throws(() => exampleCoverage([], settings, [walkthrough("one")]), /Settings and model selection \(1\/2\)/);
  assert.throws(() => exampleCoverage([entry("start", { tags: ["Concept demo", "Settings"] })], settings, [walkthrough("one")]), /Settings and model selection \(1\/2\)/);
  const coverage = exampleCoverage([], settings, [walkthrough("one"), walkthrough("two")]);
  assert.deepEqual(coverage.concepts[0].examples.map(exampleAnchor), ["example-one", "example-two"]);
  assert.throws(() => exampleCoverage([entry("one", { tags: ["Concept demo", "Settings"] })], settings, [walkthrough("one"), walkthrough("two")]), /Duplicate reference example: one/);
});

test("walkthrough examples have complete steps and their own link targets in HTML and Markdown", () => {
  assert.throws(() => exampleCoverage([], settings, [{ ...walkthrough("one"), steps: [] }]), /Incomplete walkthrough/);
  const examples = [walkthrough("one"), walkthrough("two")];
  const html = exampleWalkthroughsHtml(examples);
  const markdown = exampleWalkthroughsMarkdown(examples);
  for (const example of examples) {
    assert.ok(html.includes(`id="example-${example.id}"`));
    assert.ok(markdown.includes(`<a id="example-${example.id}"></a>`));
    for (const step of example.steps) {
      assert.ok(html.includes(`<li>${step}</li>`));
      assert.ok(markdown.includes(step));
    }
  }
  assert.match(html, /not additional start cards/);
  assert.match(markdown, /not additional start cards/);
  assert.ok(!html.includes('id="start-'));
});


test("free categories group skill templates independently of concept tags", async () => {
  const { groupStartEntries } = await import("./homepage-examples.ts");
  const groups = groupStartEntries([
    { ...entry("last"), category: "Mini-apps", order: 30 },
    { ...entry("other"), category: "Custom category", order: 20 },
    { ...entry("first"), category: "Mini-apps", order: 5 },
  ]);
  assert.deepEqual(groups.map((group) => [group.label, group.entries.map((entry) => entry.id)]), [
    ["Mini-apps", ["first", "last"]], ["Custom category", ["other"]],
  ]);
  assert.throws(() => groupStartEntries([entry("missing")]), /needs a category/);
});

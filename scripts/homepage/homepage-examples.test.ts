import assert from "node:assert/strict";
import test from "node:test";
import { exampleCoverage, exampleAnchor, exampleWalkthroughsHtml, exampleWalkthroughsMarkdown, type ExampleEntry, type ExampleWalkthrough } from "./homepage-examples.js";

const concepts = [{ id: "team", label: "Agententeams" }];
const entry = (id: string, overrides: Partial<ExampleEntry> = {}): ExampleEntry => ({
  id, title: id, owner: "ragents.reference", action: "skill", tags: ["Konzeptdemo", "Agententeams"], ...overrides,
});

test("beide Perspektiven dürfen sich überschneiden und jedes Beispiel zählt nur einmal", () => {
  const first = entry("one", { tags: ["Anwendungsfall", "Konzeptdemo", "Agententeams"] });
  assert.throws(() => exampleCoverage([first], concepts), /Agententeams \(1\/2\)/);
  const coverage = exampleCoverage([first, entry("two")], concepts);
  assert.deepEqual(coverage.axes.map((axis) => axis.examples.length), [1, 2]);
  assert.deepEqual(coverage.concepts[0].examples.map((example) => example.id), ["one", "two"]);
  assert.throws(() => exampleCoverage([first, first], concepts), /Duplicate reference example/);
});

test("private oder fremde Einstiege erfüllen keine Referenzabdeckung", () => {
  assert.throws(() => exampleCoverage([entry("one"), entry("two", { owner: "private.product" })], concepts), /Agententeams \(1\/2\)/);
});

test("fehlende und unbekannte Konzept-Tags stoppen die Generierung", () => {
  for (const tags of [undefined, [], ["Agententeams"]]) {
    assert.throws(() => exampleCoverage([entry("one", { tags }), entry("two")], concepts), /needs the Use case or Concept demo tag/);
  }
  assert.throws(() => exampleCoverage([entry("one", { tags: ["Konzeptdemo", "Agententeam"] })], concepts), /Unknown concept tags.*Agententeam/);
  assert.throws(() => exampleCoverage([entry("one", { tags: ["Konzeptdemo"] })], concepts), /needs at least one concept/);
});

test("ein Script ersetzt standardmäßig keine Skill-Demo; Script- und gemischte Konzepte zählen ausdrücklich", () => {
  const starts = [entry("skill"), entry("script", { action: "script" })];
  assert.throws(() => exampleCoverage(starts, concepts), /Agententeams \(1\/2\)/);
  assert.equal(exampleCoverage(starts, [{ ...concepts[0], entryKind: "any" }]).concepts[0].examples.length, 2);
  assert.throws(() => exampleCoverage(starts, [{ ...concepts[0], entryKind: "script" }]), /Agententeams \(1\/2\)/);
  assert.equal(exampleCoverage([...starts, entry("script-two", { action: "script" })], [{ ...concepts[0], entryKind: "script" }]).concepts[0].examples.length, 2);
});

test("Skill-Konzepte brauchen zwei echte Skill-Einstiege", () => {
  const skills = [{ id: "skills", label: "Skills", entryKind: "skill" as const }];
  const starts = [entry("one", { action: "skill", tags: ["Anwendungsfall", "Skills"] }), entry("two", { action: "script", tags: ["Konzeptdemo", "Skills"] })];
  assert.throws(() => exampleCoverage(starts, skills), /Skills \(1\/2\)/);
  assert.equal(exampleCoverage([starts[0], { ...starts[1], action: "skill" }], skills).concepts[0].examples.length, 2);
});

test("mehrdeutige Konzeptkennungen oder Labels werden abgewiesen", () => {
  assert.throws(() => exampleCoverage([], [...concepts, concepts[0]]), /Duplicate identifier or label/);
  assert.throws(() => exampleCoverage([], [...concepts, { id: "other", label: concepts[0].label }]), /Duplicate identifier or label/);
});

const walkthrough = (id: string): ExampleWalkthrough => ({
  id, title: "Eine Einstellung ändern", description: "Modellwahl vor dem nächsten Auftrag.",
  tags: ["Konzeptdemo", "Einstellungen"], steps: ["Einstellungen öffnen.", "Ein Modell auswählen."],
});
const settings = [{ id: "settings", label: "Einstellungen", entryKind: "walkthrough" as const }];

test("Bedienkonzepte brauchen zwei Anleitungen und ändern die Startarten nicht", () => {
  assert.throws(() => exampleCoverage([], settings, [walkthrough("one")]), /Settings and model selection \(1\/2\)/);
  assert.throws(() => exampleCoverage([entry("start", { tags: ["Konzeptdemo", "Einstellungen"] })], settings, [walkthrough("one")]), /Settings and model selection \(1\/2\)/);
  const coverage = exampleCoverage([], settings, [walkthrough("one"), walkthrough("two")]);
  assert.deepEqual(coverage.concepts[0].examples.map(exampleAnchor), ["example-one", "example-two"]);
  assert.throws(() => exampleCoverage([entry("one", { tags: ["Konzeptdemo", "Einstellungen"] })], settings, [walkthrough("one"), walkthrough("two")]), /Duplicate reference example: one/);
});

test("Bedienbeispiele haben vollständige Schritte und eigene Linkziele in HTML und Markdown", () => {
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


test("freie Kategorien gruppieren Skill-Einstiege unabhängig von Konzept-Tags", async () => {
  const { groupStartEntries } = await import("./homepage-examples.ts");
  const groups = groupStartEntries([
    { ...entry("last"), category: "Mini-Apps", order: 30 },
    { ...entry("other"), category: "Eigene Kategorie", order: 20 },
    { ...entry("first"), category: "Mini-Apps", order: 5 },
  ]);
  assert.deepEqual(groups.map((group) => [group.label, group.entries.map((entry) => entry.id)]), [
    ["Mini-Apps", ["first", "last"]], ["Eigene Kategorie", ["other"]],
  ]);
  assert.throws(() => groupStartEntries([entry("missing")]), /needs a category/);
});

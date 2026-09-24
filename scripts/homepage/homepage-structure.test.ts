import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { guideChapters } from "./homepage-guide.js";
import { assertHomepageStructure } from "./homepage-structure.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const sticker = (id: string, label = "Zwei<br>Zeilen") => `<a class="feature-sticker" data-sticker href="#${id}"><strong>${label}</strong></a>`;
const feature = (id: string, body = '<a href="guide-runtime.html">Mehr</a>', tag = "section") => `<${tag} id="${id}" data-core-feature><div>${body}</div></${tag}>`;

test("Jede Kernfunktion hat genau einen Sticker, einen Abschnitt und einen Guide-Link", () => {
  const html = `${sticker("a")}${sticker("b", "Eine Zeile")}${feature("a")}<section id="c"><p>ohne Sticker</p></section>${feature("b", '<a href="guide-access.html#rechte">Mehr</a>', "article")}`;
  assert.deepEqual(assertHomepageStructure(html), { features: [{ id: "a", guide: "guide-runtime.html" }, { id: "b", guide: "guide-access.html#rechte" }] });
});

test("Sticker ohne Abschnitt, Abschnitte ohne Sticker oder Guide-Link und dreizeilige Sticker werden abgelehnt", () => {
  for (const [html, message] of [
    [`${sticker("a")}`, /keinen Abschnitt/],
    [`${feature("a")}`, /keinen Sticker/],
    [`${sticker("a")}${feature("a", "<p>ohne Link</p>")}`, /kein Guide-Kapitel/],
    [`${sticker("a")}${feature("a", '<a href="reference.html">Referenz</a>')}`, /kein Guide-Kapitel/],
    [`${sticker("a", "Drei<br>ganze<br>Zeilen")}${feature("a")}`, /mehr als zwei Zeilen/],
    [`${sticker("a")}${sticker("a")}${feature("a")}`, /Zwei Sticker/],
    [`${sticker("a")}${feature("a")}${feature("a")}`, /zweimal/],
    [`<a data-sticker href="reference.html"><strong>Weg</strong></a>${feature("a")}`, /auf einen Abschnitt/],
    [`${sticker("a")}<section data-core-feature><a href="guide-runtime.html">Mehr</a></section>`, /braucht eine id/],
    ["<p>nichts</p>", /keine Kernfunktion/],
  ] as const) assert.throws(() => assertHomepageStructure(html), message, html);
});

test("Verschachtelte Abschnitte werden bis zu ihrem eigenen Ende gelesen", () => {
  const html = `${sticker("outer")}<section id="outer" data-core-feature><section id="inner"><p>innen</p></section><a href="guide-ideas.html">Mehr</a></section>`;
  assert.deepEqual(assertHomepageStructure(html).features, [{ id: "outer", guide: "guide-ideas.html" }]);
  assert.throws(() => assertHomepageStructure(`${sticker("outer")}<section id="outer" data-core-feature><section id="inner"><a href="guide-ideas.html">Mehr</a>`), /Nicht geschlossenes/);
});

test("Die echte Homepage führt sieben Kernfunktionen, jede mit vorhandenem Guide-Kapitel", async () => {
  const html = await readFile(path.join(repoRoot, "docs/homepage/index.html"), "utf8");
  const { features } = assertHomepageStructure(html);
  assert.deepEqual(features.map(({ id }) => id), ["setups", "agents", "programming", "actor-views", "journal", "distributed", "clients"]);
  for (const { id, guide } of features) {
    const chapter = /^guide-([a-z-]+)\.html/.exec(guide)![1];
    assert.ok(guideChapters.some((entry) => entry.id === chapter), `${id}: ${guide}`);
  }
});

test("Die Homepage zeigt englische Konzeptbilder für die aktuelle Oberfläche", async () => {
  const html = await readFile(path.join(repoRoot, "docs/homepage/index.html"), "utf8");
  assert.match(html, /A workshop for AI agents in the browser and in VS Code/);
  assert.match(html, /class="agent-network"/);
  assert.match(html, /class="concept-diagram typescript-flow"/);
  assert.match(html, /class="mini-review"/);
  assert.match(html, /class="run-panel-diagram"/);
  assert.match(html, /class="journal-ledger"/);
  assert.match(html, /class="runtime-map"/);
  assert.doesNotMatch(html, /<iframe\b/);
  assert.doesNotMatch(html, />Console</i);
});

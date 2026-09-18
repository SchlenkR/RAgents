import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertPublicOutput } from "./homepage-catalog.js";
import {
  buildHomepageGuide,
  guideChapters,
  guideChapterHtml,
  guideIndexHtml,
  guideExcerpt,
  guideMarkdownOutputs,
  renderGuideMarkdown,
} from "./homepage-guide.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("Guide beginnt mit Grundideen und hält Navigation und Inhalt auf kurzen Wegen erreichbar", async () => {
  const guide = await buildHomepageGuide(repoRoot);
  assert.equal(guide.chapters[0].id, "ideas");
  const chapter = guide.chapters[0];
  const html = guideChapterHtml(chapter);
  assert.ok(html.indexOf('class="guide-layout"') < html.indexOf("<h1>"));
  assert.match(html, /<details class="guide-mobile-nav"><summary>Guide: Grundideen<\/summary>/);
  assert.match(html, /<aside class="guide-sidebar">/);
  for (const name of ["Verstehen", "Ausprobieren", "Selbst bauen", "Nachschlagen"]) assert.ok(html.includes(name), name);
  for (const entry of guideChapters) assert.ok(html.includes(`href="guide-${entry.id}.html"`), entry.id);
  for (const href of ["reference.html#samples", "reference.html#tools", "reference.html#ui", "developer.html"]) assert.ok(html.includes(`href="${href}"`), href);
  const index = guideIndexHtml();
  for (const href of ["guide-ideas.html", "guide-getting-started.html", "guide-functions.html", "reference.html"]) assert.ok(index.includes(`href="${href}"`), href);
});

test("Guide-Auszüge übernehmen nur die markierten öffentlichen Abschnitte unverändert", () => {
  const first = "## Funktionen\n\nEine **öffentliche** Beschreibung.\n\n- Eintrag mit `Code`";
  const second = "## Ausführung\n\n```typescript\nreturn await context.functions.read({ path: input.path });\n```";
  const source = [
    "# Interner Betrieb", "Privat: plugins/private.product unter /Users/example/workspace.",
    "<!-- guide:functions -->", first, "<!-- /guide:functions -->",
    "Weitere interne Daten: OPENROUTER_VSCODE_APIKEY.",
    "<!-- guide:access -->", "## Rechte\n\nEin anderes öffentliches Kapitel.", "<!-- /guide:access -->",
    "<!-- guide:functions -->", second, "<!-- /guide:functions -->",
    "Privater Nachtrag: /private/workspace.",
  ].join("\n");
  assert.equal(guideExcerpt(source, "functions"), `${first}\n\n${second}\n`);
  assert.equal(guideExcerpt(source, "access"), "## Rechte\n\nEin anderes öffentliches Kapitel.\n");
});

test("Guide-Marker innerhalb von Codeblöcken bleiben Code und eröffnen keine Abschnitte", () => {
  for (const fence of ["```", "~~~~"]) {
    const code = `${fence}markdown\n<!-- guide:access -->\n<!-- /guide:access -->\n${fence}`;
    const source = `${code}\n<!-- guide:functions -->\n## Beispiel\n\n${code}\n<!-- /guide:functions -->`;
    assert.equal(guideExcerpt(source, "functions"), `## Beispiel\n\n${code}\n`);
    assert.throws(() => guideExcerpt(code, "access"), /fehlt/);
  }
});

test("Guide-Auszüge lehnen fehlende, leere, verschachtelte und nicht geschlossene Abschnitte ab", () => {
  for (const [source, message] of [
    ["## Ohne Marker", /fehlt/],
    ["<!-- guide:functions -->\n \n<!-- /guide:functions -->", /Leerer/],
    ["<!-- guide:functions -->\n<!-- guide:access -->", /Verschachtelte/],
    ["<!-- guide:functions -->\n## Noch offen", /Offener/],
    ["<!-- guide:functions -->\n## Falsches Ende\n<!-- /guide:access -->", /Unpassendes/],
    ["<!-- /guide:functions -->", /Unpassendes/],
    ["<!-- guide:unknown -->\n## Unbekannt\n<!-- /guide:unknown -->", /Unbekanntes/],
  ] as const) assert.throws(() => guideExcerpt(source, "functions"), message);
});

test("Private Namen, Pfade und Konfigurationsverweise dürfen nicht im veröffentlichten Auszug stehen", () => {
  for (const privateContent of ["plugins/private.product", "/Users/example/project", "/private/workspace", "/tmp/session", "OPENROUTER_VSCODE_APIKEY"]) {
    const source = `<!-- guide:functions -->\n## Beispiel\n\n${privateContent}\n<!-- /guide:functions -->`;
    assert.throws(() => guideExcerpt(source, "functions"), /privaten Namen, lokalen Pfad oder Konfigurationsverweis/);
  }
});

test("Guide-Markdown rendert GFM-Tabellen, Code und eindeutige verlinkbare Überschriften", () => {
  const markdown = [
    "## Kurze `API`", "", "Ein **wichtiger** Begriff und ~~alter Text~~.", "",
    "| Name | Zweck |", "| --- | --- |", "| `read` | Lesen |", "",
    "```typescript", 'const value = "<script>";', "```", "",
    "### Details", "", "## Kurze `API`", "", "## Grüße & Zugriff",
  ].join("\n");
  const { html, headings } = renderGuideMarkdown(markdown, "docs/spec/typescript-platform.md");
  assert.deepEqual(headings, [
    { id: "kurze-api", title: "Kurze API" },
    { id: "kurze-api-1", title: "Kurze API" },
    { id: "grüße-zugriff", title: "Grüße & Zugriff" },
  ]);
  assert.match(html, /<h2 id="kurze-api">Kurze <code>API<\/code><\/h2>/);
  assert.match(html, /<h3 id="details">Details<\/h3>/);
  assert.match(html, /<h2 id="kurze-api-1">/);
  assert.match(html, /<table>[\s\S]*<th>Name<\/th>[\s\S]*<td><code>read<\/code><\/td>/);
  assert.match(html, /<strong>wichtiger<\/strong>/);
  assert.match(html, /<del>alter Text<\/del>/);
  assert.match(html, /<pre><code class="language-typescript">const value = &quot;&lt;script&gt;&quot;;/);
  assert.doesNotMatch(html, /<script>/);
});

test("Guide-Links und Bilder werden relativ zur Quelldatei auf den Ausgabeordner bezogen", () => {
  const markdown = [
    "## Verweise", "",
    "[Plugin](plugins.md#funktionen)",
    "[Betrieb](../operations.md?mode=core#start)",
    "[Referenz](../homepage/reference.html#tools)",
    "![Schema](../images/process.svg)",
    "[Abschnitt](#verweise)",
    "[Extern](https://example.org/docs?q=guide#start)",
    "[Kontakt](mailto:hello@example.org)",
  ].join("\n");
  const { html } = renderGuideMarkdown(markdown, "docs/spec/core.md");
  for (const href of ["../spec/plugins.md#funktionen", "../operations.md?mode=core#start", "reference.html#tools", "#verweise", "https://example.org/docs?q=guide#start", "mailto:hello@example.org"]) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
  assert.match(html, /src="\.\.\/images\/process.svg"/);
  const rootDocument = renderGuideMarkdown("[Spec](docs/spec/core.md)", "README.md");
  assert.match(rootDocument.html, /href="\.\.\/spec\/core.md"/);
});

test("Guide-Markdown lehnt rohe HTML-Ausgabe, Hauptüberschriften und nicht unterstützte Linkprotokolle ab", () => {
  assert.throws(() => renderGuideMarkdown("# Doppelte Hauptüberschrift", "docs/spec/core.md"), /Überschrift Ebene 2/);
  assert.throws(() => renderGuideMarkdown("<div>Eigene Oberfläche</div>", "docs/spec/core.md"), /HTML im Guide/);
  for (const target of ["javascript:alert", "file:///secret", "/absolute/path", "//example.org/path", "data:text/plain,hello"]) {
    assert.throws(() => renderGuideMarkdown(`[Link](${target})`, "docs/spec/core.md"), /Ungültiger Guide-Link/);
  }
});

test("Der echte Guide übernimmt die markierte Spec und erklärt Funktionsmetadaten, TypeScript und Subagenten", async () => {
  const guide = await buildHomepageGuide(repoRoot);
  assert.deepEqual(guide.chapters.map((chapter) => chapter.id), guideChapters.map((chapter) => chapter.id));
  for (const chapter of guide.chapters) {
    assert.ok(chapter.headings.length > 0, chapter.id);
    assert.doesNotThrow(() => assertPublicOutput(chapter.markdown), chapter.id);
    assert.doesNotMatch(chapter.markdown, /<!-- \/?guide:/);
    assert.ok(chapter.html.includes(`<h2 id="${chapter.headings[0].id}">`), chapter.id);
  }
  const functions = guide.chapters.find((chapter) => chapter.id === "functions")!.markdown;
  for (const name of ["defineRunFunction", "name", "label", "description", "longDescription", "typescript_api", "typescript_eval", "context.functions"]) {
    assert.ok(functions.includes(name), name);
  }
  assert.match(guide.chapters.map((chapter) => chapter.markdown).join("\n"), /tools: \[\]/);
  const outputs = guideMarkdownOutputs(guide);
  assert.match(outputs["guide-getting-started.md"], /\]\(guide-access\.html\)/);
  assert.match(outputs["guide-access.md"], /\]\(guide-runtime\.html#subagenten-ausstatten\)/);
  assert.deepEqual(Object.keys(outputs).sort(), ["guide.md", ...guideChapters.map(({ id }) => `guide-${id}.md`)].sort());
  for (const chapter of guide.chapters) {
    assert.equal(outputs[`guide-${chapter.id}.md`], chapter.markdown);
    assert.ok(outputs["guide.md"].includes(`](guide-${chapter.id}.md)`), chapter.id);
  }
});

test("Quelländerungen erreichen HTML und Markdown mit gültigen Links und unveränderten Codebeispielen", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-guide-source-"));
  try {
    for (const chapter of guideChapters) {
      const file = path.join(root, chapter.source);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, await readFile(path.join(repoRoot, chapter.source), "utf8"));
    }
    const content = "## Aktuelle Anleitung\n\nNeue Erklärung mit [Zugriff][access].\n\n[access]: homepage/guide-access.html\n\n`[Beispiel](unchanged.md)`\n\n```md\n[Beispiel](unchanged.md)\n```";
    await writeFile(path.join(root, "docs/operations.md"), `Privater Vorspann: intern\n<!-- guide:getting-started -->\n${content}\n<!-- /guide:getting-started -->`);
    const { chapters } = await buildHomepageGuide(root);
    const chapter = chapters.find(entry => entry.id === "getting-started")!;
    assert.match(chapter.html, /Neue Erklärung mit <a href="guide-access.html">Zugriff<\/a>/);
    assert.match(chapter.markdown, /\[access\]: guide-access.html/);
    assert.match(chapter.markdown, /`\[Beispiel\]\(unchanged.md\)`/);
    assert.match(chapter.markdown, /```md\n\[Beispiel\]\(unchanged.md\)\n```/);
    assert.doesNotMatch(chapter.markdown, /Privater Vorspann/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

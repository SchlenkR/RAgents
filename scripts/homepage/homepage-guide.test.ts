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

test("guide starts with core ideas and keeps navigation and content within short reach", async () => {
  const guide = await buildHomepageGuide(repoRoot);
  assert.equal(guide.chapters[0].id, "ideas");
  const chapter = guide.chapters[0];
  const html = guideChapterHtml(chapter);
  assert.ok(html.indexOf('class="guide-layout"') < html.indexOf("<h1>"));
  assert.match(html, /<details class="guide-mobile-nav"><summary>Guide: Core ideas<\/summary>/);
  assert.match(html, /<aside class="guide-sidebar">/);
  for (const name of ["Understand", "Use", "Build", "Access"]) assert.ok(html.includes(name), name);
  for (const entry of guideChapters) assert.ok(html.includes(`href="guide-${entry.id}.html"`), entry.id);
  const index = guideIndexHtml();
  for (const href of ["guide-ideas.html", "guide-getting-started.html", "guide-functions.html", "guide-plugins.html"]) assert.ok(index.includes(`href="${href}"`), href);
});

test("guide excerpts take over only the marked public sections unchanged", () => {
  const first = "## Functions\n\nA **public** description.\n\n- Entry with `code`";
  const second = "## Execution\n\n```typescript\nreturn await context.functions.read({ file_path: input.path });\n```";
  const source = [
    "# Internal operations", "Private: plugins/private.product under /Users/example/workspace.",
    "<!-- guide:functions -->", first, "<!-- /guide:functions -->",
    "More internal data: PRIVATE_MODEL_API_KEY.",
    "<!-- guide:access -->", "## Permissions\n\nAnother public chapter.", "<!-- /guide:access -->",
    "<!-- guide:functions -->", second, "<!-- /guide:functions -->",
    "Private addendum: /private/workspace.",
  ].join("\n");
  assert.equal(guideExcerpt(source, "functions"), `${first}\n\n${second}\n`);
  assert.equal(guideExcerpt(source, "access"), "## Permissions\n\nAnother public chapter.\n");
});

test("guide markers inside code blocks stay code and open no sections", () => {
  for (const fence of ["```", "~~~~"]) {
    const code = `${fence}markdown\n<!-- guide:access -->\n<!-- /guide:access -->\n${fence}`;
    const source = `${code}\n<!-- guide:functions -->\n## Example\n\n${code}\n<!-- /guide:functions -->`;
    assert.equal(guideExcerpt(source, "functions"), `## Example\n\n${code}\n`);
    assert.throws(() => guideExcerpt(code, "access"), /Missing guide section/);
  }
});

test("guide excerpts reject missing, empty, nested, and unclosed sections", () => {
  for (const [source, message] of [
    ["## Without marker", /Missing guide section/],
    ["<!-- guide:functions -->\n \n<!-- /guide:functions -->", /Empty guide section/],
    ["<!-- guide:functions -->\n<!-- guide:access -->", /Nested guide sections/],
    ["<!-- guide:functions -->\n## Still open", /Unclosed guide section/],
    ["<!-- guide:functions -->\n## Wrong end\n<!-- /guide:access -->", /Mismatched guide section end/],
    ["<!-- /guide:functions -->", /Mismatched guide section end/],
    ["<!-- guide:unknown -->\n## Unknown\n<!-- /guide:unknown -->", /Unknown guide chapter/],
  ] as const) assert.throws(() => guideExcerpt(source, "functions"), message);
});

test("private names, paths, and configuration references must not appear in the published excerpt", () => {
  for (const privateContent of ["plugins/private.product", "/Users/example/project", "/private/workspace", "/tmp/session", "PRIVATE_MODEL_API_KEY"]) {
    const source = `<!-- guide:functions -->\n## Example\n\n${privateContent}\n<!-- /guide:functions -->`;
    assert.throws(() => guideExcerpt(source, "functions"), /private name, local path, or configuration reference/);
  }
});

test("guide Markdown renders GFM tables, code, and unique linkable headings", () => {
  const markdown = [
    "## Short `API`", "", "An **important** term and ~~old text~~.", "",
    "| Name | Purpose |", "| --- | --- |", "| `read` | Read |", "",
    "```typescript", 'const value = "<script>";', "```", "",
    "### Details", "", "## Short `API`", "", "## Grüße & access",
  ].join("\n");
  const { html, headings } = renderGuideMarkdown(markdown, "docs/spec/typescript-platform.md");
  assert.deepEqual(headings, [
    { id: "short-api", title: "Short API" },
    { id: "short-api-1", title: "Short API" },
    { id: "grüße-access", title: "Grüße & access" },
  ]);
  assert.match(html, /<h2 id="short-api">Short <code>API<\/code><\/h2>/);
  assert.match(html, /<h3 id="details">Details<\/h3>/);
  assert.match(html, /<h2 id="short-api-1">/);
  assert.match(html, /<table>[\s\S]*<th>Name<\/th>[\s\S]*<td><code>read<\/code><\/td>/);
  assert.match(html, /<strong>important<\/strong>/);
  assert.match(html, /<del>old text<\/del>/);
  assert.match(html, /<pre><code class="language-typescript">const value = &quot;&lt;script&gt;&quot;;/);
  assert.doesNotMatch(html, /<script>/);
});

test("guide links and images are resolved relative to the source file against the output folder", () => {
  const markdown = [
    "## Links", "",
    "[Plugin](plugins.md#functions)",
    "[Operations](../operations.md?mode=core#start)",
    "[Reference](../homepage/reference.html#tools)",
    "![Diagram](../images/process.svg)",
    "[Section](#links)",
    "[External](https://example.org/docs?q=guide#start)",
    "[Contact](mailto:hello@example.org)",
  ].join("\n");
  const { html } = renderGuideMarkdown(markdown, "docs/spec/core.md");
  for (const href of ["../spec/plugins.md#functions", "../operations.md?mode=core#start", "reference.html#tools", "#links", "https://example.org/docs?q=guide#start", "mailto:hello@example.org"]) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
  assert.match(html, /src="\.\.\/images\/process.svg"/);
  const rootDocument = renderGuideMarkdown("[Spec](docs/spec/core.md)", "README.md");
  assert.match(rootDocument.html, /href="\.\.\/spec\/core.md"/);
});

test("guide Markdown rejects raw HTML output, top-level headings, and unsupported link protocols", () => {
  assert.throws(() => renderGuideMarkdown("# Duplicate top-level heading", "docs/spec/core.md"), /heading level 2/);
  assert.throws(() => renderGuideMarkdown("<div>Custom interface</div>", "docs/spec/core.md"), /Express guide content as Markdown/);
  for (const target of ["javascript:alert", "file:///secret", "/absolute/path", "//example.org/path", "data:text/plain,hello"]) {
    assert.throws(() => renderGuideMarkdown(`[Link](${target})`, "docs/spec/core.md"), /Invalid guide link/);
  }
});

test("the real guide takes over the marked spec and explains function metadata, TypeScript, and subagents", async () => {
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
  assert.match(outputs["guide-access.md"], /\]\(guide-runtime\.html#equipping-subagents\)/);
  assert.deepEqual(Object.keys(outputs).sort(), ["guide.md", ...guideChapters.map(({ id }) => `guide-${id}.md`)].sort());
  for (const chapter of guide.chapters) {
    assert.equal(outputs[`guide-${chapter.id}.md`], chapter.markdown);
    assert.ok(outputs["guide.md"].includes(`](guide-${chapter.id}.md)`), chapter.id);
  }
});

test("source changes reach HTML and Markdown with valid links and unchanged code examples", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-guide-source-"));
  try {
    for (const source of guideChapters.flatMap((chapter) => chapter.sources)) {
      const file = path.join(root, source);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, await readFile(path.join(repoRoot, source), "utf8"));
    }
    const content = "## Current guide\n\nNew explanation with [access][access].\n\n[access]: homepage/guide-access.html\n\n`[Example](unchanged.md)`\n\n```md\n[Example](unchanged.md)\n```";
    for (const source of ["docs/operations.md", "docs/usage.md"]) {
      const chapterIds = guideChapters.filter((entry) => (entry.sources as readonly string[]).includes(source)).map((entry) => entry.id);
      await writeFile(path.join(root, source), `Private preamble: internal\n${chapterIds.map((id) => `<!-- guide:${id} -->\n${content}\n<!-- /guide:${id} -->`).join("\n")}`);
    }
    const { chapters } = await buildHomepageGuide(root);
    const chapter = chapters.find(entry => entry.id === "getting-started")!;
    assert.match(chapter.html, /New explanation with <a href="guide-access.html">access<\/a>/);
    assert.match(chapter.markdown, /\[access\]: guide-access.html/);
    assert.match(chapter.markdown, /`\[Example\]\(unchanged.md\)`/);
    assert.match(chapter.markdown, /```md\n\[Example\]\(unchanged.md\)\n```/);
    assert.doesNotMatch(chapter.markdown, /Private preamble/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

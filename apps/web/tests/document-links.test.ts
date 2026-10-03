import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "quassel";

import { RunUrls } from "../src/chat/QuasselHost";
import { DocumentPanel, type DocumentSection } from "../../../plugins/ragents.documents/web/DocumentViewer";
import { baseAddressOf, documentBaseOf, htmlWithBase, resolveDocumentUrl } from "../../../plugins/ragents.documents/web/links";
import { webPlugin } from "../../../plugins/ragents.documents/web/index";

const prefix = "/api/plugins/ragents.documents";
const raw = `${prefix}/runs/run-1/raw`;
const report = documentBaseOf(prefix, "run-1", "@documents/review/report.md");

test("an address in a document resolves against the document's folder, an alias against its root, everything else stays", () => {
  assert.equal(resolveDocumentUrl(report, "shots/home.png"), `${raw}/%40documents/review/shots/home.png`);
  assert.equal(resolveDocumentUrl(report, "./shots/home.png?size=1#top"), `${raw}/%40documents/review/shots/home.png?size=1#top`);
  assert.equal(resolveDocumentUrl(report, "../browser/a b.png"), `${raw}/%40documents/browser/a%20b.png`);
  assert.equal(resolveDocumentUrl(report, "@documents/browser/a.png"), `${raw}/@documents/browser/a.png`);
  assert.equal(resolveDocumentUrl(report, "../../src/app.ts"), `${raw}/src/app.ts`, "plain URL semantics: above the alias is the run's root");
  for (const kept of ["https://example.com/a.png", "mailto:team@example.com", "#results", "/api/other", "data:image/png;base64,AA", ""]) {
    assert.equal(resolveDocumentUrl(report, kept), kept);
  }
  const project = documentBaseOf(prefix, "run-1", "docs/guide.md");
  assert.equal(resolveDocumentUrl(project, "img/flow.svg"), `${raw}/docs/img/flow.svg`);
  assert.equal(resolveDocumentUrl(documentBaseOf(prefix, "run-1"), "shots/a.png"), `${raw}/shots/a.png`, "text without a file resolves against the run's root");
  assert.equal(resolveDocumentUrl(documentBaseOf(prefix, "run-1", "/home/user/project/notes.md"), "a.png"), `${raw}//home/user/project/a.png`);
  assert.deepEqual([report.root, project.root, documentBaseOf(prefix, "run-1").root], ["@documents", "", ""], "the root a grant has to cover");
});

const markdownOf = (text: string): string => renderToStaticMarkup(createElement(DocumentPanel, {
  activeId: "report",
  sections: [{ id: "chat", label: "Shown in chat", kind: "chat", documents: [{ id: "report", title: "Report", format: "markdown", content: text, base: report }] }],
  truncated: false,
  onSelect: () => {},
}));

test("the Markdown display hands every link and image address to quassel's resolver and leaves code as written", () => {
  const html = markdownOf([
    "# Review",
    "",
    "![Home](shots/home.png \"Home (start)\") and [details](<notes/a b.md>), [web](https://example.com), [top](#review)",
    "",
    "![Earlier][earlier]",
    "",
    "[earlier]: @documents/browser/earlier.png",
    "",
    "```",
    "![not an image](code.png)",
    "```",
    "",
    "| Step | Shot |",
    "| --- | --- |",
    "| Save | ![Saved](shots/saved\\).png) |",
  ].join("\n"));
  assert.match(html, new RegExp(`<img[^>]*src="${raw}/%40documents/review/shots/home\\.png"`));
  assert.match(html, new RegExp(`href="${raw}/%40documents/review/notes/a%20b\\.md"`));
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /href="#review"/);
  assert.match(html, new RegExp(`<img[^>]*src="${raw}/@documents/browser/earlier\\.png"`), "a definition resolves like an inline destination");
  assert.match(html, new RegExp(`<img[^>]*src="${raw}/%40documents/review/shots/saved\\)\\.png"`));
  assert.match(html, /!\[not an image\]\(code\.png\)/, "a code block stays as written");
});

test("an HTML document gets the base address of its folder after its doctype, a grant in that address, and sends no referrer", () => {
  assert.equal(baseAddressOf(report), `${raw}/%40documents/review/`);
  assert.equal(baseAddressOf(report, "grant-1"), `${prefix}/runs/run-1/grant/grant-1/%40documents/review/`);
  const meta = "<meta name=\"referrer\" content=\"no-referrer\">";
  assert.equal(htmlWithBase("<!DOCTYPE html>\n<html><body><img src=\"a.png\"></body></html>", baseAddressOf(report)),
    `<!DOCTYPE html><base href="${raw}/%40documents/review/">${meta}\n<html><body><img src="a.png"></body></html>`);
  assert.equal(htmlWithBase("<p>Hello</p>", "/x?a=1&b=\"2\""), `<base href="/x?a=1&amp;b=&quot;2&quot;">${meta}<p>Hello</p>`);
});

test("the Documents view renders a Markdown document with its images under the content route and an image document by reference", () => {
  const sections: DocumentSection[] = [{
    id: "chat", label: "Shown in chat", kind: "chat",
    documents: [
      { id: "report", title: "Report", format: "markdown", content: "![Home](@documents/review/shots/home.png)", base: documentBaseOf(prefix, "run-1") },
      { id: "shot", title: "Home", format: "image", contentUrl: `${raw}/%40documents/review/shots/home.png`, base: report },
      { id: "result", title: "Result", format: "markdown", content: "![Plan](plan.png)" },
    ],
  }];
  const render = (activeId: string) => renderToStaticMarkup(createElement(RunUrls, { resolve: () => "/resolved-by-the-run", runId: "run-1" },
    createElement(DocumentPanel, { activeId, sections, truncated: false, onSelect: () => {} })));
  assert.match(render("report"), new RegExp(`<img[^>]*src="${raw}/@documents/review/shots/home\\.png"`));
  assert.match(render("shot"), new RegExp(`<img[^>]*src="${raw}/%40documents/review/shots/home\\.png"`));
  assert.match(render("result"), /<img[^>]*src="plan\.png"/, "a document without a base keeps its addresses, also inside a run that resolves them");
});

test("the run's chat resolves relative and aliased addresses against the run's root and keeps absolute ones", () => {
  const plugin = webPlugin.activate!({ routePrefix: prefix });
  const chat = (text: string) => renderToStaticMarkup(createElement(RunUrls, { resolve: plugin.resolveRunUrl, runId: "run-1" }, createElement(Markdown, { text })));
  assert.match(chat("![Shot](@documents/browser/x.png)"), new RegExp(`<img[^>]*src="${raw}/@documents/browser/x\\.png"`));
  assert.match(chat("![Shot](shots/a.png)"), new RegExp(`<img[^>]*src="${raw}/shots/a\\.png"`));
  for (const kept of ["https://example.com/a.png", "/api/other.png", "#top"]) {
    assert.match(chat(`[x](${kept})`), new RegExp(`href="${kept.replaceAll(".", "\\.")}"`), kept);
  }
  assert.match(renderToStaticMarkup(createElement(RunUrls, { resolve: undefined, runId: "run-1" }, createElement(Markdown, { text: "![Shot](shots/a.png)" }))),
    /<img[^>]*src="shots\/a\.png"/, "without a resolver the address stays");
});

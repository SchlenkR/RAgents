import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentPanel, type DocumentSection } from "../../../plugins/ragents.documents/web/DocumentViewer";
import { documentBaseOf, htmlWithBase, markdownWithResolvedUrls, resolveDocumentUrl } from "../../../plugins/ragents.documents/web/links";

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
});

test("the Markdown rewrite changes link and image destinations found by the parser and leaves everything else as written", () => {
  const source = [
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
    "",
    "[^1]: a footnote, not a definition",
    "",
  ].join("\r\n");
  const rewritten = markdownWithResolvedUrls(source, (url) => resolveDocumentUrl(report, url));
  assert.equal(rewritten, [
    "# Review",
    "",
    `![Home](${raw}/%40documents/review/shots/home.png "Home (start)") and [details](${raw}/%40documents/review/notes/a%20b.md), [web](https://example.com), [top](#review)`,
    "",
    "![Earlier][earlier]",
    "",
    `[earlier]: ${raw}/@documents/browser/earlier.png`,
    "",
    "```",
    "![not an image](code.png)",
    "```",
    "",
    "| Step | Shot |",
    "| --- | --- |",
    `| Save | ![Saved](${raw}/%40documents/review/shots/saved%29.png) |`,
    "",
    "[^1]: a footnote, not a definition",
    "",
  ].join("\r\n"));
  assert.equal(markdownWithResolvedUrls("No links here.", () => "changed"), "No links here.");
});

test("an HTML document gets the base address of its folder, after its doctype", () => {
  const base = `${report.root}${report.folder}`;
  assert.equal(htmlWithBase("<!DOCTYPE html>\n<html><body><img src=\"a.png\"></body></html>", base),
    `<!DOCTYPE html><base href="${raw}/%40documents/review/">\n<html><body><img src="a.png"></body></html>`);
  assert.equal(htmlWithBase("<p>Hello</p>", "/x?a=1&b=\"2\""), "<base href=\"/x?a=1&amp;b=&quot;2&quot;\"><p>Hello</p>");
});

test("the Documents view renders a Markdown document with its images under the content route and an image document by reference", () => {
  const sections: DocumentSection[] = [{
    id: "chat", label: "Shown in chat", kind: "chat",
    documents: [
      { id: "report", title: "Report", format: "markdown", content: "![Home](@documents/review/shots/home.png)", base: documentBaseOf(prefix, "run-1") },
      { id: "shot", title: "Home", format: "image", contentUrl: `${raw}/%40documents/review/shots/home.png`, base: report },
    ],
  }];
  const render = (activeId: string) => renderToStaticMarkup(createElement(DocumentPanel, { activeId, sections, truncated: false, onSelect: () => {} }));
  assert.match(render("report"), new RegExp(`<img[^>]*src="${raw}/@documents/review/shots/home\\.png"`));
  assert.match(render("shot"), new RegExp(`<img[^>]*src="${raw}/%40documents/review/shots/home\\.png"`));
});

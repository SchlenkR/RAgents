import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListDetail, type ListDetailItem } from "../src/ui/ListDetail";
import { ListDetail as PublicListDetail } from "../../../apps/web/src/actor-programs/client-ui/index";
import type { ListDetailProps as PublicListDetailProps } from "../../../apps/web/src/actor-programs/client-ui/contracts";

const items: readonly ListDetailItem[] = Object.freeze([
  Object.freeze({ id: "first", title: "First draft", group: "Texts", description: "A short text", tone: "accent" as const }),
  Object.freeze({ id: "review", title: "Review", group: "Tasks", tone: "purple" as const }),
  Object.freeze({ id: "second", title: "Second draft", group: "Texts", tone: "success" as const }),
]);

test("ListDetail keeps group and entry order and marks exactly the controlled selection", () => {
  const props: PublicListDetailProps = {
    label: "Library", items, selectedId: "second", onSelect: () => {},
    detailHeader: createElement("h2", null, "Full preview"),
    detailFooter: createElement("button", { type: "button" }, "Apply"),
    children: "Only the preview is shown.",
  };
  assert.equal(PublicListDetail, ListDetail);
  const html = renderToStaticMarkup(createElement(ListDetail, props));
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/<ul /g) ?? []).length, 2);
  assert.ok(html.indexOf("First draft") < html.indexOf("Second draft"));
  assert.ok(html.indexOf("Second draft") < html.indexOf("Review"));
  assert.match(html, /<h2>Full preview<\/h2>/);
  assert.match(html, /<footer[^>]*>.*Apply/s);
  const detailId = html.match(/id="([^"]+-detail)"/)?.[1];
  assert.ok(detailId);
  assert.equal(html.split(`aria-controls="${detailId}"`).length - 1, items.length);
  assert.deepEqual(items.map((item) => item.id), ["first", "review", "second"]);
});

test("ListDetail shows no stale details and actions for removed or missing selections", () => {
  const render = (selectedId?: string) => renderToStaticMarkup(createElement(ListDetail, {
    label: "Filtered list", items: [items[0]], selectedId, onSelect: () => {},
    children: "Stale content", detailHeader: "Stale title", detailFooter: "Stale action",
  }));
  for (const html of [render("review"), render()]) {
    assert.match(html, /Choose an entry/);
    assert.doesNotMatch(html, /Stale content|Stale title|Stale action/);
    assert.doesNotMatch(html, /aria-pressed="true"/);
  }
});

test("ListDetail keeps the filter bar for an empty result and locks selection actions when disabled", () => {
  const empty = renderToStaticMarkup(createElement(ListDetail, {
    label: "Search", items: [], onSelect: () => {},
    toolbar: createElement("input", { type: "search", "aria-label": "Search", value: "missing", readOnly: true }),
    emptyState: createElement("p", null, "No matching texts"),
  }));
  assert.match(empty, /type="search"/);
  assert.match(empty, /No matching texts/);
  assert.doesNotMatch(empty, /aria-pressed/);
  const disabled = renderToStaticMarkup(createElement(ListDetail, { label: "List", items, onSelect: () => {}, disabled: true }));
  assert.equal((disabled.match(/disabled=""/g) ?? []).length, items.length);
});

test("ListDetail rejects ambiguous and empty entry IDs", () => {
  const render = (next: ListDetailItem[]) => renderToStaticMarkup(createElement(ListDetail, { label: "List", items: next, onSelect: () => {} }));
  assert.throws(() => render([items[0], items[0]]), /unique, non-empty IDs/);
  assert.throws(() => render([{ id: " ", title: "Without ID" }]), /unique, non-empty IDs/);
});

test("ListDetail switches by its own width, not by the window width", () => {
  const html = renderToStaticMarkup(createElement(ListDetail, {
    label: "List", items, onSelect: () => {}, selectedId: "first",
    toolbar: createElement("input", { type: "search", "aria-label": "Search", readOnly: true }),
  }));
  assert.match(html, /@container\/list-detail/);
  assert.doesNotMatch(html, /max-\[700px\]:/);
  const narrowDetail = html.match(/@max-\[900px\]\/list-detail:group-data-\[detail=true\]\/list-detail:hidden/g) ?? [];
  assert.equal(narrowDetail.length, 2);
});

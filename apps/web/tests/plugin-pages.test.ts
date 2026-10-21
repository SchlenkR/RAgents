import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAccessContext } from "../../../packages/ragents/src/access.ts";
import { PluginRegistry, type PageContribution, type WebPlugin } from "../src/PluginRegistry.tsx";
import { PageButtons, PluginPage } from "../src/run-panel/PluginPages.tsx";

const page = (id: string, order: number, extra: Partial<PageContribution> = {}): PageContribution => ({
  id, order, title: `Page ${id}`, Icon: () => createElement("svg", { "data-icon": id }), Page: () => createElement("p", null, `Content ${id}`), ...extra,
});
const registryWith = (plugins: WebPlugin[]) => new PluginRegistry({
  brand: { title: "Test" },
  plugins,
  product: { id: "test", title: "Test" },
  startEntries: [],
});

test("pages are sorted by order and id", () => {
  const registry = registryWith([
    { id: "test.first", pages: [page("later", 200), page("second", 100)] },
    { id: "test.second", pages: [page("first", 100)] },
  ]);
  assert.deepEqual(registry.pages.map((entry) => entry.id), ["first", "second", "later"]);
});

test("home claims use visible pages in order then id, regardless of plugin order", () => {
  const plugins: WebPlugin[] = [
    { id: "demo.later", pages: [page("later", 200, { home: true })] },
    { id: "demo.first", pages: [page("beta", 100, { home: true }), page("alpha", 100, { home: true, readRight: "demo.home" })] },
    { id: "demo.disabled", enabled: () => false, pages: [page("disabled", 0, { home: true })] },
  ];
  const user = (rights: string[]) => createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights } });
  for (const ordered of [plugins, [...plugins].reverse()]) {
    const registry = registryWith(ordered);
    assert.equal(registry.homePageFor(user([]))?.id, "beta");
    assert.equal(registry.homePageFor(user(["demo.home"]))?.id, "alpha");
    assert.equal(registry.homePageFor()?.id, "alpha");
  }
  assert.equal(registryWith([]).homePageFor(), undefined);
  assert.equal(registryWith([{ id: "demo.guarded", pages: [page("guarded", 0, { home: true, readRight: "demo.home" })] }]).homePageFor(user([])), undefined);
  assert.equal(registryWith([{ id: "demo.case", pages: [page("demo.alpha", 0, { home: true }), page("demo.Zeta", 0, { home: true })] }]).homePageFor()?.id, "demo.Zeta");
});

test("removing or disabling a plugin removes its pages and they do not collide with active ones", () => {
  const retained = { id: "test.retained", pages: [page("reports", 200)] };
  const disabled = { id: "test.disabled", enabled: () => false, pages: [page("reports", 100)] };
  assert.deepEqual(registryWith([retained, disabled]).pages.map((entry) => entry.id), ["reports"]);
  assert.deepEqual(registryWith([disabled]).pages, []);
  assert.deepEqual(registryWith([]).pages, []);
});

test("duplicate or empty ids, blank titles, and ids with surrounding whitespace are rejected", () => {
  assert.throws(() => registryWith([
    { id: "test.first", pages: [page("reports", 100)] },
    { id: "test.second", pages: [page("reports", 200)] },
  ]), /Page registered twice: reports/);
  assert.throws(() => registryWith([{ id: "test.empty", pages: [page("", 100)] }]), /Page without ID/);
  assert.throws(() => registryWith([{ id: "test.blank", pages: [page("reports", 100, { title: "  " })] }]), /Page reports has no title/);
  assert.throws(() => registryWith([{ id: "test.padded", pages: [page(" reports", 100)] }]), /Page  reports has whitespace around its ID/);
  assert.throws(() => registryWith([{ id: "demo.reserved", pages: [page("runs", 100)] }]), /Page ID runs is reserved/);
});

test("a page needs its read right and a page without one is shown to everyone", () => {
  const registry = registryWith([{ id: "test.guarded", pages: [page("open", 100), page("guarded", 200, { readRight: "test.read" })] }]);
  const user = (rights: string[]) => createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights } });
  assert.deepEqual(registry.pagesFor(user(["runs.read"])).map((entry) => entry.id), ["open"]);
  assert.deepEqual(registry.pagesFor(user(["runs.read", "test.read"])).map((entry) => entry.id), ["open", "guarded"]);
  assert.deepEqual(registry.pagesFor().map((entry) => entry.id), ["open", "guarded"], "Without sign-in everything is allowed.");
});

test("the top bar shows one button per page with its icon and title and highlights only the open page", () => {
  const html = renderToStaticMarkup(createElement(PageButtons, { active: "reports", onOpen: () => {}, pages: [page("reports", 100, { title: "Reports" }), page("audit", 200, { title: "Audit" })] }));
  assert.match(html, /<nav aria-label="Pages"/);
  const buttons = [...html.matchAll(/<button[^>]*>.*?<\/button>/g)].map((match) => match[0]);
  assert.equal(buttons.length, 2);
  assert.match(buttons[0]!, /aria-label="Reports"/);
  assert.match(buttons[0]!, /aria-current="page"/);
  assert.match(buttons[0]!, /data-icon="reports"/);
  assert.match(buttons[0]!, />Reports<\/span>/);
  assert.match(buttons[1]!, /aria-label="Audit"/);
  assert.doesNotMatch(buttons[1]!, /aria-current/);
  assert.equal(renderToStaticMarkup(createElement(PageButtons, { active: undefined, onOpen: () => {}, pages: [] })), "", "Without pages the top bar gets no button.");
});

test("the open page is plain content in a scrolling main area without a dialog", () => {
  const html = renderToStaticMarkup(createElement(PluginPage, { onOpenRun: () => {}, page: page("reports", 100, { title: "Reports" }) }));
  assert.match(html, /<main[^>]*aria-label="Reports"[^>]*data-plugin-page="reports"/);
  assert.match(html, /overflow-y-auto/);
  assert.match(html, /<p>Content reports<\/p>/);
  assert.doesNotMatch(html, /role="dialog"/);
});

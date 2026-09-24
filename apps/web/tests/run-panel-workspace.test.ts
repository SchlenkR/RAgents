import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "../src/ui/badge.tsx";
import type { SessionContext, SessionNavigation, WorkspaceTabContribution } from "../src/PluginRegistry.tsx";
import { RunPanelRail } from "../src/run-panel/RunPanelRail.tsx";
import { RunPanelWorkspace } from "../src/run-panel/RunPanelWorkspace.tsx";
import {
  activeWorkspaceTab,
  clampWorkspaceHeight,
  DEFAULT_RUN_PANEL_WORKSPACE_STATE,
  parseRunPanelWorkspaceState,
  runPanelWorkspaceStorageKey,
  saveRunPanelWorkspaceState,
} from "../src/run-panel/workspace-state.ts";

const Icon = ({ text }: { text: string }) => createElement("svg", { "data-icon": text });
const tab = (id: string, label: string, order: number, extra: Partial<WorkspaceTabContribution> = {}): WorkspaceTabContribution => ({
  id, label, order, Icon: () => createElement(Icon, { text: id }), Panel: () => createElement("p", null, `Panel ${label}`), ...extra,
});
const tabs = [
  tab("files", "Dateien", 260),
  tab("documents", "Dokumente", 200, { Badge: () => createElement(Badge, { variant: "secondary" }, "3"), keepMounted: true }),
  tab("executions", "Executions", 110),
];
const session = { session: { id: "run-a", title: "Run", updatedAt: 0 }, messages: [] } as unknown as SessionContext;
const navigationFor = (activeTabId: string): SessionNavigation => ({ activeTabId, openTab: () => {}, revealEntity: () => false, selectionFor: () => undefined });
const attribute = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((match) => match[1]);

function fakeWindow(context: { after: (fn: () => void) => void }) {
  const values = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } },
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  return values;
}

test("der Zustand der Leiste wird streng gelesen und die Höhe lässt dem Chat Platz", () => {
  assert.deepEqual(parseRunPanelWorkspaceState(null), DEFAULT_RUN_PANEL_WORKSPACE_STATE);
  assert.deepEqual(parseRunPanelWorkspaceState(JSON.stringify({ tab: "files", height: 300 })), { tab: "files", height: 300 });
  assert.deepEqual(parseRunPanelWorkspaceState(JSON.stringify({ tab: null, height: 120 })), { tab: null, height: 120 });
  assert.throws(() => parseRunPanelWorkspaceState(JSON.stringify({ tab: "files" })), /ungültig/);
  assert.throws(() => parseRunPanelWorkspaceState(JSON.stringify({ tab: 3, height: 300 })), /ungültig/);
  assert.throws(() => parseRunPanelWorkspaceState(JSON.stringify({ tab: "files", height: 20 })), /ungültig/);
  assert.throws(() => parseRunPanelWorkspaceState(JSON.stringify({ tab: "files", height: 300, extra: 1 })), /ungültig/);
  assert.equal(clampWorkspaceHeight(50, 800), 120);
  assert.equal(clampWorkspaceHeight(700, 800), 640);
  assert.equal(clampWorkspaceHeight(300.4, Number.POSITIVE_INFINITY), 300);
});

test("der offene Reiter gilt nur, solange die Fläche offen und der Reiter verfügbar ist", () => {
  assert.equal(activeWorkspaceTab({ tab: null, height: 280 }, tabs), "");
  assert.equal(activeWorkspaceTab({ tab: "documents", height: 280 }, tabs), "documents");
  assert.equal(activeWorkspaceTab({ tab: "removed", height: 280 }, tabs), "");
});

test("Öffnen, erneutes Wählen und Schließen schreiben den Reiter je Run in den Browser-Speicher", (context) => {
  const values = fakeWindow(context);
  const key = runPanelWorkspaceStorageKey("run-a");
  const stored = () => parseRunPanelWorkspaceState(values.get(key) ?? null);
  const click = (tabId: string) => {
    const state = stored();
    saveRunPanelWorkspaceState("run-a", { ...state, tab: activeWorkspaceTab(state, tabs) === tabId ? null : tabId });
  };
  click("files");
  assert.deepEqual(stored(), { tab: "files", height: 280 });
  click("documents");
  assert.equal(activeWorkspaceTab(stored(), tabs), "documents");
  click("documents");
  assert.deepEqual(stored(), { tab: null, height: 280 });
  saveRunPanelWorkspaceState("run-a", { ...stored(), height: 400 });
  assert.equal(values.has(runPanelWorkspaceStorageKey("run-b")), false);
  assert.throws(() => saveRunPanelWorkspaceState("run-a", { tab: "files", height: 10 }), /ungültig/);
  assert.deepEqual(stored(), { tab: null, height: 400 });
});

test("die Leiste zeigt die verfügbaren Reiter in ihrer Reihenfolge, den offenen gedrückt, Badge und Punkt für Neues, Tooltip statt title", () => {
  const ordered = [...tabs].sort((left, right) => left.order - right.order);
  const html = renderToStaticMarkup(createElement(RunPanelRail, { navigation: navigationFor("documents"), onClose: () => {}, open: true, pendingTabIds: ["files"], session, tabs: ordered }));
  assert.deepEqual(attribute(html, "aria-label"), ["Reiter der Leiste", "Executions", "Dokumente", "Dateien"]);
  assert.deepEqual(attribute(html, "aria-pressed"), ["false", "true", "false"]);
  assert.deepEqual(attribute(html, "title"), []);
  assert.deepEqual(attribute(html, "data-slot").filter((slot) => slot === "tooltip-trigger").length, 3);
  assert.match(html, /data-slot="badge"[^>]*>3</);
  assert.equal((html.match(/rounded-full bg-primary/g) ?? []).length, 1);
  assert.match(html, /aria-controls="run-panel-workspace"/);
  const closed = renderToStaticMarkup(createElement(RunPanelRail, { navigation: navigationFor("documents"), onClose: () => {}, open: false, pendingTabIds: [], session, tabs: ordered }));
  assert.deepEqual(attribute(closed, "aria-pressed"), ["false", "false", "false"]);
});

test("die Leiste zeigt den offenen Reiter mit Name und Schließen-Knopf und bleibt geschlossen verborgen", () => {
  const open = renderToStaticMarkup(createElement(RunPanelWorkspace, { navigation: navigationFor("files"), onClose: () => {}, open: true, runId: "run-a", session, tabs }));
  assert.match(open, /<section[^>]*aria-label="Leiste"[^>]*id="run-panel-workspace"/);
  assert.doesNotMatch(open, /<section[^>]*hidden=""/);
  assert.match(open, /<h2[^>]*>Dateien<\/h2>/);
  assert.match(open, /aria-label="Leiste schließen"/);
  assert.match(open, /aria-label="Höhe der Leiste"[^>]*aria-orientation="horizontal"[^>]*aria-valuenow="280"/);
  assert.match(open, /Panel Dateien/);
  assert.doesNotMatch(open, /Panel Dokumente|Panel Executions/);
  const closed = renderToStaticMarkup(createElement(RunPanelWorkspace, { navigation: navigationFor(""), onClose: () => {}, open: false, runId: "run-a", session, tabs }));
  assert.match(closed, /<section[^>]*hidden=""/);
  assert.doesNotMatch(closed, /Panel Dateien|Panel Dokumente|Panel Executions/);
});

test("das Run-Panel zeigt die Leiste nur im Layout panel, eine Mini-App im Editor-Reiter bekommt keine", async (context) => {
  const values = fakeWindow(context);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const { PluginChat } = await import("../src/PluginChat.tsx");
  const { PluginRegistry } = await import("../src/PluginRegistry.tsx");
  const registry = new PluginRegistry({
    brand: { title: "Test" }, product: { id: "test", title: "Test" }, startEntries: [],
    plugins: [{ id: "test", workspaceTabs: tabs, surfaceElements: [{ id: "test.apps", order: 1, select: () => [{ id: "board", title: "Board" }], Element: () => createElement("p", null, "Board-App") }] }],
  });
  const run = { id: "run-a", title: "Run", updatedAt: 0 };
  const panel = renderToStaticMarkup(createElement(PluginChat, { layout: "panel", registry, session: run }));
  const rail = panel.match(/<nav aria-label="Reiter der Leiste"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.notEqual(rail, "");
  assert.deepEqual(attribute(rail, "aria-pressed"), ["false", "false", "false"]);
  assert.match(panel, /<section[^>]*aria-label="Leiste"[^>]*hidden=""/);
  assert.equal(values.size, 0, "ohne Klick wird nichts gespeichert");
  const element = renderToStaticMarkup(createElement(PluginChat, { layout: { element: "board" }, registry, session: run }));
  assert.match(element, /Board-App/);
  assert.doesNotMatch(element, /Reiter der Leiste|aria-label="Leiste"/);
});

test("Reiter und Kopfbeiträge, die den Arbeitsbereich brauchen, fehlen bei einem Run, dessen Arbeitsbereich der Betrachter nicht erreicht", async (context) => {
  fakeWindow(context);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const { PluginChat } = await import("../src/PluginChat.tsx");
  const { PluginRegistry } = await import("../src/PluginRegistry.tsx");
  const { unrestrictedAccess } = await import("../../../packages/ragents/src/access.ts");
  const registry = new PluginRegistry({
    brand: { title: "Test" }, product: { id: "test", title: "Test" }, startEntries: [],
    plugins: [{
      id: "test",
      workspaceTabs: [tab("files", "Dateien", 260), tab("diagnostics", "Diagnose", 300, { requiresWorkspace: true })],
      sessionHeaders: [
        { id: "test.processes", order: 1, requiresWorkspace: true, Header: () => null },
        { id: "test.activity", order: 2, Header: () => null },
      ],
    }],
  });
  const run = (workspaceAccessible?: boolean) => ({ id: "run-a", title: "Run", updatedAt: 0, ...(workspaceAccessible === undefined ? {} : { workspaceAccessible }) });
  const contextOf = (workspaceAccessible?: boolean) => ({ session: run(workspaceAccessible), messages: [] }) as unknown as SessionContext;
  const ids = (entries: readonly { id: string }[]) => entries.map((entry) => entry.id);

  assert.deepEqual(ids(registry.availableTabs(contextOf(false))), ["files"]);
  assert.deepEqual(ids(registry.registeredTabs(contextOf(false))), ["files", "diagnostics"], "registriert bleibt der Reiter, ein Verweis darauf wirft nicht");
  assert.deepEqual(ids(registry.headersFor(contextOf(false), unrestrictedAccess, "header")), ["test.activity"]);
  for (const reachable of [true, undefined]) {
    assert.deepEqual(ids(registry.availableTabs(contextOf(reachable))), ["files", "diagnostics"]);
    assert.deepEqual(ids(registry.headersFor(contextOf(reachable), unrestrictedAccess, "header")), ["test.processes", "test.activity"]);
  }

  const rail = (workspaceAccessible: boolean) => renderToStaticMarkup(createElement(PluginChat, { layout: "panel", registry, session: run(workspaceAccessible) }))
    .match(/<nav aria-label="Reiter der Leiste"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.deepEqual(attribute(rail(false), "data-icon"), ["files"]);
  assert.deepEqual(attribute(rail(true), "data-icon"), ["files", "diagnostics"]);
});

test("der Reiter Dateien bietet ohne erreichbaren Arbeitsbereich nur die Dateiablage an", async () => {
  const { FileBrowserPanel } = await import("../../../plugins/ragents.workspace/web/FileBrowser.tsx");
  const render = (workspaceAccessible: boolean) => renderToStaticMarkup(createElement(FileBrowserPanel, {
    active: true, navigation: navigationFor("files"), selection: undefined,
    session: { session: { id: "run-a", title: "Run", updatedAt: 0, workspaceAccessible }, messages: [] } as unknown as SessionContext,
  }));
  const foreign = render(false);
  assert.match(foreign, /Dateiablage/);
  assert.doesNotMatch(foreign, /Arbeitsverzeichnis/);
  assert.match(render(true), /Arbeitsverzeichnis[\s\S]*Dateiablage/);
});

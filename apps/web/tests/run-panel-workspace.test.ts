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
  tab("files", "Files", 260),
  tab("documents", "Documents", 200, { Badge: () => createElement(Badge, { variant: "secondary" }, "3"), keepMounted: true }),
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

test("the sidebar state is parsed strictly", () => {
  assert.deepEqual(parseRunPanelWorkspaceState(null), DEFAULT_RUN_PANEL_WORKSPACE_STATE);
  assert.deepEqual(parseRunPanelWorkspaceState(JSON.stringify({ tab: "files" })), { tab: "files" });
  assert.deepEqual(parseRunPanelWorkspaceState(JSON.stringify({ tab: null })), { tab: null });
  assert.throws(() => parseRunPanelWorkspaceState(JSON.stringify({})), /invalid/);
  assert.throws(() => parseRunPanelWorkspaceState(JSON.stringify({ tab: 3 })), /invalid/);
  assert.throws(() => parseRunPanelWorkspaceState(JSON.stringify({ tab: "files", height: 300 })), /invalid/);
});

test("the open tab applies only while the surface is open and the tab is available", () => {
  assert.equal(activeWorkspaceTab({ tab: null }, tabs), "");
  assert.equal(activeWorkspaceTab({ tab: "documents" }, tabs), "documents");
  assert.equal(activeWorkspaceTab({ tab: "removed" }, tabs), "");
});

test("opening, selecting again and closing write the tab per run to browser storage", (context) => {
  const values = fakeWindow(context);
  const key = runPanelWorkspaceStorageKey("run-a");
  const stored = () => parseRunPanelWorkspaceState(values.get(key) ?? null);
  const click = (tabId: string) => {
    const state = stored();
    saveRunPanelWorkspaceState("run-a", { ...state, tab: activeWorkspaceTab(state, tabs) === tabId ? null : tabId });
  };
  click("files");
  assert.deepEqual(stored(), { tab: "files" });
  click("documents");
  assert.equal(activeWorkspaceTab(stored(), tabs), "documents");
  click("documents");
  assert.deepEqual(stored(), { tab: null });
  assert.equal(values.has(runPanelWorkspaceStorageKey("run-b")), false);
});

test("the sidebar shows the available tabs in their order, the open one pressed, badge and dot for new items, tooltip instead of title", () => {
  const ordered = [...tabs].sort((left, right) => left.order - right.order);
  const html = renderToStaticMarkup(createElement(RunPanelRail, { navigation: navigationFor("documents"), onClose: () => {}, open: true, pendingTabIds: ["files"], session, tabs: ordered }));
  assert.deepEqual(attribute(html, "aria-label"), ["Sidebar tabs", "Executions", "Documents", "Files"]);
  assert.deepEqual(attribute(html, "aria-pressed"), ["false", "true", "false"]);
  assert.deepEqual(attribute(html, "title"), []);
  assert.deepEqual(attribute(html, "data-slot").filter((slot) => slot === "tooltip-trigger").length, 3);
  assert.match(html, /data-slot="badge"[^>]*>3</);
  assert.equal((html.match(/rounded-full bg-primary/g) ?? []).length, 1);
  assert.match(html, /aria-controls="run-panel-workspace"/);
  const closed = renderToStaticMarkup(createElement(RunPanelRail, { navigation: navigationFor("documents"), onClose: () => {}, open: false, pendingTabIds: [], session, tabs: ordered }));
  assert.deepEqual(attribute(closed, "aria-pressed"), ["false", "false", "false"]);
});

test("the sidebar shows the open tab as a pop-out with name, close button and backdrop and stays hidden when closed", () => {
  const open = renderToStaticMarkup(createElement(RunPanelWorkspace, { navigation: navigationFor("files"), onClose: () => {}, open: true, session, tabs }));
  assert.match(open, /<section[^>]*aria-label="Sidebar"[^>]*id="run-panel-workspace"/);
  assert.doesNotMatch(open, /<section[^>]*hidden=""/);
  assert.match(open, /<h2[^>]*>Files<\/h2>/);
  assert.match(open, /aria-label="Close sidebar"/);
  assert.match(open, /bg-backdrop/);
  assert.match(open, /Panel Files/);
  assert.doesNotMatch(open, /Panel Documents|Panel Executions/);
  const closed = renderToStaticMarkup(createElement(RunPanelWorkspace, { navigation: navigationFor(""), onClose: () => {}, open: false, session, tabs }));
  assert.match(closed, /<section[^>]*hidden=""/);
  assert.doesNotMatch(closed, /bg-backdrop/);
  assert.doesNotMatch(closed, /Panel Files|Panel Documents|Panel Executions/);
});

test("the run panel shows the sidebar only in the panel layout, a mini-app in an editor tab gets none", async (context) => {
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
  const rail = panel.match(/<nav aria-label="Sidebar tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.notEqual(rail, "");
  assert.deepEqual(attribute(rail, "aria-pressed"), ["false", "false", "false"]);
  assert.match(panel, /<section[^>]*aria-label="Sidebar"[^>]*hidden=""/);
  assert.equal(values.size, 0, "nothing is stored without a click");
  const element = renderToStaticMarkup(createElement(PluginChat, { layout: { element: "board" }, registry, session: run }));
  assert.match(element, /Board-App/);
  assert.doesNotMatch(element, /Sidebar tabs|aria-label="Sidebar"/);
});

test("tabs and header contributions that need the workspace are missing for a run whose workspace the viewer cannot reach", async (context) => {
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
      workspaceTabs: [tab("files", "Files", 260), tab("diagnostics", "Diagnostics", 300, { requiresWorkspace: true })],
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
  assert.deepEqual(ids(registry.registeredTabs(contextOf(false))), ["files", "diagnostics"], "the tab stays registered, a reference to it does not throw");
  assert.deepEqual(ids(registry.headersFor(contextOf(false), unrestrictedAccess)), ["test.activity"]);
  for (const reachable of [true, undefined]) {
    assert.deepEqual(ids(registry.availableTabs(contextOf(reachable))), ["files", "diagnostics"]);
    assert.deepEqual(ids(registry.headersFor(contextOf(reachable), unrestrictedAccess)), ["test.processes", "test.activity"]);
  }

  const rail = (workspaceAccessible: boolean) => renderToStaticMarkup(createElement(PluginChat, { layout: "panel", registry, session: run(workspaceAccessible) }))
    .match(/<nav aria-label="Sidebar tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.deepEqual(attribute(rail(false), "data-icon"), ["files"]);
  assert.deepEqual(attribute(rail(true), "data-icon"), ["files", "diagnostics"]);
});

test("the Files tab offers only the file storage without a reachable workspace", async () => {
  const { FileBrowserPanel } = await import("../../../plugins/ragents.workspace/web/FileBrowser.tsx");
  const render = (workspaceAccessible: boolean) => renderToStaticMarkup(createElement(FileBrowserPanel, {
    active: true, navigation: navigationFor("files"), selection: undefined,
    session: { session: { id: "run-a", title: "Run", updatedAt: 0, workspaceAccessible }, messages: [] } as unknown as SessionContext,
  }));
  const foreign = render(false);
  assert.match(foreign, /File storage/);
  assert.doesNotMatch(foreign, /Working directory/);
  assert.match(render(true), /Working directory[\s\S]*File storage/);
});

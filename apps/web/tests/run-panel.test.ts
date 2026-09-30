import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel.tsx";
import { AccessContext } from "../src/AccessContext.tsx";
import { unrestrictedAccess } from "../../../packages/ragents/src/access.ts";
import type { SessionContext, SurfaceCenterContext } from "../src/PluginRegistry.tsx";
import { createBrowserHost, RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host.ts";

const session = {
  session: { id: "run", title: "Run", updatedAt: 0 }, connected: true, running: false,
  messages: [], pluginEvents: [], send: async () => {}, start: async () => {},
} satisfies SessionContext;

const render = (kind: RunPanelHost["kind"], apps: boolean) => {
  const host = { ...createBrowserHost({} as Window), kind };
  const props: SurfaceCenterContext = {
    session, navigation: { activeTabId: "", openTab() {}, revealEntity: () => false, selectionFor: () => undefined },
    cardSections: [], tabIds: [], statusContainer: null, toolbarContainer: null,
    renderChat: () => createElement("textarea", { "aria-label": "Message" }),
    surfaceElements: apps ? [{
      id: "apps", order: 0,
      select: () => [{ id: "notes", title: "Notes" }, { id: "hidden", title: "Hidden", visible: false }],
      Element: () => { throw new Error("An app must not mount before it is opened."); },
    }] : [],
  };
  return renderToStaticMarkup(createElement(AccessContext.Provider, { value: { ...unrestrictedAccess, logout: async () => {} } },
    createElement(RunPanelHostProvider, { value: host }, createElement(OrchestrationRunPanel, props))));
};

test("VS Code keeps chat visible and exposes even a single app as a launch entry", () => {
  const html = render("vscode", true);
  assert.match(html, /Mini-apps of the run/);
  assert.match(html, />Notes</);
  assert.match(html, /aria-label="Message"/);
  assert.doesNotMatch(html, /Hidden|role="tab"|role="separator"/);
});

test("the browser panel starts on Chat with app tabs and no eagerly mounted app", () => {
  const html = render("browser", true);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"[^>]*role="tab"[^>]*>Chat</);
  assert.match(html, />Notes</);
  assert.doesNotMatch(html, /Hidden/);
});

test("a run without apps retains the chat without an empty app list", () => {
  const html = render("vscode", false);
  assert.match(html, /aria-label="Message"/);
  assert.doesNotMatch(html, /Mini-apps of the run/);
});

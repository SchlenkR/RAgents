import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolInfo } from "quassel/events";

import type { SessionContext, SessionNavigation, ToolPresenterContext } from "../src/PluginRegistry";
import { webPlugin } from "../../../plugins/ragents.documents/web/index";

const plugin = webPlugin.activate!({ routePrefix: "/api/plugins/ragents.documents" });
const presenter = plugin.toolPresenters![0]!;
const session = { session: { id: "run-1" } } as unknown as SessionContext;
const navigation: SessionNavigation = { activeTabId: undefined, openTab: () => {}, revealEntity: () => false, selectionFor: () => undefined };
const tool = (args: object): ToolInfo => ({ id: "call-1", name: "show_document", arguments: JSON.stringify(args), result: "Shown to the user." });
const inline = (args: object) => renderToStaticMarkup(createElement(presenter.Inline!, { navigation, session, tool: tool(args) } as ToolPresenterContext));

test("show_document opens a workspace file, a file under @documents, an image and own content in the Documents view", () => {
  for (const args of [
    { title: "Guide", file_path: "docs/guide.md" },
    { title: "Report", file_path: "@documents/topic/report.md" },
    { title: "Login", file_path: "@documents/topic/shots/login.png" },
    { title: "Summary", content: "# Summary" },
  ]) {
    assert.deepEqual(presenter.reveal!(tool(args), session), { tabId: "ragents.documents.library", selection: "call-1" }, JSON.stringify(args));
  }
  assert.match(inline({ title: "Guide", file_path: "docs/guide.md" }), /Guide/);
  assert.match(inline({ title: "Page", file_path: "site/index.html" }), /HTML/);
  assert.match(inline({ title: "Login", file_path: "@documents/topic/shots/login.png" }), /Image/);
});

test("a call of a former contract shows no document", () => {
  for (const args of [{ title: "Old", path: "topic/file.md" }, { title: "Stored", storePath: "topic/report.md" }]) {
    assert.equal(presenter.reveal!(tool(args), session), undefined, JSON.stringify(args));
    assert.equal(inline(args), "");
  }
});

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import type { GlobalAppSummary } from "../../../plugins/ragents.global-apps/contract.ts";
import { GlobalAppWidget } from "../../../plugins/ragents.global-apps/web/GlobalAppWidget.tsx";
import { globalAppWidgets } from "../../../plugins/ragents.global-apps/web/index.tsx";
import { checkedStartWidgets } from "../src/panel/start-widgets";

const app: GlobalAppSummary = {
  name: "daily-date", actorId: "app-actor", description: "Today's date at 8", triggers: { daily: { at: "08:00", timeZone: "Europe/Berlin" } },
  views: [], paused: false, status: "ready", lastRunAt: "2026-10-10T06:00:00Z", nextRunAt: "2026-10-11T06:00:00Z",
  lastResult: { outcome: "completed", at: "2026-10-10T06:00:00Z", summary: "Today is 10 October 2026." }, problem: null,
};
const render = (value: GlobalAppSummary) => renderToStaticMarkup(createElement(GlobalAppWidget, { app: value, runId: "global-space", revision: 1 }));

test("every widget shows its last result, including a widget loading its React view", () => {
  for (const views of [[], [{ id: "date.main", title: "Today's date", revision: "revision" }]]) {
    const html = render({ ...app, views });
    assert.match(html, /Today is 10 October 2026/);
    assert.match(html, /Last result/);
    assert.match(html, /Run now/);
    assert.match(html, /Pause/);
  }
});

test("a failed app has its own cause and recovery actions and keeps the last output", () => {
  const html = render({ ...app, status: "blocked", problem: "The app frame is unavailable." });
  assert.match(html, /role="alert"/);
  assert.match(html, /The app frame is unavailable/);
  assert.match(html, /Retry/);
  assert.match(html, /Open details/);
  assert.match(html, /Today is 10 October 2026/);
});

test("dynamic app widget IDs stay stable when view titles and revisions change, and the gallery describes each app", () => {
  const widgets = (value: GlobalAppSummary) => globalAppWidgets({ runId: "global-space", revision: 1, apps: [value], errors: [], problem: null }, () => {});
  assert.equal(widgets(app)[0]?.id, "ragents.global-apps:daily-date");
  assert.equal(widgets(app)[0]?.description, "Today's date at 8");
  assert.equal(widgets({ ...app, description: " " })[0]?.description, undefined, "an app without a description shows none");
  const failing = globalAppWidgets({ runId: "global-space", revision: 1, apps: [app], errors: [{ id: "broken", name: "broken", problem: "The build failed." }], problem: "Unavailable." }, () => {});
  assert.doesNotThrow(() => checkedStartWidgets("ragents.global-apps", failing), "app, error, and system widgets meet the host's rules");
  const viewed = { ...app, views: [{ id: "date.main", title: "Date", revision: "new" }] };
  assert.equal(widgets(viewed)[0]?.id, widgets(app)[0]?.id);
  assert.equal(widgets(viewed)[0]?.columns, 4);
  assert.equal(widgets(app)[0]?.columns, 2);
});

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import type { GlobalAppSummary } from "../../../plugins/ragents.global-apps/contract.ts";
import { GlobalAppCard } from "../../../plugins/ragents.global-apps/web/GlobalAppCard.tsx";
import { webPlugin } from "../../../plugins/ragents.global-apps/web/index.tsx";
import { GlobalAppsContent } from "../../../plugins/ragents.global-apps/web/GlobalAppsPage.tsx";
import { createAccessContext } from "../../../packages/ragents/src/access.ts";
import { PluginRegistry } from "../src/PluginRegistry.tsx";

const app: GlobalAppSummary = {
  name: "daily-date", actorId: "app-actor", program: "daily-date.daily-date", description: "Today's date at 8", input: true, triggers: { daily: { at: "08:00", timeZone: "Europe/Berlin" } },
  views: [], paused: false, status: "ready", lastRunAt: "2026-10-10T06:00:00Z", nextRunAt: "2026-10-11T06:00:00Z",
  lastResult: { outcome: "completed", at: "2026-10-10T06:00:00Z", summary: "Today is 10 October 2026." }, problem: null,
};
const render = (value: GlobalAppSummary) => renderToStaticMarkup(createElement(GlobalAppCard, { app: value, runId: "global-space", revision: 1 }));

test("every app shows its last result, including an app loading its React view", () => {
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

test("an app without an input handler offers no trigger controls", () => {
  const html = render({ ...app, input: false, lastResult: null });
  assert.doesNotMatch(html, /Run now/);
  assert.doesNotMatch(html, /Pause/);
  assert.match(html, /No runs yet/);
});

test("the Apps page contains each app, independent failures and recovery actions", () => {
  const html = renderToStaticMarkup(createElement(GlobalAppsContent, {
    snapshot: { runId: "global-space", revision: 1, apps: [app], errors: [{ id: "broken", name: "broken-app", problem: "The build failed." }], problem: "Connection unavailable." },
    onRetry: () => {},
  }));
  assert.match(html, /daily-date/);
  assert.match(html, /Today is 10 October 2026/);
  assert.match(html, /The build failed/);
  assert.match(html, /Connection unavailable/);
  assert.equal((html.match(/>Retry</g) ?? []).length, 2);
  assert.equal((html.match(/>Remove</g) ?? []).length, 1);
  const empty = renderToStaticMarkup(createElement(GlobalAppsContent, {
    snapshot: { runId: null, revision: 0, apps: [], errors: [], problem: null }, onRetry: () => {},
  }));
  assert.match(empty, /No global apps yet/);
});

test("global apps contribute a guarded page and disappear with the plugin", () => {
  const profile = { brand: { title: "Demo" }, plugins: [webPlugin], product: { id: "demo", title: "Demo" }, startEntries: [] };
  const registry = new PluginRegistry(profile);
  const user = (rights: string[]) => createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights } });
  assert.deepEqual(registry.pagesFor(user([])), []);
  assert.deepEqual(registry.pagesFor(user(["ragents.global-apps.read"])).map((page) => [page.id, page.title]), [["ragents.global-apps", "Apps"]]);
  assert.equal(registry.homePageFor(), undefined);
  assert.deepEqual(new PluginRegistry({ ...profile, plugins: [] }).pages, []);
});

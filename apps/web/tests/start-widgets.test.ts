import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { PluginRegistry, type StartWidgetContribution, type StartWidgetsContext } from "../src/PluginRegistry";
import { checkedStartWidgets, loadStartWidgets } from "../src/panel/start-widgets";

const context = (): StartWidgetsContext => ({ runs: [], onOpenRun: () => {}, signal: new AbortController().signal, update: () => {} });
const healthy: StartWidgetContribution = { id: "healthy:counter", title: "Counter", columns: 3, content: createElement("p", {}, "Ready") };

test("dynamic widgets are loaded per context and a failed factory does not affect other contributions", async () => {
  const registry = new PluginRegistry({
    product: { id: "demo", title: "Demo" }, brand: { title: "Demo" }, startEntries: [],
    plugins: [
      { id: "broken", startWidgetsFor: async () => { throw new Error("App metadata unavailable."); } },
      { id: "healthy", startWidgetsFor: ({ runs }) => [{ ...healthy, title: `Counter ${runs.length}` }] },
      { id: "static", startSections: [{ id: "static", title: "Static widget", order: 0, Section: () => null }] },
    ],
  });
  const results = await Promise.allSettled(registry.startWidgetFactories.map((factory) => loadStartWidgets(factory, context())));
  assert.equal(results[0]?.status, "rejected");
  assert.deepEqual(results[1], { status: "fulfilled", value: [{ ...healthy, title: "Counter 0" }] });
  assert.equal(registry.startSections[0]?.title, "Static widget");
});

test("invalid widget IDs, layout hints, gallery details and missing content report errors", () => {
  const check = (widget: StartWidgetContribution) => checkedStartWidgets("healthy", [widget]);
  assert.throws(() => checkedStartWidgets("healthy", [healthy, healthy]), /unique stable identifiers/);
  assert.throws(() => check({ ...healthy, id: "other:counter" }), /needs an ID that starts with healthy:/, "a plugin cannot take another plugin's widget IDs");
  assert.throws(() => check({ ...healthy, id: "healthy:" }), /needs an ID that starts with healthy:/);
  assert.throws(() => check({ ...healthy, title: " " }), /no title/);
  assert.throws(() => check({ ...healthy, columns: 7 }), /Start widget healthy:counter has columns 7; allowed are whole numbers from 1 to 6\./);
  assert.throws(() => check({ ...healthy, columns: 1.5 }), /has columns 1.5/);
  assert.throws(() => check({ ...healthy, order: NaN }), /invalid order/);
  assert.throws(() => check({ ...healthy, content: undefined }), /no title or content/);
  assert.throws(() => check({ ...healthy, description: " " }), /empty description/);
  assert.throws(() => check({ ...healthy, minColumns: 4 }), /has 3 columns outside its range from minColumns 4 to maxColumns 6/);
  assert.throws(() => check({ ...healthy, maxColumns: 0 }), /has maxColumns 0/);
  assert.throws(() => check({ ...healthy, columns: undefined, maxColumns: 4 }), /has 6 columns outside its range/, "the default width is the whole row");
  const described = { ...healthy, description: "Counts what happened today.", minColumns: 2, maxColumns: 4 };
  assert.deepEqual(check(described), [described]);
});

test("a start section cannot take the widget ID prefix of a plugin that publishes dynamic widgets", () => {
  assert.throws(() => new PluginRegistry({
    product: { id: "demo", title: "Demo" }, brand: { title: "Demo" }, startEntries: [],
    plugins: [
      { id: "apps", startWidgetsFor: () => [] },
      { id: "static", startSections: [{ id: "apps:planner", title: "Planner", order: 0, Section: () => null }] },
    ],
  }), /Start section apps:planner uses the widget ID prefix of apps/);
});

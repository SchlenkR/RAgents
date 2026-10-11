import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { PluginRegistry, type StartWidget, type StartWidgetFactoryContext, type StartWidgetProps } from "../src/PluginRegistry";
import { checkedStartWidgets, loadStartWidgets } from "../src/panel/start-widgets";

const context = (): StartWidgetFactoryContext => ({ runs: [], onOpenRun: () => {}, signal: new AbortController().signal, update: () => {} });
const healthy: StartWidget = { id: "healthy:counter", title: "Counter", columns: 3, order: 200, render: () => createElement("p", {}, "Ready") };
const registryWith = (plugins: ConstructorParameters<typeof PluginRegistry>[0]["plugins"]) => new PluginRegistry({
  product: { id: "demo", title: "Demo" }, brand: { title: "Demo" }, startEntries: [], plugins,
});

test("a factory's widgets are loaded per context and a failed factory does not affect other contributions", async () => {
  const registry = registryWith([
    { id: "broken", startWidgets: async () => { throw new Error("App metadata unavailable."); } },
    { id: "healthy", startWidgets: ({ runs }) => [{ ...healthy, title: `Counter ${runs.length}` }] },
    { id: "static", startWidgets: [{ id: "static", title: "Static widget", order: 0, render: () => null }] },
  ]);
  assert.deepEqual(registry.startWidgetFactories.map((factory) => factory.id), ["broken", "healthy"], "a list is no factory");
  const results = await Promise.allSettled(registry.startWidgetFactories.map((factory) => loadStartWidgets(factory, context())));
  assert.equal(results[0]?.status, "rejected");
  assert.deepEqual(results[1], { status: "fulfilled", value: [{ ...healthy, title: "Counter 0" }] });
  assert.equal(registry.startWidgets.find((widget) => widget.id === "static")?.title, "Static widget");
});

test("listed and published widgets follow the same rules with the same causes", () => {
  const listed = (widget: StartWidget) => () => registryWith([{ id: "healthy", startWidgets: [widget] }]);
  const published = (widget: StartWidget) => () => checkedStartWidgets("healthy", [widget]);
  const settings = { limit: { type: "number", label: "Limit", default: 5, min: 1, max: 9 } } as const;
  const broken: readonly [Partial<StartWidget>, RegExp][] = [
    [{ title: " " }, /Start widget healthy:counter has an empty title\.$/],
    [{ columns: 7 }, /Start widget healthy:counter has columns 7; allowed are whole numbers from 1 to 6\.$/],
    [{ columns: 1.5 }, /has columns 1.5/],
    [{ order: NaN }, /Start widget healthy:counter has an invalid order\.$/],
    [{ render: undefined }, /Start widget healthy:counter has no render function\.$/],
    [{ description: " " }, /Start widget healthy:counter has an empty description\.$/],
    [{ minColumns: 4 }, /has 3 columns outside its range from minColumns 4 to maxColumns 6/],
    [{ maxColumns: 0 }, /has maxColumns 0/],
    [{ minColumns: 0 }, /has minColumns 0; allowed are whole numbers from 1 to 6/],
    [{ columns: 2, minColumns: 3, maxColumns: 4 }, /has 2 columns outside its range from minColumns 3 to maxColumns 4/],
    [{ columns: undefined, maxColumns: 4 }, /has 6 columns outside its range/],
    [{ title: undefined }, /Start widget healthy:counter declares a width without a title\.$/],
    [{ title: undefined, columns: undefined, description: "Shows things" }, /Start widget healthy:counter declares a description without a title\.$/],
    [{ title: undefined, columns: undefined, settings }, /Start widget healthy:counter declares settings without a title\.$/],
    [{ settings: {} }, /Start widget healthy:counter declares settings without any setting\.$/],
    [{ settings: { limit: { ...settings.limit, min: 10 } } }, /Start widget healthy:counter has the setting limit from 10 to 9/],
    [{ settings: { limit: { ...settings.limit, default: 10 } } }, /has the setting limit whose default 10 is above the maximum 9/],
  ];
  for (const [change, cause] of broken) {
    const widget = { ...healthy, ...change } as StartWidget;
    assert.throws(listed(widget), cause, `listed: ${JSON.stringify(change)}`);
    assert.throws(published(widget), cause, `published: ${JSON.stringify(change)}`);
  }
  const fine: StartWidget = { ...healthy, description: "Counts what happened today.", minColumns: 2, maxColumns: 4, settings,
    render: ({ settings: values }: StartWidgetProps<typeof settings>) => createElement("p", {}, `Showing ${values.limit}`) };
  const untitled: StartWidget = { id: "healthy:notes", order: 300, render: () => createElement("section", {}, "Notes") };
  assert.deepEqual(published(fine)(), [fine]);
  assert.deepEqual(published(untitled)(), [untitled], "a published widget may also own its heading");
  assert.deepEqual(listed(fine)().startWidgets.filter((widget) => widget.id === fine.id), [fine]);
});

test("only a factory's own widgets carry its prefix", () => {
  assert.throws(() => checkedStartWidgets("healthy", [healthy, healthy]), /unique stable identifiers/);
  assert.throws(() => checkedStartWidgets("healthy", [{ ...healthy, id: "other:counter" }]), /needs an ID that starts with healthy:/, "a plugin cannot take another plugin's widget IDs");
  assert.throws(() => checkedStartWidgets("healthy", [{ ...healthy, id: "healthy:" }]), /needs an ID that starts with healthy:/);
  assert.throws(() => registryWith([
    { id: "apps", startWidgets: () => [] },
    { id: "static", startWidgets: [{ id: "apps:planner", title: "Planner", order: 0, render: () => null }] },
  ]), /Start widget apps:planner uses the widget ID prefix of apps, whose factory publishes its widgets/);
});

import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { PluginRegistry, type StartWidgetContribution, type StartWidgetsContext } from "../src/PluginRegistry";
import { checkedStartWidgets, loadStartWidgets } from "../src/panel/start-widgets";

const context = (): StartWidgetsContext => ({ runs: [], onOpenRun: () => {}, signal: new AbortController().signal, update: () => {} });
const healthy: StartWidgetContribution = { id: "demo:counter", title: "Counter", span: "half", content: createElement("p", {}, "Ready") };

test("dynamic widgets are loaded per context and a failed factory does not affect other contributions", async () => {
  const registry = new PluginRegistry({
    product: { id: "demo", title: "Demo" }, brand: { title: "Demo" }, startEntries: [],
    plugins: [
      { id: "broken", startWidgetsFor: async () => { throw new Error("App metadata unavailable."); } },
      { id: "healthy", startWidgetsFor: ({ runs }) => [{ ...healthy, title: `Counter ${runs.length}` }] },
      { id: "static", startSections: [{ id: "static", title: "Static widget", order: 0, Section: () => null }] },
    ],
  });
  const results = await Promise.allSettled(registry.startWidgetFactories.map(({ create }) => loadStartWidgets(create, context())));
  assert.equal(results[0]?.status, "rejected");
  assert.deepEqual(results[1], { status: "fulfilled", value: [{ ...healthy, title: "Counter 0" }] });
  assert.equal(registry.startSections[0]?.title, "Static widget");
});

test("invalid widget IDs, layout hints and missing content report errors", () => {
  assert.throws(() => checkedStartWidgets([healthy, healthy]), /unique stable identifiers/);
  assert.throws(() => checkedStartWidgets([{ ...healthy, title: " " }]), /no title/);
  assert.throws(() => checkedStartWidgets([{ ...healthy, span: "huge" as never }]), /invalid span/);
  assert.throws(() => checkedStartWidgets([{ ...healthy, order: NaN }]), /invalid order/);
  assert.throws(() => checkedStartWidgets([{ ...healthy, content: undefined }]), /no title or content/);
});

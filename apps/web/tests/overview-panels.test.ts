import assert from "node:assert/strict";
import test from "node:test";

import { PluginRegistry, type OverviewPanelContribution, type WebPlugin } from "../src/PluginRegistry.tsx";

const panel = (id: string, order: number): OverviewPanelContribution => ({ id, order, Panel: () => null });
const registryWith = (plugins: WebPlugin[]) => new PluginRegistry({
  brand: { title: "Test" },
  plugins,
  product: { id: "test", title: "Test" },
  startEntries: [],
});

test("Übersichtsbeiträge sind nach Reihenfolge und Kennung sortiert", () => {
  const registry = registryWith([
    { id: "test.first", overviewPanels: [panel("later", 200), panel("second", 100)] },
    { id: "test.second", overviewPanels: [panel("first", 100)] },
  ]);
  assert.deepEqual(registry.overviewPanels.map((entry) => entry.id), ["first", "second", "later"]);
});

test("Entfernen und Deaktivieren eines Plugins entfernt seinen Übersichtsbeitrag", () => {
  const retained = { id: "test.retained", overviewPanels: [panel("retained", 200)] };
  const disabled = { id: "test.disabled", enabled: () => false, overviewPanels: [panel("disabled", 100)] };
  assert.deepEqual(registryWith([retained, disabled]).overviewPanels.map((entry) => entry.id), ["retained"]);
  assert.deepEqual(registryWith([retained]).overviewPanels.map((entry) => entry.id), ["retained"]);
  assert.deepEqual(registryWith([]).overviewPanels, []);
});

test("doppelte oder leere Übersichtskennungen werden abgelehnt", () => {
  assert.throws(() => registryWith([
    { id: "test.first", overviewPanels: [panel("coordinator", 100)] },
    { id: "test.second", overviewPanels: [panel("coordinator", 200)] },
  ]), /Übersichtsbeitrag doppelt registriert: coordinator/);
  assert.throws(() => registryWith([{ id: "test.empty", overviewPanels: [panel("", 100)] }]), /Übersichtsbeitrag ohne ID/);
});

test("Übersichtsbeiträge deaktivierter Plugins verursachen keine Kollision mit aktiven", () => {
  const registry = registryWith([
    { id: "test.enabled", overviewPanels: [panel("coordinator", 100)] },
    { id: "test.disabled", enabled: () => false, overviewPanels: [panel("coordinator", 100)] },
  ]);
  assert.equal(registry.overviewPanels.length, 1);
});

test("ein Übersichtsbeitrag darf ein Leserecht verlangen", () => {
  const registry = registryWith([{ id: "test.guarded", overviewPanels: [{ ...panel("guarded", 100), readRight: "test.read" }] }]);
  assert.equal(registry.overviewPanels[0]?.readRight, "test.read");
});

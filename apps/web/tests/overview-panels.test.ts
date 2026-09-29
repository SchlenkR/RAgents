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

test("overview contributions are sorted by order and id", () => {
  const registry = registryWith([
    { id: "test.first", overviewPanels: [panel("later", 200), panel("second", 100)] },
    { id: "test.second", overviewPanels: [panel("first", 100)] },
  ]);
  assert.deepEqual(registry.overviewPanels.map((entry) => entry.id), ["first", "second", "later"]);
});

test("removing or disabling a plugin removes its overview contribution", () => {
  const retained = { id: "test.retained", overviewPanels: [panel("retained", 200)] };
  const disabled = { id: "test.disabled", enabled: () => false, overviewPanels: [panel("disabled", 100)] };
  assert.deepEqual(registryWith([retained, disabled]).overviewPanels.map((entry) => entry.id), ["retained"]);
  assert.deepEqual(registryWith([retained]).overviewPanels.map((entry) => entry.id), ["retained"]);
  assert.deepEqual(registryWith([]).overviewPanels, []);
});

test("duplicate or empty overview ids are rejected", () => {
  assert.throws(() => registryWith([
    { id: "test.first", overviewPanels: [panel("coordinator", 100)] },
    { id: "test.second", overviewPanels: [panel("coordinator", 200)] },
  ]), /Overview contribution registered twice: coordinator/);
  assert.throws(() => registryWith([{ id: "test.empty", overviewPanels: [panel("", 100)] }]), /Overview contribution without ID/);
});

test("overview contributions of disabled plugins do not collide with active ones", () => {
  const registry = registryWith([
    { id: "test.enabled", overviewPanels: [panel("coordinator", 100)] },
    { id: "test.disabled", enabled: () => false, overviewPanels: [panel("coordinator", 100)] },
  ]);
  assert.equal(registry.overviewPanels.length, 1);
});

test("an overview contribution may require a read right", () => {
  const registry = registryWith([{ id: "test.guarded", overviewPanels: [{ ...panel("guarded", 100), readRight: "test.read" }] }]);
  assert.equal(registry.overviewPanels[0]?.readRight, "test.read");
});

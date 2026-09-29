import assert from "node:assert/strict";
import test from "node:test";

import { PluginRegistry, type StartOptionContribution } from "../src/PluginRegistry.tsx";
import { conflictingStartOptions, initialStartOptionUpdates, shownStartOptions, withoutFixedStartOptions } from "../src/StartOptions.tsx";
import type { StartOptionState } from "../../server/src/plugin-support/start-options-contract.ts";
import { choicePresentationFrom } from "../../server/src/plugin-support/start-options-contract.ts";

const Empty = () => null;

const registryWith = (...plugins: { id: string; startOptions?: StartOptionContribution[] }[]) => new PluginRegistry({
  brand: { title: "Test" },
  plugins,
  product: { id: "test", title: "Test" },
  startEntries: [],
});

test("start options are collected across all plugins and are unique", () => {
  const registry = registryWith(
    { id: "test.product", startOptions: [{ id: "ragents.model", Control: Empty }] },
    { id: "test.workspace", startOptions: [{ id: "test.workspace.source" }] },
  );
  assert.deepEqual([...registry.startOptions.keys()], ["ragents.model", "test.workspace.source"]);
  assert.equal(registry.startOptions.get("ragents.model")?.Control, Empty);
  assert.throws(
    () => registryWith(
      { id: "test.product", startOptions: [{ id: "ragents.model" }] },
      { id: "test.other", startOptions: [{ id: "ragents.model" }] },
    ),
    /Start option registered twice: ragents\.model/,
  );
});

test("the choice presentation is read strictly", () => {
  assert.deepEqual(
    choicePresentationFrom({ kind: "choice", label: "Source", options: [{ value: "empty", label: "Empty" }] }, "x"),
    { kind: "choice", label: "Source", options: [{ value: "empty", label: "Empty" }] },
  );
  assert.equal(choicePresentationFrom({ kind: "model" }, "x"), undefined);
  assert.throws(() => choicePresentationFrom(null, "x"), /provides no presentation/);
  assert.throws(() => choicePresentationFrom({ kind: "choice", options: [] }, "x"), /has no label/);
  assert.throws(() => choicePresentationFrom({ kind: "choice", label: "Source", options: [{ value: "" }] }, "x"), /options made of value and label/);
});

test("a preset sets only selectable, open options and ignores anything unknown", () => {
  const option = (values: Partial<StartOptionState> & { id: string }): StartOptionState =>
    ({ owner: "test.plugin", value: null, presentation: null, selectable: true, locked: false, chosen: false, ...values });
  const options = [
    option({ id: "ragents.workspace.binding" }),
    option({ id: "ragents.model", locked: true }),
    option({ id: "test.hidden", selectable: false }),
  ];
  const binding = { machine: { client: "vscode-notebook", label: "Notebook" }, folder: { path: "/work" } };
  assert.deepEqual(initialStartOptionUpdates(options, {
    "ragents.workspace.binding": binding,
    "ragents.model": "sonnet",
    "test.hidden": "x",
    "test.unknown": "x",
  }), [["ragents.workspace.binding", binding]]);
  assert.deepEqual(initialStartOptionUpdates(options, {}), []);
});

test("nothing presets what a template fixes, and the start page shows it fixed with its value", () => {
  const option = (values: Partial<StartOptionState> & { id: string }): StartOptionState =>
    ({ owner: "test.plugin", value: null, presentation: null, selectable: true, locked: false, chosen: false, ...values });
  const fixed = { "ragents.workspace.binding": { machine: "server", folder: "fresh" } };
  const preselected = { "ragents.workspace.binding": { machine: { client: "vscode-notebook", label: "Notebook" }, folder: { path: "/work" } }, "ragents.model": "fast" };
  assert.deepEqual(withoutFixedStartOptions(preselected, fixed), { "ragents.model": "fast" });
  assert.deepEqual(withoutFixedStartOptions(preselected, undefined), preselected);

  const options = [
    option({ id: "ragents.workspace.binding", value: { machine: "server", folder: { path: "/srv" } } }),
    option({ id: "ragents.model", value: "fast" }),
    option({ id: "test.hidden", selectable: false }),
  ];
  assert.deepEqual(shownStartOptions(options, fixed), [
    { option: { ...options[0]!, value: { machine: "server", folder: "fresh" }, selectable: false }, fixed: true },
    { option: options[1]!, fixed: false },
  ]);
  assert.deepEqual(shownStartOptions(options, {}).map(({ option }) => option.id), ["ragents.workspace.binding", "ragents.model"]);
});

test("the preparation names a choice that contradicts what the template fixes, before the start refuses it", () => {
  const option = (values: Partial<StartOptionState> & { id: string }): StartOptionState =>
    ({ owner: "test.plugin", value: null, presentation: null, selectable: true, locked: false, chosen: true, ...values });
  const fixed = { "ragents.workspace.binding": { machine: "server", folder: "fresh" }, "ragents.model": { model: "fast", thinking: "off" } };
  const chosenPath = option({ id: "ragents.workspace.binding", value: { machine: "server", folder: { path: "/srv" } } });
  assert.deepEqual(conflictingStartOptions([
    chosenPath,
    option({ id: "ragents.model", value: { thinking: "off", model: "fast" } }),
    option({ id: "test.free", value: "x" }),
  ], fixed), [chosenPath]);
  assert.deepEqual(conflictingStartOptions([{ ...chosenPath, chosen: false }], fixed), [], "a default differing from the template is no contradiction");
  assert.deepEqual(conflictingStartOptions([{ ...chosenPath, locked: true }], fixed), [], "a started run is judged by the server alone");
});

import assert from "node:assert/strict";
import test from "node:test";

import { PluginRegistry, type StartOptionContribution } from "../src/PluginRegistry.tsx";
import { initialStartOptionUpdates } from "../src/StartOptions.tsx";
import type { StartOptionState } from "../../server/src/plugin-support/start-options-contract.ts";
import { choicePresentationFrom } from "../../server/src/plugin-support/start-options-contract.ts";

const Empty = () => null;

const registryWith = (...plugins: { id: string; startOptions?: StartOptionContribution[] }[]) => new PluginRegistry({
  brand: { title: "Test" },
  plugins,
  product: { id: "test", title: "Test" },
  startEntries: [],
});

test("Startoptionen werden über alle Plugins gesammelt und sind eindeutig", () => {
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
    /Startoption doppelt registriert: ragents\.model/,
  );
});

test("die Auswahl-Darstellung wird streng gelesen", () => {
  assert.deepEqual(
    choicePresentationFrom({ kind: "choice", label: "Quelle", options: [{ value: "empty", label: "Leer" }] }, "x"),
    { kind: "choice", label: "Quelle", options: [{ value: "empty", label: "Leer" }] },
  );
  assert.equal(choicePresentationFrom({ kind: "model" }, "x"), undefined);
  assert.throws(() => choicePresentationFrom(null, "x"), /keine Darstellung/);
  assert.throws(() => choicePresentationFrom({ kind: "choice", options: [] }, "x"), /kein label/);
  assert.throws(() => choicePresentationFrom({ kind: "choice", label: "Quelle", options: [{ value: "" }] }, "x"), /options aus value und label/);
});

test("eine Vorbelegung setzt nur wählbare, offene Optionen und ignoriert Unbekanntes", () => {
  const option = (values: Partial<StartOptionState> & { id: string }): StartOptionState =>
    ({ owner: "test.plugin", value: null, presentation: null, selectable: true, locked: false, ...values });
  const options = [
    option({ id: "ragents.workspace.binding" }),
    option({ id: "ragents.model", locked: true }),
    option({ id: "test.hidden", selectable: false }),
  ];
  const binding = { kind: "client", client: "vscode-notebook", label: "Notebook", path: "/work" };
  assert.deepEqual(initialStartOptionUpdates(options, {
    "ragents.workspace.binding": binding,
    "ragents.model": "sonnet",
    "test.hidden": "x",
    "test.unbekannt": "x",
  }), [["ragents.workspace.binding", binding]]);
  assert.deepEqual(initialStartOptionUpdates(options, {}), []);
});

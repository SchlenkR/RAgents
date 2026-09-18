import assert from "node:assert/strict";
import test from "node:test";

import { activatePlugins, pluginBootstrapFrom, webPluginLoadersFrom } from "../src/plugin-bootstrap.ts";

const bootstrap = {
  product: { id: "core", title: "Core" },
  plugins: [{ id: "ragents.todo", web: true }, { id: "ragents.orchestration", web: true, config: { greeting: "hallo" } }],
  startEntries: [
    {
      id: "ragents.reference.demo",
      owner: "ragents.reference",
      action: "skill", skill: "demo", category: "Beispiele",
      title: "Demo",
      description: "Eine Karte",
      prompt: "Frei",
    },
    { id: "test.feature", owner: "test.product", action: "skill", category: "Entwicklung", prompt: "Feature umsetzen", title: "Feature", description: "Ein Lauf", skill: "test-feature-run" },
    { id: "ragents.reference.setup", owner: "ragents.reference", action: "script", title: "Vorgebaut", description: "Ein Script", coordinator: true },
  ],
};

test("die Bootstrap-Antwort wird geprüft und in Descriptoren übersetzt", () => {
  const parsed = pluginBootstrapFrom(bootstrap);
  assert.deepEqual(parsed.plugins, [
    { id: "ragents.todo", web: true, config: undefined },
    { id: "ragents.orchestration", web: true, config: { greeting: "hallo" } },
  ]);
  assert.deepEqual(parsed.startEntries.map((entry) => entry.action), ["skill", "skill", "script"]);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, product: { id: "", title: "x" } }), /erwarteten Format/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: 1 }] }), /Plugin-Descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x" }] }), /Plugin-Descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", web: false, config: "nein" }] }), /Plugin-Descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, startEntries: [{ id: "x" }] }), /ungültigen Einstieg/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, startEntries: [{ ...bootstrap.startEntries[2], source: "x" }] }), /unbekannte Felder source/);
});

test("Lader entstehen aus den Bundle-Einträgen und prüfen den Export der Web-Hälfte", async () => {
  const loaders = webPluginLoadersFrom({
    "ragents.todo": async () => ({ webPlugin: { id: "ragents.todo" } }),
    "ragents.ask": async () => ({ webPlugin: { id: "anders" } }),
    "ragents.activity": async () => ({ default: {} }),
  });
  assert.deepEqual([...loaders.keys()], ["ragents.todo", "ragents.ask", "ragents.activity"]);
  assert.equal((await loaders.get("ragents.todo")!()).id, "ragents.todo");
  await assert.rejects(loaders.get("ragents.ask")!(), /abweichende Kennung anders/);
  await assert.rejects(loaders.get("ragents.activity")!(), /keine Konstante webPlugin/);
});

test("die Aktivierung lädt Web-Hälften und lässt Plugins ohne Web-Hälfte als nackte Kennung stehen", async () => {
  const loaders = webPluginLoadersFrom({
    "ragents.product": async () => ({
      webPlugin: { id: "ragents.product", brand: { title: "Core" } },
    }),
    "ragents.todo": async () => ({
      webPlugin: { id: "ragents.todo", cardSections: [{ id: "ragents.todo.items", order: 200, Section: () => null }] },
    }),
  });
  const withProduct = { ...bootstrap, plugins: [{ id: "ragents.product", web: true }, bootstrap.plugins[0], { id: "ragents.orchestration", web: false }] };
  const { registry, bootstrap: parsed } = await activatePlugins(pluginBootstrapFrom(withProduct), loaders);
  assert.equal(parsed.product.title, "Core");
  assert.deepEqual(registry.activePlugins.map((plugin) => plugin.id), ["ragents.product", "ragents.todo", "ragents.orchestration"]);
  assert.deepEqual(registry.cardSections.map((section) => section.id), ["ragents.todo.items"]);
  assert.equal(registry.brand.title, "Core");
  assert.deepEqual(registry.startEntries, [], "Einstiege von Plugins außerhalb der Liste fallen weg");
  const withReference = { ...withProduct, plugins: [...withProduct.plugins, { id: "ragents.reference", web: false }] };
  const active = (await activatePlugins(pluginBootstrapFrom(withReference), loaders)).registry;
  assert.deepEqual(active.skillEntries.map((entry) => entry.id), ["ragents.reference.demo"]);
  assert.deepEqual(active.scriptEntries.map((entry) => entry.id), ["ragents.reference.setup"]);
});

test("eine Web-Hälfte, die im Bundle fehlt, ist ein harter Fehler", async () => {
  const loaders = webPluginLoadersFrom({ "ragents.todo": async () => ({ webPlugin: { id: "ragents.todo" } }) });
  await assert.rejects(
    activatePlugins(pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "ragents.todo", web: true }, { id: "ragents.orchestration", web: true }] }), loaders),
    /Web-Bundle enthält das Plugin ragents\.orchestration nicht/,
  );
});

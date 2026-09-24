import assert from "node:assert/strict";
import test from "node:test";

import { activatePlugins, pluginBootstrapFrom, type WebBundleLoader } from "../src/plugin-bootstrap.ts";

const bootstrap = {
  product: { id: "core", title: "Core" },
  plugins: [
    { id: "ragents.todo", web: { entry: "/plugins/ragents.todo/web/index.js" } },
    { id: "ragents.orchestration", web: { entry: "/plugins/ragents.orchestration/web/index.js", css: "/plugins/ragents.orchestration/web/index.css" }, config: { greeting: "hallo" } },
  ],
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

const webOf = (id: string) => ({ entry: `/plugins/${id}/web/index.js` });

/** Serves the given modules by address and records every stylesheet it links. */
const loaderOf = (modules: Readonly<Record<string, unknown>>) => {
  const stylesheets: string[] = [];
  const loader: WebBundleLoader = {
    module: async (url) => {
      if (!(url in modules)) throw new Error("404");
      return modules[url];
    },
    stylesheet: async (url) => { stylesheets.push(url); },
  };
  return { loader, stylesheets };
};

test("die Bootstrap-Antwort wird geprüft und in Descriptoren übersetzt", () => {
  const parsed = pluginBootstrapFrom(bootstrap);
  assert.deepEqual(parsed.plugins, [
    { id: "ragents.todo", web: { entry: "/plugins/ragents.todo/web/index.js" }, config: undefined },
    { id: "ragents.orchestration", web: { entry: "/plugins/ragents.orchestration/web/index.js", css: "/plugins/ragents.orchestration/web/index.css" }, config: { greeting: "hallo" } },
  ]);
  assert.deepEqual(pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "ragents.reference" }] }).plugins, [{ id: "ragents.reference", config: undefined }]);
  assert.deepEqual(parsed.startEntries.map((entry) => entry.action), ["skill", "skill", "script"]);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, product: { id: "", title: "x" } }), /erwarteten Format/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: 1 }] }), /Plugin-Descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", web: true }] }), /Plugin-Descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", web: { entry: "" } }] }), /Plugin-Descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", web: { entry: "/a.js", style: "/a.css" } }] }), /Plugin-Descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", config: "nein" }] }), /Plugin-Descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, startEntries: [{ id: "x" }] }), /ungültigen Einstieg/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, startEntries: [{ ...bootstrap.startEntries[2], source: "x" }] }), /unbekannte Felder source/);
});

test("die Aktivierung lädt Web-Hälften per Adresse samt Stylesheet und lässt Plugins ohne Web-Hälfte als nackte Kennung stehen", async () => {
  const { loader, stylesheets } = loaderOf({
    "/plugins/ragents.product/web/index.js": { webPlugin: { id: "ragents.product", brand: { title: "Core" } } },
    "/plugins/ragents.todo/web/index.js": {
      webPlugin: { id: "ragents.todo", cardSections: [{ id: "ragents.todo.items", order: 200, Section: () => null }] },
    },
  });
  const withProduct = {
    ...bootstrap,
    plugins: [
      { id: "ragents.product", web: { ...webOf("ragents.product"), css: "/plugins/ragents.product/web/index.css" } },
      bootstrap.plugins[0],
      { id: "ragents.orchestration" },
    ],
  };
  const { registry, bootstrap: parsed } = await activatePlugins(pluginBootstrapFrom(withProduct), loader);
  assert.equal(parsed.product.title, "Core");
  assert.deepEqual(registry.activePlugins.map((plugin) => plugin.id), ["ragents.product", "ragents.todo", "ragents.orchestration"]);
  assert.deepEqual(registry.cardSections.map((section) => section.id), ["ragents.todo.items"]);
  assert.equal(registry.brand.title, "Core");
  assert.deepEqual(stylesheets, ["/plugins/ragents.product/web/index.css"]);
  assert.deepEqual(registry.startEntries, [], "Einstiege von Plugins außerhalb der Liste fallen weg");
  const withReference = { ...withProduct, plugins: [...withProduct.plugins, { id: "ragents.reference" }] };
  const active = (await activatePlugins(pluginBootstrapFrom(withReference), loader)).registry;
  assert.deepEqual(active.skillEntries.map((entry) => entry.id), ["ragents.reference.demo"]);
  assert.deepEqual(active.scriptEntries.map((entry) => entry.id), ["ragents.reference.setup"]);
});

test("eine Web-Hälfte, die nicht lädt, zeigt sich als Plugin-Fehler mit Kennung und Adresse; die übrigen Plugins bleiben aktiv", async () => {
  const product = { id: "ragents.product", web: webOf("ragents.product") };
  const modules = {
    "/plugins/ragents.product/web/index.js": { webPlugin: { id: "ragents.product", brand: { title: "Core" } } },
    "/plugins/ragents.ask/web/index.js": { webPlugin: { id: "anders" } },
    "/plugins/ragents.activity/web/index.js": { default: {} },
  };
  const { registry, failures } = await activatePlugins(pluginBootstrapFrom({ ...bootstrap, plugins: [
    product,
    { id: "ragents.todo", web: webOf("ragents.todo") },
    { id: "ragents.ask", web: webOf("ragents.ask") },
    { id: "ragents.activity", web: webOf("ragents.activity") },
  ] }), loaderOf(modules).loader);
  assert.deepEqual(failures.map((failure) => failure.id), ["ragents.todo", "ragents.ask", "ragents.activity"]);
  assert.match(failures[0]!.message, /Die Web-Hälfte des Plugins ragents\.todo lädt nicht von \/plugins\/ragents\.todo\/web\/index\.js: 404/);
  assert.match(failures[1]!.message, /Das Bundle ragents\.ask meldet die abweichende Kennung anders/);
  assert.match(failures[2]!.message, /keine Konstante webPlugin/);
  assert.equal(registry.brand.title, "Core", "die Oberfläche steht trotzdem");
  assert.deepEqual(registry.plugins.map((plugin) => plugin.id), ["ragents.product", "ragents.todo", "ragents.ask", "ragents.activity"], "ein Plugin ohne Web-Hälfte behält seinen Platz für die Server-Seite");

  await assert.rejects(activatePlugins(pluginBootstrapFrom({ ...bootstrap, plugins: [product] }), loaderOf({}).loader),
    /Kein aktives Plugin liefert ein Branding[\s\S]*Die Web-Hälfte des Plugins ragents\.product lädt nicht/, "ohne Produkt-Plugin gibt es keine Oberfläche, die Ursache steht dabei");
});

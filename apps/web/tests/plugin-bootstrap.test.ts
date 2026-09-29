import assert from "node:assert/strict";
import test from "node:test";

import { activatePlugins, pluginBootstrapFrom, type WebBundleLoader } from "../src/plugin-bootstrap.ts";

const bootstrap = {
  product: { id: "core", title: "Core" },
  plugins: [
    { id: "ragents.todo", web: { entry: "/plugins/ragents.todo/web/index.js" } },
    { id: "ragents.orchestration", web: { entry: "/plugins/ragents.orchestration/web/index.js", css: "/plugins/ragents.orchestration/web/index.css" }, config: { greeting: "hello" } },
  ],
  startEntries: [
    {
      id: "ragents.reference.demo",
      owner: "ragents.reference",
      action: "skill", skill: "demo", category: "Examples",
      title: "Demo",
      description: "A card",
      prompt: "Free",
    },
    { id: "test.feature", owner: "test.product", action: "skill", category: "Development", prompt: "Implement feature", title: "Feature", description: "A run", skill: "test-feature-run" },
    { id: "ragents.reference.setup", owner: "ragents.reference", action: "script", title: "Prebuilt", description: "A script", coordinator: true },
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

test("the bootstrap response is checked and translated into descriptors", () => {
  const parsed = pluginBootstrapFrom(bootstrap);
  assert.deepEqual(parsed.plugins, [
    { id: "ragents.todo", web: { entry: "/plugins/ragents.todo/web/index.js" }, config: undefined },
    { id: "ragents.orchestration", web: { entry: "/plugins/ragents.orchestration/web/index.js", css: "/plugins/ragents.orchestration/web/index.css" }, config: { greeting: "hello" } },
  ]);
  assert.deepEqual(pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "ragents.reference" }] }).plugins, [{ id: "ragents.reference", config: undefined }]);
  assert.deepEqual(parsed.startEntries.map((entry) => entry.action), ["skill", "skill", "script"]);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, product: { id: "", title: "x" } }), /expected format/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: 1 }] }), /invalid plugin descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", web: true }] }), /invalid plugin descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", web: { entry: "" } }] }), /invalid plugin descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", web: { entry: "/a.js", style: "/a.css" } }] }), /invalid plugin descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, plugins: [{ id: "x", config: "no" }] }), /invalid plugin descriptor/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, startEntries: [{ id: "x" }] }), /invalid template/);
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, startEntries: [{ ...bootstrap.startEntries[2], source: "x" }] }), /unknown fields source/);
  assert.equal(parsed.defaultStartEntry, undefined);
  assert.equal(pluginBootstrapFrom({ ...bootstrap, defaultStartEntry: "test.feature" }).defaultStartEntry, "test.feature");
  assert.throws(() => pluginBootstrapFrom({ ...bootstrap, defaultStartEntry: 3 }), /expected format/);
});

test("activation loads web halves by address with their stylesheet and leaves plugins without a web half as a bare id", async () => {
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
  assert.deepEqual(registry.startEntries, [], "templates of plugins outside the list are dropped");
  const withReference = { ...withProduct, plugins: [...withProduct.plugins, { id: "ragents.reference" }] };
  const active = (await activatePlugins(pluginBootstrapFrom(withReference), loader)).registry;
  assert.deepEqual(active.skillEntries.map((entry) => entry.id), ["ragents.reference.demo"]);
  assert.deepEqual(active.scriptEntries.map((entry) => entry.id), ["ragents.reference.setup"]);
  const withDefault = (await activatePlugins(pluginBootstrapFrom({ ...withReference, defaultStartEntry: "ragents.reference.setup" }), loader)).registry;
  assert.equal(withDefault.defaultStartEntry, "ragents.reference.setup", "the start selection shows the server's default template first");
  await assert.rejects(activatePlugins(pluginBootstrapFrom({ ...withProduct, defaultStartEntry: "ragents.reference.setup" }), loader), /default template ragents.reference.setup/);
});

test("a web half that does not load shows as a plugin failure with id and address; the other plugins stay active", async () => {
  const product = { id: "ragents.product", web: webOf("ragents.product") };
  const modules = {
    "/plugins/ragents.product/web/index.js": { webPlugin: { id: "ragents.product", brand: { title: "Core" } } },
    "/plugins/ragents.ask/web/index.js": { webPlugin: { id: "other" } },
    "/plugins/ragents.activity/web/index.js": { default: {} },
  };
  const { registry, failures } = await activatePlugins(pluginBootstrapFrom({ ...bootstrap, plugins: [
    product,
    { id: "ragents.todo", web: webOf("ragents.todo") },
    { id: "ragents.ask", web: webOf("ragents.ask") },
    { id: "ragents.activity", web: webOf("ragents.activity") },
  ] }), loaderOf(modules).loader);
  assert.deepEqual(failures.map((failure) => failure.id), ["ragents.todo", "ragents.ask", "ragents.activity"]);
  assert.match(failures[0]!.message, /The web half of plugin ragents\.todo does not load from \/plugins\/ragents\.todo\/web\/index\.js: 404/);
  assert.match(failures[1]!.message, /The bundle ragents\.ask reports the different id other/);
  assert.match(failures[2]!.message, /does not export a webPlugin constant/);
  assert.equal(registry.brand.title, "Core", "the interface stands anyway");
  assert.deepEqual(registry.plugins.map((plugin) => plugin.id), ["ragents.product", "ragents.todo", "ragents.ask", "ragents.activity"], "a plugin without a web half keeps its place for the server side");

  await assert.rejects(activatePlugins(pluginBootstrapFrom({ ...bootstrap, plugins: [product] }), loaderOf({}).loader),
    /No active plugin provides branding[\s\S]*The web half of plugin ragents\.product does not load/, "without a product plugin there is no interface, and the cause is shown with it");
});

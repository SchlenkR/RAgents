import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DomainError } from "@ragents/engine";
import { discoverPluginIds, importBundles, loadPlugins, resolvePluginEntries, staleBuiltInBundles } from "../src/profile/plugin-discovery.ts";
import { BUNDLE_FORMAT, isFetchedBundle, sourceRevisionOf } from "../src/profile/bundle-manifest.ts";
import { bundlesRoot, pluginFolder } from "../src/plugin-support/plugins-root.ts";
import { PLUGIN_ENTRY_SOURCE, writeBundle, type BundleFixture } from "./bundle-fixture.ts";

const bundleRoot = (bundles: Readonly<Record<string, BundleFixture | undefined>>): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-bundles-"));
  for (const [name, fixture] of Object.entries(bundles)) {
    if (fixture === undefined) mkdirSync(path.join(root, name));
    else writeBundle(path.join(root, name), fixture);
  }
  return root;
};

const withRequires = (requires: readonly string[], body = ""): string =>
  `${body}export const plugin = { requires: ${JSON.stringify(requires)}, create: () => ({ manifest: { id: "x" }, register: () => {} }) };\n`;

test("every folder under bundles is a built plugin; the host loads only bundles", async () => {
  const ids = discoverPluginIds();

  assert.ok(ids.includes("ragents.orchestration"));
  assert.ok(ids.includes("ragents.ask"));
  assert.ok(ids.includes("ragents.lsp-typescript"));
  const loaded = await loadPlugins(["ragents.orchestration", "ragents.ask", "ragents.todo"]);
  assert.deepEqual(loaded.known, ids);
  assert.deepEqual(loaded.ids, ["ragents.orchestration", "ragents.ask", "ragents.todo"]);
  assert.deepEqual([...loaded.web.keys()].sort(), ["ragents.ask", "ragents.orchestration", "ragents.todo"]);
  assert.deepEqual(loaded.web.get("ragents.todo"), { entry: "/plugins/ragents.todo/web/index.js" }, "the address follows the manifest, a CSS only if the bundle has one");
  assert.deepEqual(loaded.bundles.map((plugin) => plugin.folder), loaded.ids.map((id) => path.join(bundlesRoot, id)));
  assert.equal(typeof loaded.modules.get("ragents.orchestration")?.create, "function");
  assert.equal(pluginFolder("ragents.ask"), path.join(bundlesRoot, "ragents.ask"));
});

test("a bundle outside the host is named by path; the folder name is the id", async () => {
  const elsewhere = bundleRoot({ "test.elsewhere": {} });
  const absolute = path.join(elsewhere, "test.elsewhere");

  const loaded = await loadPlugins(["ragents.orchestration", absolute]);
  assert.deepEqual(loaded.ids, ["ragents.orchestration", "test.elsewhere"]);
  assert.ok(loaded.known.includes("test.elsewhere"));
  assert.equal(loaded.web.has("test.elsewhere"), false);
  assert.equal(pluginFolder("test.elsewhere"), absolute);
  assert.deepEqual(resolvePluginEntries(["./test.elsewhere"], elsewhere).map(({ id, folder }) => ({ id, folder })), [{ id: "test.elsewhere", folder: absolute }]);
});

test("a source folder or a folder without a manifest in the profile is a hard error with its cause", async () => {
  const elsewhere = bundleRoot({ "test.empty": undefined, "test.source": undefined });
  mkdirSync(path.join(elsewhere, "test.source", "server"));
  writeFileSync(path.join(elsewhere, "test.source", "server", "index.ts"), PLUGIN_ENTRY_SOURCE);

  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.missing")]), /has no folder/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.source")]), /is a source folder, not a bundle: build it with ragents plugin build .*test\.source/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.empty")]), /is not a bundle: ragents-bundle\.json is missing/);
  assert.throws(() => discoverPluginIds(elsewhere), /is not a bundle/);
});

test("format and host API of the bundle must match the host, otherwise the start names the command to rebuild", async () => {
  const elsewhere = bundleRoot({
    "test.old-format": { manifest: { format: 1 } },
    "test.old-api": { manifest: { api: 0 } },
    "test.other-id": { manifest: { id: "test.renamed" } },
    "test.extra-field": { manifest: { web: true } },
    "test.outside-web": { manifest: { web: { entry: "server/index.js", classes: "web/classes.json" } }, files: { "web/classes.json": "[]" } },
    "test.missing-web": { manifest: { web: { entry: "web/index.js", classes: "web/classes.json" } }, files: { "web/classes.json": "[]" } },
  });

  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.old-format")]),
    new RegExp(`The bundle test\\.old-format has format 1, this host reads format ${BUNDLE_FORMAT}; rebuild with ragents plugin build <source-folder>`));
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.old-api")]),
    /The bundle test\.old-api is built for host API 0, this host offers \d+; rebuild with ragents plugin build .*/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.other-id")]), /reports the id test\.renamed/);
  const dataRoot = mkdtempSync(path.join(tmpdir(), "ragents-data-root-"));
  const fetched = path.join(dataRoot, "remote", "workshop.example.com", "workshop-client", "profiles", "abc", "dist", "plugins", "test.old-api");
  assert.equal(isFetchedBundle(fetched, dataRoot), true);
  assert.equal(isFetchedBundle(path.join(elsewhere, "test.old-api"), dataRoot), false);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.extra-field")]), /web is missing or has the wrong shape/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.outside-web")]), /server\/index\.js is not under web\//);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.missing-web")]), /The bundle test\.missing-web is missing web\/index\.js; rebuild with ragents plugin build/);
});

test("a bundle that needs host API names this host does not have fails at startup with its cause", async () => {
  const elsewhere = bundleRoot({
    "test.newer-name": { manifest: { hostNames: { server: { "@ragents/engine": ["DomainError"] }, web: { "@ragents/web/ui": ["Button", "NewButton"] } } } },
    "test.newer-module": { manifest: { hostNames: { server: { "@ragents/host/new": ["something"] }, web: {} } } },
    "test.fitting": { manifest: { hostNames: { server: { "@ragents/engine": ["DomainError"] }, web: { "@ragents/web/ui": ["Button"] } } } },
  });
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.newer-name")]),
    /The bundle test\.newer-name needs names from host API \d+ that this host does not offer \(web @ragents\/web\/ui: NewButton\); it was built against a newer host: update the host, otherwise rebuild with ragents plugin build <source-folder>/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.newer-module")]), /does not offer \(server @ragents\/host\/new\)/);
  assert.deepEqual(resolvePluginEntries([path.join(elsewhere, "test.fitting")]).map((plugin) => plugin.id), ["test.fitting"]);
});

test("a built-in bundle counts as outdated as soon as its source folder changes; the host does not check bundles from elsewhere", async () => {
  const sources = mkdtempSync(path.join(tmpdir(), "ragents-sources-"));
  for (const id of ["test.fresh", "test.changed"]) {
    mkdirSync(path.join(sources, id, "server"), { recursive: true });
    writeFileSync(path.join(sources, id, "ragents-plugin.json"), JSON.stringify({ id }));
    writeFileSync(path.join(sources, id, "server", "index.ts"), PLUGIN_ENTRY_SOURCE);
  }
  const revision = sourceRevisionOf(path.join(sources, "test.fresh"));
  mkdirSync(path.join(sources, "test.fresh", "node_modules", "lib"), { recursive: true });
  writeFileSync(path.join(sources, "test.fresh", "node_modules", "lib", "index.js"), "");
  assert.equal(sourceRevisionOf(path.join(sources, "test.fresh")), revision, "node_modules does not count toward the source revision");
  const root = bundleRoot({
    "test.fresh": { manifest: { sourceRevision: revision } },
    "test.changed": { manifest: { sourceRevision: sourceRevisionOf(path.join(sources, "test.changed")) } },
    "test.unknown": { manifest: { sourceRevision: "0".repeat(64) } },
  });
  writeFileSync(path.join(sources, "test.changed", "server", "extra.ts"), "export const extra = 1;\n");
  const elsewhere = bundleRoot({ "test.elsewhere": { manifest: { sourceRevision: "0".repeat(64) } } });
  const plugins = resolvePluginEntries(["test.fresh", "test.changed", "test.unknown", path.join(elsewhere, "test.elsewhere")], process.cwd(), root);
  assert.deepEqual(staleBuiltInBundles(plugins, sources, root), ["test.changed"]);
});

test("an entry point without a valid plugin export is a hard error", async () => {
  const root = bundleRoot({
    "test.without-export": { server: "export const other = 1;\n" },
    "test.without-create": { server: "export const plugin = { requires: [] };\n" },
  });

  await assert.rejects(() => loadPlugins(["test.without-export"], root), /exports no valid entry point in server\/index\.js/);
  await assert.rejects(() => loadPlugins(["test.without-create"], root), /exports no valid entry point in server\/index\.js/);
});

test("an unknown id and an unbuilt built-in plugin abort the start", async () => {
  await assert.rejects(() => loadPlugins(["ragents.orchestration", "ragents.nowhere"]), /Unknown plugin ragents\.nowhere; built in are: /);
  const root = bundleRoot({});
  await assert.rejects(() => loadPlugins(["ragents.ask"], root), /The built-in plugin ragents\.ask is not built: .* is missing; build it in the checkout with pnpm build:plugins/);
});

test("a missing requires aborts the start", async () => {
  await assert.rejects(
    () => loadPlugins(["ragents.documents"]),
    /Plugin ragents\.documents needs the missing plugin ragents\.orchestration/,
  );
});

test("a wrong order aborts the start", async () => {
  await assert.rejects(
    () => loadPlugins(["ragents.documents", "ragents.orchestration"]),
    /Plugin ragents\.orchestration must be registered before ragents\.documents/,
  );
});

test("a duplicate plugin id aborts the start, also by path", async () => {
  await assert.rejects(
    () => loadPlugins(["ragents.orchestration", "ragents.orchestration"]),
    /Plugin ragents\.orchestration appears more than once in the plugin list/,
  );
  const elsewhere = bundleRoot({ "ragents.orchestration": {} });
  await assert.rejects(
    () => loadPlugins(["ragents.orchestration", path.join(elsewhere, "ragents.orchestration")]),
    /Plugin ragents\.orchestration appears more than once in the plugin list/,
  );
});

test("what a bundle uses from other bundles is in the plugin list and in requires", async () => {
  const elsewhere = bundleRoot({
    "test.uses-missing": { manifest: { uses: ["ragents.todo"] } },
    "test.uses-undeclared": { manifest: { uses: ["ragents.orchestration"] } },
  });

  await assert.rejects(() => loadPlugins(["ragents.orchestration", path.join(elsewhere, "test.uses-missing")]),
    /Plugin test\.uses-missing needs the missing plugin ragents\.todo; its bundle imports that plugin's exports/);
  await assert.rejects(() => loadPlugins(["ragents.orchestration", path.join(elsewhere, "test.uses-undeclared")]),
    /The bundle test\.uses-undeclared imports exports of ragents\.orchestration, but does not name it in requires/);
});

test("a bundle gets only the server list from the host, with the same modules as the host, and only their exports from bundles", async () => {
  const elsewhere = bundleRoot({
    "test.host-modules": {
      server: withRequires(["ragents.ask"], [
        "import { DomainError } from \"@ragents/engine\";",
        "import { defineWorkflow } from \"@ragents/workflow\";",
        "import * as ask from \"@ragents/plugins/ragents.ask/server/contract\";",
        "export const probe = { DomainError, workflow: typeof defineWorkflow, ask: Object.keys(ask).length };",
        "",
      ].join("\n")),
      manifest: { uses: ["ragents.ask"] },
    },
    "test.unlisted": { server: `import "lucide-react";\n${PLUGIN_ENTRY_SOURCE}` },
    "test.no-export": { server: withRequires(["ragents.ask"], "import \"@ragents/plugins/ragents.ask/server/nothing\";\n"), manifest: { uses: ["ragents.ask"] } },
  });

  const plugins = resolvePluginEntries(["ragents.ask", path.join(elsewhere, "test.host-modules")]);
  const probe = (await importBundles(plugins)).get("test.host-modules")?.probe as { DomainError: unknown; workflow: string; ask: number };
  assert.equal(probe.DomainError, DomainError);
  assert.equal(probe.workflow, "function");
  assert.ok(probe.ask > 0);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.unlisted")]),
    /The bundle test\.unlisted does not load: The bundle test\.unlisted imports lucide-react, which the host does not provide/);
  await assert.rejects(() => loadPlugins(["ragents.ask", path.join(elsewhere, "test.no-export")]),
    /the bundle ragents\.ask does not export server\/nothing for the server/);
});

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DomainError } from "@ragents/engine";
import { discoverPluginIds, importBundles, loadPlugins, resolvePluginEntries, staleBuiltInBundles } from "../src/profile/plugin-discovery.ts";
import { BUNDLE_FORMAT, isFetchedBundle, sourceStandOf } from "../src/profile/bundle-manifest.ts";
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

test("jeder Ordner unter bundles ist ein gebautes Plugin; der Host lädt nur Bundles", async () => {
  const ids = discoverPluginIds();

  assert.ok(ids.includes("ragents.orchestration"));
  assert.ok(ids.includes("ragents.ask"));
  assert.ok(ids.includes("ragents.lsp-typescript"));
  const loaded = await loadPlugins(["ragents.orchestration", "ragents.ask", "ragents.todo"]);
  assert.deepEqual(loaded.known, ids);
  assert.deepEqual(loaded.ids, ["ragents.orchestration", "ragents.ask", "ragents.todo"]);
  assert.deepEqual([...loaded.web.keys()].sort(), ["ragents.ask", "ragents.orchestration", "ragents.todo"]);
  assert.deepEqual(loaded.web.get("ragents.todo"), { entry: "/plugins/ragents.todo/web/index.js" }, "die Adresse folgt dem Manifest, ein CSS nur, wenn das Bundle eins hat");
  assert.deepEqual(loaded.bundles.map((plugin) => plugin.folder), loaded.ids.map((id) => path.join(bundlesRoot, id)));
  assert.equal(typeof loaded.modules.get("ragents.orchestration")?.create, "function");
  assert.equal(pluginFolder("ragents.ask"), path.join(bundlesRoot, "ragents.ask"));
});

test("ein Bundle außerhalb des Hosts wird per Pfad genannt; der Ordnername ist die Kennung", async () => {
  const elsewhere = bundleRoot({ "test.elsewhere": {} });
  const absolute = path.join(elsewhere, "test.elsewhere");

  const loaded = await loadPlugins(["ragents.orchestration", absolute]);
  assert.deepEqual(loaded.ids, ["ragents.orchestration", "test.elsewhere"]);
  assert.ok(loaded.known.includes("test.elsewhere"));
  assert.equal(loaded.web.has("test.elsewhere"), false);
  assert.equal(pluginFolder("test.elsewhere"), absolute);
  assert.deepEqual(resolvePluginEntries(["./test.elsewhere"], elsewhere).map(({ id, folder }) => ({ id, folder })), [{ id: "test.elsewhere", folder: absolute }]);
});

test("ein Quellordner oder ein Ordner ohne Manifest im Profil ist ein harter Fehler mit Ursache", async () => {
  const elsewhere = bundleRoot({ "test.empty": undefined, "test.source": undefined });
  mkdirSync(path.join(elsewhere, "test.source", "server"));
  writeFileSync(path.join(elsewhere, "test.source", "server", "index.ts"), PLUGIN_ENTRY_SOURCE);

  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.missing")]), /hat keinen Ordner/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.source")]), /ist ein Quellordner, kein Bundle: mit ragents plugin build .*test\.source bauen/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.empty")]), /ist kein Bundle: ragents-bundle\.json fehlt/);
  assert.throws(() => discoverPluginIds(elsewhere), /ist kein Bundle/);
});

test("Format und Host-API des Bundles müssen zum Host passen, sonst nennt der Start den Befehl zum Neubauen", async () => {
  const elsewhere = bundleRoot({
    "test.old-format": { manifest: { format: 1 } },
    "test.old-api": { manifest: { api: 0 } },
    "test.other-id": { manifest: { id: "test.renamed" } },
    "test.extra-field": { manifest: { web: true } },
    "test.outside-web": { manifest: { web: { entry: "server/index.js", classes: "web/classes.json" } }, files: { "web/classes.json": "[]" } },
    "test.missing-web": { manifest: { web: { entry: "web/index.js", classes: "web/classes.json" } }, files: { "web/classes.json": "[]" } },
  });

  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.old-format")]),
    new RegExp(`Das Bundle test\\.old-format hat das Format 1, dieser Host liest Format ${BUNDLE_FORMAT}; mit ragents plugin build <quellordner> neu bauen`));
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.old-api")]),
    /Das Bundle test\.old-api ist für Host-API 0 gebaut, dieser Host bietet \d+; mit ragents plugin build .* neu bauen/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.other-id")]), /meldet die Kennung test\.renamed/);
  const dataRoot = mkdtempSync(path.join(tmpdir(), "ragents-data-root-"));
  const fetched = path.join(dataRoot, "remote", "werkstatt.example.com", "werkstatt-client", "profiles", "abc", "dist", "plugins", "test.old-api");
  assert.equal(isFetchedBundle(fetched, dataRoot), true);
  assert.equal(isFetchedBundle(path.join(elsewhere, "test.old-api"), dataRoot), false);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.extra-field")]), /web fehlt oder hat die falsche Form/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.outside-web")]), /server\/index\.js liegt nicht unter web\//);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.missing-web")]), /Dem Bundle test\.missing-web fehlt web\/index\.js; mit ragents plugin build/);
});

test("ein Bundle, das Namen der Host-API braucht, die dieser Host nicht hat, scheitert beim Start mit Ursache", async () => {
  const elsewhere = bundleRoot({
    "test.newer-name": { manifest: { hostNames: { server: { "@ragents/engine": ["DomainError"] }, web: { "@ragents/web/ui": ["Button", "NeuerKnopf"] } } } },
    "test.newer-module": { manifest: { hostNames: { server: { "@ragents/host/neu": ["etwas"] }, web: {} } } },
    "test.fitting": { manifest: { hostNames: { server: { "@ragents/engine": ["DomainError"] }, web: { "@ragents/web/ui": ["Button"] } } } },
  });
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.newer-name")]),
    /Das Bundle test\.newer-name braucht aus der Host-API \d+ Namen, die dieser Host nicht anbietet \(web @ragents\/web\/ui: NeuerKnopf\); es ist gegen einen neueren Host gebaut: den Host aktualisieren, sonst mit ragents plugin build <quellordner> neu bauen/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.newer-module")]), /nicht anbietet \(server @ragents\/host\/neu\)/);
  assert.deepEqual(resolvePluginEntries([path.join(elsewhere, "test.fitting")]).map((plugin) => plugin.id), ["test.fitting"]);
});

test("ein eingebautes Bundle gilt als veraltet, sobald sich sein Quellordner ändert; Bundles von anderswo prüft der Host nicht", async () => {
  const sources = mkdtempSync(path.join(tmpdir(), "ragents-sources-"));
  for (const id of ["test.fresh", "test.changed"]) {
    mkdirSync(path.join(sources, id, "server"), { recursive: true });
    writeFileSync(path.join(sources, id, "ragents-plugin.json"), JSON.stringify({ id }));
    writeFileSync(path.join(sources, id, "server", "index.ts"), PLUGIN_ENTRY_SOURCE);
  }
  const stand = sourceStandOf(path.join(sources, "test.fresh"));
  mkdirSync(path.join(sources, "test.fresh", "node_modules", "lib"), { recursive: true });
  writeFileSync(path.join(sources, "test.fresh", "node_modules", "lib", "index.js"), "");
  assert.equal(sourceStandOf(path.join(sources, "test.fresh")), stand, "node_modules zählt nicht zum Quellstand");
  const root = bundleRoot({
    "test.fresh": { manifest: { sourceStand: stand } },
    "test.changed": { manifest: { sourceStand: sourceStandOf(path.join(sources, "test.changed")) } },
    "test.unknown": { manifest: { sourceStand: "0".repeat(64) } },
  });
  writeFileSync(path.join(sources, "test.changed", "server", "extra.ts"), "export const extra = 1;\n");
  const elsewhere = bundleRoot({ "test.elsewhere": { manifest: { sourceStand: "0".repeat(64) } } });
  const plugins = resolvePluginEntries(["test.fresh", "test.changed", "test.unknown", path.join(elsewhere, "test.elsewhere")], process.cwd(), root);
  assert.deepEqual(staleBuiltInBundles(plugins, sources, root), ["test.changed"]);
});

test("ein Einstiegspunkt ohne gültigen plugin-Export ist ein harter Fehler", async () => {
  const root = bundleRoot({
    "test.without-export": { server: "export const other = 1;\n" },
    "test.without-create": { server: "export const plugin = { requires: [] };\n" },
  });

  await assert.rejects(() => loadPlugins(["test.without-export"], root), /exportiert in server\/index\.js keinen gültigen Einstiegspunkt/);
  await assert.rejects(() => loadPlugins(["test.without-create"], root), /exportiert in server\/index\.js keinen gültigen Einstiegspunkt/);
});

test("eine unbekannte Kennung und ein nicht gebautes eingebautes Plugin brechen den Start ab", async () => {
  await assert.rejects(() => loadPlugins(["ragents.orchestration", "ragents.nowhere"]), /Unbekanntes Plugin ragents\.nowhere; eingebaut sind: /);
  const root = bundleRoot({});
  await assert.rejects(() => loadPlugins(["ragents.ask"], root), /Das eingebaute Plugin ragents\.ask ist nicht gebaut: .* fehlt; im Checkout mit pnpm build:plugins bauen/);
});

test("ein fehlendes requires bricht den Start ab", async () => {
  await assert.rejects(
    () => loadPlugins(["ragents.documents"]),
    /Plugin ragents\.documents benötigt das fehlende Plugin ragents\.orchestration/,
  );
});

test("eine falsche Reihenfolge bricht den Start ab", async () => {
  await assert.rejects(
    () => loadPlugins(["ragents.documents", "ragents.orchestration"]),
    /Plugin ragents\.orchestration muss vor ragents\.documents registriert werden/,
  );
});

test("eine doppelte Plugin-ID bricht den Start ab, auch per Pfad", async () => {
  await assert.rejects(
    () => loadPlugins(["ragents.orchestration", "ragents.orchestration"]),
    /Plugin ragents\.orchestration steht mehrfach in der Pluginliste/,
  );
  const elsewhere = bundleRoot({ "ragents.orchestration": {} });
  await assert.rejects(
    () => loadPlugins(["ragents.orchestration", path.join(elsewhere, "ragents.orchestration")]),
    /Plugin ragents\.orchestration steht mehrfach in der Pluginliste/,
  );
});

test("was ein Bundle aus anderen Bundles nutzt, steht in der Pluginliste und in requires", async () => {
  const elsewhere = bundleRoot({
    "test.uses-missing": { manifest: { uses: ["ragents.todo"] } },
    "test.uses-undeclared": { manifest: { uses: ["ragents.orchestration"] } },
  });

  await assert.rejects(() => loadPlugins(["ragents.orchestration", path.join(elsewhere, "test.uses-missing")]),
    /Plugin test\.uses-missing benötigt das fehlende Plugin ragents\.todo; sein Bundle importiert dessen Exporte/);
  await assert.rejects(() => loadPlugins(["ragents.orchestration", path.join(elsewhere, "test.uses-undeclared")]),
    /Das Bundle test\.uses-undeclared importiert Exporte von ragents\.orchestration, nennt es aber nicht in requires/);
});

test("ein Bundle bezieht vom Host nur die Server-Liste, mit denselben Modulen wie der Host, und von Bundles nur deren Exporte", async () => {
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
    /Das Bundle test\.unlisted lädt nicht: Das Bundle test\.unlisted importiert lucide-react, das der Host nicht bereitstellt/);
  await assert.rejects(() => loadPlugins(["ragents.ask", path.join(elsewhere, "test.no-export")]),
    /das Bundle ragents\.ask exportiert server\/nothing aber nicht für den Server/);
});

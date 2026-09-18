import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverPluginIds, loadPlugins, resolvePluginEntries } from "../src/profile/plugin-discovery.ts";
import { pluginFolder, pluginsRoot } from "../src/plugin-support/plugins-root.ts";

const VALID_PLUGIN = "export const plugin = { create: () => ({ manifest: { id: \"x\" }, register: () => {} }) };\n";

const pluginRoot = (folders: Readonly<Record<string, string | undefined>>): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-plugins-"));
  for (const [name, entry] of Object.entries(folders)) {
    mkdirSync(path.join(root, name));
    if (entry === undefined) continue;
    mkdirSync(path.join(root, name, "server"));
    writeFileSync(path.join(root, name, "server", "index.ts"), entry);
  }
  return root;
};

test("jeder Ordner unter plugins ist ein Plugin mit gültigem Einstiegspunkt", async () => {
  const ids = discoverPluginIds();

  assert.ok(ids.includes("ragents.orchestration"));
  assert.ok(ids.includes("ragents.ask"));
  assert.ok(ids.includes("ragents.lsp-typescript"));
  const loaded = await loadPlugins(["ragents.orchestration", "ragents.ask", "ragents.todo"]);
  assert.deepEqual(loaded.known, ids);
  assert.deepEqual(loaded.ids, ["ragents.orchestration", "ragents.ask", "ragents.todo"]);
  assert.equal(typeof loaded.modules.get("ragents.orchestration")?.create, "function");
});

test("ein Plugin außerhalb des Repos wird per Pfad genannt; der Ordnername ist die Kennung", async () => {
  const elsewhere = pluginRoot({ "test.elsewhere": VALID_PLUGIN });
  const absolute = path.join(elsewhere, "test.elsewhere");

  const loaded = await loadPlugins(["ragents.orchestration", absolute]);
  assert.deepEqual(loaded.ids, ["ragents.orchestration", "test.elsewhere"]);
  assert.ok(loaded.known.includes("test.elsewhere"));
  assert.equal(pluginFolder("test.elsewhere"), absolute);
  assert.equal(pluginFolder("ragents.ask"), path.join(pluginsRoot, "ragents.ask"));
  assert.deepEqual(resolvePluginEntries(["./test.elsewhere"], elsewhere), [{ id: "test.elsewhere", folder: absolute }]);
});

test("ein Pfad ohne Plugin-Ordner oder Einstiegspunkt ist ein harter Fehler", async () => {
  const elsewhere = pluginRoot({ "test.without-entry": undefined });

  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.missing")]), /hat keinen Ordner/);
  await assert.rejects(() => loadPlugins([path.join(elsewhere, "test.without-entry")]), /hat keinen Einstiegspunkt/);
});

test("ein Ordner ohne Einstiegspunkt ist ein harter Fehler", () => {
  const root = pluginRoot({ "test.without-entry": undefined });

  assert.throws(() => discoverPluginIds(root), /hat keinen Einstiegspunkt/);
});

test("ein Einstiegspunkt ohne plugin-Export ist ein harter Fehler", async () => {
  const root = pluginRoot({ "test.without-export": "export const other = 1;\n" });

  await assert.rejects(
    () => loadPlugins(["test.without-export"], root),
    /exportiert keinen gültigen Einstiegspunkt/,
  );
});

test("ein plugin-Export ohne create ist ein harter Fehler", async () => {
  const root = pluginRoot({ "test.without-create": "export const plugin = { requires: [] };\n" });

  await assert.rejects(
    () => loadPlugins(["test.without-create"], root),
    /exportiert keinen gültigen Einstiegspunkt/,
  );
});

test("eine unbekannte Plugin-ID im Profil bricht den Start ab", async () => {
  await assert.rejects(
    () => loadPlugins(["ragents.orchestration", "ragents.nowhere"]),
    /Unbekanntes Plugin ragents\.nowhere; gefunden wurden: /,
  );
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
  const elsewhere = pluginRoot({ "ragents.orchestration": VALID_PLUGIN });
  await assert.rejects(
    () => loadPlugins(["ragents.orchestration", path.join(elsewhere, "ragents.orchestration")]),
    /Plugin ragents\.orchestration steht mehrfach in der Pluginliste/,
  );
});

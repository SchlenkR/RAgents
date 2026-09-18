import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { configFilePath, loadConfigFile, validateConfigFileSections } from "../src/config-file.ts";

const source = fileURLToPath(new URL("../src", import.meta.url));

const configRoot = (body: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-config-"));
  writeFileSync(path.join(root, "ragents.config.test-order.ts"), body);
  return root;
};

test("main.ts lädt vor der Konfiguration nichts außer dem Lader selbst", () => {
  const main = readFileSync(path.join(source, "main.ts"), "utf8");
  const valueImports = [...main.matchAll(/^import(?!\s+type\b)[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]);

  assert.deepEqual(valueImports, ["./config-file.js"]);
  assert.ok(main.indexOf("await loadConfigFile()") < main.indexOf('await import("./server.js")'));
});

test("die Prüfung vor dem Laden ist ein harter Fehler", () => {
  assert.throws(
    () => validateConfigFileSections({
      hostKeys: [],
      knownPluginIds: [],
      activePluginIds: [],
      declaredKeysFor: () => [],
      secretKeys: [],
    }),
    /muss vor ihrer Prüfung geladen werden/,
  );
});

test("ein Secret im Klartext bricht schon das Laden ab", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-config-"));
  writeFileSync(path.join(root, "ragents.config.test-secret.ts"), `export const config = {
  "ragents.todo": { RAGENTS_TEST_ACCESS_TOKEN: "im-klartext" },
};
`);
  process.env.PRODUCT_PROFILE = "test-secret";

  await assert.rejects(() => loadConfigFile(root), /ist ein Secret und darf nicht im Klartext/);
});

test("eine env-Referenz auf eine ungesetzte Variable nennt Variable und Abhilfe", async () => {
  const root = configRoot(`const env = (name) => ({ kind: "environment", name });
export const config = { host: { ACCESS_TOKEN: env("RAGENTS_TEST_UNSET_VARIABLE") } };
`);
  process.env.PRODUCT_PROFILE = "test-order";
  delete process.env.RAGENTS_TEST_UNSET_VARIABLE;

  await assert.rejects(
    () => loadConfigFile(root),
    /host\.ACCESS_TOKEN verweist mit env\("RAGENTS_TEST_UNSET_VARIABLE"\) .* nicht gesetzt ist\. Setze sie vor dem Start \(export RAGENTS_TEST_UNSET_VARIABLE=\.\.\.\)/,
  );
});

test("die Konfiguration steht nach dem Laden in der Umgebung, gesetzte Werte gewinnen", async () => {
  const root = configRoot(`export const config = {
  host: { RAGENTS_TEST_HOST_VALUE: "aus-der-datei" },
  "ragents.todo": { RAGENTS_TEST_PLUGIN_VALUE: 7, RAGENTS_TEST_LIST: ["a", "b"] },
};
`);
  process.env.PRODUCT_PROFILE = "test-order";
  process.env.RAGENTS_TEST_HOST_VALUE = "aus-der-umgebung";
  assert.equal(process.env.RAGENTS_TEST_PLUGIN_VALUE, undefined);

  await loadConfigFile(root);

  assert.equal(process.env.RAGENTS_TEST_HOST_VALUE, "aus-der-umgebung");
  assert.equal(process.env.RAGENTS_TEST_PLUGIN_VALUE, "7");
  assert.equal(process.env.RAGENTS_TEST_LIST, '["a","b"]');
  assert.equal(configFilePath(), path.join(root, "ragents.config.test-order.ts"));
  await assert.rejects(() => loadConfigFile(root), /bereits geladen/);
});

test("eine unbekannte Sektion bricht den Start ab", () => {
  assert.throws(
    () => validateConfigFileSections({
      hostKeys: ["RAGENTS_TEST_HOST_VALUE"],
      knownPluginIds: ["ragents.orchestration"],
      activePluginIds: ["ragents.orchestration"],
      declaredKeysFor: () => [],
      secretKeys: [],
    }),
    /unbekannte Sektion ragents\.todo/,
  );
});

test("ein für das Plugin nicht deklarierter Schlüssel bricht den Start ab", () => {
  assert.throws(
    () => validateConfigFileSections({
      hostKeys: ["RAGENTS_TEST_HOST_VALUE"],
      knownPluginIds: ["ragents.todo"],
      activePluginIds: ["ragents.todo"],
      declaredKeysFor: () => ["RAGENTS_TEST_PLUGIN_VALUE"],
      secretKeys: [],
    }),
    /RAGENTS_TEST_LIST ist für dieses Plugin nicht deklariert/,
  );
});

test("ein als Secret deklarierter Schlüssel ohne env-Referenz bricht den Start ab", () => {
  assert.throws(
    () => validateConfigFileSections({
      hostKeys: ["RAGENTS_TEST_HOST_VALUE"],
      knownPluginIds: ["ragents.todo"],
      activePluginIds: ["ragents.todo"],
      declaredKeysFor: () => ["RAGENTS_TEST_PLUGIN_VALUE", "RAGENTS_TEST_LIST"],
      secretKeys: ["RAGENTS_TEST_PLUGIN_VALUE"],
    }),
    /ist als Secret deklariert und darf nicht im Klartext/,
  );
});

test("main.ts meldet einen Startfehler als letzte Zeile ohne Stack", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(source, "main.ts")], {
    cwd: path.dirname(source),
    env: { ...process.env, PRODUCT_PROFILE: "" },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  const lines = result.stderr.trim().split("\n");
  assert.match(lines.at(-1) ?? "", /^RAgents startet nicht: PRODUCT_PROFILE ist nicht gesetzt\. scripts\/start\.sh <profil>/);
  assert.equal(lines.some((line) => line.includes("    at ")), false);
});

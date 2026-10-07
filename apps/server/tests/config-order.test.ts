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

test("main.ts loads nothing before the configuration except the loader itself", () => {
  const main = readFileSync(path.join(source, "main.ts"), "utf8");
  const valueImports = [...main.matchAll(/^import(?!\s+type\b)[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]);

  assert.deepEqual(valueImports, ["./config-file.js"]);
  assert.ok(main.indexOf("await loadConfigFile()") < main.indexOf('await import("./server.js")'));
});

test("the check before loading is a hard error", () => {
  assert.throws(
    () => validateConfigFileSections({
      hostKeys: [],
      knownPluginIds: [],
      activePluginIds: [],
      declaredKeysFor: () => [],
      secretKeys: [],
    }),
    /must be loaded before it is checked/,
  );
});

test("a secret in plain text already aborts the load", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-config-"));
  writeFileSync(path.join(root, "ragents.config.test-secret.ts"), `export const config = {
  "ragents.todo": { RAGENTS_TEST_ACCESS_TOKEN: "in-plain-text" },
};
`);
  process.env.PRODUCT_PROFILE = "test-secret";

  await assert.rejects(() => loadConfigFile(root), /is a secret and must not appear in plain text/);
});

test("an env reference to an unset variable names the variable and the remedy", async () => {
  const root = configRoot(`const env = (name) => ({ kind: "environment", name });
export const config = { host: { ACCESS_TOKEN: env("RAGENTS_TEST_UNSET_VARIABLE") } };
`);
  process.env.PRODUCT_PROFILE = "test-order";
  delete process.env.RAGENTS_TEST_UNSET_VARIABLE;

  await assert.rejects(
    () => loadConfigFile(root),
    /host\.ACCESS_TOKEN refers with env\("RAGENTS_TEST_UNSET_VARIABLE"\) .* not set in this shell\. Set it before starting \(export RAGENTS_TEST_UNSET_VARIABLE=\.\.\.\)/,
  );
});

test("after loading, the configuration is in the environment and values already set win", async () => {
  const root = configRoot(`export const config = {
  host: { RAGENTS_TEST_HOST_VALUE: "from-the-file" },
  "ragents.todo": { RAGENTS_TEST_PLUGIN_VALUE: 7, RAGENTS_TEST_LIST: ["a", "b"], RAGENTS_TEST_SWITCH: false },
};
`);
  process.env.PRODUCT_PROFILE = "test-order";
  process.env.RAGENTS_TEST_HOST_VALUE = "from-the-environment";
  assert.equal(process.env.RAGENTS_TEST_PLUGIN_VALUE, undefined);

  await loadConfigFile(root);

  assert.equal(process.env.RAGENTS_TEST_HOST_VALUE, "from-the-environment");
  assert.equal(process.env.RAGENTS_TEST_PLUGIN_VALUE, "7");
  assert.equal(process.env.RAGENTS_TEST_LIST, '["a","b"]');
  assert.equal(process.env.RAGENTS_TEST_SWITCH, "0");
  assert.equal(configFilePath(), path.join(root, "ragents.config.test-order.ts"));
  await assert.rejects(() => loadConfigFile(root), /already been loaded/);
});

test("an unknown section aborts the start", () => {
  assert.throws(
    () => validateConfigFileSections({
      hostKeys: ["RAGENTS_TEST_HOST_VALUE"],
      knownPluginIds: ["ragents.orchestration"],
      activePluginIds: ["ragents.orchestration"],
      declaredKeysFor: () => [],
      secretKeys: [],
    }),
    /unknown section ragents\.todo/,
  );
});

test("a key not declared for the plugin aborts the start", () => {
  assert.throws(
    () => validateConfigFileSections({
      hostKeys: ["RAGENTS_TEST_HOST_VALUE"],
      knownPluginIds: ["ragents.todo"],
      activePluginIds: ["ragents.todo"],
      declaredKeysFor: () => ["RAGENTS_TEST_PLUGIN_VALUE"],
      secretKeys: [],
    }),
    /RAGENTS_TEST_LIST is not declared for this plugin/,
  );
});

test("a key declared as a secret without an env reference aborts the start", () => {
  assert.throws(
    () => validateConfigFileSections({
      hostKeys: ["RAGENTS_TEST_HOST_VALUE"],
      knownPluginIds: ["ragents.todo"],
      activePluginIds: ["ragents.todo"],
      declaredKeysFor: () => ["RAGENTS_TEST_PLUGIN_VALUE", "RAGENTS_TEST_LIST"],
      secretKeys: ["RAGENTS_TEST_PLUGIN_VALUE"],
    }),
    /is declared as a secret and must not appear in plain text/,
  );
});

test("main.ts reports a startup failure as the last line without a stack", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(source, "main.ts")], {
    cwd: path.dirname(source),
    env: { ...process.env, PRODUCT_PROFILE: "" },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  const lines = result.stderr.trim().split("\n");
  assert.match(lines.at(-1) ?? "", /^RAgents does not start: PRODUCT_PROFILE is not set\. scripts\/start\.sh <profile>/);
  assert.equal(lines.some((line) => line.includes("    at ")), false);
});

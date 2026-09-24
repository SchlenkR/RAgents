import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { extract as extractTar } from "tar";
import { HOST_API_VERSION } from "../src/host-api.ts";
import { PLUGIN_ENTRY_SOURCE, writeBundle } from "./bundle-fixture.ts";

process.env.DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "ragents-distribution-data-"));
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { inspectClientProfile, packClientProfile } = await import("../../../plugins/ragents.profile-distribution/server/archive.ts");

const fixture = async (t: TestContext, profileBody?: string) => {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-distribution-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pluginsRoot = path.join(root, "host-bundles");
  writeBundle(path.join(pluginsRoot, "ragents.orchestration"));
  const client = writeBundle(path.join(root, "werkstatt", "plugins", "werkstatt.demo"), {
    files: { "skills/demo/SKILL.md": "# Demo\n", "prompt.hbs": "Hallo {{name}}\n" },
  });
  const profileFile = path.join(root, "werkstatt", "config", "ragents.config.werkstatt-client.ts");
  await mkdir(path.dirname(profileFile), { recursive: true });
  await writeFile(profileFile, profileBody ?? `const env = (name) => ({ kind: "environment", name });
export const config = {
  host: { PRODUCT_PROFILE: "werkstatt-client", PRODUCT_ID: "werkstatt", PRODUCT_TITLE: "Werkstatt", PORT: 4720, PLUGINS: ["ragents.orchestration", "../plugins/werkstatt.demo"] },
  "werkstatt.demo": { DEMO_ENDPOINT: "https://example.invalid", DEMO_TOKEN: env("DEMO_TOKEN_VALUE") },
};
export const users = [{ id: "dev", password: env("DEV_PASSWORD_VALUE"), token: env("DEV_TOKEN_VALUE"), rights: ["*"] }];
`);
  return { root, pluginsRoot, profileFile, client };
};

test("die Client-Profildatei wird ohne ihre Umgebung geprüft und mit den Bundles, die sie per Pfad nennt, deterministisch gepackt", async (t) => {
  const { root, pluginsRoot, profileFile } = await fixture(t);
  const inspected = await inspectClientProfile(profileFile, pluginsRoot);
  assert.equal(inspected.profile, "werkstatt-client");
  assert.equal(inspected.root, path.join(root, "werkstatt"));
  assert.equal(inspected.file, "config/ragents.config.werkstatt-client.ts");
  assert.deepEqual(inspected.plugins.map((plugin) => [plugin.id, plugin.source]), [["ragents.orchestration", "host"], ["werkstatt.demo", "archive"]]);
  const first = await packClientProfile(inspected);
  const second = await packClientProfile(inspected);
  assert.equal(first.version, second.version);
  assert.equal(first.version, createHash("sha256").update(first.archive).digest("hex"));
  assert.deepEqual(first.entries, [
    "config/ragents.config.werkstatt-client.ts",
    "plugins/werkstatt.demo/prompt.hbs",
    "plugins/werkstatt.demo/ragents-bundle.json",
    "plugins/werkstatt.demo/server/index.js",
    "plugins/werkstatt.demo/skills/demo/SKILL.md",
  ], "Profildatei und Bundle, kein Web: das bringt der Host des Clients mit");
  const target = path.join(root, "extracted");
  await mkdir(target);
  await writeFile(path.join(root, "archive.tar.gz"), first.archive);
  await extractTar({ file: path.join(root, "archive.tar.gz"), cwd: target, strict: true });
  assert.equal(await readFile(path.join(target, "plugins/werkstatt.demo/prompt.hbs"), "utf8"), "Hallo {{name}}\n");
  assert.equal(await readFile(path.join(target, inspected.file), "utf8"), await readFile(profileFile, "utf8"));
});

test("fehlerhafte Client-Profile brechen die Verteilung mit Ursache ab", async (t) => {
  const broken = async (body: string, pattern: RegExp) => {
    const { pluginsRoot, profileFile } = await fixture(t, body);
    await assert.rejects(() => inspectClientProfile(profileFile, pluginsRoot), pattern);
  };
  await broken(`export const config = { host: { PRODUCT_PROFILE: "werkstatt-client", PLUGINS: [] } };\n`, /host\.PLUGINS/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "other", PLUGINS: ["ragents.orchestration"] } };\n`, /PRODUCT_PROFILE muss werkstatt-client sein/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "werkstatt-client", PLUGINS: ["ragents.missing"] } };\n`, /Unbekanntes Plugin ragents\.missing/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "werkstatt-client", PLUGINS: ["../plugins/werkstatt.demo"] }, "werkstatt.other": {} };\n`, /Sektion werkstatt\.other/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "werkstatt-client", PLUGINS: ["../plugins/werkstatt.demo"] }, "werkstatt.demo": { DEMO_TOKEN: "klartext" } };\n`, /DEMO_TOKEN ist ein Secret/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "werkstatt-client", UNKNOWN: 1, PLUGINS: ["../plugins/werkstatt.demo"] } };\n`, /host\.UNKNOWN/);
  const { pluginsRoot, profileFile, client } = await fixture(t);
  await rm(path.join(client, "ragents-bundle.json"));
  await writeFile(path.join(client, "server", "index.ts"), PLUGIN_ENTRY_SOURCE);
  await assert.rejects(() => inspectClientProfile(profileFile, pluginsRoot), /werkstatt\.demo ist ein Quellordner, kein Bundle/);
  writeBundle(client, { manifest: { api: HOST_API_VERSION + 1 } });
  await assert.rejects(() => inspectClientProfile(profileFile, pluginsRoot), new RegExp(`werkstatt\\.demo ist für Host-API ${HOST_API_VERSION + 1} gebaut, dieser Host bietet ${HOST_API_VERSION}`));
  writeBundle(client);
  for (const [index, entry] of [client, "~/werkstatt/plugins/werkstatt.demo"].entries()) {
    const absoluteProfile = path.join(path.dirname(profileFile), `absolute-${index}`, path.basename(profileFile));
    await mkdir(path.dirname(absoluteProfile));
    await writeFile(absoluteProfile, `export const config = { host: { PRODUCT_PROFILE: "werkstatt-client", PLUGINS: ["ragents.orchestration", ${JSON.stringify(entry)}] } };\n`);
    await assert.rejects(() => inspectClientProfile(absoluteProfile, pluginsRoot),
      /nennt ein Bundle absolut oder mit ~\/; der Client löst diesen Pfad auf seinem eigenen Rechner auf .* relativ zur Profildatei nennen \(\.\/ oder \.\.\/\)/, entry);
  }
  await symlink(path.join(client, "prompt.hbs"), path.join(client, "link.hbs"));
  await assert.rejects(async () => packClientProfile(await inspectClientProfile(profileFile, pluginsRoot)), /symbolischen Link/);
});

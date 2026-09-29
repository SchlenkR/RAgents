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
  const client = writeBundle(path.join(root, "workshop", "plugins", "workshop.demo"), {
    files: { "skills/demo/SKILL.md": "# Demo\n", "prompt.hbs": "Hello {{name}}\n" },
  });
  const profileFile = path.join(root, "workshop", "config", "ragents.config.workshop-client.ts");
  await mkdir(path.dirname(profileFile), { recursive: true });
  await writeFile(profileFile, profileBody ?? `const env = (name) => ({ kind: "environment", name });
export const config = {
  host: { PRODUCT_PROFILE: "workshop-client", PRODUCT_ID: "workshop", PRODUCT_TITLE: "Workshop", PORT: 4720, PLUGINS: ["ragents.orchestration", "../plugins/workshop.demo"],
    MODEL_ALIASES: [{ alias: "workshop", model: "openrouter/z-ai/glm-5.3-flash", compaction: { threshold: 160000, keepRecentTokens: 24000, summaryTokens: 12000 } }] },
  "workshop.demo": { DEMO_ENDPOINT: "https://example.invalid", DEMO_TOKEN: env("DEMO_TOKEN_VALUE") },
};
export const users = [{ id: "dev", password: env("DEV_PASSWORD_VALUE"), token: env("DEV_TOKEN_VALUE"), rights: ["*"] }];
`);
  return { root, pluginsRoot, profileFile, client };
};

test("the client profile file is checked without its environment and packed deterministically with the bundles it names by path", async (t) => {
  const { root, pluginsRoot, profileFile } = await fixture(t);
  const inspected = await inspectClientProfile(profileFile, pluginsRoot);
  assert.equal(inspected.profile, "workshop-client");
  assert.equal(inspected.root, path.join(root, "workshop"));
  assert.equal(inspected.file, "config/ragents.config.workshop-client.ts");
  assert.deepEqual(inspected.plugins.map((plugin) => [plugin.id, plugin.source]), [["ragents.orchestration", "host"], ["workshop.demo", "archive"]]);
  const first = await packClientProfile(inspected);
  const second = await packClientProfile(inspected);
  assert.equal(first.version, second.version);
  assert.equal(first.version, createHash("sha256").update(first.archive).digest("hex"));
  assert.deepEqual(first.entries, [
    "config/ragents.config.workshop-client.ts",
    "plugins/workshop.demo/prompt.hbs",
    "plugins/workshop.demo/ragents-bundle.json",
    "plugins/workshop.demo/server/index.js",
    "plugins/workshop.demo/skills/demo/SKILL.md",
  ], "profile file and bundle, no web: the client's host brings that");
  const target = path.join(root, "extracted");
  await mkdir(target);
  await writeFile(path.join(root, "archive.tar.gz"), first.archive);
  await extractTar({ file: path.join(root, "archive.tar.gz"), cwd: target, strict: true });
  assert.equal(await readFile(path.join(target, "plugins/workshop.demo/prompt.hbs"), "utf8"), "Hello {{name}}\n");
  assert.equal(await readFile(path.join(target, inspected.file), "utf8"), await readFile(profileFile, "utf8"));
});

test("faulty client profiles abort the distribution with their cause", async (t) => {
  const broken = async (body: string, pattern: RegExp) => {
    const { pluginsRoot, profileFile } = await fixture(t, body);
    await assert.rejects(() => inspectClientProfile(profileFile, pluginsRoot), pattern);
  };
  await broken(`export const config = { host: { PRODUCT_PROFILE: "workshop-client", PLUGINS: [] } };\n`, /host\.PLUGINS/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "other", PLUGINS: ["ragents.orchestration"] } };\n`, /PRODUCT_PROFILE must be workshop-client/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "workshop-client", PLUGINS: ["ragents.missing"] } };\n`, /Unknown plugin ragents\.missing/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "workshop-client", PLUGINS: ["../plugins/workshop.demo"] }, "workshop.other": {} };\n`, /section workshop\.other/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "workshop-client", PLUGINS: ["../plugins/workshop.demo"] }, "workshop.demo": { DEMO_TOKEN: "plaintext" } };\n`, /DEMO_TOKEN is a secret/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "workshop-client", UNKNOWN: 1, PLUGINS: ["../plugins/workshop.demo"] } };\n`, /host\.UNKNOWN/);
  await broken(`export const config = { host: { PRODUCT_PROFILE: "workshop-client", MODEL_ALIASES: [1], PLUGINS: ["../plugins/workshop.demo"] } };\n`, /host\.MODEL_ALIASES has no valid value/);
  const { pluginsRoot, profileFile, client } = await fixture(t);
  await rm(path.join(client, "ragents-bundle.json"));
  await writeFile(path.join(client, "server", "index.ts"), PLUGIN_ENTRY_SOURCE);
  await assert.rejects(() => inspectClientProfile(profileFile, pluginsRoot), /workshop\.demo is a source folder, not a bundle/);
  writeBundle(client, { manifest: { api: HOST_API_VERSION + 1 } });
  await assert.rejects(() => inspectClientProfile(profileFile, pluginsRoot), new RegExp(`workshop\\.demo is built for host API ${HOST_API_VERSION + 1}, this host offers ${HOST_API_VERSION}`));
  writeBundle(client);
  for (const [index, entry] of [client, "~/workshop/plugins/workshop.demo"].entries()) {
    const absoluteProfile = path.join(path.dirname(profileFile), `absolute-${index}`, path.basename(profileFile));
    await mkdir(path.dirname(absoluteProfile));
    await writeFile(absoluteProfile, `export const config = { host: { PRODUCT_PROFILE: "workshop-client", PLUGINS: ["ragents.orchestration", ${JSON.stringify(entry)}] } };\n`);
    await assert.rejects(() => inspectClientProfile(absoluteProfile, pluginsRoot),
      /names a bundle absolutely or with ~\/; the client resolves this path on its own machine .* relative to the profile file \(\.\/ or \.\.\/\)/, entry);
  }
  await symlink(path.join(client, "prompt.hbs"), path.join(client, "link.hbs"));
  await assert.rejects(async () => packClientProfile(await inspectClientProfile(profileFile, pluginsRoot)), /symbolic link/);
});

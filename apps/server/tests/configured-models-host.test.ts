import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { announcement, isolatedDirectory, rpc, stopChild } from "./foreign-plugin-fixture.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const models = ["worker", "coordinator", "extra"].map((id) => ({
  id, contextWindow: 131_072, maxTokens: 16_384, reasoning: false, input: ["text"],
}));
const defaultHost = { COMPACTION_PROVIDER: "local", COMPACTION_MODEL: "" };
const defaultProduct = {
  AGENT_PROVIDER: "local", AGENT_MODEL: "worker", AGENT_COORDINATOR_MODEL: "coordinator",
  AGENT_THINKING: "off", AGENT_COORDINATOR_THINKING: "off",
};

const fixture = (host: Readonly<Record<string, unknown>> = defaultHost, product: Readonly<Record<string, unknown>> = defaultProduct, withProviders = true) => {
  const directory = isolatedDirectory("ragents-configured-models-");
  const profile = path.join(directory, "ragents.config.model-check.ts");
  writeFileSync(profile, `import { env } from "@ragents/host/config-definition.js";
export const config = {
  host: { PRODUCT_PROFILE: "model-check", PRODUCT_ID: "acme", PRODUCT_TITLE: "Model check",
    PLUGINS: ["ragents.orchestration", "ragents.workspace", "ragents.product"],
    ...${JSON.stringify(host)}, ${withProviders ? `MODEL_PROVIDERS: [{ id: "local", baseUrl: "https://models.invalid/v1", apiKey: env("TEST_MODEL_KEY"), models: ${JSON.stringify(models)} }]` : ""} },
  "ragents.product": ${JSON.stringify(product)},
  "ragents.workspace": { PROCESS_SANDBOX: "off" },
};
`);
  const env: NodeJS.ProcessEnv = { ...process.env, RAGENTS_DEV: "1", PRODUCT_PROFILE: "model-check", PRODUCT_PROFILE_FILE: profile,
    DATA_DIR: path.join(directory, "data"), TEST_MODEL_KEY: "test-key", PORT: undefined, BIND_ADDRESS: undefined,
    MODEL_PROVIDERS: undefined, MODEL_ALIASES: undefined, COMPACTION_PROVIDER: undefined, COMPACTION_MODEL: undefined,
    AGENT_PROVIDER: undefined, AGENT_MODEL: undefined, AGENT_COORDINATOR_MODEL: undefined, AGENT_MODELS: undefined,
    AGENT_MODEL_REASONING: undefined, AGENT_THINKING: undefined, AGENT_COORDINATOR_THINKING: undefined, MODEL_SELECTABLE: undefined,
    RELAY_URL: undefined, RELAY_TOKEN: undefined, TEST_RELAY_TOKEN: "test-relay-token" };
  return { directory, options: { cwd: path.join(root, "apps/server"), env } };
};

test("direct configured models supply the product roles and selection, optionally restricted by AGENT_MODELS", { timeout: 120_000 }, async () => {
  for (const ids of [undefined, ["coordinator", "worker"]]) {
    const { directory, options } = fixture(defaultHost, { ...defaultProduct, ...(ids ? { AGENT_MODELS: ids } : {}) });
    const output: string[] = [];
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], { ...options, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const host = await announcement(child, output);
      const settings = await rpc(host, "ragents.product.modelSettings.read") as { models: { id: string; provider: string }[]; profiles: { name: string; model: string; provider: string }[] };
      assert.deepEqual(settings.models.map(({ id, provider }) => [id, provider]), (ids ?? models.map(({ id }) => id)).map((id) => [id, "local"]));
      assert.deepEqual(settings.profiles.map(({ name, model, provider }) => [name, model, provider]), [
        ["coordinator", "coordinator", "local"], ["relay", "coordinator", "local"], ["standard", "worker", "local"],
      ]);
      const titles = await rpc(host, "ragents.settings.titles.read") as { models: { id: string; provider: string }[]; selection: unknown };
      assert.equal(titles.selection, null);
      assert.deepEqual(titles.models.map(({ id, provider }) => [id, provider]).sort(), models.map(({ id }) => [id, "local"]).sort());
    } finally {
      await stopChild(child);
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("invalid model configuration fails startup with the key, provider and configured names", { timeout: 120_000 }, () => {
  const cases = [
    { host: defaultHost, product: { ...defaultProduct, AGENT_PROVIDER: undefined }, error: /AGENT_PROVIDER: provider openrouter is not configured; declare it in MODEL_PROVIDERS or set AGENT_PROVIDER/ },
    { host: { COMPACTION_MODEL: "" }, product: defaultProduct, error: /COMPACTION_PROVIDER: provider openrouter is not configured; declare it in MODEL_PROVIDERS or set COMPACTION_PROVIDER/ },
    ...["AGENT_MODEL", "AGENT_COORDINATOR_MODEL"].map((key) => ({ host: defaultHost, product: { ...defaultProduct, [key]: "missing" }, error: new RegExp(`${key}: model missing is not configured for provider local; configured model ids: worker, coordinator, extra`) })),
    { host: defaultHost, product: { ...defaultProduct, AGENT_COORDINATOR_THINKING: "max" }, error: /thinking level max of role coordinator is not available/ },
    { host: defaultHost, product: { ...defaultProduct, AGENT_MODELS: ["worker", "coordinator", "missing"] }, error: /AGENT_MODELS: model missing is not configured for provider local; configured model ids: worker, coordinator, extra/ },
    { host: { ...defaultHost, COMPACTION_MODEL: "missing" }, product: defaultProduct, error: /COMPACTION_MODEL: model missing is not configured for provider local; configured model ids: worker, coordinator, extra/ },
    { host: defaultHost, product: { ...defaultProduct, OPENROUTER_API_KEY: { kind: "environment", name: "TEST_MODEL_KEY" } }, error: /ragents\.product\.OPENROUTER_API_KEY is not declared for this plugin/ },
  ];
  for (const entry of cases) {
    const { directory, options } = fixture(entry.host, entry.product);
    try {
      const result = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], { ...options, encoding: "utf8", timeout: 30_000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, `${JSON.stringify(entry.product)}\n${result.stdout}\n${result.stderr}`);
      assert.match(`${result.stdout}\n${result.stderr}`, entry.error);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});


test("a relay profile loads its models once before resolving roles, aliases and title settings", { timeout: 60_000 }, async () => {
  const requests: { url: string | undefined; authorization: string | undefined }[] = [];
  const compaction = { threshold: 100_000, keepRecentTokens: 20_000, summaryTokens: 8_000 };
  const relay = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/relay/v1/models");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: models.map(({ id, ...catalog }) => ({
      id, object: "model", catalog: { ...catalog, compaction },
    })) }));
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  assert.ok(address && typeof address === "object");
  const { directory, options } = fixture({ COMPACTION_PROVIDER: "relay", COMPACTION_MODEL: "coordinator",
    MODEL_ALIASES: [{ alias: "team-coordinator", model: "relay/coordinator", compaction }] },
  { ...defaultProduct, AGENT_PROVIDER: "relay", RELAY_URL: `http://127.0.0.1:${address.port}`,
    RELAY_TOKEN: { kind: "environment", name: "TEST_RELAY_TOKEN" } }, false);
  const output: string[] = [];
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], { ...options, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const host = await announcement(child, output);
    const settings = await rpc(host, "ragents.product.modelSettings.read") as { models: { id: string; provider: string }[]; profiles: { name: string; model: string; provider: string }[] };
    assert.deepEqual(settings.models.map(({ id, provider }) => [id, provider]), models.map(({ id }) => [id, "relay"]));
    assert.deepEqual(settings.profiles.map(({ name, model, provider }) => [name, model, provider]), [
      ["coordinator", "coordinator", "relay"], ["relay", "coordinator", "relay"], ["standard", "worker", "relay"],
    ]);
    const titles = await rpc(host, "ragents.settings.titles.read") as { models: { id: string; provider: string }[]; selection: unknown };
    assert.deepEqual(titles.selection, { provider: "relay", model: "coordinator" });
    assert.deepEqual(titles.models.map(({ id, provider }) => [id, provider]).sort(), models.map(({ id }) => [id, "relay"]).sort());
    assert.deepEqual(requests, [{ url: "/relay/v1/models", authorization: "Bearer test-relay-token" }]);
    const invalid = fixture({ COMPACTION_PROVIDER: "relay", COMPACTION_MODEL: "coordinator",
      MODEL_ALIASES: [{ alias: "team-coordinator", model: "relay/coordinator", compaction: { ...compaction, threshold: 125_000 } }] },
    { ...defaultProduct, AGENT_PROVIDER: "relay", RELAY_URL: `http://127.0.0.1:${address.port}`,
      RELAY_TOKEN: { kind: "environment", name: "TEST_RELAY_TOKEN" } }, false);
    const rejected = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], { ...invalid.options, stdio: ["ignore", "pipe", "pipe"] });
    try {
      await assert.rejects(announcement(rejected, []), /MODEL_ALIASES: team-coordinator on relay\/coordinator: compaction: threshold plus summaryTokens \(133000\) must stay below the context window \(131072\)/);
      assert.equal(rejected.exitCode, 1);
      assert.equal(requests.length, 2);
    } finally {
      await stopChild(rejected);
      rmSync(invalid.directory, { recursive: true, force: true });
    }
  } finally {
    await stopChild(child);
    await new Promise<void>((resolve, reject) => relay.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});


test("the built host starts with stale title and role choices, renders their settings and keeps relay aliases independent", { timeout: 60_000 }, async () => {
  const { directory, options } = fixture({ ...defaultHost,
    PLUGINS: ["ragents.orchestration", "ragents.workspace", "ragents.product", "ragents.overseer", "ragents.model-relay"],
    MODEL_ALIASES: [{ alias: "shared", model: "local/worker", compaction: { threshold: 100_000, keepRecentTokens: 20_000, summaryTokens: 8_000 } }],
  });
  const data = options.env.DATA_DIR!;
  mkdirSync(path.join(data, "plugins", "ragents.product"), { recursive: true });
  const stored = { profiles: ["coordinator", "relay", "standard"].map((name) => ({ name, model: "removed", thinking: "off" })) };
  writeFileSync(path.join(data, "plugins", "ragents.product", "model-settings.json"), JSON.stringify(stored));
  writeFileSync(path.join(data, "title-settings.json"), JSON.stringify({ selection: { provider: "local", model: "removed-title" } }));
  const output: string[] = [];
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], { ...options, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const host = await announcement(child, output);
    const settings = await rpc(host, "ragents.product.modelSettings.read") as { profiles: { model: string }[] };
    assert.ok(settings.profiles.every(({ model }) => model === "removed"));
    const titles = await rpc(host, "ragents.settings.titles.read") as { selection: unknown };
    assert.deepEqual(titles.selection, { provider: "local", model: "removed-title" });
    const global = await rpc(host, "ragents.overseer.settings.read") as { model: string };
    assert.equal(global.model, "removed");
    assert.deepEqual(await rpc(host, "ragents.runs.list"), []);
    const response = await fetch(`${host.url}/relay/v1/models`, { headers: { authorization: `Bearer ${host.token}` } });
    assert.equal(response.status, 200);
    const catalog = await response.json() as { data: { id: string }[] };
    assert.deepEqual(catalog.data.map(({ id }) => id), ["shared"]);
  } finally {
    await stopChild(child);
    rmSync(directory, { recursive: true, force: true });
  }
});

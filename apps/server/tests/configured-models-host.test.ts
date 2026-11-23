import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { readBody } from "../src/plugin-support/http.ts";
import type { ActorConversations } from "../src/ragents/actor-chat-history.ts";
import { announcement, isolatedDirectory, rpc, stopChild } from "./foreign-plugin-fixture.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const models = ["worker", "coordinator", "extra"].map((id) => ({
  id, contextWindow: 131_072, maxTokens: 16_384, reasoning: false, input: ["text"],
}));
const compaction = { threshold: 100_000, keepRecentTokens: 20_000, summaryTokens: 8_000 };
const relayCatalog = {
  object: "list",
  data: models.map(({ id, ...catalog }) => ({ id, object: "model", catalog: { ...catalog, compaction } })),
};
const defaultProduct = {
  AGENT_PROVIDER: "local", AGENT_MODEL: "worker", AGENT_COORDINATOR_MODEL: "coordinator",
  AGENT_THINKING: "off", AGENT_COORDINATOR_THINKING: "off",
};

const fixture = (host: Readonly<Record<string, unknown>> = {}, product: Readonly<Record<string, unknown>> = defaultProduct, withProviders = true) => {
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
    MODEL_PROVIDERS: undefined, MODEL_ALIASES: undefined, TITLE_MODEL: undefined,
    AGENT_PROVIDER: undefined, AGENT_MODEL: undefined, AGENT_COORDINATOR_MODEL: undefined, AGENT_MODELS: undefined,
    AGENT_MODEL_REASONING: undefined, AGENT_THINKING: undefined, AGENT_COORDINATOR_THINKING: undefined, MODEL_SELECTABLE: undefined,
    RELAY_URL: undefined, RELAY_TOKEN: undefined, TEST_RELAY_TOKEN: "test-relay-token" };
  return { directory, options: { cwd: path.join(root, "apps/server"), env } };
};

test("direct configured models supply the product roles and selection, optionally restricted by AGENT_MODELS", { timeout: 120_000 }, async () => {
  for (const ids of [undefined, ["coordinator", "worker"]]) {
    const { directory, options } = fixture({}, { ...defaultProduct, ...(ids ? { AGENT_MODELS: ids } : {}) });
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
    { host: {}, product: { ...defaultProduct, AGENT_PROVIDER: undefined }, error: /AGENT_PROVIDER: provider openrouter is not configured; declare it in MODEL_PROVIDERS or set AGENT_PROVIDER/ },
    ...["AGENT_MODEL", "AGENT_COORDINATOR_MODEL"].map((key) => ({ host: {}, product: { ...defaultProduct, [key]: "missing" }, error: new RegExp(`${key}: model missing is not configured for provider local; configured model ids: worker, coordinator, extra`) })),
    { host: {}, product: { ...defaultProduct, AGENT_COORDINATOR_THINKING: "max" }, error: /thinking level max of role coordinator is not available/ },
    { host: {}, product: { ...defaultProduct, AGENT_MODELS: ["worker", "coordinator", "missing"] }, error: /AGENT_MODELS: model missing is not configured for provider local; configured model ids: worker, coordinator, extra/ },
    { host: { TITLE_MODEL: "missing" }, product: defaultProduct, error: /TITLE_MODEL: model missing is not configured; configured model ids: worker, coordinator, extra/ },
    { host: {}, product: { ...defaultProduct, OPENROUTER_API_KEY: { kind: "environment", name: "TEST_MODEL_KEY" } }, error: /ragents\.product\.OPENROUTER_API_KEY is not declared for this plugin/ },
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
  const relay = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/relay/v1/models");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(relayCatalog));
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  assert.ok(address && typeof address === "object");
  const { directory, options } = fixture({ TITLE_MODEL: "team-coordinator",
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
    assert.deepEqual(titles.selection, { provider: "alias", model: "team-coordinator" });
    assert.deepEqual(titles.models.map(({ id, provider }) => [id, provider]).sort(), [...models.map(({ id }) => [id, "relay"]), ["team-coordinator", "alias"]].sort());
    assert.deepEqual(requests, [{ url: "/relay/v1/models", authorization: "Bearer test-relay-token" }]);
    const invalid = fixture({ TITLE_MODEL: "team-coordinator",
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
  const { directory, options } = fixture({
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

test("a relay-only profile without orchestration can chat and exposes only its own functions", { timeout: 60_000 }, async (t) => {
  const reply = "The relay received the message.";
  const calls: {
    model: string;
    messages: { role: string; content: unknown }[];
    tools: { function: { name: string } }[];
  }[] = [];
  const relay = createServer(async (request, response) => {
    if (request.headers.authorization !== "Bearer test-relay-token") {
      response.writeHead(401).end();
    } else if (request.method === "GET" && request.url === "/relay/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(relayCatalog));
    } else if (request.method === "POST" && request.url === "/relay/v1/chat/completions") {
      const call = JSON.parse(await readBody(request)) as (typeof calls)[number];
      calls.push(call);
      const lookup = calls.length === 1;
      const delta = lookup
        ? { tool_calls: [{ index: 0, id: "available-functions", type: "function", function: { name: "typescript_api", arguments: "{}" } }] }
        : { content: reply };
      const chunk = { id: "reply", object: "chat.completion.chunk", created: 1, model: call.model,
        choices: [{ index: 0, delta, finish_reason: lookup ? "tool_calls" : "stop" }] };
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => relay.close((error) => error ? reject(error) : resolve())));
  const address = relay.address();
  assert.ok(address && typeof address === "object");
  const { directory, options } = fixture({ PLUGINS: ["ragents.workspace", "ragents.product"] }, {
    ...defaultProduct, AGENT_PROVIDER: "relay", RELAY_URL: `http://127.0.0.1:${address.port}`,
    RELAY_TOKEN: { kind: "environment", name: "TEST_RELAY_TOKEN" },
  }, false);
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], { ...options, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const host = await announcement(child, []);
    const runId = "solo-chat";
    await rpc(host, "ragents.chat.send", { runId, text: "List your functions." });
    await t.waitFor(async () => {
      const history = await rpc(host, "ragents.chat.actorHistory", { runId }) as ActorConversations;
      assert.ok(Object.values(history.actors).flat().some((message) => message.role === "assistant" && message.text === reply));
    }, { timeout: 15_000 });

    const orchestration = /\b(?:agent_spawn|actor_\w+|event_\w+|artifact_\w+|model_list|run_configure|run_stop|run_script_\w+)\b/;
    assert.deepEqual(calls.map((call) => call.model), ["coordinator", "coordinator"]);
    const settings = await rpc(host, "ragents.settings.read") as { tools: { name: string }[] };
    assert.doesNotMatch(settings.tools.map((tool) => tool.name).join(" "), orchestration);
    const nativeNames = calls[0]!.tools.map((tool) => tool.function.name);
    assert.ok(nativeNames.includes("read") && nativeNames.includes("typescript_api"));
    assert.doesNotMatch(nativeNames.join(" "), orchestration);
    const system = calls[0]!.messages.find((message) => message.role === "system");
    assert.ok(system);
    assert.doesNotMatch(JSON.stringify(system.content), /Orchestration through TypeScript/);
    assert.equal(JSON.stringify(system.content).match(orchestration)?.[0], undefined, "The prompt names an unavailable orchestration function");
    const result = calls[1]!.messages.find((message) => message.role === "tool");
    assert.ok(typeof result?.content === "string");
    const catalog = JSON.parse(result.content) as { functions: { name: string }[] };
    const functionNames = catalog.functions.map((fn) => fn.name);
    assert.ok(functionNames.includes("read"));
    assert.doesNotMatch(functionNames.join(" "), orchestration);
    const usage = await rpc(host, "ragents.chat.contextUsage", { runId }) as { compactionThreshold: number };
    assert.equal(usage.compactionThreshold, compaction.threshold);
  } finally {
    await stopChild(child);
    rmSync(directory, { recursive: true, force: true });
  }
});

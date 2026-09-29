import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ModelRuntime } from "@ragents/agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@ragents/ai";
import { createAccessContext, PluginHost, type AccessContext } from "@ragents/engine";
import { readBody } from "../src/plugin-support/http.ts";
import { modelUpstreamsToken, type ModelUpstream } from "../src/plugin-support/model-upstreams.ts";
import { parseModelAliases } from "../src/plugin-support/model-aliases.ts";
import { createRelayCatalog } from "../src/plugin-support/product-relay.ts";
import { relayAliases } from "../../../plugins/ragents.model-relay/server/config.ts";
import { catalogEntryOf, createRelayRoutes, resolveAliases } from "../../../plugins/ragents.model-relay/server/relay.ts";

process.env.DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "ragents-relay-data-"));
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { plugin: relayModule } = await import("../../../plugins/ragents.model-relay/server/index.ts");

const secretModel: Model<Api> = {
  id: "vendor/secret-model-9", name: "Vendor: Secret Model 9", api: "openai-completions", provider: "openrouter",
  baseUrl: "https://upstream.invalid/api/v1", reasoning: true, thinkingLevelMap: { minimal: null }, input: ["text", "image"],
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 32_000,
  compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
};

const compaction = { threshold: 150_000, keepRecentTokens: 20_000, summaryTokens: 16_000 };

const aliasEntry = (alias: string, model: string, extra: Record<string, unknown> = {}) => ({ alias, model, compaction, ...extra });

const listen = async (t: TestContext, server: Server): Promise<string> => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return `http://127.0.0.1:${address.port}`;
};

interface UpstreamCall { headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }

/** An OpenAI-compatible fake provider: streams three SSE blocks with the real model name, the last one carries usage. */
const fakeUpstream = async (t: TestContext, calls: UpstreamCall[]) => {
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
    calls.push({ headers: request.headers, body });
    if (body.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "x", model: body.model, provider: "Secret Cloud", choices: [{ delta: { content: "Hal" } }] })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      response.write(`data: ${JSON.stringify({ id: "x", model: body.model, choices: [{ delta: { content: "lo" } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: "x", choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      id: "y", model: body.model, provider: "Secret Cloud", system_fingerprint: "fp_7",
      choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 7, completion_tokens: 1 },
    }));
  });
  return listen(t, server);
};

const relayServer = async (t: TestContext, upstreamUrl: string, access: (request: { headers: Record<string, unknown> }) => AccessContext, extra: Record<string, unknown> = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-relay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
  const upstream: ModelUpstream = { id: "openrouter", baseUrl: `${upstreamUrl}/api/v1`, apiKey: "sk-upstream-secret", models: [secretModel] };
  host.register({ manifest: { id: "test.product" }, register: (registration) => registration.provide(modelUpstreamsToken, () => [upstream]) });
  process.env.MODEL_ALIASES = JSON.stringify([aliasEntry("workshop-coordinator", "openrouter/vendor/secret-model-9", extra)]);
  t.after(() => { delete process.env.MODEL_ALIASES; });
  host.register(relayModule.create(host));
  host.seal();
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = () => undefined;
  try { await host.initialize(); } finally { console.log = originalLog; }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const handled = await host.dispatchHttp(request, response, url, access(request as { headers: Record<string, unknown> }));
    if (!handled) { response.writeHead(404); response.end(); }
  });
  return { url: await listen(t, server), lines, host };
};

const withRight = createAccessContext({ enabled: true, user: { id: "dev", label: "Dev", rights: ["models.use"] } });
const withoutRight = createAccessContext({ enabled: true, user: { id: "reader", label: "Reader", rights: ["runs.read"] } });

test("MODEL_ALIASES is checked and every alias is bound to a provider and a catalog", () => {
  assert.deepEqual(parseModelAliases([aliasEntry("a", "openrouter/x/y"), aliasEntry("b", "local/z")]), [
    { alias: "a", upstream: "openrouter", model: "x/y", compaction }, { alias: "b", upstream: "local", model: "z", compaction },
  ]);
  for (const bad of [["a=openrouter/x"], [aliasEntry("a", "openrouter")], [aliasEntry("a", "/x")], [aliasEntry("A", "openrouter/x")],
    [aliasEntry("a", "openrouter/x"), aliasEntry("a", "openrouter/y")], [{ alias: "a", model: "openrouter/x" }]]) {
    assert.throws(() => parseModelAliases(bad), /MODEL_ALIASES/);
  }
  assert.throws(() => relayAliases(parseModelAliases([])), /ragents.model-relay needs MODEL_ALIASES/);
  const upstream: ModelUpstream = { id: "openrouter", baseUrl: "https://u.invalid/v1", apiKey: "k", models: [secretModel] };
  assert.throws(() => resolveAliases(parseModelAliases([aliasEntry("a", "ollama/x")]), [upstream]), /provider ollama .* is not configured on this server \(available: openrouter\)/);
  assert.throws(() => resolveAliases(parseModelAliases([aliasEntry("a", "openrouter/x")]), [upstream]), /model x behind a is missing from the catalog of openrouter/);
  const entry = catalogEntryOf(resolveAliases(parseModelAliases([aliasEntry("a", "openrouter/vendor/secret-model-9")]), [upstream])[0]!);
  assert.equal(entry.id, "a");
  assert.equal(entry.catalog.contextWindow, 200_000);
  assert.deepEqual(entry.catalog.compaction, compaction);
  assert.deepEqual(entry.catalog.thinkingLevelMap, { minimal: null });
  assert.equal(JSON.stringify(entry).includes("secret"), false);
  assert.equal(JSON.stringify(entry).includes("cost"), false);
  const mapped = catalogEntryOf(resolveAliases(parseModelAliases([aliasEntry("a", "openrouter/vendor/secret-model-9", { thinkingLevels: { off: "low", low: "low", medium: "high", xhigh: "high" } })]), [upstream])[0]!);
  assert.deepEqual(mapped.catalog.thinkingLevelMap, { off: "low", minimal: null, low: "low", medium: "high", high: null, xhigh: "high", max: null });
  assert.deepEqual(mapped.catalog.compaction, compaction);
  assert.throws(() => resolveAliases(parseModelAliases([aliasEntry("a", "openrouter/vendor/secret-model-9", { thinkingLevels: { low: "minimal" } })]), [upstream]),
    /a on openrouter\/vendor\/secret-model-9: thinkingLevels\.low maps to minimal, which the target does not offer \(valid: off, low, medium, high\)/);
});

test("the catalog names aliases without real names and requires the right models.use", async (t) => {
  const upstreamUrl = await fakeUpstream(t, []);
  const relay = await relayServer(t, upstreamUrl, (request) => request.headers["x-test-user"] === "dev" ? withRight : withoutRight);
  const denied = await fetch(`${relay.url}/relay/v1/models`);
  assert.equal(denied.status, 403);
  const response = await fetch(`${relay.url}/relay/v1/models`, { headers: { "x-test-user": "dev" } });
  assert.equal(response.status, 200);
  const body = await response.json() as { object: string; data: Array<{ id: string; catalog: { reasoning: boolean } }> };
  assert.equal(body.object, "list");
  assert.deepEqual(body.data.map((entry) => entry.id), ["workshop-coordinator"]);
  assert.equal(body.data[0]!.catalog.reasoning, true);
  assert.equal(JSON.stringify(body).includes("secret-model"), false);
  assert.equal(relay.host.isApiPath("/relay/v1/models"), true);
});

test("requests go out with the real model and the server key, the response names only the alias", async (t) => {
  const calls: UpstreamCall[] = [];
  const upstreamUrl = await fakeUpstream(t, calls);
  const relay = await relayServer(t, upstreamUrl, () => withRight);
  const streamed = await fetch(`${relay.url}/relay/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer personal-token", "x-session-id": "affinity-1" },
    body: JSON.stringify({ model: "workshop-coordinator", stream: true, messages: [{ role: "user", content: "Hi" }] }),
  });
  assert.equal(streamed.status, 200);
  assert.equal(streamed.headers.get("content-type"), "text/event-stream");
  const text = await streamed.text();
  assert.equal(text, `data: {"id":"x","model":"workshop-coordinator","choices":[{"delta":{"content":"Hal"}}]}\n\n`
    + `data: {"id":"x","model":"workshop-coordinator","choices":[{"delta":{"content":"lo"}}]}\n\n`
    + `data: {"id":"x","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n`);
  assert.equal(text.includes("secret-model"), false);
  assert.equal(text.includes("Secret Cloud"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.body.model, "vendor/secret-model-9");
  assert.equal(calls[0]!.body.stream, true);
  assert.equal(calls[0]!.headers.authorization, "Bearer sk-upstream-secret");
  assert.equal(calls[0]!.headers["x-session-id"], "affinity-1");
  const plain = await fetch(`${relay.url}/relay/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "workshop-coordinator", messages: [] }),
  });
  assert.equal(plain.status, 200);
  const body = await plain.json() as { model: string; provider?: string; system_fingerprint?: string; usage: unknown };
  assert.equal(body.model, "workshop-coordinator");
  assert.equal(body.provider, undefined);
  assert.equal(body.system_fingerprint, "fp_7");
  assert.deepEqual(body.usage, { prompt_tokens: 7, completion_tokens: 1 });
  const unknown = await fetch(`${relay.url}/relay/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "vendor/secret-model-9", messages: [] }),
  });
  assert.equal(unknown.status, 404);
  assert.equal(calls.length, 2);
  const invalid = await fetch(`${relay.url}/relay/v1/chat/completions`, { method: "POST", body: "no json" });
  assert.equal(invalid.status, 400);
});

test("the routes log user, alias and tokens and report a dead provider as 502", async (t) => {
  const lines: string[] = [];
  const upstream: ModelUpstream = { id: "openrouter", baseUrl: "http://127.0.0.1:9/api/v1", apiKey: "k", models: [secretModel] };
  const routes = createRelayRoutes({ aliases: () => resolveAliases(parseModelAliases([aliasEntry("a", "openrouter/vendor/secret-model-9")]), [upstream]), log: (line) => lines.push(line) });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = routes.find((candidate) => candidate.matches(request, url));
    if (!route) { response.writeHead(404); response.end(); return; }
    await route.handle({ request, response, url, access: withRight });
  });
  const url = await listen(t, server);
  const response = await fetch(`${url}/relay/v1/chat/completions`, { method: "POST", body: JSON.stringify({ model: "a", messages: [] }) });
  assert.equal(response.status, 502);
  assert.match(lines[0]!, /^dev a -> openrouter\/vendor\/secret-model-9: unreachable/);
});

test("a client of the relay compacts with the values of the server's alias", async (t) => {
  const relay = await relayServer(t, await fakeUpstream(t, []), () => withRight);
  const catalog = createRelayCatalog({ url: relay.url, token: "personal-token" });
  const [model] = await catalog.load();
  assert.equal(model!.id, "workshop-coordinator");
  assert.equal(model!.contextWindow, 200_000);
  assert.deepEqual(model!.compaction, compaction);
  const registration = await catalog.registration();
  assert.deepEqual(registration.config.models?.map((entry) => entry.compaction), [compaction]);
});

test("a client of the relay offers the levels of the alias, and the chosen level arrives mapped at the provider", async (t) => {
  const calls: UpstreamCall[] = [];
  const relay = await relayServer(t, await fakeUpstream(t, calls), () => withRight, { thinkingLevels: { off: "low", low: "low", medium: "high", xhigh: "high" } });
  const registration = await createRelayCatalog({ url: relay.url, token: "personal-token" }).registration();
  const models = ModelRuntime.create();
  models.registerProvider(registration.id, registration.config);
  const model = models.getModel(registration.id, "workshop-coordinator")!;
  assert.deepEqual(getSupportedThinkingLevels(model), ["off", "low", "medium", "xhigh"]);
  const context = { messages: [{ role: "user" as const, content: "Hi", timestamp: 1 }] };
  await models.completeSimple(model, context, { maxRetries: 0 });
  await models.completeSimple(model, context, { reasoning: "medium", maxRetries: 0 });
  assert.deepEqual(calls.map((call) => [call.body.model, call.body.reasoning]), [["vendor/secret-model-9", { effort: "low" }], ["vendor/secret-model-9", { effort: "high" }]]);
});

test("a relay catalog without valid compaction values fails the client start", async () => {
  const served = (entryCompaction: unknown) => async () => new Response(JSON.stringify({ object: "list", data: [{
    id: "a", object: "model", owned_by: "relay",
    catalog: { reasoning: false, input: ["text"], contextWindow: 200_000, maxTokens: 32_000, ...(entryCompaction === undefined ? {} : { compaction: entryCompaction }) },
  }] }), { headers: { "content-type": "application/json" } });
  await assert.rejects(() => createRelayCatalog({ url: "http://relay.invalid", token: "t" }, served(undefined)).load(),
    /offers a without valid compaction values: compaction needs threshold, keepRecentTokens and summaryTokens/);
  await assert.rejects(() => createRelayCatalog({ url: "http://relay.invalid", token: "t" }, served({ ...compaction, threshold: 190_000 })).load(),
    /offers a without valid compaction values: compaction: threshold plus summaryTokens \(206000\) must stay below the context window \(200000\)/);
});

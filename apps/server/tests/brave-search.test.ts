import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { Value } from "typebox/value";
import { Journal, Orchestration, type PluginHost, type RunFunction, type ToolScope } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { braveSearchFunctions, BraveSearchError, type BraveSearchConfig } from "../../../plugins/ragents.brave-search/server/functions.ts";
import { untrustedNotice, type SearchOutput } from "../../../plugins/ragents.brave-search/server/client.ts";
import { compositionEnvironment, minimalFixture } from "./fixtures/profile-composition/profiles.ts";

const apiKey = "test-key-0123456789";

interface Call {
  readonly url: URL;
  readonly headers: Headers;
}

const answering = (calls: Call[], status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): typeof fetch =>
  async (input, init) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  };

const tool = (name: string, config: Partial<BraveSearchConfig> & { readonly fetch: typeof fetch }): RunFunction =>
  braveSearchFunctions({ apiKey, ...config }).find((entry) => entry.name === name)!;

const call = async (fn: RunFunction, input: object, signal?: AbortSignal): Promise<SearchOutput> =>
  await fn.run({ signal } as unknown as ToolScope, "call-1", input as never) as SearchOutput;

const failure = async (fn: RunFunction, input: object = { query: "tax" }): Promise<BraveSearchError> => {
  try { await call(fn, input); }
  catch (cause) {
    assert.ok(cause instanceof BraveSearchError, `Unexpected error ${String(cause)}`);
    return cause;
  }
  throw new Error("The call did not fail");
};

const webHit = (index: number, extra: Record<string, unknown> = {}) => ({
  title: `Guide ${index}`,
  url: `https://example.com/guide-${index}`,
  description: "A short excerpt",
  page_age: "2026-10-04T16:34:01",
  age: "3 weeks ago",
  language: "de",
  profile: { name: "Example", url: "https://example.com", img: "https://imgs.example.com/logo" },
  meta_url: { hostname: "example.com", favicon: "https://imgs.example.com/favicon" },
  thumbnail: { src: "https://imgs.example.com/thumb", original: "https://example.com/thumb.jpg" },
  ...extra,
});

const webPayload = (items: readonly object[], more = false) => ({
  type: "search",
  query: { original: "tax", more_results_available: more, related_queries: ["tax rate", "tax table"] },
  mixed: { type: "mixed", main: [] },
  web: { type: "search", results: items },
});

test("a web search sends the key as a header, the configured defaults as parameters and no key in the address", async () => {
  const calls: Call[] = [];
  const web = tool("web_search", { country: "de", language: "DE", fetch: answering(calls, 200, webPayload([webHit(1)])) });

  await call(web, { query: "  Grunderwerbsteuer Hessen  " });

  assert.equal(calls.length, 1);
  const { url, headers } = calls[0]!;
  assert.equal(url.origin + url.pathname, "https://api.search.brave.com/res/v1/web/search");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: "Grunderwerbsteuer Hessen", count: "8", offset: "0", country: "DE", search_lang: "de", safesearch: "moderate",
    text_decorations: "false", result_filter: "web",
  });
  assert.equal(headers.get("x-subscription-token"), apiKey);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(url.href.includes(apiKey), false);
});

test("a call overrides the defaults and restricts the age with a word or a date range", async () => {
  const calls: Call[] = [];
  const web = tool("web_search", { country: "DE", language: "de", safeSearch: "strict", fetch: answering(calls, 200, webPayload([])) });

  await call(web, { query: "tax", count: 3, offset: 2, country: "us", language: "EN-GB", freshness: "Week", extraSnippets: true });
  await call(web, { query: "tax", freshness: "2026-01-01to2026-03-31" });
  await call(web, { query: "tax", country: "all" });

  assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams), {
    q: "tax", count: "3", offset: "2", country: "US", search_lang: "en-gb", safesearch: "strict", freshness: "pw",
    text_decorations: "false", result_filter: "web", extra_snippets: "true",
  });
  assert.equal(calls[1]!.url.searchParams.get("freshness"), "2026-01-01to2026-03-31");
  assert.equal(calls[2]!.url.searchParams.get("country"), "ALL");
  for (const input of [{ freshness: "yesterday" }, { freshness: "2026-03-31to2026-01-01" }, { freshness: "2026-02-30to2026-03-31" }, { country: "Germany" }, { language: "deutsch" }, { query: "   " }]) {
    const error = await failure(web, { query: "tax", ...input });
    assert.equal(error.kind, "request");
  }
  assert.equal(calls.length, 3, "invalid input must not reach the network");
});

test("a web result keeps only title, address, excerpt and date and says that it is untrusted", async () => {
  const calls: Call[] = [];
  const web = tool("web_search", { fetch: answering(calls, 200, webPayload([
    webHit(1, { description: "<strong>6,0 %</strong> tax &amp; fees in Hesse &#x27;2026&#x27;, rates &lt; 7 % and x < 5\n\n  apply", extra_snippets: ["more"] }),
    webHit(2, { page_age: undefined, age: "April 4, 2026" }),
    webHit(3, { page_age: undefined, age: undefined }),
    webHit(4, { url: "javascript:alert(1)" }),
    webHit(5, { title: " " }),
    "not an object",
  ], true)) });

  const output = await call(web, { query: "tax" });

  assert.deepEqual(output, {
    notice: untrustedNotice,
    results: [
      { title: "Guide 1", url: "https://example.com/guide-1", snippet: "6,0 % tax & fees in Hesse '2026', rates < 7 % and x < 5 apply", age: "2026-10-04" },
      { title: "Guide 2", url: "https://example.com/guide-2", snippet: "A short excerpt", age: "April 4, 2026" },
      { title: "Guide 3", url: "https://example.com/guide-3", snippet: "A short excerpt" },
    ],
    hasMore: true,
  });
  assert.equal(JSON.stringify(output).includes("related_queries"), false);
});

test("an answer without matches is an empty list", async () => {
  const web = tool("web_search", { fetch: answering([], 200, { type: "search", query: { original: "tax" } }) });

  assert.deepEqual(await call(web, { query: "tax" }), { notice: untrustedNotice, results: [] });
});

test("further excerpts come only on request, at most three and short", async () => {
  const extras = ["one", "two", "three", "four", "x".repeat(400)];
  const asked = await call(tool("web_search", { fetch: answering([], 200, webPayload([webHit(1, { extra_snippets: extras })])) }), { query: "tax", extraSnippets: true });
  const unasked = await call(tool("web_search", { fetch: answering([], 200, webPayload([webHit(1, { extra_snippets: extras })])) }), { query: "tax" });

  assert.deepEqual(asked.results[0]!.moreSnippets, ["one", "two", "three"]);
  assert.equal("moreSnippets" in unasked.results[0]!, false);
  const long = await call(tool("web_search", { fetch: answering([], 200, webPayload([webHit(1, { extra_snippets: ["x".repeat(400)] })])) }), { query: "tax", extraSnippets: true });
  assert.equal(long.results[0]!.moreSnippets![0]!.length, 240);
});

test("long titles and excerpts are cut without splitting a character", async () => {
  const web = tool("web_search", { fetch: answering([], 200, webPayload([webHit(1, { title: "T".repeat(500), description: `${"a".repeat(296)}\u{1F600}\u{1F600}b` })])) });

  const [hit] = (await call(web, { query: "tax" })).results;

  assert.equal(hit!.title.length, 160);
  assert.ok(hit!.title.endsWith("..."));
  assert.equal(hit!.snippet, `${"a".repeat(296)}...`);
});

test("the answer stays within the character limit and names the matches it left out", async () => {
  const items = Array.from({ length: 20 }, (_, index) => webHit(index, { description: "d".repeat(300) }));
  const web = tool("web_search", { maxResultChars: 2000, fetch: answering([], 200, webPayload(items)) });

  const output = await call(web, { query: "tax", count: 20 });

  assert.ok(output.results.length >= 3 && output.results.length < 20);
  assert.equal(output.omitted, 20 - output.results.length);
  assert.ok(JSON.stringify(output.results).length <= 2000);
  const single = tool("web_search", { maxResultChars: 500, fetch: answering([], 200, webPayload(items.slice(0, 2))) });
  assert.equal((await call(single, { query: "tax" })).results.length, 1);
});

test("a news search reads the news endpoint and names the publisher", async () => {
  const calls: Call[] = [];
  const news = tool("news_search", { country: "DE", fetch: answering(calls, 200, {
    type: "news",
    query: { original: "tax" },
    results: [
      { type: "news_result", title: "Rates change", url: "https://news.example.com/a", description: "Headline text", age: "6 hours ago", page_age: "2026-10-28T11:58:06", profile: { name: "Example News", url: "https://news.example.com" }, meta_url: { hostname: "news.example.com" } },
      { type: "news_result", title: "No profile", url: "https://news.example.org/b", description: "Other text", age: "2 days ago", meta_url: { hostname: "news.example.org" } },
    ],
  }) });

  const output = await call(news, { query: "tax", freshness: "day", count: 2 });

  assert.equal(calls[0]!.url.pathname, "/res/v1/news/search");
  assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams), {
    q: "tax", count: "2", offset: "0", country: "DE", safesearch: "moderate", freshness: "pd", text_decorations: "false",
  });
  assert.deepEqual(output.results, [
    { title: "Rates change", url: "https://news.example.com/a", snippet: "Headline text", age: "2026-10-28", source: "Example News" },
    { title: "No profile", url: "https://news.example.org/b", snippet: "Other text", age: "2 days ago", source: "news.example.org" },
  ]);
});

test("the functions are native tools with closed input and describe the content as untrusted", () => {
  const functions = braveSearchFunctions({ apiKey, fetch: answering([], 200, {}) });

  assert.deepEqual(functions.map((fn) => fn.name), ["web_search", "news_search"]);
  for (const fn of functions) {
    assert.notEqual(fn.nativeTool, false);
    assert.match(`${fn.description} ${fn.longDescription ?? ""}`, /untrusted/);
    assert.equal(Value.Check(fn.schema, { query: "tax" }), true);
    assert.equal(Value.Check(fn.schema, { query: "tax", count: 20, offset: 9, freshness: "week", country: "DE", language: "de" }), true);
    for (const input of [{}, { query: "" }, { query: "x".repeat(401) }, { query: "tax", count: 0 }, { query: "tax", count: 21 }, { query: "tax", offset: 10 }, { query: "tax", unknown: 1 }]) {
      assert.equal(Value.Check(fn.schema, input), false, JSON.stringify(input));
    }
    assert.equal(Value.Check(fn.resultSchema, { notice: "n", results: [{ title: "t", url: "u", snippet: "s", age: "a" }], hasMore: true, omitted: 1 }), true);
  }
  assert.equal(Value.Check(functions[0]!.schema, { query: "tax", extraSnippets: true }), true);
  assert.equal(Value.Check(functions[1]!.schema, { query: "tax", extraSnippets: true }), false);
});

test("a rejected key, a request error and an outage name the cause and never the key", async () => {
  const rejected = await failure(tool("web_search", { fetch: answering([], 422, { type: "ErrorResponse", error: { code: "SUBSCRIPTION_TOKEN_INVALID", detail: "The provided subscription token is invalid.", status: 422 } }) }));
  assert.equal(rejected.kind, "key");
  assert.match(rejected.message, /rejected the API key \(The provided subscription token is invalid\.\)/);

  const forbidden = await failure(tool("news_search", { fetch: answering([], 403, "forbidden") }));
  assert.equal(forbidden.kind, "key");

  const invalid = await failure(tool("web_search", { fetch: answering([], 422, { error: { code: "VALIDATION", detail: "Unable to validate request parameter(s)", meta: { errors: [{ loc: ["query", "offset"], msg: "Input should be less than or equal to 9" }] } } }) }));
  assert.equal(invalid.kind, "request");
  assert.match(invalid.message, /HTTP 422: offset: Input should be less than or equal to 9\)/);

  const outage = await failure(tool("web_search", { fetch: answering([], 503, "<html>down</html>") }));
  assert.equal(outage.kind, "unavailable");
  assert.match(outage.message, /HTTP 503.*Try again shortly/);

  for (const error of [rejected, forbidden, invalid, outage]) assert.equal(error.message.includes(apiKey), false);
});

test("a rate limit names the wait and a used up quota says that waiting is pointless", async () => {
  const rate = await failure(tool("web_search", { fetch: answering([], 429, { error: { code: "RATE_LIMITED", detail: "Rate limit exceeded", status: 429 } }, {
    "x-ratelimit-limit": "1, 15000", "x-ratelimit-remaining": "0, 14000", "x-ratelimit-reset": "1, 1419704",
  }) }));
  assert.equal(rate.kind, "rate-limit");
  assert.equal(rate.retryAfterSeconds, 1);
  assert.match(rate.message, /Retry in about 1 s\./);

  const quota = await failure(tool("web_search", { fetch: answering([], 429, { error: { code: "RATE_LIMITED", status: 429 } }, {
    "x-ratelimit-limit": "1, 15000", "x-ratelimit-remaining": "1, 0", "x-ratelimit-reset": "1, 1419704",
  }) }));
  assert.equal(quota.kind, "quota");
  assert.equal(quota.retryAfterSeconds, 1419704);
  assert.match(quota.message, /quota of the plan is used up; it renews in about 16 days/);

  const named = await failure(tool("web_search", { fetch: answering([], 429, { error: { code: "QUOTA_LIMITED", status: 429 } }) }));
  assert.equal(named.kind, "quota");
  assert.equal(named.retryAfterSeconds, undefined);
  assert.match(named.message, /used up\. Searching again/);

  const bare = await failure(tool("web_search", { fetch: answering([], 429, "") }));
  assert.equal(bare.kind, "rate-limit");
  assert.equal(bare.retryAfterSeconds, 1);
});

test("a network failure, a timeout and a broken answer are told apart from a cancellation", async () => {
  const unreachable = await failure(tool("web_search", { fetch: async () => { throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.search.brave.com") }); } }));
  assert.equal(unreachable.kind, "network");
  assert.match(unreachable.message, /could not be reached: getaddrinfo ENOTFOUND api\.search\.brave\.com/);

  const waiting: typeof fetch = (_input, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
  const slow = await failure(tool("web_search", { timeoutSeconds: 0.05, fetch: waiting }));
  assert.equal(slow.kind, "timeout");
  assert.match(slow.message, /did not answer within 0\.05 seconds/);

  const controller = new AbortController();
  const pending = call(tool("web_search", { fetch: waiting }), { query: "tax" }, controller.signal);
  controller.abort(new Error("stopped by the run"));
  await assert.rejects(pending, (cause: unknown) => !(cause instanceof BraveSearchError) && cause instanceof Error && cause.message === "stopped by the run");

  assert.equal((await failure(tool("web_search", { fetch: answering([], 200, "not json") }))).kind, "response");
  assert.equal((await failure(tool("web_search", { fetch: answering([], 200, { web: { results: "no list" } }) }))).kind, "response");
});

test("the settings are checked when the functions are created", () => {
  const fetchNothing = answering([], 200, {});

  assert.throws(() => braveSearchFunctions({ apiKey: "  ", fetch: fetchNothing }), /API key is empty/);
  assert.throws(() => braveSearchFunctions({ apiKey, country: "Germany", fetch: fetchNothing }), /default country must be a two-letter/);
  assert.throws(() => braveSearchFunctions({ apiKey, language: "deutsch", fetch: fetchNothing }), /default language must be a language code/);
  assert.throws(() => braveSearchFunctions({ apiKey, safeSearch: "none" as never, fetch: fetchNothing }), /safe search mode must be off, moderate or strict/);
  assert.throws(() => braveSearchFunctions({ apiKey, timeoutSeconds: 0, fetch: fetchNothing }), /timeout must be a positive/);
  assert.throws(() => braveSearchFunctions({ apiKey, maxResultChars: 100, fetch: fetchNothing }), /at least 500/);
});

test("the library entry needs only the engine and typebox, so an embedding host can import it", () => {
  const folder = path.join(import.meta.dirname, "../../../plugins/ragents.brave-search");
  const specifiers = ["functions.ts", "client.ts"].flatMap((file) =>
    [...readFileSync(path.join(folder, "server", file), "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1]!));

  assert.deepEqual([...new Set(specifiers)].sort(), ["./client.js", "@ragents/engine", "typebox"]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(folder, "ragents-plugin.json"), "utf8")).exports.server, ["server/functions"]);
});

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "ragents-brave-search-"));
const workspaceDirectory = path.join(temporaryDirectory, "workspace");
mkdirSync(workspaceDirectory);
const environment = { ...compositionEnvironment, DATA_DIR: path.join(temporaryDirectory, "data"), BRAVE_API_KEY: undefined, BRAVE_SEARCH_COUNTRY: undefined, BRAVE_SEARCH_LANGUAGE: undefined, BRAVE_SEARCH_SAFESEARCH: undefined, BRAVE_SEARCH_TIMEOUT_SECONDS: undefined };
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
const restore = (values: Iterable<readonly [string, string | undefined]>): void => {
  for (const [key, value] of values) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};
restore(Object.entries(environment));
const hosts: PluginHost[] = [];
const services = testServices();
const journal = new Journal(":memory:", services);
const runtime = new Orchestration(journal, services);
after(async () => {
  try { await Promise.all(hosts.map((host) => host.lifecycle.shutdown())); }
  finally {
    restore(previousEnvironment);
    journal.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const { loadPlugins } = await import("../src/profile/plugin-discovery.ts");
const { composeProfile } = await import("../src/profile/compose.ts");

const composed = async (settings: Readonly<Record<string, string>>): Promise<PluginHost> => {
  restore(Object.entries({ ...environment, ...settings }));
  const plugins = [...minimalFixture.plugins, "ragents.brave-search"];
  const loaded = await loadPlugins(plugins);
  const host = composeProfile(
    { product: minimalFixture.product, pluginIds: plugins, modules: loaded.modules, web: loaded.web, executor: loaded.executor },
    {
      ensureSession: () => {},
      ensureWorkspaceAccess: () => {},
      runtime: () => runtime,
      sessionWorkspaceFor: () => Promise.resolve({
        cwd: workspaceDirectory,
        currentRoot: () => Promise.resolve(workspaceDirectory),
        runOperation: <T>(operation: () => Promise<T>) => operation(),
      }),
    },
  );
  hosts.push(host);
  return host;
};

const searchTools = (host: PluginHost): readonly string[] => host.tools.describe().map((entry) => entry.name).filter((name) => name.endsWith("_search")).sort();

test("a profile with the key offers both functions and keeps the key out of child processes", async () => {
  const host = await composed({ BRAVE_API_KEY: apiKey, BRAVE_SEARCH_COUNTRY: "de", BRAVE_SEARCH_LANGUAGE: "de", BRAVE_SEARCH_SAFESEARCH: "off", BRAVE_SEARCH_TIMEOUT_SECONDS: "5" });

  assert.deepEqual(searchTools(host), ["news_search", "web_search"]);
  assert.deepEqual(host.config.entries().filter((entry) => entry.key.startsWith("BRAVE_")).map((entry) => [entry.key, entry.source, entry.secret === true]), [
    ["BRAVE_API_KEY", "environment", true],
    ["BRAVE_SEARCH_COUNTRY", "environment", false],
    ["BRAVE_SEARCH_LANGUAGE", "environment", false],
    ["BRAVE_SEARCH_SAFESEARCH", "environment", false],
    ["BRAVE_SEARCH_TIMEOUT_SECONDS", "environment", false],
  ]);
  assert.ok(host.config.secretKeys().includes("BRAVE_API_KEY"));
});

test("a profile without the key stays inactive instead of failing", async () => {
  const host = await composed({});

  assert.deepEqual(searchTools(host), []);
  assert.ok(host.publicProfile().plugins.some((entry) => entry.id === "ragents.brave-search"));
});

test("a wrong setting stops the start with the name of the key", async () => {
  await assert.rejects(() => composed({ BRAVE_API_KEY: apiKey, BRAVE_SEARCH_COUNTRY: "Germany" }), /BRAVE_SEARCH_COUNTRY must be a two-letter country code/);
  await assert.rejects(() => composed({ BRAVE_API_KEY: apiKey, BRAVE_SEARCH_SAFESEARCH: "none" }), /BRAVE_SEARCH_SAFESEARCH must be off, moderate or strict/);
  await assert.rejects(() => composed({ BRAVE_API_KEY: apiKey, BRAVE_SEARCH_TIMEOUT_SECONDS: "-1" }), /BRAVE_SEARCH_TIMEOUT_SECONDS must be a positive number/);
});

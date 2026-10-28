import assert from "node:assert/strict";
import test from "node:test";
import type { ToolScope } from "@ragents/engine";
import { braveSearchFunctions, BraveSearchError } from "../../../plugins/ragents.brave-search/server/functions.ts";
import type { Hit, SearchOutput } from "../../../plugins/ragents.brave-search/server/client.ts";

const apiKey = process.env.BRAVE_API_KEY;
const skip = apiKey ? false : "BRAVE_API_KEY is not set";

const run = async (key: string, name: string, input: object): Promise<SearchOutput> => {
  const fn = braveSearchFunctions({ apiKey: key, country: "DE", language: "de" }).find((entry) => entry.name === name)!;
  return await fn.run({ signal: undefined } as unknown as ToolScope, "live-1", input as never) as SearchOutput;
};

const assertCompact = (hit: Hit): void => {
  assert.match(hit.url, /^https?:\/\//);
  assert.ok(hit.title.length > 0 && hit.title.length <= 160);
  assert.ok(hit.snippet.length <= 300);
  assert.doesNotMatch(`${hit.title} ${hit.snippet}`, /<\/?[a-z][^>]*>/i);
};

test("a live web search returns compact, current matches", { skip, timeout: 30_000 }, async () => {
  const output = await run(apiKey!, "web_search", { query: "Grunderwerbsteuer Hessen 2026", count: 5 });

  assert.ok(output.results.length > 0 && output.results.length <= 5);
  output.results.forEach(assertCompact);
  assert.ok(JSON.stringify(output).length <= 8000);
});

test("a live news search returns the same compact shape", { skip, timeout: 30_000 }, async () => {
  const output = await run(apiKey!, "news_search", { query: "Grunderwerbsteuer", freshness: "month", count: 3 });

  assert.ok(output.results.length <= 3);
  output.results.forEach(assertCompact);
});

test("a live search with a wrong key names the key as the cause", { skip, timeout: 30_000 }, async () => {
  await assert.rejects(
    () => run("not-a-valid-key", "web_search", { query: "tax" }),
    (cause: unknown) => cause instanceof BraveSearchError && cause.kind === "key" && !cause.message.includes("not-a-valid-key"),
  );
});

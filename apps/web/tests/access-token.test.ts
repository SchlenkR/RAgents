import assert from "node:assert/strict";
import test from "node:test";
import { accessTokenInstalled, installAccessToken, withAccessToken } from "../src/access-token.ts";

test("without a token addresses stay untouched", () => {
  assert.equal(accessTokenInstalled(), false);
  assert.equal(withAccessToken("/files/runs/run-a/artifacts/art-1"), "/files/runs/run-a/artifacts/art-1");
});

test("an installed token rides along as bearer on same-origin requests and as query on header-less addresses", async () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const browser = {
    location: { href: "http://localhost:4710/run-panel.html", origin: "http://localhost:4710" },
    fetch: async (input: RequestInfo | URL) => {
      const request = input as Request;
      seen.push({ url: request.url, authorization: request.headers.get("authorization") });
      return new Response("{}");
    },
  } as unknown as Window;
  installAccessToken("tok/en", browser);
  assert.equal(accessTokenInstalled(), true);
  await browser.fetch("/rpc");
  await browser.fetch("http://localhost:4710/api/access", { headers: { authorization: "Bearer other" } });
  await browser.fetch("https://example.org/data");
  assert.deepEqual(seen, [
    { url: "http://localhost:4710/rpc", authorization: "Bearer tok/en" },
    { url: "http://localhost:4710/api/access", authorization: "Bearer other" },
    { url: "https://example.org/data", authorization: null },
  ]);
  assert.equal(withAccessToken("/files/runs/run-a/artifacts/art-1"), "/files/runs/run-a/artifacts/art-1?access=tok%2Fen");
  assert.equal(withAccessToken("/apps/x/frame?revision=1"), "/apps/x/frame?revision=1&access=tok%2Fen");
  assert.throws(() => installAccessToken("again", browser), /bereits installiert/);
});

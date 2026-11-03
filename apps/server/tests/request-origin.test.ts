import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import { isSameOriginRequest, parseAllowedOrigins } from "../src/request-origin.ts";

const request = (headers: Record<string, string> = {}, encrypted = false): IncomingMessage =>
  ({ headers: { host: "acme.example:4710", ...headers }, socket: { encrypted } }) as unknown as IncomingMessage;

test("the host accepts its exact origin and native clients without an Origin", () => {
  assert.equal(isSameOriginRequest(request()), true);
  assert.equal(isSameOriginRequest(request({ origin: "http://acme.example:4710", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isSameOriginRequest(request({ origin: "https://acme.example:4710" }, true)), true);
  assert.equal(isSameOriginRequest(request({ origin: "https://acme.example:4710", "x-forwarded-proto": "https" })), true);
  for (const origin of ["https://foreign.example", "https://acme.example:4710", "http://acme.example:4711", "http://other.acme.example:4710", "null", "", "http://acme.example:4710/path", "http://user@acme.example:4710", "invalid"]) {
    assert.equal(isSameOriginRequest(request({ origin })), false, origin);
  }
  assert.equal(isSameOriginRequest(request({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(isSameOriginRequest(request({ origin: "http://acme.example:4710", "sec-fetch-site": "cross-site" })), false);
});

test("only explicit HTTP origins override the cross-site check", () => {
  const allowed = parseAllowedOrigins(["https://portal.example/", "HTTP://localhost:5710"]);
  assert.deepEqual(allowed, ["https://portal.example", "http://localhost:5710"]);
  assert.equal(isSameOriginRequest(request({ origin: "https://portal.example", "sec-fetch-site": "cross-site" }), allowed), true);
  assert.equal(isSameOriginRequest(request({ origin: "https://other.portal.example" }), allowed), false);
  assert.equal(isSameOriginRequest(request({ origin: "null" }), allowed), false);
  for (const value of ["*", "null", "vscode-webview://demo", "https://portal.example/path", "https://user:pass@portal.example", "https://portal.example?query", "https://portal.example#fragment", ""]) {
    assert.throws(() => parseAllowedOrigins([value]), /ALLOWED_ORIGINS needs HTTP or HTTPS origins/, value);
  }
});

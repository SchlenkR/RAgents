import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "@ragents/engine";
import { guardedJsonRoute, PayloadTooLargeError } from "../src/plugin-support/http.ts";
import { capturedJson } from "./runtime-fixture.ts";

test("plugin routes preserve domain status codes with their default error mapper", async () => {
  for (const error of [new DomainError("unavailable", "Run unavailable", 409), new PayloadTooLargeError(4096)]) {
    const { captured, response } = capturedJson();
    await guardedJsonRoute({ response, errorStatus: 500, handle: () => { throw error; } });
    assert.equal(captured.status, error.status);
    assert.deepEqual(captured.body, { error: error.message });
  }
});

test("plugin routes keep configured statuses for non-domain failures", async () => {
  for (const errorStatus of [undefined, 404, 500]) {
    const { captured, response } = capturedJson();
    await guardedJsonRoute({ response, errorStatus, handle: () => { throw new Error("Failed"); } });
    assert.equal(captured.status, errorStatus ?? 400);
    assert.deepEqual(captured.body, { error: "Failed" });
  }
});

test("plugin-specific error mapping retains control over status and public message", async () => {
  const { captured, response } = capturedJson();
  await guardedJsonRoute({
    response,
    mapError: () => ({ status: 502, message: "Upstream unavailable" }),
    handle: () => { throw new DomainError("upstream", "Private details", 404); },
  });
  assert.equal(captured.status, 502);
  assert.deepEqual(captured.body, { error: "Upstream unavailable" });
});

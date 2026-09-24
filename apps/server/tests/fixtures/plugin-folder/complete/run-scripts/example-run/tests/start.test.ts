import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.js";
test("setup records start", async () => {
  const context = createTestContext<{started?: boolean}>({state: {}});
  await program.onInput({id: "input", content: "", artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null}, context);
  assert.equal(context.state.read().started, true);
});

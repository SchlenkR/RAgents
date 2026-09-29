import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("adds entries without losing existing entries", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.append({"text": "  First entry  "}, context), {"text": "First entry", "entries": ["First entry"]});
  assert.deepEqual(await program.functions.append({"text": "Second entry"}, context), {"text": "Second entry", "entries": ["First entry", "Second entry"]});
  assert.deepEqual(context.state.read(), {"entries": ["First entry", "Second entry"]});
});

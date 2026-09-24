import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("ergänzt Einträge ohne vorhandene Einträge zu verlieren", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.append({"text": "  Erster Eintrag  "}, context), {"text": "Erster Eintrag", "entries": ["Erster Eintrag"]});
  assert.deepEqual(await program.functions.append({"text": "Zweiter Eintrag"}, context), {"text": "Zweiter Eintrag", "entries": ["Erster Eintrag", "Zweiter Eintrag"]});
  assert.deepEqual(context.state.read(), {"entries": ["Erster Eintrag", "Zweiter Eintrag"]});
});

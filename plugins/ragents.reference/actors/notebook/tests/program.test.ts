import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

const input = (content: string) => ({ id: "input-1", content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null });

test("keeps notes newest first and at most fifty", async () => {
  const context = createTestContext<{ notes?: string[] }>({ state: { notes: Array.from({ length: 50 }, (_, index) => `old ${index}`) } });
  await program.onInput!(input("  new note  "), context);
  const notes = context.state.read().notes!;
  assert.equal(notes.length, 50);
  assert.equal(notes[0], "new note");
  assert.equal(notes.at(-1), "old 48");
});

test("an empty note is refused and changes nothing", async () => {
  const context = createTestContext<{ notes?: string[] }>({ state: { notes: ["kept"] } });
  await assert.rejects(async () => program.onInput!(input("   "), context), /needs text/);
  assert.deepEqual(context.state.read(), { notes: ["kept"] });
});

test("clear empties the notebook and names how many notes it removed", async () => {
  const context = createTestContext<{ notes?: string[] }>({ state: { notes: ["one", "two"] } });
  assert.deepEqual(await program.functions.clear({}, context), { cleared: 2 });
  assert.deepEqual(context.state.read(), { notes: [] });
});

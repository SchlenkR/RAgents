import assert from "node:assert/strict";
import test from "node:test";
import program from "../src/server.ts";
import { setupContext, startInput } from "./helpers.ts";

test("Thema und Rundenzahl steuern Teilnehmer, Fläche und Auftrag", async () => {
  const { calls, context } = setupContext();
  await program.onInput!(startInput({ topic: "Teamfrühstück", rounds: 3 }), context);
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => (call.input as { handle: string }).handle), ["mira", "jon", "ada"]);
  assert.deepEqual(calls.find((call) => call.name === "run_configure")?.input, { title: "Gesprächsrunde: Teamfrühstück" });
  const layout = calls.find((call) => call.name === "canvas_layout_replace")?.input as { shapes: { text: string }[]; lines: unknown[] };
  assert.equal(layout.shapes[0].text, "Teamfrühstück");
  assert.equal(layout.lines.length, 4);
  assert.match(JSON.stringify(calls.at(-1)), /genau 3 Gesprächsrunden/);
  assert.deepEqual(context.state.read(), { built: true });
  const completedCalls = calls.length;
  await program.onInput!(startInput(null), context);
  assert.equal(calls.length, completedCalls);
});

test("null hat einen ausdrücklichen Standard, ungültige Werte lösen keine Wirkung aus", async () => {
  const initial = setupContext();
  await program.onInput!(startInput(null), initial.context);
  assert.match(JSON.stringify(initial.calls), /Sollten Innenstädte autofrei werden/);
  assert.match(JSON.stringify(initial.calls.at(-1)), /genau 2 Gesprächsrunden/);
  for (const input of [{ topic: "Plan" }, { topic: "", rounds: 2 }, { topic: "Plan", rounds: 6 }, { topic: "Plan", rounds: 1.5 }, { topic: "Plan", rounds: 2, extra: true }, "Plan"]) {
    const { calls, context } = setupContext();
    await assert.rejects(async () => program.onInput!(startInput(input), context), /Startwert braucht topic/);
    assert.deepEqual(calls, []);
    assert.deepEqual(context.state.read(), {});
  }
});

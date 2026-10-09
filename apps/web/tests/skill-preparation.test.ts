import assert from "node:assert/strict";
import test from "node:test";
import { guideOutcome } from "../src/StartEntryDialog.tsx";
import type { SkillStartEntry } from "../src/PluginRegistry.tsx";
import { preparedRunInput } from "../src/run-preparation.ts";

const skill: SkillStartEntry = {
  id: "example.skill", owner: "example", action: "skill", skill: "example", category: "Examples",
  title: "A skill", description: "A prepared task", prompt: "Create a list.", guide: "example.guide",
};

test("a skill guide leads to the preparation of the task it returned, not to a start", () => {
  assert.deepEqual(guideOutcome(skill, "Implement the selected feature."), { kind: "prepare", entry: skill, prompt: "Implement the selected feature." });
});

test("a skill guide without a task is an error and leads nowhere", () => {
  for (const value of [{ invalid: "No task" }, "", "   ", null]) assert.throws(() => guideOutcome(skill, value), /The guide for A skill must return a non-empty task/);
});

test("a run script guide starts with its value as the start input", () => {
  const entry = { id: "example.script", owner: "example", title: "Setup", description: "A script", action: "script" as const, coordinator: true, guide: "example.guide" };
  assert.deepEqual(guideOutcome(entry, { topic: "A topic" }), { kind: "start", value: { topic: "A topic" } });
});

test("edited and discussed tasks keep their skill when actually created", () => {
  const direct = preparedRunInput([], "  An entirely new task.  ", undefined, skill.skill);
  assert.equal(direct.text, "Use the skill example for this task.\n\nAn entirely new task.");
  const discussed = preparedRunInput([
    { role: "user", text: "A list, please." },
    { role: "assistant", text: "Which topic?" },
  ], "The shopping list.", undefined, skill.skill);
  assert.ok(discussed.text.startsWith("Use the skill example for this task.\n\n"));
  assert.ok(discussed.text.endsWith("User:\nThe shopping list."));
  assert.throws(() => preparedRunInput([], "", undefined, skill.skill), /empty/);
});

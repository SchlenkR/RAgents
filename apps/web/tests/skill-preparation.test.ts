import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentProps, ReactElement } from "react";
import { openStartEntry } from "../src/StartSelection.tsx";
import { RunPreparationChat } from "../src/RunPreparationChat.tsx";
import { PluginRegistry, type EntryGuideContext, type SessionContext, type SkillStartEntry } from "../src/PluginRegistry.tsx";
import { createModalController } from "../src/ui/modal-controller.ts";
import { preparedRunInput } from "../src/run-preparation.ts";

const skill: SkillStartEntry = {
  id: "example.skill", owner: "example", action: "skill", skill: "example", category: "Examples",
  title: "A skill", description: "A prepared task", prompt: "Create a list.",
};
const Guide = (_context: EntryGuideContext) => null;
const setup = () => {
  const registry = new PluginRegistry({ id: "test", brand: { title: "Test" }, startEntries: [skill],
    plugins: [{ id: "example", guides: [{ id: "example.guide", Guide }] }] });
  const modal = createModalController({ nextBehavior: () => "push", onClose: () => {} });
  const sessionRef = { current: {
    send: async () => { throw new Error("The preparation must not send a message."); },
    start: async () => { throw new Error("The preparation must not start a run."); },
  } as unknown as SessionContext };
  const run = async () => { throw new Error("A skill with a guide must not start a run directly."); };
  return { registry, modal, sessionRef, run };
};

test("a skill without a guide starts right away with its task, as in VS Code, without a preparation chat", () => {
  const { registry, modal, sessionRef } = setup();
  const calls: unknown[] = [];
  openStartEntry(skill, registry, modal, sessionRef, async (selected, value) => { calls.push([selected, value]); });
  assert.deepEqual(calls, [[skill, null]]);
  assert.equal(modal.getSnapshot().length, 1);
});

test("a skill guide leads to the preparation and starts no run even when completed twice", () => {
  const { registry, modal, sessionRef, run } = setup();
  openStartEntry({ ...skill, guide: "example.guide" }, registry, modal, sessionRef, run);
  const guidePage = modal.getSnapshot().at(-1)!.page!;
  const content = guidePage.render(modal) as ReactElement<EntryGuideContext>;
  assert.equal(content.type, Guide);
  assert.throws(() => content.props.onComplete({ invalid: "No task" }), /non-empty task/);
  assert.equal(modal.getSnapshot().at(-1)!.page, guidePage);
  content.props.onComplete("Implement the selected feature.");
  const preparation = modal.getSnapshot().at(-1)!.page!;
  const prepared = preparation.render(modal) as ReactElement<ComponentProps<typeof RunPreparationChat>>;
  assert.equal(prepared.type, RunPreparationChat);
  assert.equal(prepared.props.initialPrompt, "Implement the selected feature.");
  assert.equal(prepared.props.entry.skill, skill.skill);
  assert.equal(prepared.props.sessionRef, sessionRef, "the preparation chat starts through the template itself");
  assert.equal(modal.getSnapshot().length, 2);
  content.props.onComplete("A second task");
  assert.equal(modal.getSnapshot().at(-1)!.page, preparation);
});

test("cancelling a skill guide opens no preparation", () => {
  const { registry, modal, sessionRef, run } = setup();
  openStartEntry({ ...skill, guide: "example.guide" }, registry, modal, sessionRef, run);
  const content = modal.getSnapshot().at(-1)!.page!.render(modal) as ReactElement<EntryGuideContext>;
  content.props.onCancel();
  assert.equal(modal.getSnapshot().length, 1);
});

test("cancelling a guide notifies the caller after closing the guide so the draft can return to Start", () => {
  const { registry, modal, sessionRef, run } = setup();
  const cancellations: number[] = [];
  openStartEntry({ ...skill, guide: "example.guide" }, registry, modal, sessionRef, run,
    () => { cancellations.push(modal.getSnapshot().length); });
  const content = modal.getSnapshot().at(-1)!.page!.render(modal) as ReactElement<EntryGuideContext>;
  content.props.onCancel();
  assert.deepEqual(cancellations, [1], "The caller observes the guide already closed.");
  assert.equal(modal.getSnapshot().length, 1, "Cancelling does not open preparation or another template selection.");
});

test("run scripts still receive the guide value directly", () => {
  const { registry, modal, sessionRef } = setup();
  const calls: unknown[] = [];
  const entry = { id: "example.script", owner: "example", title: "Setup", description: "A script",
    action: "script" as const, coordinator: true, guide: "example.guide" };
  openStartEntry(entry, registry, modal, sessionRef, async (selected, value) => { calls.push([selected, value]); });
  const content = modal.getSnapshot().at(-1)!.page!.render(modal) as ReactElement<EntryGuideContext>;
  content.props.onComplete({ topic: "A topic" });
  assert.deepEqual(calls, [[entry, { topic: "A topic" }]]);
  assert.equal(modal.getSnapshot().length, 1);
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

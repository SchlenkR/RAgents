import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ComponentProps, type ReactElement } from "react";
import { openStartEntry } from "../src/StartSelection.tsx";
import { RunPreparationChat } from "../src/RunPreparationChat.tsx";
import { PluginRegistry, type EntryGuideContext, type SessionContext, type SkillStartEntry } from "../src/PluginRegistry.tsx";
import { createModalController } from "../src/ui/modal-controller.ts";
import { preparedRunInput } from "../src/run-preparation.ts";

const skill: SkillStartEntry = {
  id: "example.skill", owner: "example", action: "skill", skill: "example", category: "Beispiele",
  title: "Ein Skill", description: "Ein vorbereiteter Auftrag", prompt: "Erstelle eine Liste.",
};
const Guide = (_context: EntryGuideContext) => null;
const setup = () => {
  const registry = new PluginRegistry({ id: "test", brand: { title: "Test" }, startEntries: [skill],
    plugins: [{ id: "example", guides: [{ id: "example.guide", Guide }] }] });
  const modal = createModalController({ nextBehavior: () => "push", onClose: () => {} });
  const sessionRef = { current: {
    send: async () => { throw new Error("Die Vorbereitung darf keine Nachricht senden."); },
    start: async () => { throw new Error("Die Vorbereitung darf keinen Run starten."); },
  } as unknown as SessionContext };
  const run = async () => { throw new Error("Ein Skill darf keinen Run direkt starten."); };
  return { registry, modal, sessionRef, run };
};

test("ein Skill öffnet den bearbeitbaren Auftrag mit festem Skillbezug ohne Runstart", () => {
  const { registry, modal, sessionRef, run } = setup();
  openStartEntry(skill, registry, modal, sessionRef, run);
  const page = modal.getSnapshot().at(-1)!.page!;
  assert.equal(page.title, "Auftrag vorbereiten");
  const content = page.render(modal);
  assert.ok(isValidElement(content));
  assert.equal(content.type, RunPreparationChat);
  const props = (content as ReactElement<ComponentProps<typeof RunPreparationChat>>).props;
  assert.equal(props.initialPrompt, skill.prompt);
  assert.equal(props.entry, skill, "der Vorbereitungschat startet über die Vorlage selbst");
  assert.equal(props.sessionRef, sessionRef);
});

test("ein Skill-Leitfaden führt zur Vorbereitung und startet auch bei doppeltem Abschluss keinen Run", () => {
  const { registry, modal, sessionRef, run } = setup();
  openStartEntry({ ...skill, guide: "example.guide" }, registry, modal, sessionRef, run);
  const guidePage = modal.getSnapshot().at(-1)!.page!;
  const content = guidePage.render(modal) as ReactElement<EntryGuideContext>;
  assert.equal(content.type, Guide);
  assert.throws(() => content.props.onComplete({ invalid: "Kein Auftrag" }), /nicht leeren Auftrag/);
  assert.equal(modal.getSnapshot().at(-1)!.page, guidePage);
  content.props.onComplete("Setze das ausgewählte Feature um.");
  const preparation = modal.getSnapshot().at(-1)!.page!;
  const prepared = preparation.render(modal) as ReactElement<ComponentProps<typeof RunPreparationChat>>;
  assert.equal(prepared.type, RunPreparationChat);
  assert.equal(prepared.props.initialPrompt, "Setze das ausgewählte Feature um.");
  assert.equal(prepared.props.entry.skill, skill.skill);
  assert.equal(modal.getSnapshot().length, 2);
  content.props.onComplete("Ein zweiter Auftrag");
  assert.equal(modal.getSnapshot().at(-1)!.page, preparation);
});

test("Abbruch eines Skill-Leitfadens öffnet keine Vorbereitung", () => {
  const { registry, modal, sessionRef, run } = setup();
  openStartEntry({ ...skill, guide: "example.guide" }, registry, modal, sessionRef, run);
  const content = modal.getSnapshot().at(-1)!.page!.render(modal) as ReactElement<EntryGuideContext>;
  content.props.onCancel();
  assert.equal(modal.getSnapshot().length, 1);
});

test("Run-Scripts bekommen den Leitfadenwert weiter direkt", () => {
  const { registry, modal, sessionRef } = setup();
  const calls: unknown[] = [];
  const entry = { id: "example.script", owner: "example", title: "Aufbau", description: "Ein Script",
    action: "script" as const, coordinator: true, guide: "example.guide" };
  openStartEntry(entry, registry, modal, sessionRef, async (selected, value) => { calls.push([selected, value]); });
  const content = modal.getSnapshot().at(-1)!.page!.render(modal) as ReactElement<EntryGuideContext>;
  content.props.onComplete({ topic: "Ein Thema" });
  assert.deepEqual(calls, [[entry, { topic: "Ein Thema" }]]);
  assert.equal(modal.getSnapshot().length, 1);
});

test("bearbeitete und besprochene Aufträge behalten ihren Skill beim tatsächlichen Erstellen", () => {
  const direct = preparedRunInput([], "  Ein völlig neuer Auftrag.  ", undefined, skill.skill);
  assert.equal(direct.text, "Nutze den Skill example für diesen Auftrag.\n\nEin völlig neuer Auftrag.");
  const discussed = preparedRunInput([
    { role: "user", text: "Eine Liste bitte." },
    { role: "assistant", text: "Welches Thema?" },
  ], "Die Einkaufsliste.", undefined, skill.skill);
  assert.ok(discussed.text.startsWith("Nutze den Skill example für diesen Auftrag.\n\n"));
  assert.ok(discussed.text.endsWith("Benutzer:\nDie Einkaufsliste."));
  assert.throws(() => preparedRunInput([], "", undefined, skill.skill), /leer/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { canvasStartupState } from "../../../plugins/ragents.orchestration/web/canvas-startup.ts";
import { chatShowsContent } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-startup.ts";
import type { Message } from "../src/chat/types.ts";

const message = (role: Message["role"], text: string, extra: Partial<Message> = {}): Message => ({ key: `${role}-${text}`, role, text, closed: true, ...extra });

test("system lines and working steps keep the run panel in its loading state", () => {
  assert.equal(chatShowsContent([]), false);
  assert.equal(chatShowsContent([
    message("system", "Arbeitsbereich: /home/user/project"),
    message("thinking", "Plane den Aufbau", { closed: false }),
    message("tool", "", { tool: { id: "call-1", name: "read", arguments: "{}" } }),
    message("assistant", "  ", { closed: false }),
  ]), false);
});

test("a conversation turn or a question ends the loading state", () => {
  assert.equal(chatShowsContent([message("user", "Bitte loslegen")]), true);
  assert.equal(chatShowsContent([message("assistant", "Die Mini-App steht.")]), true);
  assert.equal(chatShowsContent([message("assistant", "", { attachments: [{ name: "plan.pdf", mediaType: "application/pdf", size: 10, url: "/files/plan.pdf" }] })]), true);
  assert.equal(chatShowsContent([message("action", "Weiterarbeiten?", { action: { actionId: "question-1", owner: "ragents.ask", payload: {} } })]), true);
});

test("an idle free run has nothing to wait for once its chat is connected", () => {
  const free = { view: undefined, startup: undefined, running: false, error: undefined };
  assert.equal(canvasStartupState({ ...free, connected: false })?.kind, "working");
  assert.equal(canvasStartupState({ ...free, connected: true }), undefined);
});

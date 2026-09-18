import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { AccessContext } from "../src/AccessContext";
import { ChatStepsProvider, PluginRegistry, useChatSteps, type SessionContext } from "../src/PluginRegistry";
import { ChatMessages } from "../src/chat/ChatMessages";
import type { Message } from "../src/chat/types";
import { attachmentCapabilityError } from "../src/chat/attachments";
import { StartSurface } from "../src/StartSurface";
import { StartOptionsProvider } from "../src/StartOptions";
import { createModalController, ModalControllerContext } from "../src/ui/modal-controller";
import { FlowInspector } from "../../../plugins/ragents.orchestration/web/FlowInspector";
import { ActorChat } from "../../../plugins/ragents.orchestration/web/ActorChat";
import type { RunActor, RunView } from "../../../plugins/ragents.orchestration/web/run-view";

const operator = createAccessContext({ enabled: true, user: {
  id: "operator", label: "Operator", rights: ["runs.read", "runs.write"], startEntries: ["example.sync"],
} });
const renderRestricted = (children: ReactNode) => renderToStaticMarkup(createElement(AccessContext.Provider, {
  value: { ...operator, logout: async () => {} }, children,
}));

test("restricted launch shows only the allowed setup without free composer or technical metadata", () => {
  const registry = new PluginRegistry({
    brand: { title: "Example" }, product: { id: "example", title: "Example" }, plugins: [{ id: "example" }],
    startEntries: [
      { id: "example.sync", owner: "example", action: "script", title: "Abgleichen", description: "Wähle die Projekte.", coordinator: false },
      { id: "example.other", owner: "example", action: "script", title: "Anderer Ablauf", description: "Andere Aufgabe", coordinator: true },
      { id: "example.skill", owner: "example", action: "skill", skill: "skill", category: "Frei", title: "Freier Auftrag", description: "Frei starten", prompt: "Privater Startauftrag" },
    ],
  });
  const session = { session: { id: "run", title: "Run", updatedAt: 0 }, send: async () => {}, start: async () => {} } as unknown as SessionContext;
  const modal = createModalController({ nextBehavior: () => "push", onClose: () => {} });
  const html = renderRestricted(createElement(ModalControllerContext.Provider, { value: modal },
    createElement(StartOptionsProvider, { connected: true, messageCount: 0, sessionId: "run" }, createElement(StartSurface, { registry, session }))));
  assert.match(html, /Abgleichen/);
  assert.match(html, />Starten<\/button>/);
  assert.doesNotMatch(html, /textarea|Anderer Ablauf|Freier Auftrag|Privater Startauftrag|Run-Script|start-source|Startoptionen/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Starten/);
});

test("restricted chat keeps messages and questions while suppressing technical steps", () => {
  const Conversation = () => {
    const steps = useChatSteps();
    assert.equal(steps.selectable, false);
    assert.equal(steps.stepsExpandable, false);
    assert.equal(steps.mode("agents"), "current");
    return createElement(ChatMessages, { detailMode: steps.mode("agents"), stepsExpandable: steps.stepsExpandable, running: true,
      renderTool: () => assert.fail("Restricted chat must not invoke technical tool renderers"),
      toolArgumentsText: () => assert.fail("Restricted chat must not format technical tool arguments"), messages: [
      { key: "user", role: "user", text: "Bitte starten" },
      { key: "answer", role: "assistant", text: "Ich gleiche die Projekte ab." },
      { key: "question", role: "question", text: "Welche Änderung behalten?", question: { callId: "ask", options: ["Unsere"] } },
      { key: "thinking", role: "thinking", text: "Privater Gedanke" },
      { key: "tool", role: "tool", text: "internal_tool", tool: { id: "tool", name: "internal_tool", arguments: "private_argument" } },
    ] });
  };
  const html = renderRestricted(createElement(ChatStepsProvider, {
    policy: { modes: { coordinator: "full", agents: "full" }, selectable: true, stepsExpandable: true, stepsVisible: true },
  }, createElement(Conversation)));
  assert.match(html, /Bitte starten/);
  assert.match(html, /Ich gleiche die Projekte ab/);
  assert.match(html, /Welche Änderung behalten/);
  assert.match(html, /data-state="running"[^>]*title="Werkzeug läuft"/);
  assert.ok(html.includes(">Werkzeug läuft</span>"));
  assert.match(html, /data-chat="working" role="status"/);
  assert.doesNotMatch(html, /Privater Gedanke|internal_tool|private_argument|aria-haspopup="dialog"|role="dialog"|data-step="detail"/);
});

test("restricted step policy respects hidden steps and explicit off for each scope", () => {
  const cases = [
    { policy: { modes: { coordinator: "current", agents: "current" } as const, selectable: true, stepsExpandable: true, stepsVisible: false }, expected: ["off", "off"] },
    { policy: { modes: { coordinator: "off", agents: "full" } as const, selectable: true, stepsExpandable: true, stepsVisible: true }, expected: ["off", "current"] },
    { policy: { modes: { coordinator: "full", agents: "off" } as const, selectable: true, stepsExpandable: true, stepsVisible: true }, expected: ["current", "off"] },
  ];
  for (const entry of cases) {
    const Probe = () => {
      const steps = useChatSteps();
      assert.deepEqual([steps.mode("coordinator"), steps.mode("agents")], entry.expected);
      assert.equal(steps.selectable, false);
      assert.equal(steps.stepsExpandable, false);
      return null;
    };
    renderRestricted(createElement(ChatStepsProvider, { policy: entry.policy }, createElement(Probe)));
  }
});

test("restricted actor chat shows empty redacted phase chips and working scenes without an inspect right", () => {
  const actor = { id: "agent", handle: "helper", displayName: "Helfer", kind: "agent", grants: [], lifecycle: { kind: "running", turnId: "turn", inputId: "input" } } as unknown as RunActor;
  const view = { id: "run", ownerId: "owner", primaryActorId: actor.id, actors: [actor], inputs: [], turns: [], actions: [], subscriptions: [], artifacts: [], pluginStates: [] } as unknown as RunView;
  const policy = { modes: { coordinator: "current", agents: "current" } as const, selectable: false, stepsExpandable: false, stepsVisible: true };
  const cases: { message: Message; label: string }[] = [
    { message: { key: "thinking", role: "thinking", text: "" }, label: "Denken" },
    { message: { key: "tool", role: "tool", text: "", tool: { id: "tool", name: "", arguments: "" } }, label: "Werkzeug läuft" },
  ];
  for (const { message, label } of cases) {
    const html = renderRestricted(createElement(ChatStepsProvider, { policy }, createElement(ActorChat, {
      actor, view, presentation: "canvas", primaryMessages: [message], running: true, onNavigate: () => {},
    })));
    assert.match(html, /data-step="row"/);
    assert.match(html, /data-step="chip"/);
    assert.ok(html.includes(`>${label}</span>`));
    assert.match(html, /data-chat="working" role="status"/);
    assert.doesNotMatch(html, /<button|aria-haspopup|role="dialog"|data-step="detail"/);
  }
});

test("restricted actor popout has a working composer without technical inspector tabs", () => {
  const actor = { id: "agent", handle: "helper", displayName: "Helfer", kind: "agent", grants: [], lifecycle: { kind: "idle" },
    prompt: "Private instructions", toolNames: ["internal_tool"], execution: { driver: { kind: "agent", config: { model: "private-model", provider: "private-provider" } } },
  } as unknown as RunActor;
  const view = { id: "run", ownerId: "owner", primaryActorId: actor.id, actors: [actor], inputs: [], turns: [], actions: [], subscriptions: [], artifacts: [], pluginStates: [] } as unknown as RunView;
  const html = renderRestricted(createElement(FlowInspector, { view, selection: { type: "actor", id: actor.id },
    canGoBack: false, composerVisible: true, onNavigate: () => {}, onBack: () => {}, primaryMessages: [], primaryRunning: false,
  }));
  assert.match(html, /Helfer/);
  assert.match(html, /textarea/);
  assert.doesNotMatch(html, /private-model|private-provider|Private instructions|internal_tool|Actor-Ansichten|Quelltext|Denktiefe|Kosten/);
});

test("attachment rejection with a hidden model gives an actionable message without model controls", () => {
  const error = attachmentCapabilityError([{ name: "photo.png", mediaType: "image/png" }], { input: ["text"], model: "" });
  assert.match(error ?? "", /photo.png.*Entferne den Anhang/);
  assert.doesNotMatch(error ?? "", /Modell/);
});

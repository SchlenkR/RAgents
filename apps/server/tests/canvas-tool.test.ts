import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import type { RunView, ToolScope } from "@ragents/engine";

import { canvasLayoutOf } from "../../../plugins/ragents.orchestration/contract.ts";
import { canvasTileNodeOf } from "../../../plugins/ragents.orchestration/tiled-layout.ts";
import { createRunContextDeclarations } from "../../../packages/ragents/src/typescript/run-context.ts";
import { compileVirtualTypeScript } from "../../../packages/ragents/src/typescript/compiler.ts";
import { ACTOR_PROGRAMS_STATE_ID } from "../../../apps/server/src/plugin-support/actor-programs/contract.ts";
import { serverApiDeclarations } from "../../../apps/server/src/plugin-support/actor-programs/app-project.ts";
import { checkLayoutAgainstRun, createCanvasTool } from "../../../plugins/ragents.orchestration/server/canvas-tool.ts";
import { ToolRegistry } from "../../../packages/ragents/src/agents/plugins.ts";
import { describeToolAvailability } from "../../../packages/ragents/src/agents/tools.ts";
import { TurnToolset } from "../../../packages/ragents/src/agents/toolset.ts";
import { claimTurn } from "../../../packages/ragents/src/agents/turn.ts";
import { allGrants, catalog, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";

test("the Canvas plugin declares and enforces the required state grant for both actor behaviors", () => {
  const setup = setupRun();
  try {
    const tool = createCanvasTool();
    assert.deepEqual(describeToolAvailability(tool.available).requiredCapabilities, ["plugin.state.write"]);
    assert.equal(tool.available(setup.agent, setup.view), false);
    const grants = allGrants();
    assert.equal(tool.available({...setup.agent, grants}, setup.view), true);
    const view = setup.runtime.createScriptActor({actorId: setup.view.ownerId, commandId: "script"}, setup.view.id, {
      handle: "canvas", displayName: "Canvas", grants: [], toolNames: [],
    });
    const script = view.actors.find((entry) => entry.kind === "script")!;
    assert.equal(tool.available(script, view), false);
    assert.equal(tool.available({...script, grants}, view), true);
  } finally { setup.journal.close(); }
});

const actor = (id: string, handle: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "agent",
  handle,
  displayName: handle,
  grants: [],
  createdAt: "2026-09-03T10:00:00Z",
  lifecycle: { kind: "idle", since: "2026-09-03T10:00:00Z" },
  ...extra,
});

const view = {
  id: "run-1",
  ownerId: "human",
  pluginStates: [],
  actors: [
    actor("human", "owner", { kind: "human" }),
    actor("k", "koordinator"),
    actor("a1", "anna", { createdBy: "k" }),
    actor("s1", "router", { kind: "script", createdBy: "a1" }),
    actor("old", "bert", { createdBy: "k", lifecycle: { kind: "stopped", stoppedAt: "2026-09-03T10:01:00Z", reason: "fertig" } }),
    actor("b2", "bert", { createdBy: "k" }),
  ],
} as unknown as RunView;

const replaced = (input: unknown, runView = view, onStore?: () => void): unknown => {
  let stored: unknown;
  const scope = {
    runtime: {
      view: () => runView,
      replacePluginState: (_context: unknown, _runId: string, request: { state: unknown; scope: unknown }) => {
        onStore?.();
        stored = request;
      },
    },
    caller: { runId: "run-1", actorId: "k", turnId: null },
    context: () => ({}),
    eventsFor: () => [],
  } as unknown as ToolScope;
  createCanvasTool().run(scope, "call-1", input as never);
  return stored;
};

test("canvas_layout_replace nimmt eine geschachtelte Kachelaufteilung an und speichert sie im Run-Scope", () => {
  const input = {
    root: {
      direction: "vertical",
      weights: [2, 1],
      children: [
        { entity: "@Anna", chatInput: false },
        { direction: "horizontal", weights: [1, 1], children: [{ entity: "@bert" }, { entity: "@router" }] },
      ],
    },
  };
  assert.equal(Value.Check(createCanvasTool().schema, input), true);
  assert.deepEqual(replaced(input), {
    pluginId: "ragents.orchestration",
    scope: { kind: "run" },
    state: canvasLayoutOf(input),
  });
});

test("das Schema verlangt root und kennt keine Gruppen, Formen oder Linien mehr", () => {
  const schema = createCanvasTool().schema;
  assert.equal(Value.Check(schema, {}), false);
  assert.equal(Value.Check(schema, { root: null }), true);
  assert.equal(Value.Check(schema, { nodes: [{ entity: "@anna" }] }), false);
  assert.equal(Value.Check(schema, { root: { entity: "@anna", group: "h" } }), false);
  assert.equal(Value.Check(schema, { root: { direction: "horizontal", weights: [1, 1], children: [{ entity: "@a" }] } }), false);
  assert.equal(Value.Check(schema, { root: { direction: "ring", weights: [1, 1], children: [{ entity: "@a" }, { entity: "@b" }] } }), false);
});

test("ein Aufruf mit den Altschlüsseln des freien Canvas wird abgewiesen", () => {
  const noStore = () => assert.fail("Eine Altanordnung darf nichts speichern");
  for (const input of [{ nodes: [{ entity: "@anna" }] }, { root: null, shapes: [] }, { root: null, lines: [] }, { root: null, mode: "tiled" }]) {
    assert.throws(() => replaced(input, view, noStore), /entfernten freien Canvas/);
  }
});

test("canvasLayoutOf weist einen Altzustand mit einer klaren Meldung ab", () => {
  assert.throws(() => canvasLayoutOf({ nodes: [], shapes: [], lines: [], mode: "free" }),
    /Die Programmanordnung stammt aus dem entfernten freien Canvas \(nodes, shapes, lines, mode\); canvas_layout_replace mit root setzt sie als Kachelaufteilung neu/);
  assert.throws(() => canvasLayoutOf({}), /root fehlt/);
  assert.deepEqual(canvasLayoutOf({ root: null }), { root: null });
});

test("Actors muessen im Lauf existieren, der Mensch bleibt im Chat", () => {
  assert.throws(() => replaced({ root: { entity: "@niemand" } }), /@niemand ist kein Actor dieses Laufs. Vorhanden: @koordinator, @anna/);
  assert.throws(() => replaced({ root: { entity: "@owner" } }), /Mensch im Chat/);
});

const wizardView = (actorId = "a1", program: unknown = {
  name: "balkon-wizard",
  actorHandle: "anna",
  views: [{ id: "balkon-wizard--wizard", key: "wizard", title: "Balkon-Wizard", visible: true }],
}): RunView => ({
  ...view,
  pluginStates: [{ pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId }, state: { version: 1, program } }],
}) as RunView;

test("Canvas löst gewählte Programm- und Actor-Namen für Ansichten serverseitig auf", () => {
  for (const reference of ["app:balkon-wizard/wizard", "app:@anna/wizard", "app:balkon-wizard--wizard", "app:@ANNA/WIZARD", "app:Balkon-Wizard"]) {
    const input = { root: { entity: reference } };
    assert.deepEqual(replaced(input, wizardView()), {
      pluginId: "ragents.orchestration",
      scope: { kind: "run" },
      state: canvasLayoutOf({ root: { entity: "app:balkon-wizard--wizard" } }),
    });
    assert.equal(input.root.entity, reference);
  }
});

test("Canvas weist unbekannte oder nicht mehr aktive Ansichten vor jeder Speicherung zurück", () => {
  const noStore = () => assert.fail("Ungültige Ansichten dürfen den gespeicherten Canvas nicht ersetzen");
  const input = { root: { entity: "app:balkon-wizard/wizard" } };
  assert.throws(() => replaced(input, view, noStore), /keine aktive Actor-Ansicht.*Zuerst das Programm aktivieren.*keine/);
  assert.throws(() => replaced(input, wizardView("old"), noStore), /keine aktive Actor-Ansicht/);
  assert.throws(() => replaced(input, wizardView("a1", null), noStore), /keine aktive Actor-Ansicht/);
  assert.throws(() => replaced({ root: { entity: "app:balkon-wizard/missing" } }, wizardView(), noStore), /Vorhanden: balkon-wizard\/wizard \(@anna\/wizard\)/);
});

test("Canvas meldet mehrdeutige Titel mit gültigen Namen und priorisiert eindeutige Referenzen", () => {
  const runView = wizardView("a1", {
    name: "balkon-wizard", actorHandle: "anna",
    views: [
      { id: "balkon-wizard--wizard", key: "wizard", title: "Wizard" },
      { id: "balkon-wizard--summary", key: "summary", title: "Wizard" },
      { id: "balkon-wizard--other", key: "other", title: "balkon-wizard/wizard" },
    ],
  });
  assert.throws(() => replaced({ root: { entity: "app:Wizard" } }, runView, () => assert.fail("Mehrdeutiger Canvas darf nicht gespeichert werden")),
    /mehrdeutig.*balkon-wizard\/wizard \(@anna\/wizard\).*balkon-wizard\/summary \(@anna\/summary\)/);
  const layout = checkLayoutAgainstRun(runView, canvasLayoutOf({ root: { entity: "app:balkon-wizard/wizard" } }));
  assert.deepEqual(layout.root, { entity: "app:balkon-wizard--wizard" });
});

test("ein neuer Aufruf ersetzt den gespeicherten Zustand vollständig, auch einen Altzustand", () => {
  const runView = wizardView();
  const withState = (state: unknown) => ({ ...runView, pluginStates: [...runView.pluginStates, {
    pluginId: "ragents.orchestration", scope: { kind: "run" }, state,
  }] }) as RunView;
  const root = { direction: "vertical", weights: [1, 1], children: [
    { entity: "@koordinator" },
    { direction: "horizontal", weights: [2, 1], children: [{ entity: "app:@anna/wizard" }, { entity: "@bert" }] },
  ] };
  const legacy = { nodes: [{ entity: "@anna" }], shapes: [], lines: [], mode: "free" };
  const expected = { root: { ...root, children: [root.children[0], {
    ...root.children[1], children: [{ entity: "app:balkon-wizard--wizard" }, { entity: "@bert" }],
  }] } };
  assert.deepEqual((replaced({ root }, withState(legacy)) as { state: unknown }).state, expected);
  assert.deepEqual((replaced({ root: null }, withState(legacy)) as { state: unknown }).state, { root: null });
});

test("Kachel-Eingaben werden vor dem Speichern vollständig geprüft", () => {
  const split = (children: unknown[], weights: unknown[] = [2, 1]) => ({ direction: "horizontal", weights, children });
  const noStore = () => assert.fail("Ungültige Kacheln dürfen nicht gespeichert werden");
  for (const root of [
    split([{ entity: "@anna" }, { entity: "@ANNA" }]),
    split([{ entity: "app:@anna/wizard" }, { entity: "app:balkon-wizard/wizard" }]),
    { entity: "@missing" }, { entity: "@owner" }, { entity: "app:missing/view" }, { entity: "shape:x" },
    split([{ entity: "@anna" }, { entity: "@bert" }], [0, 1]),
    split([{ entity: "@anna" }, { entity: "@bert" }], [Infinity, 1]),
    split([{ entity: "@anna" }, { entity: "@bert" }], [NaN, 1]),
    split([{ entity: "@anna" }]),
    { entity: "@anna", direction: "horizontal" },
  ]) {
    assert.throws(() => replaced({ root }, wizardView(), noStore));
  }
  const deep = Array.from({ length: 17 }).reduce<unknown>((root, _, index) => split([{ entity: `@helper-${index}` }, root]), { entity: "@anna" });
  assert.throws(() => canvasTileNodeOf(deep), /verschachtelte Teilungen/);
});

test("die generierte TypeScript-API prüft beliebig geschachtelte Kacheln", () => {
  const tool = createCanvasTool();
  const capabilities = [{ id: tool.name, label: tool.label, description: tool.description, schema: tool.schema, resultSchema: tool.resultSchema }];
  const declarations = createRunContextDeclarations({
    stateType: "unknown",
    capabilities,
    program: "declare const context: RunContext;",
  });
  for (const module of [false, true]) {
    const compile = (entity: string) => compileVirtualTypeScript({
      sources: [{ fileName: "main.ts", text: `${module ? "import type {RunContext} from './runtime.js'; declare const context: RunContext<unknown>;" : ""} context.functions.canvas_layout_replace({mode:'tiled',root:{direction:'vertical',weights:[1,1],children:[{entity:'@top'},{direction:'horizontal',weights:[2,1],children:[{entity:'app:@owner/main'},{entity:${entity}}]}]}});` }],
      declarations: [
        { fileName: "runtime.d.ts", text: module ? serverApiDeclarations(capabilities) : declarations },
        { fileName: "typebox.d.ts", text: "declare module 'typebox' { export type TSchema = unknown; export type Static<T> = unknown; }" },
      ],
    });
    const valid = compile("'@helper'");
    assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
    assert.equal(compile("123").valid, false);
  }
});


test("chatInput bleibt ein optionaler Wahrheitswert an Actor-Kacheln", () => {
  const input = { root: { entity: "@Anna", chatInput: false } };
  assert.equal(Value.Check(createCanvasTool().schema, input), true);
  const layout = canvasLayoutOf(input);
  assert.deepEqual(layout.root, { entity: "@anna", chatInput: false });
  assert.deepEqual(replaced(input), { pluginId: "ragents.orchestration", scope: { kind: "run" }, state: layout });
  assert.deepEqual(canvasLayoutOf({ root: { entity: "@anna", chatInput: true } }).root, { entity: "@anna", chatInput: true });
  assert.deepEqual(canvasLayoutOf({ root: { entity: "@anna" } }).root, { entity: "@anna" });
  for (const chatInput of [null, "false", 0]) {
    const invalid = { root: { entity: "@anna", chatInput } };
    assert.equal(Value.Check(createCanvasTool().schema, invalid), false);
    assert.throws(() => canvasLayoutOf(invalid), /chatInput/);
  }
  assert.throws(() => canvasLayoutOf({ root: { entity: "app:example/main", chatInput: false } }), /chatInput/);
});

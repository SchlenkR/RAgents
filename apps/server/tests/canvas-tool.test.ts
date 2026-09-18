import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import type { RunView, ToolScope } from "@aicontainer/ragents";

import { canvasLayoutOf } from "../../../plugins/ragents.orchestration/contract.ts";
import { canvasTileNodeOf } from "../../../plugins/ragents.orchestration/tiled-layout.ts";
import { createRunContextDeclarations } from "../../../packages/ragents/src/typescript/run-context.ts";
import { compileVirtualTypeScript } from "../../../packages/ragents/src/typescript/compiler.ts";
import { ACTOR_PROGRAMS_STATE_ID } from "../../../plugins/ragents.actor-programs/contract.ts";
import { serverApiDeclarations } from "../../../plugins/ragents.actor-programs/server/app-project.ts";
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

test("canvas_layout_replace nimmt ein geschachteltes Layout an und speichert es im Run-Scope", () => {
  const input = {
    nodes: [
      { id: "runde", group: "circle", label: "Diskussion", frame: true },
      { entity: "@Anna", parent: "runde" },
      { entity: "@bert", parent: "runde" },
      { entity: "shape:thema", parent: "runde" },
      { id: "rest", group: "wrap-h", width: 800 },
      { id: "team", group: "tree", root: "@router", parent: "rest" },
    ],
    shapes: [{ id: "thema", kind: "diamond", text: "Thema" }],
    lines: [{ from: "@anna", to: "@bert", arrow: "both", style: "dashed", label: "streiten" }],
  };
  assert.equal(Value.Check(createCanvasTool().schema, input), true);
  assert.deepEqual(replaced(input), {
    pluginId: "ragents.orchestration",
    scope: { kind: "run" },
    state: canvasLayoutOf(input),
  });
});

test("das Schema verlangt gueltige Gruppenarten, Formen und Pfeile", () => {
  const schema = createCanvasTool().schema;
  assert.equal(Value.Check(schema, { nodes: [{ id: "x", group: "ring" }] }), false);
  assert.equal(Value.Check(schema, { nodes: [], shapes: [{ id: "s", kind: "square", text: "T" }] }), false);
  assert.equal(Value.Check(schema, { nodes: [], lines: [{ from: "@a", to: "@b", arrow: "start" }] }), false);
  assert.equal(Value.Check(schema, { nodes: [{ id: "w", group: "wrap-h", width: 0 }] }), false);
});

test("Actors muessen im Lauf existieren, der Mensch bleibt im Chat", () => {
  assert.throws(() => replaced({ nodes: [{ entity: "@niemand" }] }), /@niemand ist kein Actor dieses Laufs. Vorhanden: @koordinator, @anna/);
  assert.throws(() => replaced({ nodes: [{ entity: "@owner" }] }), /Mensch im Chat/);
  assert.throws(() => replaced({ nodes: [], lines: [{ from: "@anna", to: "@fremd" }] }), /lines\[0\].to: @fremd/);
  assert.throws(() => replaced({ nodes: [{ id: "w", group: "wrap-h" }] }), /width/);
});

test("ein Baum duldet keine doppelt platzierten Nachkommen und keinen Baum in seiner Abstammung", () => {
  const tree = (root: string, id = "t") => ({ id, group: "tree", root });
  assert.throws(() => checkLayoutAgainstRun(view, canvasLayoutOf({ nodes: [tree("@koordinator"), { entity: "@router" }] })), /@router gehört zur Abstammung von @koordinator/);
  assert.throws(() => checkLayoutAgainstRun(view, canvasLayoutOf({ nodes: [tree("@anna"), { entity: "@anna" }] })), /Wurzel @anna ist zusätzlich/);
  assert.throws(() => checkLayoutAgainstRun(view, canvasLayoutOf({ nodes: [tree("@koordinator", "a"), tree("@anna", "b")] })), /Baum b: @anna liegt schon im Baum a/);
  checkLayoutAgainstRun(view, canvasLayoutOf({ nodes: [tree("@anna"), { entity: "@bert" }] }));
});

const wizardView = (actorId = "a1", program: unknown = {
  name: "balkon-wizard",
  actorHandle: "anna",
  views: [{ id: "balkon-wizard--wizard", key: "wizard", title: "Balkon-Wizard", visible: true }],
}): RunView => ({
  ...view,
  pluginStates: [{ pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId }, state: { version: 1, program } }],
}) as RunView;

test("Canvas löst gewählte Programm- und Actor-Namen für Ansichten und Linien serverseitig auf", () => {
  for (const reference of ["app:balkon-wizard/wizard", "app:@anna/wizard", "app:balkon-wizard--wizard", "app:@ANNA/WIZARD", "app:Balkon-Wizard"]) {
    const input = { nodes: [{ entity: reference }], lines: [{ from: "@koordinator", to: reference }] };
    assert.deepEqual(replaced(input, wizardView()), {
      pluginId: "ragents.orchestration",
      scope: { kind: "run" },
      state: canvasLayoutOf({
        nodes: [{ entity: "app:balkon-wizard--wizard" }],
        lines: [{ from: "@koordinator", to: "app:balkon-wizard--wizard" }],
      }),
    });
    assert.equal(input.nodes[0].entity, reference);
  }
});

test("Canvas weist unbekannte oder nicht mehr aktive Ansichten vor jeder Speicherung zurück", () => {
  const noStore = () => assert.fail("Ungültige Ansichten dürfen den gespeicherten Canvas nicht ersetzen");
  const input = { nodes: [{ entity: "app:balkon-wizard/wizard" }] };
  assert.throws(() => replaced(input, view, noStore), /keine aktive Actor-Ansicht.*Zuerst das Programm aktivieren.*keine/);
  assert.throws(() => replaced(input, wizardView("old"), noStore), /keine aktive Actor-Ansicht/);
  assert.throws(() => replaced(input, wizardView("a1", null), noStore), /keine aktive Actor-Ansicht/);
  assert.throws(() => replaced({ nodes: [{ entity: "app:balkon-wizard/missing" }] }, wizardView(), noStore), /Vorhanden: balkon-wizard\/wizard \(@anna\/wizard\)/);
  for (const side of ["from", "to"]) {
    assert.throws(() => replaced({ nodes: [], lines: [{ from: "@anna", to: "@bert", [side]: "app:missing/view" }] }, wizardView(), noStore),
      new RegExp(`lines\\[0\\].${side}: app:missing/view`));
  }
});

test("Canvas prüft doppelte Platzierung und Selbstverbindungen nach der Namensauflösung", () => {
  const aliases = ["app:@anna/wizard", "app:balkon-wizard/wizard"];
  assert.throws(() => replaced({ nodes: aliases.map((entity) => ({ entity })) }, wizardView()), /mehrfach|mehr als einmal|doppelt/);
  assert.throws(() => replaced({ nodes: [], lines: [{ from: aliases[0], to: aliases[1] }] }, wizardView()), /zu sich selbst/);
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
  assert.throws(() => replaced({ nodes: [{ entity: "app:Wizard" }] }, runView, () => assert.fail("Mehrdeutiger Canvas darf nicht gespeichert werden")),
    /mehrdeutig.*balkon-wizard\/wizard \(@anna\/wizard\).*balkon-wizard\/summary \(@anna\/summary\)/);
  const layout = checkLayoutAgainstRun(runView, canvasLayoutOf({ nodes: [{ entity: "app:balkon-wizard/wizard" }] }));
  assert.deepEqual(layout.nodes, [{ entity: "app:balkon-wizard--wizard" }]);
});

test("Kacheln lösen App-Namen auf und bewahren beim Moduswechsel die freie Anordnung", () => {
  const free = canvasLayoutOf({
    nodes: [{ entity: "@anna" }, { entity: "shape:topic" }],
    shapes: [{ id: "topic", kind: "circle", text: "Thema" }],
    lines: [{ from: "@anna", to: "shape:topic" }],
  });
  const root = { direction: "vertical", weights: [1, 1], children: [
    { entity: "@koordinator" },
    { direction: "horizontal", weights: [2, 1], children: [{ entity: "app:@anna/wizard" }, { entity: "@bert" }] },
  ] };
  const runView = wizardView();
  const withState = (state: unknown) => ({ ...runView, pluginStates: [...runView.pluginStates, {
    pluginId: "ragents.orchestration", scope: { kind: "run" }, state,
  }] }) as RunView;
  assert.equal(Value.Check(createCanvasTool().schema, { mode: "tiled", root }), true);
  const tiled = (replaced({ mode: "tiled", root }, withState(free)) as { state: unknown }).state;
  const expected = { ...free, mode: "tiled", root: { ...root, children: [root.children[0], {
    ...root.children[1], children: [{ entity: "app:balkon-wizard--wizard" }, { entity: "@bert" }],
  }] } };
  assert.deepEqual(tiled, expected);
  const restored = (replaced({ mode: "free" }, withState(tiled)) as { state: unknown }).state;
  assert.deepEqual(restored, { ...expected, mode: "free" });
  assert.deepEqual((replaced({ mode: "tiled" }, withState(restored)) as { state: unknown }).state, expected);
  assert.deepEqual((replaced({ root: null }, withState(tiled)) as { state: unknown }).state, { ...free, mode: "tiled", root: null });
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
    assert.throws(() => replaced({ mode: "tiled", root }, wizardView(), noStore));
  }
  const deep = Array.from({ length: 17 }).reduce<unknown>((root, _, index) => split([{ entity: `@helper-${index}` }, root]), { entity: "@anna" });
  assert.throws(() => canvasTileNodeOf(deep), /verschachtelte Teilungen/);
  assert.throws(() => replaced({ mode: "tiled", shapes: [] }, wizardView(), noStore), /zusammen mit nodes/);
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


test("actor chat input is an optional boolean retained in both canvas modes", () => {
  for (const mode of ["free", "tiled"] as const) {
    const input = { mode, root: { entity: "@anna" }, nodes: [{ entity: "@Anna", chatInput: false }] };
    assert.equal(Value.Check(createCanvasTool().schema, input), true);
    const layout = canvasLayoutOf(input);
    assert.deepEqual(layout.nodes, [{ entity: "@anna", chatInput: false }]);
    assert.deepEqual(replaced(input), { pluginId: "ragents.orchestration", scope: { kind: "run" }, state: layout });
  }
  assert.deepEqual(canvasLayoutOf({ nodes: [{ entity: "@anna", chatInput: true }] }).nodes, [{ entity: "@anna", chatInput: true }]);
  assert.deepEqual(canvasLayoutOf({ nodes: [{ entity: "@anna" }] }).nodes, [{ entity: "@anna" }]);
  for (const chatInput of [null, "false", 0]) {
    const input = { nodes: [{ entity: "@anna", chatInput }] };
    assert.equal(Value.Check(createCanvasTool().schema, input), false);
    assert.throws(() => canvasLayoutOf(input), /chatInput/);
  }
  for (const node of [{ entity: "app:example/main" }, { entity: "shape:example" }, { id: "group", group: "h" }]) {
    assert.throws(() => canvasLayoutOf({ nodes: [{ ...node, chatInput: false }] }), /chatInput/);
  }
});

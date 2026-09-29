import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import type { RunView, ToolScope } from "@ragents/engine";

import { surfaceLayoutOf } from "../../../plugins/ragents.orchestration/contract.ts";
import { surfaceTileNodeOf } from "../../../plugins/ragents.orchestration/tiled-layout.ts";
import { createRunContextDeclarations } from "../../../packages/ragents/src/typescript/run-context.ts";
import { compileVirtualTypeScript } from "../../../packages/ragents/src/typescript/compiler.ts";
import { ACTOR_PROGRAMS_STATE_ID } from "../../../apps/server/src/plugin-support/actor-programs/contract.ts";
import { serverApiDeclarations } from "../../../apps/server/src/plugin-support/actor-programs/app-project.ts";
import { checkLayoutAgainstRun, createSurfaceTool } from "../../../plugins/ragents.orchestration/server/surface-tool.ts";
import { ToolRegistry } from "../../../packages/ragents/src/agents/plugins.ts";
import { describeToolAvailability } from "../../../packages/ragents/src/agents/tools.ts";
import { TurnToolset } from "../../../packages/ragents/src/agents/toolset.ts";
import { claimTurn } from "../../../packages/ragents/src/agents/turn.ts";
import { allGrants, catalog, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";

test("the surface tool declares and enforces the required state grant for both actor behaviors", () => {
  const setup = setupRun();
  try {
    const tool = createSurfaceTool();
    assert.deepEqual(describeToolAvailability(tool.available).requiredCapabilities, ["plugin.state.write"]);
    assert.equal(tool.available(setup.agent, setup.view), false);
    const grants = allGrants();
    assert.equal(tool.available({...setup.agent, grants}, setup.view), true);
    const view = setup.runtime.createScriptActor({actorId: setup.view.ownerId, commandId: "script"}, setup.view.id, {
      handle: "surface", displayName: "Surface", grants: [], toolNames: [],
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
    actor("k", "coordinator"),
    actor("a1", "anna", { createdBy: "k" }),
    actor("s1", "router", { kind: "script", createdBy: "a1" }),
    actor("old", "bert", { createdBy: "k", lifecycle: { kind: "stopped", stoppedAt: "2026-09-03T10:01:00Z", reason: "done" } }),
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
  createSurfaceTool().run(scope, "call-1", input as never);
  return stored;
};

test("canvas_layout_replace accepts a nested tile layout and stores it in the run scope", () => {
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
  assert.equal(Value.Check(createSurfaceTool().schema, input), true);
  assert.deepEqual(replaced(input), {
    pluginId: "ragents.orchestration",
    scope: { kind: "run" },
    state: surfaceLayoutOf(input),
  });
});

test("the schema requires root and no longer knows groups, shapes or lines", () => {
  const schema = createSurfaceTool().schema;
  assert.equal(Value.Check(schema, {}), false);
  assert.equal(Value.Check(schema, { root: null }), true);
  assert.equal(Value.Check(schema, { nodes: [{ entity: "@anna" }] }), false);
  assert.equal(Value.Check(schema, { root: { entity: "@anna", group: "h" } }), false);
  assert.equal(Value.Check(schema, { root: { direction: "horizontal", weights: [1, 1], children: [{ entity: "@a" }] } }), false);
  assert.equal(Value.Check(schema, { root: { direction: "ring", weights: [1, 1], children: [{ entity: "@a" }, { entity: "@b" }] } }), false);
});

test("a call with the legacy keys of the free surface is rejected", () => {
  const noStore = () => assert.fail("A legacy arrangement must not store anything");
  for (const input of [{ nodes: [{ entity: "@anna" }] }, { root: null, shapes: [] }, { root: null, lines: [] }, { root: null, mode: "tiled" }]) {
    assert.throws(() => replaced(input, view, noStore), /removed free surface/);
  }
});

test("surfaceLayoutOf rejects a legacy state with a clear message", () => {
  assert.throws(() => surfaceLayoutOf({ nodes: [], shapes: [], lines: [], mode: "free" }),
    /The program arrangement comes from the removed free surface \(nodes, shapes, lines, mode\); canvas_layout_replace with root sets it anew as a tile layout/);
  assert.throws(() => surfaceLayoutOf({}), /root is missing/);
  assert.deepEqual(surfaceLayoutOf({ root: null }), { root: null });
});

test("actors must exist in the run, the human stays in the chat", () => {
  assert.throws(() => replaced({ root: { entity: "@nobody" } }), /@nobody is not an actor of this run. Present: @coordinator, @anna/);
  assert.throws(() => replaced({ root: { entity: "@owner" } }), /the human in the chat/);
});

const wizardView = (actorId = "a1", program: unknown = {
  name: "balcony-wizard",
  actorHandle: "anna",
  views: [{ id: "balcony-wizard--wizard", key: "wizard", title: "Balcony-Wizard", visible: true }],
}): RunView => ({
  ...view,
  pluginStates: [{ pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId }, state: { version: 1, program } }],
}) as RunView;

test("the surface resolves chosen program and actor names for views on the server", () => {
  for (const reference of ["app:balcony-wizard/wizard", "app:@anna/wizard", "app:balcony-wizard--wizard", "app:@ANNA/WIZARD", "app:Balcony-Wizard"]) {
    const input = { root: { entity: reference } };
    assert.deepEqual(replaced(input, wizardView()), {
      pluginId: "ragents.orchestration",
      scope: { kind: "run" },
      state: surfaceLayoutOf({ root: { entity: "app:balcony-wizard--wizard" } }),
    });
    assert.equal(input.root.entity, reference);
  }
});

test("the surface rejects unknown or no longer active views before any storing", () => {
  const noStore = () => assert.fail("Invalid views must not replace the stored surface");
  const input = { root: { entity: "app:balcony-wizard/wizard" } };
  assert.throws(() => replaced(input, view, noStore), /not an active actor view.*Activate the program first.*none/);
  assert.throws(() => replaced(input, wizardView("old"), noStore), /not an active actor view/);
  assert.throws(() => replaced(input, wizardView("a1", null), noStore), /not an active actor view/);
  assert.throws(() => replaced({ root: { entity: "app:balcony-wizard/missing" } }, wizardView(), noStore), /Available: balcony-wizard\/wizard \(@anna\/wizard\)/);
});

test("the surface reports ambiguous titles with valid names and prioritizes unique references", () => {
  const runView = wizardView("a1", {
    name: "balcony-wizard", actorHandle: "anna",
    views: [
      { id: "balcony-wizard--wizard", key: "wizard", title: "Wizard" },
      { id: "balcony-wizard--summary", key: "summary", title: "Wizard" },
      { id: "balcony-wizard--other", key: "other", title: "balcony-wizard/wizard" },
    ],
  });
  assert.throws(() => replaced({ root: { entity: "app:Wizard" } }, runView, () => assert.fail("An ambiguous surface must not be stored")),
    /ambiguous.*balcony-wizard\/wizard \(@anna\/wizard\).*balcony-wizard\/summary \(@anna\/summary\)/);
  const layout = checkLayoutAgainstRun(runView, surfaceLayoutOf({ root: { entity: "app:balcony-wizard/wizard" } }));
  assert.deepEqual(layout.root, { entity: "app:balcony-wizard--wizard" });
});

test("a new call replaces the stored state completely, including a legacy state", () => {
  const runView = wizardView();
  const withState = (state: unknown) => ({ ...runView, pluginStates: [...runView.pluginStates, {
    pluginId: "ragents.orchestration", scope: { kind: "run" }, state,
  }] }) as RunView;
  const root = { direction: "vertical", weights: [1, 1], children: [
    { entity: "@coordinator" },
    { direction: "horizontal", weights: [2, 1], children: [{ entity: "app:@anna/wizard" }, { entity: "@bert" }] },
  ] };
  const legacy = { nodes: [{ entity: "@anna" }], shapes: [], lines: [], mode: "free" };
  const expected = { root: { ...root, children: [root.children[0], {
    ...root.children[1], children: [{ entity: "app:balcony-wizard--wizard" }, { entity: "@bert" }],
  }] } };
  assert.deepEqual((replaced({ root }, withState(legacy)) as { state: unknown }).state, expected);
  assert.deepEqual((replaced({ root: null }, withState(legacy)) as { state: unknown }).state, { root: null });
});

test("tile inputs are checked completely before storing", () => {
  const split = (children: unknown[], weights: unknown[] = [2, 1]) => ({ direction: "horizontal", weights, children });
  const noStore = () => assert.fail("Invalid tiles must not be stored");
  for (const root of [
    split([{ entity: "@anna" }, { entity: "@ANNA" }]),
    split([{ entity: "app:@anna/wizard" }, { entity: "app:balcony-wizard/wizard" }]),
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
  assert.throws(() => surfaceTileNodeOf(deep), /nested splits/);
});

test("the generated TypeScript API checks arbitrarily nested tiles", () => {
  const tool = createSurfaceTool();
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


test("chatInput stays an optional boolean on actor tiles", () => {
  const input = { root: { entity: "@Anna", chatInput: false } };
  assert.equal(Value.Check(createSurfaceTool().schema, input), true);
  const layout = surfaceLayoutOf(input);
  assert.deepEqual(layout.root, { entity: "@anna", chatInput: false });
  assert.deepEqual(replaced(input), { pluginId: "ragents.orchestration", scope: { kind: "run" }, state: layout });
  assert.deepEqual(surfaceLayoutOf({ root: { entity: "@anna", chatInput: true } }).root, { entity: "@anna", chatInput: true });
  assert.deepEqual(surfaceLayoutOf({ root: { entity: "@anna" } }).root, { entity: "@anna" });
  for (const chatInput of [null, "false", 0]) {
    const invalid = { root: { entity: "@anna", chatInput } };
    assert.equal(Value.Check(createSurfaceTool().schema, invalid), false);
    assert.throws(() => surfaceLayoutOf(invalid), /chatInput/);
  }
  assert.throws(() => surfaceLayoutOf({ root: { entity: "app:example/main", chatInput: false } }), /chatInput/);
});

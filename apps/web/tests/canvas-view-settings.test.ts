import assert from "node:assert/strict";
import test from "node:test";
import {
  actorVisibleOnCanvas, canvasViewStorageKey, DEFAULT_CANVAS_VIEW_PREFERENCES, parseCanvasViewPreferences,
} from "../../../plugins/ragents.orchestration/web/canvas-view-settings.ts";
import type { RunActor } from "../../../plugins/ragents.orchestration/web/run-view.ts";

const actor = (id: string, kind: RunActor["kind"]): RunActor => ({ id, kind, handle: id, displayName: id,
  createdAt: "2026-09-11T10:00:00Z", grants: [], lifecycle: { kind: "idle", since: "2026-09-11T10:00:00Z" } });

test("app owners default to list-only regardless of driver; other actors retain their canvas card", () => {
  const owners = new Set(["list", "assistant"]);
  for (const [id, kind, expected] of [
    ["list", "script", false], ["assistant", "agent", false], ["coordinator", "agent", true],
    ["worker", "script", true], ["owner", "human", false],
  ] as const) assert.equal(actorVisibleOnCanvas(actor(id, kind), owners, DEFAULT_CANVAS_VIEW_PREFERENCES), expected);
});

test("explicit actor visibility wins over the app-owner default and survives serialization", () => {
  const preferences = parseCanvasViewPreferences(JSON.stringify({ ...DEFAULT_CANVAS_VIEW_PREFERENCES,
    actorVisibility: { list: true, coordinator: false, owner: true } }));
  const owners = new Set(["list"]);
  assert.equal(actorVisibleOnCanvas(actor("list", "script"), owners, preferences), true);
  assert.equal(actorVisibleOnCanvas(actor("coordinator", "agent"), owners, preferences), false);
  assert.equal(actorVisibleOnCanvas(actor("owner", "human"), owners, preferences), false);
  assert.equal(actorVisibleOnCanvas(actor("list", "script"), owners, { ...DEFAULT_CANVAS_VIEW_PREFERENCES, showAppActors: true }), true);
  assert.notEqual(canvasViewStorageKey("first"), canvasViewStorageKey("second"));
  assert.deepEqual(parseCanvasViewPreferences(null), DEFAULT_CANVAS_VIEW_PREFERENCES);
});

test("the primary actor defaults to the header and explicit canvas choices take precedence", () => {
  const primary = actor("lead", "agent");
  const owners = new Set<string>();
  assert.equal(actorVisibleOnCanvas(primary, owners, DEFAULT_CANVAS_VIEW_PREFERENCES, "lead"), false);
  assert.equal(actorVisibleOnCanvas(actor("worker", "agent"), owners, DEFAULT_CANVAS_VIEW_PREFERENCES, "lead"), true);
  assert.equal(actorVisibleOnCanvas(primary, owners, DEFAULT_CANVAS_VIEW_PREFERENCES, null), true);
  assert.equal(actorVisibleOnCanvas(actor("lead", "script"), owners, DEFAULT_CANVAS_VIEW_PREFERENCES, "lead"), false);
  assert.equal(actorVisibleOnCanvas(primary, new Set(["lead"]), { ...DEFAULT_CANVAS_VIEW_PREFERENCES, showAppActors: true }, "lead"), false);
  const preferences = parseCanvasViewPreferences(JSON.stringify({ ...DEFAULT_CANVAS_VIEW_PREFERENCES, actorVisibility: { lead: true } }));
  assert.equal(actorVisibleOnCanvas(primary, owners, preferences, "lead"), true);
  assert.equal(actorVisibleOnCanvas(primary, new Set(["lead"]), preferences, "lead"), true);
});

test("malformed stored view settings fail explicitly instead of changing the personal selection", () => {
  for (const value of [
    {}, [], { ...DEFAULT_CANVAS_VIEW_PREFERENCES, showAppActors: "false" },
    { ...DEFAULT_CANVAS_VIEW_PREFERENCES, actorVisibility: { list: 1 } },
    { ...DEFAULT_CANVAS_VIEW_PREFERENCES, actorVisibility: [] },
    { ...DEFAULT_CANVAS_VIEW_PREFERENCES, extra: true },
  ]) assert.throws(() => parseCanvasViewPreferences(JSON.stringify(value)), /ungültig/);
  assert.throws(() => parseCanvasViewPreferences("broken"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionContext } from "../src/PluginRegistry.tsx";
import { ActorCanvasControls, ActorCanvasList, ActorShortcuts, filterCanvasActors } from "../../../plugins/ragents.orchestration/web/ActorCanvasControls.tsx";
import { actorVisibleOnCanvas, DEFAULT_CANVAS_VIEW_PREFERENCES, type CanvasViewPreferences } from "../../../plugins/ragents.orchestration/web/canvas-view-settings.ts";
import type { RunActor } from "../src/run-view.ts";
import { actorHeaderStorageKey, actorOnStage, actorVisibleInHeader, parseActorHeaderMode } from "../../../plugins/ragents.orchestration/web/actor-header-settings.ts";
import { publishStageEntities } from "../../../plugins/ragents.orchestration/web/canvas-stage.ts";

const actor = (id: string, kind: RunActor["kind"], lifecycle?: RunActor["lifecycle"]): RunActor => ({
  id, handle: id, displayName: id, kind, lifecycle, grants: [], createdAt: "2026-09-11T10:00:00Z",
});
const actors = [
  actor("owner", "human"),
  { ...actor("coordinator", "agent", { kind: "idle", since: "now" }), displayName: "Planung" },
  actor("counter", "script", { kind: "running", turnId: "turn", inputId: "input", startedAt: "now" }),
  actor("finished", "agent", { kind: "stopped", stoppedAt: "now", reason: "complete" }),
];
const appActorIds = new Set(["counter", "finished"]);
const ids = (query: string) => filterCanvasActors(actors, appActorIds, query).map(({ id }) => id);
const noop = () => undefined;

test("the actor list keeps humans and stopped actors and searches handles, names, types and statuses", () => {
  assert.deepEqual(ids("  "), actors.map(({ id }) => id));
  assert.deepEqual(ids("OWNER"), ["owner"]);
  assert.deepEqual(ids("@counter"), ["counter"]);
  assert.deepEqual(ids("Benutzer"), ["owner"]);
  assert.deepEqual(ids("planung"), ["coordinator"]);
  assert.deepEqual(ids("LLM-Agent bereit"), ["coordinator"]);
  assert.deepEqual(ids("TypeScript arbeitet"), ["counter"]);
  assert.deepEqual(ids("script running"), ["counter"]);
  assert.deepEqual(ids("Mini-App gestoppt"), ["finished"]);
  assert.deepEqual(ids("stopped"), ["finished"]);
  assert.deepEqual(ids("absent"), []);
});

test("checkboxes use effective canvas visibility including individual app overrides", () => {
  assert.deepEqual(actors.map((entry) => actorVisibleOnCanvas(entry, appActorIds, DEFAULT_CANVAS_VIEW_PREFERENCES)), [false, true, false, false]);
  const preferences = { actorVisibility: { owner: true, coordinator: false, finished: true } };
  assert.deepEqual(actors.map((entry) => actorVisibleOnCanvas(entry, appActorIds, preferences)), [false, false, false, true]);
});

test("rendered rows name every actor as plain text and carry the effective canvas checkboxes", () => {
  const html = renderToStaticMarkup(createElement(ActorCanvasList, { actors, appActorIds, onPreferencesChange: noop, preferences: DEFAULT_CANVAS_VIEW_PREFERENCES }));
  assert.match(html, /Benutzer/);
  assert.match(html, /Gestoppt/);
  assert.equal((html.match(/<button/g) ?? []).length, 0);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 3);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
  assert.doesNotMatch(html, /aria-label="@owner im Canvas anzeigen"/);
  assert.match(html, /aria-label="@finished im Canvas anzeigen"/);
  assert.match(html, /<span[^>]*>@counter<\/span>/);
  assert.equal((html.match(/>Mini-App</g) ?? []).length, 2);
});

test("the primary stays in the actor header while its canvas checkbox defaults to off", () => {
  const session = { session: { id: "run" }, runView: {
    id: "run", ownerId: "owner", primaryActorId: "coordinator", actors, inputs: [], turns: [],
    subscriptions: [], actions: [], artifacts: [], pluginStates: [],
  } } as unknown as SessionContext;
  const header = renderToStaticMarkup(createElement(ActorShortcuts, { session, navigation: {} as never }));
  assert.match(header, /title="LLM-Agent: Chat mit @coordinator öffnen\. Zum Andocken auf eine Kachel ziehen\."/);
  assert.match(header, /title="TypeScript-Actor: Actor-Ansicht von @counter öffnen\./);
  assert.equal((header.match(/aria-haspopup="dialog"/g) ?? []).length, 3);
  assert.equal((header.match(/aria-expanded="false"/g) ?? []).length, 3);
  assert.doesNotMatch(header, /@owner/);
  assert.match(header, /hidden=""><button[^>]+title="LLM-Agent: Chat mit @finished öffnen\./);
  const render = (preferences: CanvasViewPreferences) => renderToStaticMarkup(createElement(ActorCanvasList, {
    actors: [actors[1]], appActorIds, primaryActorId: "coordinator", onPreferencesChange: noop, preferences,
  }));
  const initial = render(DEFAULT_CANVAS_VIEW_PREFERENCES);
  assert.match(initial, /aria-label="@coordinator im Canvas anzeigen"/);
  assert.doesNotMatch(initial, /checked=""/);
  assert.match(render({ ...DEFAULT_CANVAS_VIEW_PREFERENCES, actorVisibility: { coordinator: true } }), /checked=""/);
});

test("header chips carry the surface colour of their canvas box and drop the fill while off the stage", () => {
  const session = { session: { id: "stage-run" }, runView: {
    id: "stage-run", ownerId: "owner", primaryActorId: "coordinator", actors, inputs: [], turns: [],
    subscriptions: [], actions: [], artifacts: [], pluginStates: [],
  } } as unknown as SessionContext;
  const chips = () => [...renderToStaticMarkup(createElement(ActorShortcuts, { session, navigation: {} as never }))
    .matchAll(/data-surface="([a-z]+)"(?: data-staged="true")?/g)].map((match) => `${match[1]}${match[0].includes("data-staged") ? "" : " offstage"}`);
  assert.deepEqual(chips(), ["primary offstage", "script offstage", "agent offstage"]);
  publishStageEntities("stage-run", new Set(["@coordinator", "@finished", "app:counter/main"]));
  assert.deepEqual(chips(), ["primary", "script offstage", "agent"]);
  publishStageEntities("stage-run", undefined);
  assert.ok(chips().every((chip) => chip.endsWith(" offstage")));
});

test("header modes retain access independently of canvas visibility and keep stopped actors in all mode", () => {
  const stage = new Set(["@finished"]);
  const visible = (mode: "all" | "active" | "visible" | "agent" | "script") => actors.filter((entry) => actorVisibleInHeader(entry, mode, actorOnStage(entry, "coordinator", stage))).map(({ id }) => id);
  assert.deepEqual(visible("all"), ["coordinator", "counter", "finished"]);
  assert.deepEqual(visible("active"), ["coordinator", "counter"]);
  assert.deepEqual(visible("visible"), ["coordinator", "finished"]);
  assert.deepEqual(visible("agent"), ["coordinator", "finished"]);
  assert.deepEqual(visible("script"), ["counter"]);
  assert.equal(actorVisibleInHeader({ ...actors[2], lifecycle: { kind: "stopped", stoppedAt: "now", reason: "complete" } }, "script", false), true);
  assert.equal(actorOnStage(actors[1], "coordinator", new Set()), true);
  assert.equal(actorVisibleOnCanvas(actors[1], appActorIds, DEFAULT_CANVAS_VIEW_PREFERENCES, "coordinator"), false);
  assert.deepEqual(ids(""), actors.map(({ id }) => id));
});

test("header mode defaults to visible, rejects invalid preferences and uses separate run keys", () => {
  assert.equal(parseActorHeaderMode(null), "visible");
  for (const mode of ["all", "active", "visible", "agent", "script"]) assert.equal(parseActorHeaderMode(mode), mode);
  for (const mode of ["", "coordinator", "everything", "{}", "null"]) assert.throws(() => parseActorHeaderMode(mode), /ungültig/);
  assert.notEqual(actorHeaderStorageKey("first"), actorHeaderStorageKey("second"));
});

test("the actor control exposes its own closed pop-out", () => {
  const session = { session: { id: "run" }, runView: {
    id: "run", ownerId: "owner", primaryActorId: null, actors, inputs: [], turns: [],
    subscriptions: [], actions: [], artifacts: [], pluginStates: [],
  } } as unknown as SessionContext;
  const html = renderToStaticMarkup(createElement(ActorCanvasControls, { session, appActorIds, onPreferencesChange: noop, preferences: DEFAULT_CANVAS_VIEW_PREFERENCES }));
  assert.match(html, /Actors · 4/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /role="region"/);
});

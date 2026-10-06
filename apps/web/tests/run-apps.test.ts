import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionContext, SessionNavigation, SurfaceElementContribution, SurfaceElementContext, SurfaceElementDefinition } from "../src/PluginRegistry.tsx";
import { runApps, selectedRunApp, RunAppView } from "../src/run-apps.ts";

const session = (id = "run-a") => ({ session: { id } }) as SessionContext;
const contribution = (definitions: readonly SurfaceElementDefinition[],
  Element: SurfaceElementContribution["Element"] = () => null): SurfaceElementContribution => ({
  id: "apps",
  order: 0,
  select: () => definitions,
  Element,
});

test("app identity uses the run and definition ID, independent of title and order", () => {
  const definitions = [{ id: "board", title: "Board" }, { id: "notes", title: "Board" }];
  const apps = runApps(session(), [contribution(definitions)]);
  const changed = runApps(session(), [contribution([{ id: "notes" }, { id: "board", title: "Renamed" }])]);
  assert.equal(selectedRunApp(apps, "board")?.definition, definitions[0]);
  assert.equal(selectedRunApp(changed, "board")?.definition.title, "Renamed");
  assert.equal(apps[0].runId, "run-a");
  assert.equal(runApps(session("run-b"), [contribution(definitions)])[0].runId, "run-b");
  assert.throws(() => runApps(session(), [contribution(definitions), contribution([{ id: "board", visible: false }])]), /Duplicate mini-app ID: board/);
});

test("visibility and exact selection agree across contributions and updates", () => {
  const apps = runApps(session(), [contribution([{ id: "hidden", visible: false }, { id: "default" }]),
    { ...contribution([{ id: "shown", visible: true }]), id: "other" }]);
  assert.deepEqual(apps.map(({ definition }) => definition.id), ["default", "shown"]);
  assert.equal(selectedRunApp(apps, "shown"), apps[1]);
  for (const id of [undefined, null, "hidden", "removed"]) assert.equal(selectedRunApp(apps, id), undefined);
  assert.equal(selectedRunApp([], "shown"), undefined);
  assert.equal(selectedRunApp(runApps(session(), [contribution([{ id: "shown", visible: false }])]), "shown"), undefined);
  assert.equal(selectedRunApp(runApps(session(), [contribution([{ id: "hidden", visible: true }])]), "hidden")?.definition.id, "hidden");
});

test("layout keys default to the ID, are shared by successors, and stay distinct among shown apps", () => {
  const keys = (definitions: readonly SurfaceElementDefinition[]) => runApps(session(), [contribution(definitions)]).map((app) => app.layoutKey);
  assert.deepEqual(keys([{ id: "board" }, { id: "notes" }]), ["board", "notes"]);
  assert.deepEqual(keys([{ id: "review-2.board", layoutKey: "review.board" }]), ["review.board"], "a single successor takes the shared place");
  assert.deepEqual(keys([{ id: "review.board", layoutKey: "review.board" }, { id: "review-2.board", layoutKey: "review.board" }, { id: "review-3.board", layoutKey: "review.board" }]),
    ["review.board", "review.board~2", "review.board~3"]);
  assert.deepEqual(keys([{ id: "review.board", layoutKey: "review.board", visible: false }, { id: "review-2.board", layoutKey: "review.board" }]), ["review.board"], "a hidden app holds no place");
  assert.deepEqual(keys([{ id: "shared", layoutKey: "board" }, { id: "board" }, { id: "board~2" }]), ["board", "board~2", "board~2~2"], "an ID never repeats a numbered key");
  assert.throws(() => keys([{ id: "board", layoutKey: "one" }, { id: "board", layoutKey: "two" }]), /Duplicate mini-app ID: board/);
});

test("the shared renderer preserves plugin context and rejects cross-run rendering", () => {
  const current = session();
  const navigation = {} as SessionNavigation;
  const definition = { id: "board", title: "Board", anchorActorId: "alice", data: { count: 3 } };
  const received: SurfaceElementContext[] = [];
  const Element = (context: SurfaceElementContext) => {
    received.push(context);
    return createElement("article", null, context.definition.title);
  };
  const app = runApps(current, [contribution([definition], Element)])[0];
  assert.equal(renderToStaticMarkup(createElement(RunAppView, { app, navigation, session: current })), "<article>Board</article>");
  assert.deepEqual(received, [{ definition, navigation, session: current }]);
  assert.throws(() => renderToStaticMarkup(createElement(RunAppView, { app, navigation, session: session("run-b") })), /another run/);
});

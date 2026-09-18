import assert from "node:assert/strict";
import test from "node:test";
import type { SessionContext } from "../src/PluginRegistry.tsx";
import { ACTOR_PROGRAMS_STATE_ID } from "../../../plugins/ragents.actor-programs/contract.ts";
import { actorProgramCanvasElements } from "../../../plugins/ragents.actor-programs/web/EmbeddedApps.tsx";
import { runAppFrom } from "../../../plugins/ragents.actor-programs/web/api.ts";

const owner = { id: "actor", handle: "counter", kind: "agent", lifecycle: { kind: "idle" } };
const program = (views: unknown[], actor = owner) => ({ pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId: actor.id },
  state: { version: 1, program: { name: actor.handle, actorId: actor.id, actorHandle: actor.handle, revision: "revision", views } } });
const session = (programs: unknown[], actors: unknown[] = [owner]): SessionContext => ({ runView: {
  id: "run", ownerId: "owner", primaryActorId: null, actors, inputs: [], turns: [],
  subscriptions: [], actions: [], artifacts: [], pluginStates: programs,
} } as SessionContext);

test("several actor views share their owner's canvas anchor while headless programs have no frame", () => {
  const headless = { ...owner, id: "headless", handle: "worker", kind: "script" };
  const elements = actorProgramCanvasElements(session([
    program([{ id: "counter--board", title: "Übersicht" }, { id: "counter--details", title: "Details" }]),
    program([], headless),
  ], [owner, headless]));
  assert.equal(elements.length, 2);
  assert.deepEqual(elements.map((entry) => entry.title), ["Übersicht", "Details"]);
  assert.ok(elements.every((entry) => entry.anchorActorId === owner.id));
  assert.deepEqual(elements[0]!.data, { actorId: owner.id, actorHandle: owner.handle });
  assert.deepEqual(elements.map(({ width, height }) => [width, height]), [[720, 520], [720, 520]]);
});

test("stopped and absent actors lose their views synchronously", () => {
  const programs = [program([{ id: "counter--board", title: "Übersicht" }])];
  assert.equal(actorProgramCanvasElements(session(programs)).length, 1);
  assert.deepEqual(actorProgramCanvasElements(session(programs, [{ ...owner, lifecycle: { kind: "stopped" } }])), []);
  assert.deepEqual(actorProgramCanvasElements(session(programs, [])), []);
  assert.deepEqual(actorProgramCanvasElements(session([{ ...program([]), state: { version: 1, program: null } }])), []);
});

test("visibility survives as a canvas property and another actor cannot own the placement", () => {
  const view = { id: "counter--board", title: "Board", visible: false, placements: [{ kind: "canvas", anchorActorId: owner.id, width: 600, height: 400 }] };
  const hidden = actorProgramCanvasElements(session([program([view])]))[0]!;
  assert.equal(hidden.visible, false);
  view.visible = true;
  assert.deepEqual({ ...hidden, visible: true }, actorProgramCanvasElements(session([program([view])]))[0]);
  view.placements[0]!.anchorActorId = "other-actor";
  assert.throws(() => actorProgramCanvasElements(session([program([view])])), /gehört/);
});

test("the view API requires actor ownership and rejects dialogs, foreign placement, and duplicate placement", () => {
  const app = { id: "counter--board", actorId: owner.id, actorHandle: owner.handle, title: "Board", revision: "revision", actions: [], invocations: [],
    state: { version: 1, revision: 1, values: { count: 0 } }, placements: [{ kind: "canvas", anchorActorId: owner.id, width: 480, height: 320 }] };
  assert.equal(runAppFrom(app).visible, true);
  assert.equal(runAppFrom({ ...app, visible: false }).visible, false);
  assert.throws(() => runAppFrom({ ...app, actorId: undefined }), /actorId/);
  assert.throws(() => runAppFrom({ ...app, visible: "yes" }), /visible/);
  assert.throws(() => runAppFrom({ ...app, placements: [{ kind: "dialog", size: "wide" }] }), /canvas/);
  assert.throws(() => runAppFrom({ ...app, placements: [app.placements[0], app.placements[0]] }), /placements/);
  assert.throws(() => runAppFrom({ ...app, placements: [{ ...app.placements[0], anchorActorId: "someone-else" }] }), /eigenen Actor/);
  assert.equal(runAppFrom({ ...app, id: `${"a".repeat(64)}--${"v".repeat(64)}` }).id.length, 130);
});

test("canvas uses the shared default size regardless of requested placement sizes", () => {
  const views = [[280, 180], [360, 240], [960, 720]].map(([width, height], index) => ({ id: `counter--view-${index}`, title: `View ${index}`,
    placements: [{ kind: "canvas", anchorActorId: owner.id, width, height }] }));
  const before = JSON.stringify(views);
  const elements = actorProgramCanvasElements(session([program(views)]));
  assert.deepEqual(elements.map(({ width, height }) => [width, height]), [[720, 520], [720, 520], [720, 520]]);
  assert.equal(JSON.stringify(views), before);
  assert.deepEqual(elements[2]!.resizable, { minWidth: 280, maxWidth: 2880, minHeight: 180, maxHeight: 2700 });
});

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionContext } from "../src/PluginRegistry.tsx";
import { ACTOR_PROGRAMS_STATE_ID } from "../../../apps/server/src/plugin-support/actor-programs/contract.ts";
import { actorProgramSurfaceElements } from "../../../plugins/ragents.actor-programs/web/EmbeddedApps.tsx";
import { runAppFrom } from "../../../plugins/ragents.actor-programs/web/api.ts";
import { runApps } from "../src/run-apps.ts";

const owner = { id: "actor", handle: "counter", kind: "agent", lifecycle: { kind: "idle" } };
const program = (views: unknown[], actor = owner) => ({ pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId: actor.id },
  state: { version: 1, program: { name: actor.handle, actorId: actor.id, actorHandle: actor.handle, revision: "revision", views } } });
const session = (programs: unknown[], actors: unknown[] = [owner]): SessionContext => ({ runView: {
  id: "run", ownerId: "owner", primaryActorId: null, actors, inputs: [], turns: [],
  subscriptions: [], actions: [], artifacts: [], pluginStates: programs,
} } as SessionContext);

test("several actor views share their owner's surface anchor while headless programs have no frame", () => {
  const headless = { ...owner, id: "headless", handle: "worker", kind: "script" };
  const elements = actorProgramSurfaceElements(session([
    program([{ id: "counter--board", title: "Overview" }, { id: "counter--details", title: "Details" }]),
    program([], headless),
  ], [owner, headless]));
  assert.equal(elements.length, 2);
  assert.deepEqual(elements.map((entry) => entry.title), ["Overview", "Details"]);
  assert.ok(elements.every((entry) => entry.anchorActorId === owner.id));
  assert.deepEqual(elements[0]!.data, { actorId: owner.id, actorHandle: owner.handle });
});

test("stopped and absent actors lose their views synchronously", () => {
  const programs = [program([{ id: "counter--board", title: "Overview" }])];
  assert.equal(actorProgramSurfaceElements(session(programs)).length, 1);
  assert.deepEqual(actorProgramSurfaceElements(session(programs, [{ ...owner, lifecycle: { kind: "stopped" } }])), []);
  assert.deepEqual(actorProgramSurfaceElements(session(programs, [])), []);
  assert.deepEqual(actorProgramSurfaceElements(session([{ ...program([]), state: { version: 1, program: null } }])), []);
});

test("visibility survives as a catalog property", () => {
  const view = { id: "counter--board", title: "Board", visible: false };
  const hidden = actorProgramSurfaceElements(session([program([view])]))[0]!;
  assert.equal(hidden.visible, false);
  view.visible = true;
  assert.deepEqual({ ...hidden, visible: true }, actorProgramSurfaceElements(session([program([view])]))[0]);
});

test("the view API requires actor ownership and valid visibility", () => {
  const app = { id: "counter--board", actorId: owner.id, actorHandle: owner.handle, title: "Board", revision: "revision", actions: [], invocations: [],
    state: { version: 1, revision: 1, values: { count: 0 } } };
  assert.equal(runAppFrom(app).visible, true);
  assert.equal(runAppFrom({ ...app, visible: false }).visible, false);
  assert.throws(() => runAppFrom({ ...app, actorId: undefined }), /actorId/);
  assert.throws(() => runAppFrom({ ...app, visible: "yes" }), /visible/);
  assert.equal(runAppFrom({ ...app, id: `${"a".repeat(64)}--${"v".repeat(64)}` }).id.length, 130);
});

test("catalog entries derive ownership and leave program state untouched", () => {
  const views = [0, 1, 2].map((index) => ({ id: `counter--view-${index}`, title: `View ${index}`,
    visible: true }));
  const before = JSON.stringify(views);
  const elements = actorProgramSurfaceElements(session([program(views)]));
  assert.deepEqual(elements.map((entry) => Object.keys(entry).sort()), Array(3).fill(["anchorActorId", "data", "entity", "id", "layoutKey", "title", "visible"]));
  assert.equal(JSON.stringify(views), before);
});

test("views of later starts of a run script share the dock place of the first start, distinct only while shown together", () => {
  const actor = (id: string, room: string) => ({ ...owner, id, handle: "board", room });
  const board = (room: string, id: string) => ({ pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId: id }, state: { version: 1,
    program: { name: `${room}.board`, actorId: id, actorHandle: `${room}.board`, revision: "revision", views: [{ id: `${room}.board--main`, title: "Board" }] } } });
  const first = actor("first", "review");
  const fifth = actor("fifth", "review-5");
  const run = (actors: unknown[]) => ({ ...session([board("review", first.id), board("review-5", fifth.id)], actors), session: { id: "run" } }) as SessionContext;
  assert.deepEqual(actorProgramSurfaceElements(run([first, fifth])).map((entry) => [entry.id, entry.layoutKey]),
    [["review.board--main", "review.board--main"], ["review-5.board--main", "review.board--main"]]);
  const contribution = { id: "apps", order: 0, select: actorProgramSurfaceElements, Element: () => null };
  assert.deepEqual(runApps(run([first, fifth]), [contribution]).map((app) => app.layoutKey), ["review.board--main", "review.board--main~2"], "two shown starts keep distinct places");
  assert.deepEqual(runApps(run([{ ...first, lifecycle: { kind: "stopped" } }, fifth]), [contribution]).map((app) => [app.definition.id, app.layoutKey]),
    [["review-5.board--main", "review.board--main"]], "a later start takes over the place of a stopped one");
  for (const [id, key] of [["board--main", "board--main"], ["step-2.board--view-2", "step.board--view-2"], ["v2.board--main", "v2.board--main"]]) {
    assert.equal(actorProgramSurfaceElements(session([program([{ id, title: "Board" }])]))[0]!.layoutKey, key);
  }
});

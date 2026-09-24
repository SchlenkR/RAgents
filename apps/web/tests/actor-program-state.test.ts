import assert from "node:assert/strict";
import test from "node:test";
import { actorProgramsRevision } from "../../../plugins/ragents.actor-programs/web/state-revision.ts";
import { ACTOR_PROGRAMS_STATE_ID, ACTOR_STATE_ID, ACTOR_INVOCATIONS_STATE_ID } from "../../../apps/server/src/plugin-support/actor-programs/contract.ts";
import { currentActorListing } from "../../../plugins/ragents.actor-programs/web/program-state.ts";
import type { ActorProgramsListing } from "../../../plugins/ragents.actor-programs/web/api.ts";

const actor = { id: "counter", handle: "counter", kind: "agent", lifecycle: { kind: "idle" } };
const entry = (pluginId: string, state: unknown, actorId = "counter") => ({ pluginId, scope: { kind: "actor", actorId }, state, updatedAt: "2026-09-10T10:00:00.000Z" });
const views = [{ id: "counter--board", title: "Board" }, { id: "counter--detail", title: "Detail" }];
const definition = entry(ACTOR_PROGRAMS_STATE_ID, { version: 1, program: { name: "counter", actorId: actor.id, actorHandle: actor.handle, revision: "build", views } });
const view = (pluginStates: unknown[], actors: unknown[] = [actor]) => ({ id: "run", ownerId: "owner", primaryActorId: null, actors, inputs: [], turns: [], subscriptions: [], actions: [], artifacts: [], pluginStates });
const listing: ActorProgramsListing = { apps: views.map((item) => ({ ...item, actorId: actor.id, actorHandle: actor.handle, revision: "build", actions: [], placements: [], invocations: [], state: { version: 1, revision: 1, values: { count: 0 } } })), tools: [] };

test("actor state and function invocations invalidate views even without a running chat turn", () => {
  const states = [definition, entry(ACTOR_STATE_ID, { count: 0 }), { ...entry(ACTOR_INVOCATIONS_STATE_ID, { invocations: [] }), scope: { kind: "run" } }];
  const before = actorProgramsRevision(view(states));
  const updated = [...states];
  updated[1] = entry(ACTOR_STATE_ID, { count: 1 });
  assert.notEqual(actorProgramsRevision(view(updated)), before);
  const stateChanged = actorProgramsRevision(view(updated));
  updated[2] = { ...entry(ACTOR_INVOCATIONS_STATE_ID, { invocations: [{ status: "succeeded" }] }), scope: { kind: "run" } };
  assert.notEqual(actorProgramsRevision(view(updated)), stateChanged);
  assert.equal(actorProgramsRevision(view([...updated].reverse())), actorProgramsRevision(view(updated)));
});

test("unrelated chat and actor states do not poll while actor stop and program removal invalidate", () => {
  const states = [definition];
  const before = actorProgramsRevision(view(states));
  assert.equal(actorProgramsRevision({ ...view(states), revision: 100, turns: [{ status: "completed" }] }), before);
  assert.equal(actorProgramsRevision(view([...states, entry("ragents.todo", { tasks: ["new"] }), entry(ACTOR_STATE_ID, { value: 99 }, "other")])), before);
  assert.equal(actorProgramsRevision(view(states, [{ ...actor, lifecycle: { kind: "running" } }])), before);
  assert.notEqual(actorProgramsRevision(view(states, [{ ...actor, lifecycle: { kind: "stopped" } }])), before);
  assert.notEqual(actorProgramsRevision(view([])), before);
});

test("all views receive their actor's new state immediately before an HTTP listing refresh", () => {
  const values = { count: 2 };
  const current = currentActorListing(listing, view([definition, entry(ACTOR_STATE_ID, values)]))!;
  assert.deepEqual(current.apps.map((app) => app.state.values), [values, values]);
  assert.equal(current.apps[0]!.state.values, current.apps[1]!.state.values);
  assert.deepEqual(listing.apps[0]!.state.values, { count: 0 });
  const unrelated = currentActorListing(listing, view([definition, entry(ACTOR_STATE_ID, { count: 99 }, "someone-else")]))!;
  assert.deepEqual(unrelated.apps[0]!.state.values, { count: 0 });
});

test("stopped owners and replaced program revisions unmount stale frames without waiting for HTTP", () => {
  assert.deepEqual(currentActorListing(listing, view([definition], [{ ...actor, lifecycle: { kind: "stopped" } }]))!.apps, []);
  assert.deepEqual(currentActorListing(listing, view([]))!.apps, []);
  const newer = structuredClone(definition);
  newer.state.program.revision = "next-build";
  assert.deepEqual(currentActorListing(listing, view([newer]))!.apps, []);
});

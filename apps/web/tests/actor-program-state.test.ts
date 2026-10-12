import assert from "node:assert/strict";
import test from "node:test";
import { actorProgramsRevision } from "../../../plugins/ragents.actor-programs/web/state-revision.ts";
import { ACTOR_PROGRAMS_STATE_ID, ACTOR_STATE_ID, ACTOR_INVOCATIONS_STATE_ID, ACTOR_VIEW_ID_MAX_LENGTH } from "../../../apps/server/src/plugin-support/actor-programs/contract.ts";
import { actorProgramSummary, currentActorListing } from "../../../plugins/ragents.actor-programs/web/program-state.ts";
import { actorProgramsListingFrom, toolKeyOf, type ActorProgramsListing } from "../../../plugins/ragents.actor-programs/web/api.ts";

const actor = { id: "counter", handle: "counter", kind: "agent", lifecycle: { kind: "idle" } };
const entry = (pluginId: string, state: unknown, actorId = "counter") => ({ pluginId, scope: { kind: "actor", actorId }, state, updatedAt: "2026-09-10T10:00:00.000Z" });
const views = [{ id: "counter--board", title: "Board" }, { id: "counter--detail", title: "Detail" }];
const definition = entry(ACTOR_PROGRAMS_STATE_ID, { version: 1, program: { name: "counter", actorId: actor.id, actorHandle: actor.handle, revision: "build", views } });
const view = (pluginStates: unknown[], actors: unknown[] = [actor]) => ({ id: "run", ownerId: "owner", primaryActorId: null, actors, inputs: [], turns: [], subscriptions: [], actions: [], artifacts: [], pluginStates });
const listing: ActorProgramsListing = { apps: views.map((item) => ({ ...item, actorId: actor.id, actorHandle: actor.handle, revision: "build", actions: [], invocations: [], state: { version: 1, revision: 1, values: { count: 0 } } })), tools: [] };

test("program summaries use the current definition, including headless and stopped actors", () => {
  const program = { ...definition.state.program, name: "room.counter-program", functions: [{ id: "increment" }] };
  const state = entry(ACTOR_PROGRAMS_STATE_ID, { version: 1, program });
  assert.deepEqual(actorProgramSummary(view([state]), actor.id), { name: program.name, functionCount: 1, viewCount: 2 });
  assert.deepEqual(actorProgramSummary(view([state], [{ ...actor, lifecycle: { kind: "stopped" } }]), actor.id),
    { name: program.name, functionCount: 1, viewCount: 2 });
  const headless = entry(ACTOR_PROGRAMS_STATE_ID, { version: 1, program: { ...program, name: "next-program", functions: [], views: [] } });
  assert.deepEqual(actorProgramSummary(view([headless]), actor.id), { name: "next-program", functionCount: 0, viewCount: 0 });
  assert.equal(actorProgramSummary(view([state]), "other"), undefined);
  assert.equal(actorProgramSummary(view([]), actor.id), undefined);
  assert.equal(actorProgramSummary(view([entry(ACTOR_PROGRAMS_STATE_ID, { version: 1, program: null })]), actor.id), undefined);
});

test("an invalid program summary fails instead of inventing identity or counts", () => {
  for (const program of [{ ...definition.state.program, functions: [], actorId: "other" },
    { ...definition.state.program, functions: null }, { ...definition.state.program, functions: [], views: null }]) {
    assert.throws(() => actorProgramSummary(view([entry(ACTOR_PROGRAMS_STATE_ID, { version: 1, program })]), actor.id), /definition.*invalid/);
  }
});

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

test("a listing of an actor in a room keeps its room-qualified view and module identifiers", () => {
  const hash = "a".repeat(64);
  const parsed = actorProgramsListingFrom({
    apps: [{ id: "room.counter--board", title: "Board", description: "", actorId: actor.id, actorHandle: "room.counter", revision: "build", actions: [], invocations: [], state: { version: 1, revision: 1, values: {} } }],
    tools: [{ actorId: actor.id, actorHandle: "room.counter", functionId: "increment", revision: "build", moduleId: "room.counter", name: "counter_increment", description: "Adds one", parameters: [], sourceHash: hash, targets: [], installedBy: actor.id }],
  });
  assert.deepEqual([parsed.apps[0]!.id, parsed.tools[0]!.moduleId], ["room.counter--board", "room.counter"]);
});

test("view identifiers of three names at full length pass the listing, one character more does not", () => {
  const hash = "a".repeat(64);
  const name = (letter: string) => letter + "x".repeat(63);
  const longest = `${name("r")}.${name("p")}--${name("v")}`;
  const app = (id: string) => ({ id, title: "Board", description: "", actorId: actor.id, actorHandle: "room.counter", revision: "build", actions: [], invocations: [], state: { version: 1, revision: 1, values: {} } });
  assert.equal(longest.length, ACTOR_VIEW_ID_MAX_LENGTH);
  assert.equal(actorProgramsListingFrom({ apps: [app(longest)], tools: [] }).apps[0]!.id, longest);
  assert.throws(() => actorProgramsListingFrom({ apps: [app(`${longest}x`)], tools: [] }), /view\.id is not a valid identifier/);
  const tool = { actorId: actor.id, actorHandle: "room.counter", functionId: "increment", revision: "build", moduleId: `${name("r")}.${name("p")}`, name: "counter_increment", description: "Adds one", parameters: [], sourceHash: hash, targets: [], installedBy: actor.id };
  assert.equal(actorProgramsListingFrom({ apps: [], tools: [tool] }).tools[0]!.moduleId.length, 129);
});

test("a tool is its package's function: equal tool names of packages in different rooms both stay listed", () => {
  const hash = "a".repeat(64);
  const tool = (moduleId: string, actorHandle: string) => ({ actorId: actorHandle, actorHandle, functionId: "append", revision: "build", moduleId, name: "append_to_list", description: "Appends", parameters: [], sourceHash: hash, targets: [], installedBy: "owner" });
  const parsed = actorProgramsListingFrom({ apps: [], tools: [tool("review.list", "review.list"), tool("review-2.list", "review-2.list")] });
  assert.deepEqual(parsed.tools.map(toolKeyOf), ["review.list/append", "review-2.list/append"]);
  assert.throws(() => actorProgramsListingFrom({ apps: [], tools: [tool("review.list", "review.list"), tool("review.list", "review.list")] }), /tools contains duplicate identifiers/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunAccessScope } from "../src/AccessContext";
import { pauseRun, resumeRun } from "../src/api";
import { pausedRunText, runPausable, runPause } from "../src/chat/chat-target";
import { PausedRunNotice } from "../src/chat/PausedRunNotice";
import { RpcClient } from "../src/rpc/client";
import { runViewFrom, type RunActor, type RunActorInput, type RunView } from "../src/run-view";
import { ActorChatControls } from "../../../plugins/ragents.orchestration/web/ActorChatControls";

type Lifecycle = NonNullable<RunActor["lifecycle"]>;

const running: Lifecycle = { kind: "running", turnId: "turn", inputId: "input", startedAt: "2026-10-02T10:00:00.000Z" };
const idle: Lifecycle = { kind: "idle", since: "2026-10-02T10:00:00.000Z" };
const stopped: Lifecycle = { kind: "stopped", stoppedAt: "2026-10-02T10:00:00.000Z", reason: "Done" };

const agent = (id: string, lifecycle: Lifecycle, held = false): RunActor => ({
  id, kind: "agent", handle: id, displayName: id, grants: [], createdAt: "2026-10-02T09:00:00.000Z", lifecycle, ...(held ? { held: true as const } : {}),
});

const input = (id: string, actorId: string, lifecycle: RunActorInput["lifecycle"] = { kind: "pending" }): RunActorInput => ({
  id, actorId, content: "Next step", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "owner", enqueuedAt: "2026-10-02T10:00:00.000Z", sequence: 1, lifecycle,
});

const viewOf = ({ coordinator = idle, worker = idle, paused = false, inputs = [] }: { coordinator?: Lifecycle; worker?: Lifecycle; paused?: boolean; inputs?: RunActorInput[] }): RunView => ({
  id: "run-a", revision: 4, title: "Night bus round", ownerId: "owner", primaryActorId: "coordinator", createdAt: "2026-10-02T09:00:00.000Z", forkedFrom: null,
  actors: [
    { id: "owner", kind: "human", handle: "owner", displayName: "Owner", grants: [], createdAt: "2026-10-02T09:00:00.000Z" },
    agent("coordinator", coordinator, paused),
    agent("worker", worker, paused),
    agent("finished", stopped),
  ],
  inputs, turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
  pause: paused ? { pausedAt: "2026-10-02T10:01:00.000Z", reason: "Paused by the operator", userId: null } : null,
});

const waitingInputs = [
  input("a", "coordinator"),
  input("b", "worker"),
  input("c", "worker", { kind: "claimed", turnId: "turn", steered: false }),
  input("d", "worker", { kind: "discarded", at: "2026-10-02T10:00:00.000Z", reason: "Stopped" }),
  input("e", "finished"),
];

test("a paused run counts the waiting inputs of its actors that are not stopped; the view keeps pause and held", () => {
  assert.equal(runPause(viewOf({}), "run-a"), undefined, "a running run is not paused");
  assert.deepEqual(runPause(viewOf({ paused: true, inputs: waitingInputs }), "run-a"), { waiting: 2 });
  assert.deepEqual(runPause(viewOf({ paused: true }), "run-a"), { waiting: 0 });
  assert.equal(runPause(viewOf({ paused: true }), "run-b"), undefined, "the view of another run says nothing");
  const parsed = runViewFrom(JSON.parse(JSON.stringify(viewOf({ paused: true }))));
  assert.equal(parsed?.pause?.reason, "Paused by the operator");
  assert.equal(parsed?.actors.find((actor) => actor.id === "worker")?.held, true);
});

test("the paused line names the waiting inputs only when there are any", () => {
  assert.equal(pausedRunText(0), "Paused");
  assert.equal(pausedRunText(1), "Paused - 1 input waiting");
  assert.equal(pausedRunText(3), "Paused - 3 inputs waiting");
});

test("the chat's stop pauses the run while any of its actors works and the run is not paused yet", () => {
  assert.equal(runPausable(viewOf({ coordinator: running }), "run-a", false), true);
  assert.equal(runPausable(viewOf({ worker: running }), "run-a", false), true, "another actor's turn is enough");
  assert.equal(runPausable(viewOf({}), "run-a", true), true, "the chat's live turn counts before the view knows it");
  assert.equal(runPausable(viewOf({}), "run-a", false), false, "nothing to stop");
  assert.equal(runPausable(viewOf({ worker: running, paused: true }), "run-a", false), false, "a paused run is not paused again");
  assert.equal(runPausable(viewOf({ worker: running }), "run-b", false), false, "the view of another run says nothing");
});

test("pause and resume address the whole run with a fresh command id; the pause leaves the reason to the server", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new RpcClient({ fetch: async (_url, init) => {
    const call = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method: call.method, params: call.params });
    return Response.json({ jsonrpc: "2.0", id: call.id, result: viewOf({ paused: call.method === "ragents.runs.pause" }) });
  } });
  await pauseRun("run-a", client);
  await pauseRun("run-a", client);
  await resumeRun("run-a", client);
  assert.deepEqual(calls.map(({ method, params }) => [method, Object.keys(params).sort(), params.runId]), [
    ["ragents.runs.pause", ["commandId", "runId"], "run-a"],
    ["ragents.runs.pause", ["commandId", "runId"], "run-a"],
    ["ragents.runs.resume", ["commandId", "runId"], "run-a"],
  ]);
  assert.equal(new Set(calls.map(({ params }) => params.commandId)).size, 3, "every call has its own command id");
});

test("while the run is paused, one line above the input says so and offers Resume; without runs.write it stays disabled", () => {
  const notice = (view: RunView, operable = true) => renderToStaticMarkup(createElement(RunAccessScope, { operable }, createElement(PausedRunNotice, { runId: "run-a", view })));
  const paused = viewOf({ paused: true, inputs: [input("a", "coordinator"), input("b", "worker"), input("c", "worker")] });
  const html = notice(paused);
  assert.match(html, /role="status"[^>]*>Paused - 3 inputs waiting</);
  assert.match(html, /<button[^>]*>Resume<\/button>/);
  assert.doesNotMatch(html, /<button[^>]*data-disabled=""[^>]*>Resume/);
  assert.doesNotMatch(html, /<h\d/, "no heading of its own");
  assert.match(notice(paused, false), /<button[^>]*data-disabled=""[^>]*>Resume<\/button>/);
  assert.equal(notice(viewOf({})), "", "nothing while the run is not paused");
});

test("an actor chat stops the whole run while another actor works, and shows the paused line instead of a stop while paused", () => {
  const controls = (view: RunView, operable = true) => renderToStaticMarkup(createElement(RunAccessScope, { operable },
    createElement(ActorChatControls, { actor: view.actors.find((actor) => actor.id === "worker")!, view, presentation: "panel", running: false })));
  const working = controls(viewOf({ coordinator: running }));
  assert.match(working, /aria-label="Stop work"/);
  assert.doesNotMatch(working, /Interject|Feed into the running turn/, "the idle actor's input does not claim its own turn runs");
  assert.doesNotMatch(controls(viewOf({})), /aria-label="Stop work"/, "nothing works, nothing to stop");
  assert.doesNotMatch(controls(viewOf({ coordinator: running }), false), /aria-label="Stop work"/, "without runs.write no stop");
  const paused = controls(viewOf({ coordinator: running, paused: true, inputs: [input("a", "worker")] }));
  assert.doesNotMatch(paused, /aria-label="Stop work"/);
  assert.match(paused, /role="status"[^>]*>Paused - 1 input waiting</);
  assert.match(paused, /<button[^>]*>Resume<\/button>/);
});

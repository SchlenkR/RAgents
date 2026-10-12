import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunAccessScope } from "../src/AccessContext";
import { interruptActorTurn, stopRun } from "../src/api";
import { stoppedRunText, runStopped } from "../src/chat/chat-target";
import { StoppedRunNotice } from "../src/chat/StoppedRunNotice";
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

const viewOf = ({ coordinator = idle, worker = idle, runStoppedState = false, inputs = [] }: { coordinator?: Lifecycle; worker?: Lifecycle; runStoppedState?: boolean; inputs?: RunActorInput[] }): RunView => ({
  id: "run-a", revision: 4, title: "Night bus round", ownerId: "owner", primaryActorId: "coordinator", createdAt: "2026-10-02T09:00:00.000Z", forkedFrom: null,
  actors: [
    { id: "owner", kind: "human", handle: "owner", displayName: "Owner", grants: [], createdAt: "2026-10-02T09:00:00.000Z" },
    agent("coordinator", coordinator, runStoppedState),
    agent("worker", worker, runStoppedState),
    agent("finished", stopped),
  ],
  inputs, turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
  stopped: runStoppedState ? { stoppedAt: "2026-10-02T10:01:00.000Z", reason: "Stopped by the operator", userId: null } : null,
});

const waitingInputs = [
  input("a", "coordinator"),
  input("b", "worker"),
  input("c", "worker", { kind: "claimed", turnId: "turn", steered: false }),
  input("d", "worker", { kind: "discarded", at: "2026-10-02T10:00:00.000Z", reason: "Stopped" }),
  input("e", "finished"),
];

test("a stopped run counts the waiting inputs of its actors that are not stopped; the view keeps stopped and held", () => {
  assert.equal(runStopped(viewOf({}), "run-a"), undefined, "a running run is not stopped");
  assert.deepEqual(runStopped(viewOf({ runStoppedState: true, inputs: waitingInputs }), "run-a"), { waiting: 2 });
  assert.deepEqual(runStopped(viewOf({ runStoppedState: true }), "run-a"), { waiting: 0 });
  assert.equal(runStopped(viewOf({ runStoppedState: true }), "run-b"), undefined, "the view of another run says nothing");
  const parsed = runViewFrom(JSON.parse(JSON.stringify(viewOf({ runStoppedState: true }))));
  assert.equal(parsed?.stopped?.reason, "Stopped by the operator");
  assert.equal(parsed?.actors.find((actor) => actor.id === "worker")?.held, true);
});

test("the stopped line names the waiting inputs only when there are any", () => {
  assert.equal(stoppedRunText(0), "Stopped");
  assert.equal(stoppedRunText(1), "Stopped - 1 input waiting");
  assert.equal(stoppedRunText(3), "Stopped - 3 inputs waiting");
});

test("stop addresses the whole run with a fresh command id and the default reason from the server", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new RpcClient({ fetch: async (_url, init) => {
    const call = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method: call.method, params: call.params });
    return Response.json({ jsonrpc: "2.0", id: call.id, result: viewOf({ runStoppedState: true }) });
  } });
  await stopRun("run-a", undefined, client);
  await stopRun("run-a", undefined, client);
  assert.deepEqual(calls.map(({ method, params }) => [method, Object.keys(params).sort(), params.runId]), [
    ["ragents.runs.stop", ["commandId", "runId"], "run-a"],
    ["ragents.runs.stop", ["commandId", "runId"], "run-a"],
  ]);
  assert.equal(new Set(calls.map(({ params }) => params.commandId)).size, 2);
});

test("a stopped run shows one status line without a continuation button, also with read access", () => {
  const notice = (view: RunView, operable = true) => renderToStaticMarkup(createElement(RunAccessScope, { operable }, createElement(StoppedRunNotice, { runId: "run-a", view })));
  const stoppedView = viewOf({ runStoppedState: true, inputs: [input("a", "coordinator"), input("b", "worker"), input("c", "worker")] });
  assert.match(notice(stoppedView), /role="status"[^>]*>Stopped - 3 inputs waiting</);
  assert.match(notice(stoppedView, false), /role="status"[^>]*>Stopped - 3 inputs waiting</);
  assert.doesNotMatch(notice(stoppedView), /<button|<h\d/);
  assert.equal(notice(viewOf({})), "");
});

test("an actor chat stops only its own running turn; another actor's work offers no stop, and a stopped run shows the stopped line", () => {
  const controls = (view: RunView, running: boolean, operable = true) => renderToStaticMarkup(createElement(RunAccessScope, { operable },
    createElement(ActorChatControls, { actor: view.actors.find((actor) => actor.id === "worker")!, view, presentation: "panel", running })));
  assert.match(controls(viewOf({ worker: running }), true), /aria-label="Stop work"/);
  const other = controls(viewOf({ coordinator: running }), false);
  assert.doesNotMatch(other, /aria-label="Stop work"/, "another actor's turn is not this chat's work");
  assert.doesNotMatch(other, /Interject|Feed into the running turn/, "the idle actor's input does not claim its own turn runs");
  assert.doesNotMatch(controls(viewOf({}), false), /aria-label="Stop work"/, "nothing works, nothing to stop");
  assert.doesNotMatch(controls(viewOf({ worker: running }), true, false), /aria-label="Stop work"/, "without runs.write no stop");
  const runStoppedState = controls(viewOf({ coordinator: running, runStoppedState: true, inputs: [input("a", "worker")] }), false);
  assert.doesNotMatch(runStoppedState, /aria-label="Stop work"/);
  assert.match(runStoppedState, /role="status"[^>]*>Stopped - 1 input waiting</);
  assert.doesNotMatch(runStoppedState, /Resume/);
});

test("the chat's stop interrupts the addressed actor's turn with a fresh command id", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new RpcClient({ fetch: async (_url, init) => {
    const call = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method: call.method, params: call.params });
    return Response.json({ jsonrpc: "2.0", id: call.id, result: viewOf({}) });
  } });
  await interruptActorTurn("run-a", "worker", client);
  assert.deepEqual(calls.map(({ method, params }) => [method, Object.keys(params).sort(), params.runId, params.actorId]), [
    ["ragents.runs.interruptTurn", ["actorId", "commandId", "runId"], "run-a", "worker"],
  ]);
});

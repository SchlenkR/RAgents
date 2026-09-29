import assert from "node:assert/strict";
import test from "node:test";
import { surfaceStartupState } from "../../../plugins/ragents.orchestration/web/surface-startup.ts";
import type { RunAction, RunActor, RunActorInput, RunTurn, RunView } from "../src/run-view.ts";

const at = "2026-09-14T10:00:00.000Z";
const actor = (overrides: Partial<RunActor> = {}): RunActor => ({
  id: "setup", handle: "setup", kind: "script", displayName: "Setup", grants: [], createdAt: at,
  lifecycle: { kind: "idle", since: at }, ...overrides,
});
const input = (overrides: Partial<RunActorInput> = {}): RunActorInput => ({
  id: "input-1", actorId: "setup", content: "Build the interface", artifactIds: [], sourceEventIds: [],
  subscriptionId: null, enqueuedBy: "owner", enqueuedAt: at, sequence: 1, lifecycle: { kind: "pending" }, ...overrides,
});
const turn = (overrides: Partial<RunTurn> = {}): RunTurn => ({
  id: "turn-1", actorId: "setup", inputId: "input-1", status: "completed", startedAt: at, finishedAt: at,
  reason: null, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, ...overrides,
});
const view = (overrides: Partial<RunView> = {}): RunView => ({
  id: "run-1", title: "Setup", ownerId: "owner", primaryActorId: "setup", revision: 1, createdAt: at, forkedFrom: null,
  actors: [], inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [], ...overrides,
});
const state = (overrides: Partial<Parameters<typeof surfaceStartupState>[0]> = {}) => surfaceStartupState({
  view: view(), startup: undefined, connected: true, running: false, error: undefined, ...overrides,
});

test("preparation is visible before a run view or actor exists", () => {
  assert.deepEqual(state({ view: undefined, startup: { status: "preparing", message: "Preparing the working directory" } }), {
    kind: "working", title: "Preparing run", detail: "Preparing the working directory",
  });
});

test("a hidden script waiting for its first input is reported as working", () => {
  assert.equal(state({ view: view({ actors: [actor()], inputs: [input()] }) })?.kind, "working");
});

test("active script lifecycle, running turns and server activity each keep setup visible", () => {
  assert.equal(state({ view: view({ actors: [actor({ lifecycle: { kind: "running", turnId: "turn-1", inputId: "input-1", startedAt: at } })] }) })?.kind, "working");
  assert.equal(state({ view: view({ actors: [actor()], turns: [turn({ status: "running", finishedAt: null })] }) })?.kind, "working");
  assert.equal(state({ view: undefined, running: true })?.kind, "working");
});

test("failed and interrupted setup turns show their reason instead of an endless loader", () => {
  for (const status of ["failed", "interrupted"] as const) {
    const result = state({ view: view({ actors: [actor()], turns: [turn({ status, reason: "The package could not be loaded" })] }) });
    assert.equal(result?.kind, "error");
    assert.equal(result?.detail, "The package could not be loaded");
  }
  assert.match(state({ view: view({ actors: [actor()], turns: [turn({ status: "failed" })] }) })!.detail, /could not be completed/);
});

test("a successful retry clears an older error from the same actor", () => {
  assert.equal(state({ view: view({ actors: [actor()], turns: [
    turn({ status: "failed", reason: "Old error" }), turn({ id: "turn-2", inputId: "input-2", status: "completed" }),
  ] }) }), undefined);
});

test("a queued or active retry resumes setup instead of displaying the previous failure", () => {
  const failed = turn({ status: "failed", reason: "Old error" });
  assert.equal(state({ view: view({ actors: [actor()], inputs: [input({ id: "input-2" })], turns: [failed] }) })?.kind, "working");
  assert.equal(state({ view: view({ actors: [actor()], turns: [failed, turn({ id: "turn-2", status: "running", finishedAt: null })] }) })?.kind, "working");
});

test("completion on another actor does not hide the latest setup failure", () => {
  const result = state({ view: view({
    actors: [actor(), actor({ id: "driver", handle: "driver" })],
    turns: [turn({ status: "failed", reason: "Setup failed" }), turn({ id: "driver-turn", actorId: "driver" })],
  }) });
  assert.equal(result?.kind, "error");
  assert.equal(result?.detail, "Setup failed");
});

test("stopped scripts with pending inputs or stale running turns never keep the loader alive", () => {
  const stopped = actor({ lifecycle: { kind: "stopped", stoppedAt: at, reason: "Stopped by the user" } });
  const result = state({ view: view({
    actors: [actor({ id: "owner", kind: "human" }), stopped], inputs: [input()], turns: [turn({ status: "running" })],
  }) });
  assert.equal(result?.kind, "stopped");
  assert.equal(state({ view: view({ actors: [stopped, actor({ id: "driver", handle: "driver" })], inputs: [input()] }) }), undefined);
});

test("claimed, discarded and orphaned inputs do not create phantom setup work", () => {
  for (const lifecycle of [{ kind: "claimed", turnId: "turn-1", steered: false }, { kind: "discarded", at, reason: "Discarded" }] as const) {
    assert.equal(state({ view: view({ actors: [actor()], inputs: [input({ lifecycle })] }) }), undefined);
  }
  assert.equal(state({ view: view({ actors: [actor()], inputs: [input({ actorId: "missing" })] }) }), undefined);
  assert.equal(state({ view: view({ actors: [actor({ id: "owner", kind: "human" })], inputs: [input({ actorId: "owner" })] }) }), undefined);
});

test("pending actions ask for an input without a spinner even while a turn is active", () => {
  const question: RunAction = {
    id: "question-1", askedBy: "setup", owner: "ragents.ask", payload: { question: "Continue working?", options: ["Continue"], multi: false },
    title: "Continue working?", description: null, parameters: {}, input: null, status: "pending",
    proposedAt: at, resolvedAt: null, resolvedBy: null, result: null,
  };
  const result = state({ running: true, view: view({ actors: [actor()], actions: [question] }) });
  assert.equal(result?.kind, "waiting");
  assert.match(result!.detail, /action in the chat is waiting/);
  assert.equal(state({ view: view({ actions: [{ ...question, status: "approved", resolvedAt: at }] }) }), undefined);
});

test("connection establishment loads an otherwise empty run and stops when connected", () => {
  assert.deepEqual(state({ view: undefined, connected: false }), {
    kind: "working", title: "Loading run", detail: "Connecting to the run.",
  });
  assert.equal(state({ view: undefined }), undefined);
  assert.equal(state(), undefined);
});

test("preparation and connection failures retain the concrete error without a working state", () => {
  const startup = { status: "failed", message: "Git access is unreachable" } as const;
  assert.equal(state({ startup, running: true, connected: false })?.kind, "error");
  assert.equal(state({ startup, error: "Connection lost" })?.detail, startup.message);
  assert.deepEqual(state({ error: "Connection lost", connected: false, running: true }), {
    kind: "error", title: "The run status is unreachable", detail: "Connection lost",
  });
});

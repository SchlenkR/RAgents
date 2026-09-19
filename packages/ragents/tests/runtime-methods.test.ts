import assert from "node:assert/strict";
import test from "node:test";

import { unrestrictedAccess, type AccessContext } from "../src/access.ts";
import { manualExecution } from "../src/domain/driver.ts";
import { runContracts } from "../src/http/contracts.ts";
import { runtimeMethods, type RuntimeMethodOptions } from "../src/http/methods.ts";
import { DomainError } from "../src/runtime/domain-error.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import type { MethodContext } from "../src/rpc/contribution.ts";
import { testServices } from "./support.ts";

const context = (access: AccessContext = unrestrictedAccess): MethodContext => ({
  access,
  signal: new AbortController().signal,
  progress: () => undefined,
  connection: { id: "test", userId: null, streamless: true, call: () => Promise.reject(new Error("kein Client")), onClose: () => () => undefined },
  local: true,
});

const fixture = (overrides: Partial<Pick<RuntimeMethodOptions, "abortTurns" | "assertAvailable" | "assertRunUsable" | "assertRunRights">> = {}) => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const rights: string[] = [];
  const methods = runtimeMethods({
    runtime,
    assertRunRights: (_access, runId, kind) => { rights.push(`${runId}:${kind}`); },
    projectView: (view) => view,
    hasRun: (runId) => journal.stateOf(runId) !== null,
    ...overrides,
  });
  const method = <C extends { id: string }>(contract: C) => {
    const found = methods.find((entry) => entry.contract.id === contract.id);
    if (!found) throw new Error(`Methode ${contract.id} fehlt`);
    return async (input: unknown, context: MethodContext): Promise<unknown> => found.execute(input as never, context);
  };
  const createRun = (title = "Methoden") => runtime.createRun({ commandId: `create-${title}` }, { title, ownerHandle: "owner", ownerDisplayName: "Owner" });
  const spawn = (runId: string, handle: string, grants: Parameters<Orchestration["spawnAgent"]>[2]["grants"] = []) =>
    runtime.spawnAgent({ actorId: runtime.state(runId).ownerId, commandId: `spawn-${handle}` }, runId, { handle, displayName: handle, prompt: "", execution: manualExecution(), grants, toolNames: [] });
  return { journal, runtime, methods, method, rights, createRun, spawn, close: () => journal.close() };
};

test("view, events and input enqueueing go through the contracts with rights checks", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.methods.map((entry) => entry.contract.id), Object.values(runContracts).map((contract) => contract.id));
    assert.equal(await f.method(runContracts.view)({ runId: "missing" }, context()), null);
    const run = f.createRun();
    const view = f.spawn(run.id, "worker");
    const worker = view.actors.find((entry) => entry.handle === "worker")!;
    const read = await f.method(runContracts.view)({ runId: run.id }, context()) as { id: string; actors: unknown[] };
    assert.equal(read.id, run.id);
    assert.equal(read.actors.length, 2);
    const after = await f.method(runContracts.enqueueInput)({ runId: run.id, commandId: "input-1", actorId: worker.id, content: "Plain text" }, context()) as { inputs: Array<{ content: string; actorId: string; lifecycle: { kind: string } }> };
    assert.equal(after.inputs.at(-1)?.content, "Plain text");
    assert.equal(after.inputs.at(-1)?.actorId, worker.id);
    const events = await f.method(runContracts.events)({ runId: run.id }, context()) as Array<{ type: string }>;
    assert.ok(events.some((event) => event.type === "actor.input.enqueued"));
    assert.deepEqual(f.rights.slice(0, 4), ["missing:read", `${run.id}:read`, `${run.id}:write-inspect`, `${run.id}:inspect`]);
  } finally {
    f.close();
  }
});

test("stopping an actor follows the createdBy branch", async () => {
  const f = fixture();
  try {
    let run = f.createRun("Actor stop");
    run = f.spawn(run.id, "parent", [{ capability: "agent.spawn", scope: { kind: "run" }, delegable: true }]);
    const parent = run.actors.find((entry) => entry.handle === "parent")!;
    run = f.runtime.enqueueInput({ actorId: run.ownerId, commandId: "parent-input" }, run.id, { actorId: parent.id, content: "Create a child." });
    const input = run.inputs.at(-1)!;
    run = f.runtime.startTurn({ actorId: parent.id, commandId: "parent-turn" }, run.id, parent.id, input.id);
    const turn = run.turns.at(-1)!;
    run = f.runtime.spawnAgent({ actorId: parent.id, commandId: "spawn-child", turnId: turn.id }, run.id, { handle: "child", displayName: "Child", prompt: "", execution: manualExecution(), grants: [], toolNames: [] });
    f.runtime.finishTurn({ actorId: parent.id, commandId: "finish-parent", turnId: turn.id }, run.id, parent.id, { turnId: turn.id, outcome: "completed" });
    const stopped = await f.method(runContracts.stopActor)({ runId: run.id, commandId: "stop-parent", actorId: parent.id, reason: "Done." }, context()) as { actors: Array<{ handle: string; lifecycle: { kind: string } }> };
    assert.equal(stopped.actors.find((entry) => entry.handle === "parent")?.lifecycle.kind, "stopped");
    assert.equal(stopped.actors.find((entry) => entry.handle === "child")?.lifecycle.kind, "stopped");
  } finally {
    f.close();
  }
});

test("the run guard protects reads and mutations", async () => {
  let blockedRunId: string | null = null;
  const f = fixture({ assertRunUsable: (runId) => { if (runId === blockedRunId) throw new DomainError("run-deleted", "The run has been deleted.", 410); } });
  try {
    const run = f.createRun("Guarded");
    const worker = f.spawn(run.id, "worker").actors.find((entry) => entry.handle === "worker")!;
    blockedRunId = run.id;
    await assert.rejects(f.method(runContracts.view)({ runId: run.id }, context()), (error: unknown) => error instanceof DomainError && error.status === 410);
    await assert.rejects(f.method(runContracts.enqueueInput)({ runId: run.id, commandId: "blocked", actorId: worker.id, content: "Blocked" }, context()), (error: unknown) => error instanceof DomainError && error.status === 410);
    assert.equal(f.runtime.view(run.id).inputs.length, 0);
  } finally {
    f.close();
  }
});

test("run stop preserves the primary actor and stops all other actors even when cleanup fails", async () => {
  const externallyStopped: string[] = [];
  const f = fixture({ abortTurns: async (runId) => { externallyStopped.push(runId); throw new DomainError("external-cleanup", "External cleanup failed.", 500); } });
  try {
    let run = f.createRun("Stop");
    run = f.spawn(run.id, "primary");
    run = f.spawn(run.id, "worker");
    const primary = run.actors.find((entry) => entry.handle === "primary")!;
    f.runtime.selectPrimaryActor({ actorId: run.ownerId, commandId: "select-primary" }, run.id, primary.id);
    await assert.rejects(f.method(runContracts.stopAll)({ runId: run.id, commandId: "stop-all", reason: "Stop." }, context()));
    assert.deepEqual(externallyStopped, [run.id]);
    const actors = f.runtime.view(run.id).actors.filter((entry) => entry.kind !== "human");
    assert.equal(actors.find((entry) => entry.id === primary.id)?.lifecycle.kind, "idle");
    assert.equal(actors.find((entry) => entry.handle === "worker")?.lifecycle.kind, "stopped");
  } finally {
    f.close();
  }
});

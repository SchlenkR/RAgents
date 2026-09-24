import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { DomainError, unrestrictedAccess, type MethodConnection, type MethodContext } from "@ragents/engine";
import {
  RunProcessTerminator,
  WorkspaceOperationError,
  parseDarwinMarkers,
  processIdOf,
  processTableForPlatform,
  type ProcessRecord,
  type ProcessTable,
} from "@ragents/workspace-executor";
import { createProcessMethods } from "../../../plugins/ragents.processes/server/methods.ts";
import { processesContracts } from "../../../plugins/ragents.processes/contract.ts";

const record = (pid: number, values: Partial<ProcessRecord> = {}): ProcessRecord => ({ pid, ppid: 1, pgid: 900, uid: 501, startKey: `start-${pid}`, command: "node app.js", ...values });
const fixture = (records: ProcessRecord[], markerEntries: [number, string][]) => {
  const state = { records, markers: new Map(markerEntries) };
  const signals: [number, string][] = [];
  const table: ProcessTable = {
    list: async () => [...state.records],
    runMarkers: async (pids) => new Map([...state.markers].filter(([pid]) => pids.includes(pid))),
    listeningPorts: async () => { throw new Error("Beenden darf nicht von offenen Ports abhängen"); },
  };
  const terminator = (sendSignal = (pid: number, signal: "SIGTERM" | "SIGKILL") => {
    signals.push([pid, signal]);
    state.records = state.records.filter((item) => item.pid !== pid);
  }) => new RunProcessTerminator({ table, executorPid: 900, executorUid: 501, termGraceMs: 10, killGraceMs: 10, timeoutMs: 200, pollIntervalMs: 2, sendSignal });
  return { state, table, signals, terminator };
};

test("run cleanup terminates all marked processes, including hidden tool children without ports, using positive PIDs", async () => {
  const f = fixture([record(10), record(11, { ppid: 10 }), record(12), record(20), record(900)], [[10, "run-a"], [11, "run-a"], [12, "run-a"], [20, "run-b"]]);
  await f.terminator().stopRun("run-a");
  assert.deepEqual(f.signals, [[10, "SIGTERM"], [11, "SIGTERM"], [12, "SIGTERM"]]);
  assert.deepEqual(f.state.records.map((item) => item.pid), [20, 900]);
});

test("a resistant process receives SIGKILL and children appearing during cleanup are collected too", async () => {
  const f = fixture([record(10)], [[10, "run-a"]]);
  await f.terminator((pid, signal) => {
    f.signals.push([pid, signal]);
    if (pid === 10 && signal === "SIGTERM") {
      f.state.records.push(record(11));
      f.state.markers.set(11, "run-a");
    }
    if (signal === "SIGKILL" || pid === 11) f.state.records = f.state.records.filter((item) => item.pid !== pid);
  }).stopRun("run-a");
  assert.deepEqual(f.signals.filter(([pid]) => pid === 10), [[10, "SIGTERM"], [10, "SIGKILL"]]);
  assert.deepEqual(f.signals.filter(([pid]) => pid === 11), [[11, "SIGTERM"]]);
  assert.deepEqual(f.state.records, []);
});

test("individual stop rejects a reused PID and a process belonging to another run", async () => {
  const f = fixture([record(10, { startKey: "new" })], [[10, "run-a"]]);
  await assert.rejects(f.terminator().stop("run-a", processIdOf(record(10))), (error: unknown) =>
    error instanceof WorkspaceOperationError && error.code === "stale-process" && error.status === 409 && /neu vergeben/.test(error.message));
  await assert.rejects(f.terminator().stop("run-b", processIdOf(f.state.records[0])), (error: unknown) =>
    error instanceof WorkspaceOperationError && error.code === "process-run-mismatch" && error.status === 403);
  assert.deepEqual(f.signals, []);
});

test("PID replacement between discovery and signal is not killed", async () => {
  const f = fixture([record(10)], [[10, "run-a"]]);
  let lists = 0;
  f.table.list = async () => {
    if (++lists === 2) f.state.records = [record(10, { startKey: "replacement" })];
    return [...f.state.records];
  };
  await f.terminator().stop("run-a", processIdOf(record(10)));
  assert.deepEqual(f.signals, []);
});

test("the run marker is checked again before signaling", async () => {
  const f = fixture([record(10)], [[10, "run-a"]]);
  let reads = 0;
  f.table.runMarkers = async () => new Map([[10, ++reads === 1 ? "run-a" : "run-b"]]);
  await assert.rejects(f.terminator().stop("run-a", processIdOf(record(10))), /nicht mehr zu diesem Run/);
  assert.deepEqual(f.signals, []);
});

test("the executor, init and the executor's ancestors remain protected even if marked", async () => {
  for (const pid of [1, 800, 900]) {
    const f = fixture([record(1), record(800), record(900, { ppid: 800 })], [[pid, "run-a"]]);
    await assert.rejects(f.terminator().stopRun("run-a"), /geschützten Prozessbaum des Executors/);
    assert.deepEqual(f.signals, []);
  }
});

test("an aborted request is noticed after asynchronous lookup and between TERM and KILL", async () => {
  const f = fixture([record(10)], [[10, "run-a"]]);
  const lookup = new AbortController();
  const list = f.table.list;
  f.table.list = async () => { lookup.abort(new Error("request aborted")); return list(); };
  await assert.rejects(f.terminator().stopRun("run-a", { signal: lookup.signal }), /request aborted/);
  assert.deepEqual(f.signals, []);
  f.table.list = list;
  const signaled = new AbortController();
  await assert.rejects(f.terminator((pid, signal) => { f.signals.push([pid, signal]); signaled.abort(new Error("request aborted")); }).stopRun("run-a", {
    signal: signaled.signal,
  }), /request aborted/);
  assert.deepEqual(f.signals, [[10, "SIGTERM"]]);
});

test("abort, signaling errors and an unkillable process fail explicitly", async () => {
  const f = fixture([record(10)], [[10, "run-a"]]);
  await assert.rejects(f.terminator().stopRun("run-a", { signal: AbortSignal.abort(new Error("aborted")) }), /aborted/);
  assert.deepEqual(f.signals, []);
  await assert.rejects(f.terminator(() => { throw new Error("EPERM"); }).stopRun("run-a"), /SIGTERM.*EPERM/);
  await assert.rejects(f.terminator((pid, signal) => { f.signals.push([pid, signal]); }).stopRun("run-a"), /nach SIGKILL noch aktiv/);
});

test("an unresponsive process table has a bounded failure", async () => {
  const f = fixture([], []);
  f.table.list = () => new Promise(() => {});
  await assert.rejects(f.terminator().stopRun("run-a"), /Stopp-Zeitgrenze/);
});

test("one process signaling failure does not prevent cleanup of the remaining run processes", async () => {
  const f = fixture([record(10), record(11)], [[10, "run-a"], [11, "run-a"]]);
  await assert.rejects(f.terminator((pid, signal) => {
    if (pid === 10) throw new Error("EPERM");
    f.signals.push([pid, signal]);
    f.state.records = f.state.records.filter((item) => item.pid !== pid);
  }).stopRun("run-a"), /SIGTERM.*EPERM/);
  assert.deepEqual(f.signals, [[11, "SIGTERM"]]);
  assert.deepEqual(f.state.records.map((item) => item.pid), [10]);
});

test("macOS markers come from the environment and not from a marker-looking argument", () => {
  const command = "node worker.js RAGENTS_RUN_ID=wrong-run";
  assert.deepEqual([...parseDarwinMarkers(`10 ${command} PATH=/bin RAGENTS_RUN_ID=run-a`, new Map([[10, command]]))], [[10, "run-a"]]);
  assert.deepEqual([...parseDarwinMarkers(`10 ${command} PATH=/bin`, new Map([[10, command]]))], []);
});

test("the stop method requires write access and hands the request's signal to the executor", async () => {
  let writable = false;
  const calls: AbortSignal[] = [];
  const methods = createProcessMethods({
    observer: { observe: async () => ({ runId: "run-a", observedAt: "now", processes: [] }), watch: () => () => {} },
    ensureWorkspaceAccess: () => {},
    terminate: async (_runId, _processId, signal) => { calls.push(signal); },
  });
  const method = methods.find((item) => item.contract.id === processesContracts.stop.id);
  assert.ok(method);
  assert.deepEqual(method.contract.rights, ["runs.read", "runs.write", "runs.inspect"]);
  const connection: MethodConnection = {
    id: "connection-1",
    userId: null,
    streamless: false,
    call: () => Promise.reject(new Error("Das Beenden ruft niemanden zurück")),
    onClose: () => () => undefined,
  };
  const context: MethodContext = {
    access: { ...unrestrictedAccess, can: (right: string) => right === "runs.read" || writable },
    signal: new AbortController().signal,
    progress: () => undefined,
    connection,
    local: true,
  };
  const input = { runId: "run-a", processId: processIdOf(record(10)) };
  const forbidden = (error: unknown) => error instanceof DomainError && error.status === 403;
  await assert.rejects(Promise.resolve().then(() => method.execute(input, context)), forbidden);
  assert.equal(calls.length, 0);
  writable = true;
  assert.equal(await method.execute(input, context), null);
  assert.deepEqual(calls, [context.signal]);
});

test("a detached owned test process is terminated on this platform without an external setsid program", async () => {
  const runId = `termination-${process.pid}-${Date.now()}`;
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.stdout.write('ready\\n');setInterval(()=>{},1000);setTimeout(()=>process.exit(0),30000)"], {
    detached: true,
    env: { PATH: process.env.PATH, RAGENTS_RUN_ID: runId },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout?.once("data", () => resolve());
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Testprozess endete vor der Bereitschaft")));
    });
    const table = processTableForPlatform();
    const ownTable: ProcessTable = {
      ...table,
      list: async () => (await table.list()).filter((item) => item.pid === child.pid || item.pid === process.pid),
      runMarkers: (pids) => table.runMarkers(pids.filter((pid) => pid === child.pid)),
    };
    const terminator = new RunProcessTerminator({ table: ownTable, executorPid: process.pid, executorUid: process.getuid?.(), termGraceMs: 50, pollIntervalMs: 10 });
    await terminator.stopRun(runId);
    await exited;
    assert.equal(child.signalCode, "SIGKILL");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
});

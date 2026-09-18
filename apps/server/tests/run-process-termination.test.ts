import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import { unrestrictedAccess } from "@aicontainer/ragents";
import { processIdOf, processTableForPlatform, parseDarwinMarkers, type ProcessRecord, type ProcessTable } from "../../../plugins/ragents.processes/server/process-table.ts";
import { RunProcessTerminator } from "../../../plugins/ragents.processes/server/terminator.ts";
import { createProcessRoutes } from "../../../plugins/ragents.processes/server/routes.ts";
import { processStopPath } from "../../../plugins/ragents.processes/contract.ts";
import { capturedJson } from "./runtime-fixture.ts";

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
  }) => new RunProcessTerminator({ table, serverPid: 900, serverUid: 501, termGraceMs: 10, killGraceMs: 10, timeoutMs: 200, pollIntervalMs: 2, sendSignal });
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
  await assert.rejects(f.terminator().stop("run-a", processIdOf(record(10))), /neu vergeben/);
  await assert.rejects(f.terminator().stop("run-b", processIdOf(f.state.records[0])), /nicht zu diesem Lauf/);
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
  await assert.rejects(f.terminator().stop("run-a", processIdOf(record(10))), /nicht mehr zu diesem Lauf/);
  assert.deepEqual(f.signals, []);
});

test("server, init and server ancestors remain protected even if marked", async () => {
  for (const pid of [1, 800, 900]) {
    const f = fixture([record(1), record(800), record(900, { ppid: 800 })], [[pid, "run-a"]]);
    await assert.rejects(f.terminator().stopRun("run-a"), /geschützten Server/);
    assert.deepEqual(f.signals, []);
  }
});

test("permission is revalidated after asynchronous lookup and between TERM and KILL", async () => {
  const f = fixture([record(10)], [[10, "run-a"]]);
  let allowed = true;
  const list = f.table.list;
  f.table.list = async () => { allowed = false; return list(); };
  await assert.rejects(f.terminator().stopRun("run-a", { assertAllowed: () => { if (!allowed) throw new Error("lease expired"); } }), /lease expired/);
  assert.deepEqual(f.signals, []);
  f.table.list = list;
  allowed = true;
  await assert.rejects(f.terminator((pid, signal) => { f.signals.push([pid, signal]); allowed = false; }).stopRun("run-a", {
    assertAllowed: () => { if (!allowed) throw new Error("lease expired"); },
  }), /lease expired/);
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

test("stop route requires write access and passes a live permission check to the terminator", async () => {
  const request = Object.assign(new EventEmitter(), { method: "POST", aborted: false }) as IncomingMessage;
  const url = new URL(`http://host${processStopPath("/api/plugins/ragents.processes", "run-a", processIdOf(record(10)))}`);
  let writable = false;
  let calls = 0;
  const routes = createProcessRoutes({
    observer: { observe: async () => ({ runId: "run-a", observedAt: "now", processes: [] }), watch: () => () => {} },
    ensureSession: () => {},
    terminate: async (_runId, _processId, context) => { calls++; writable = false; context.assertAllowed?.(); },
  });
  const route = routes.find((item) => item.matches(request, url));
  assert.ok(route);
  assert.deepEqual(route.requiredRights, ["runs.read", "runs.write", "runs.inspect"]);
  const access = { ...unrestrictedAccess, can: (right: string) => right === "runs.read" || writable };
  const denied = capturedJson();
  await route.handle({ request, response: denied.response, url, access });
  assert.equal(denied.captured.status, 403);
  assert.equal(calls, 0);
  writable = true;
  const expired = capturedJson();
  await route.handle({ request, response: expired.response, url, access });
  assert.equal(expired.captured.status, 403);
  assert.equal(calls, 1);
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
    const terminator = new RunProcessTerminator({ table: ownTable, serverPid: process.pid, serverUid: process.getuid?.(), termGraceMs: 50, pollIntervalMs: 10 });
    await terminator.stopRun(runId);
    await exited;
    assert.equal(child.signalCode, "SIGKILL");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
});

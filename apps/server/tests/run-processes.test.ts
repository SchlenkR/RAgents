import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createAccessContext, type MethodConnection, type MethodContext } from "@ragents/engine";

import type { RunProcessMessage, RunProcessPort, RunProcessSnapshot } from "../../../plugins/ragents.processes/contract.ts";
import { RunProcessObserver } from "../../../plugins/ragents.processes/server/observer.ts";
import { createProcessChannel, createProcessMethods } from "../../../plugins/ragents.processes/server/methods.ts";
import {
  ProcessChangedError,
  ProcessScanner,
  RUN_MARKER_ENV,
  addressFromHex,
  darwinProcessTable,
  labelOf,
  linuxProcessTable,
  parseDarwinMarkers,
  parseDarwinProcessTable,
  parseLinuxStat,
  parseLinuxTcpTable,
  parseLsofListeners,
  processTableForPlatform,
  runProcessesFrom,
  sandboxEnvironment,
  sandboxRunEnvironment,
  type ProcessRecord,
  type ProcessTable,
} from "@ragents/workspace-executor";

const SERVER_PID = 4711;

test("negative macOS system UIDs do not block process discovery", () => {
  const records = parseDarwinProcessTable(" 1158 1 1158 -2 Sun Sep 13 12:37:47 2026 /usr/libexec/dhcp6d");
  assert.equal(records[0]?.uid, -2);
  assert.equal(records[0]?.command, "/usr/libexec/dhcp6d");
  assert.throws(() => parseDarwinProcessTable(" -1158 1 1158 -2 Sun Sep 13 12:37:47 2026 invalid"), /Unlesbare Prozesszeile/);
});

const record = (values: Partial<ProcessRecord> & { pid: number }): ProcessRecord => ({
  ppid: 1,
  pgid: values.pid,
  uid: 501,
  startKey: `start-${values.pid}`,
  command: "node server.js",
  ...values,
});

const fakeTable = (state: {
  records: ProcessRecord[];
  markers: Map<number, string>;
  ports: Map<number, RunProcessPort[]>;
}) => {
  const markerRequests: number[][] = [];
  const portRequests: number[][] = [];
  const table: ProcessTable = {
    list: () => Promise.resolve([...state.records]),
    runMarkers: (pids) => {
      markerRequests.push([...pids]);
      return Promise.resolve(new Map([...state.markers].filter(([pid]) => pids.includes(pid))));
    },
    listeningPorts: (pids) => {
      portRequests.push([...pids]);
      return Promise.resolve(new Map([...state.ports].filter(([pid]) => pids.includes(pid))));
    },
  };
  return { table, markerRequests, portRequests };
};

test("die Sandbox-Umgebung trägt die Laufkennung als Marker", () => {
  const env = sandboxEnvironment({ PATH: "/bin" }, { home: { home: "/tmp/work" }, additions: sandboxRunEnvironment("run-7") });
  assert.equal(env[RUN_MARKER_ENV], "run-7");
  assert.equal(RUN_MARKER_ENV, "RAGENTS_RUN_ID");
});

test("Kinder eines laufenden Werkzeugaufrufs zählen nur mit offenem Port, Hintergrundprozesse immer", () => {
  const records = [
    record({ pid: 100, ppid: SERVER_PID, pgid: 100, command: "/bin/bash -c npm run dev" }),
    record({ pid: 101, ppid: 100, pgid: 100, command: "node /work/node_modules/.bin/vite --port 5173" }),
    record({ pid: 102, ppid: 100, pgid: 100, command: "git status" }),
    record({ pid: 200, ppid: 1, pgid: 200, command: "dotnet /work/ApiService.dll" }),
    record({ pid: 300, ppid: 1, pgid: 300, command: "node other.js" }),
    record({ pid: 400, ppid: SERVER_PID, pgid: 400, command: "typescript-language-server --stdio" }),
  ];
  const markers = new Map([[100, "run-1"], [101, "run-1"], [102, "run-1"], [200, "run-1"], [300, "run-2"], [400, "run-1"]]);
  const ports = new Map<number, RunProcessPort[]>([
    [101, [{ port: 5173, address: "*" }, { port: 5173, address: "::1" }]],
  ]);

  const processes = runProcessesFrom({
    runId: "run-1",
    executorPid: SERVER_PID,
    records,
    markerOf: (entry) => markers.get(entry.pid),
    ports,
    firstSeen: (entry) => `2026-09-03T10:00:0${entry.pid % 10}.000Z`,
  });

  assert.deepEqual(processes.map((process) => [process.pid, process.label, process.origin]), [
    [200, "dotnet ApiService.dll", "background"],
    [101, "node vite", "tool-call"],
  ]);
  assert.deepEqual(processes[1].ports, [{ port: 5173, address: "*" }, { port: 5173, address: "::1" }]);
});

test("das Label nennt den Interpreter mit seinem Skript, sonst nur das Programm", () => {
  assert.equal(labelOf("node /work/node_modules/.bin/vite --port 5173"), "node vite");
  assert.equal(labelOf("/usr/local/share/dotnet/dotnet run --project src/ApiService"), "dotnet run");
  assert.equal(labelOf("/usr/local/share/dotnet/dotnet /work/ApiService.dll"), "dotnet ApiService.dll");
  assert.equal(labelOf("/usr/local/share/dotnet/dotnet /work/DashboardServer.dll"), "dotnet DashboardServer.dll");
  assert.equal(labelOf("java -jar /opt/app.jar"), "java app.jar");
  assert.equal(labelOf("/opt/homebrew/bin/python3 -m http.server 8000"), "python3 http.server");
  assert.equal(labelOf("/Applications/Chromium.app/Contents/MacOS/Chromium --headless"), "Chromium");
  assert.equal(labelOf("node"), "node");
  assert.equal(labelOf("node -e setTimeout(()=>{},5000)"), "node");
  assert.equal(labelOf("python3 -c import time; time.sleep(9)"), "python3");
  assert.equal(labelOf(`node ${"x".repeat(80)}`).length, 40);
});

test("die macOS-Prozesstabelle, die Marker und die lsof-Ausgabe werden gelesen", () => {
  const table = parseDarwinProcessTable([
    "    1     0     1     0 Thu Sep  3 12:38:07 2026     /sbin/launchd",
    "56197 56194 56194   501 Thu Sep  3 15:17:44 2026     node -e setTimeout(()=>{},5000)",
    "  348     1   348     0 Thu Sep 13 12:39:55 2026     /usr/libexec/UserEventAgent (System)",
    "",
  ].join("\n"));
  assert.deepEqual(table[1], {
    pid: 56197, ppid: 56194, pgid: 56194, uid: 501, startKey: "Thu Sep  3 15:17:44 2026", command: "node -e setTimeout(()=>{},5000)",
  });
  assert.equal(table[2].command, "/usr/libexec/UserEventAgent (System)");
  assert.throws(() => parseDarwinProcessTable("kaputt"), /Unlesbare Prozesszeile/);

  const markers = parseDarwinMarkers([
    "56197 node -e x PATH=/bin RAGENTS_RUN_ID=run-1 HOME=/tmp",
    "56198 /bin/sleep 3",
    "56199 env RAGENTS_RUN_ID=run-2 node",
    "56200 node RAGENTS_RUN_ID=nicht/gültig",
  ].join("\n"));
  assert.deepEqual([...markers], [[56197, "run-1"], [56199, "run-2"]]);

  const listeners = parseLsofListeners(["p683", "f9", "n*:7000", "f10", "n*:7000", "f11", "n127.0.0.1:5000", "f12", "n[::1]:5000", "p700", "f3", "n[::]:8080", ""].join("\n"));
  assert.deepEqual([...listeners], [
    [683, [{ port: 7000, address: "*" }, { port: 5000, address: "127.0.0.1" }, { port: 5000, address: "::1" }]],
    [700, [{ port: 8080, address: "*" }]],
  ]);
});

test("macOS ignores an exited process between argument and environment reads without hiding live command mismatches", () => {
  const commands = new Map([
    [10, "node ending.js"],
    [11, "node gone.js"],
    [12, "node active.js RAGENTS_RUN_ID=wrong-run"],
    [13, "node <defunct>"],
  ]);
  const markers = parseDarwinMarkers([
    "10 <defunct>",
    "12 node active.js RAGENTS_RUN_ID=wrong-run PATH=/bin RAGENTS_RUN_ID=run-live",
    "13 node <defunct> PATH=/bin RAGENTS_RUN_ID=run-other",
  ].join("\n"), commands);
  assert.deepEqual([...markers], [[12, "run-live"], [13, "run-other"]]);
  assert.throws(() => parseDarwinMarkers("10 node changed.js RAGENTS_RUN_ID=run-live", commands),
    /Prozess 10 hat sich während der Umgebungsabfrage geändert/);
  assert.throws(() => parseDarwinMarkers("10 <defunct> RAGENTS_RUN_ID=run-live", commands),
    /Prozess 10 hat sich während der Umgebungsabfrage geändert/);
});

test("macOS rechecks only changed PIDs and never reads an appended marker argument as environment", async () => {
  const pids: string[] = [];
  const outputs = [
    "10 node stable.js\n11 node worker.js\n12 node original.js",
    "10 node stable.js PATH=/bin RAGENTS_RUN_ID=run-stable\n11 node worker.js RAGENTS_RUN_ID=wrong-run PATH=/bin RAGENTS_RUN_ID=run-live\n12 node temporary.js RAGENTS_RUN_ID=wrong-run",
    "10 node stable.js\n11 node worker.js RAGENTS_RUN_ID=wrong-run\n12 node original.js",
    "11 node worker.js RAGENTS_RUN_ID=wrong-run\n12 node original.js",
    "11 node worker.js RAGENTS_RUN_ID=wrong-run PATH=/bin RAGENTS_RUN_ID=run-live\n12 node original.js PATH=/bin",
    "11 node worker.js RAGENTS_RUN_ID=wrong-run\n12 node original.js",
  ];
  let calls = 0;
  const table = darwinProcessTable(async (file, args) => {
    assert.equal(file, "ps");
    assert.equal(args.includes("-E"), calls % 3 === 1);
    pids.push(args.at(-1)!);
    const output = outputs[calls++];
    assert.notEqual(output, undefined, "Unerwartete zusätzliche Prozessabfrage");
    return output!;
  });
  assert.deepEqual([...await table.runMarkers([10, 11, 12])], [[10, "run-stable"], [11, "run-live"]]);
  assert.deepEqual(pids, ["10,11,12", "10,11,12", "10,11,12", "11,12", "11,12", "11,12"]);
  assert.equal(calls, 6);
});

test("macOS fails after three unstable reads and the scanner does not cache a missing marker", async () => {
  let stable = false;
  let reads = 0;
  const table = darwinProcessTable(async (file, args) => {
    if (file === "lsof") return "";
    if (args.includes("-axww")) return "10 1 10 501 Thu Sep  3 15:17:44 2026 node worker.js";
    const phase = reads++ % 3;
    if (stable) return `10 node worker.js${phase === 1 ? " PATH=/bin RAGENTS_RUN_ID=run-live" : ""}`;
    return phase === 0 ? "10 node before.js"
      : `10 node after.js${phase === 1 ? " PATH=/bin RAGENTS_RUN_ID=secret-marker" : ""}`;
  });
  const scanner = new ProcessScanner({ table: () => table, executorPid: SERVER_PID, executorUid: 501 });
  await assert.rejects(scanner.snapshot("run-live"), (error: unknown) => {
    assert.ok(error instanceof ProcessChangedError);
    assert.equal(error.pid, 10);
    assert.doesNotMatch(error.message, /secret-marker|PATH|before\.js|after\.js/);
    return true;
  });
  assert.equal(reads, 9);
  stable = true;
  const snapshot = await scanner.snapshot("run-live");
  assert.deepEqual(snapshot.processes.map((process) => process.pid), [10]);
  assert.equal(reads, 12);
});

test("macOS marker retries do not catch command failures or malformed ps output", async () => {
  for (const failingPhase of [0, 1, 2]) {
    const failure = Object.assign(new Error("ps: operation not permitted"), { code: "EPERM" });
    let calls = 0;
    const table = darwinProcessTable(async () => {
      if (calls++ === failingPhase) throw failure;
      return "10 node stable.js";
    });
    await assert.rejects(table.runMarkers([10]), (error: unknown) => error === failure);
    assert.equal(calls, failingPhase + 1);
  }
  let calls = 0;
  const malformed = darwinProcessTable(async () => ++calls === 1 ? "10 node stable.js" : "sensitive-unreadable-output");
  await assert.rejects(malformed.runMarkers([10]), (error: unknown) => {
    assert.ok(error instanceof Error && !(error instanceof ProcessChangedError));
    assert.match(error.message, /Unlesbare Befehlszeile/);
    assert.doesNotMatch(error.message, /sensitive-unreadable-output/);
    return true;
  });
  assert.equal(calls, 2);
});

test("die Linux-Dateien aus /proc werden gelesen", () => {
  const stat = parseLinuxStat("1234 (node (dev) srv) S 1000 1234 1234 0 -1 4194560 100 0 0 0 5 1 0 0 20 0 11 0 987654 1 2 3 4 5 6 7 8 9 10 11");
  assert.deepEqual(stat, { comm: "node (dev) srv", state: "S", ppid: 1000, pgid: 1234, startTime: "987654" });
  assert.throws(() => parseLinuxStat("12 (x) S 1"), /Unlesbare stat-Zeile/);

  const listeners = parseLinuxTcpTable([
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:1431 00000000:0000 0A 00000000:00000000 00:00000000 00000000  4300        0 55555 1 0000000000000000 100 0 0 10 0",
    "   1: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 66666 1 0000000000000000 100 0 0 10 0",
    "   2: 0100007F:E4A3 0100007F:1431 01 00000000:00000000 00:00000000 00000000  4300        0 77777 1 0000000000000000 20 4 30 10 -1",
  ].join("\n"));
  assert.deepEqual(listeners, [
    { inode: "55555", port: { port: 5169, address: "127.0.0.1" } },
    { inode: "66666", port: { port: 8080, address: "*" } },
  ]);

  assert.equal(addressFromHex("00000000000000000000000000000000"), "*");
  assert.equal(addressFromHex("00000000000000000000000001000000"), "::1");
  assert.equal(addressFromHex("0000000000000000FFFF00000100007F"), "::ffff:127.0.0.1".replace("127.0.0.1", "7f00:1"));
  assert.throws(() => addressFromHex("abc"), /Unbekannte Adressform/);
});

/** Ein Prozess in einem nachgebauten /proc; `sealed` sperrt Umgebung und Dateideskriptoren wie bei PR_SET_DUMPABLE 0. */
const fakeProcess = async (proc: string, pid: number, environment: string, sealed: boolean): Promise<void> => {
  const directory = path.join(proc, String(pid));
  await mkdir(path.join(directory, "fd"), { recursive: true });
  await writeFile(path.join(directory, "stat"), `${pid} (chromium) S 1 ${pid} ${pid} 0 -1 4194560 100 0 0 0 5 1 0 0 20 0 11 0 4242 1 2 3 4 5 6 7 8 9 10 11`);
  await writeFile(path.join(directory, "status"), `Name:\tchromium\nUid:\t${process.getuid?.() ?? 0}\t0\t0\t0\n`);
  await writeFile(path.join(directory, "cmdline"), "chromium\0--type=renderer\0");
  await writeFile(path.join(directory, "environ"), environment);
  if (!sealed) return;
  await chmod(path.join(directory, "environ"), 0o000);
  await chmod(path.join(directory, "fd"), 0o000);
};

test("ein eigener Prozess mit gesperrter Umgebung trägt keinen Marker, statt Anzeige und Stopp scheitern zu lassen", { skip: process.getuid?.() === 0 }, async () => {
  const proc = await mkdtemp(path.join(tmpdir(), "ragents-fake-proc-"));
  try {
    await fakeProcess(proc, 41, `PATH=/usr/bin\0${RUN_MARKER_ENV}=run-1\0`, false);
    await fakeProcess(proc, 42, `${RUN_MARKER_ENV}=run-1\0`, true);
    const table = linuxProcessTable({ proc, asRoot: false });
    assert.deepEqual((await table.list()).map((entry) => entry.pid).sort(), [41, 42]);
    assert.deepEqual([...await table.runMarkers([41, 42])], [[41, "run-1"]]);
    assert.deepEqual([...await table.listeningPorts([42])], []);
    await assert.rejects(linuxProcessTable({ proc, asRoot: true }).runMarkers([42]), /Die Umgebung von Prozess 42 ist nicht lesbar \(EACCES\); als root braucht die Prozessüberwachung CAP_SYS_PTRACE/);
  } finally {
    await chmod(path.join(proc, "42", "fd"), 0o700).catch(() => undefined);
    await rm(proc, { recursive: true, force: true });
  }
});

test("der Scanner liest Marker nur für neue Prozesse und merkt sich die erste Sichtung", async () => {
  const state = {
    records: [
      record({ pid: 10, ppid: SERVER_PID, pgid: 10, command: "/bin/bash -c node app.js" }),
      record({ pid: 11, ppid: 10, pgid: 10, command: "node app.js" }),
      record({ pid: 20, uid: 0, command: "root-daemon" }),
    ],
    markers: new Map([[10, "run-1"], [11, "run-1"]]),
    ports: new Map<number, RunProcessPort[]>(),
  };
  const fake = fakeTable(state);
  let tick = 0;
  const scanner = new ProcessScanner({
    table: () => fake.table,
    executorPid: SERVER_PID,
    executorUid: 501,
    now: () => new Date(Date.UTC(2026, 8, 3, 10, 0, tick++)),
  });

  const first = await scanner.snapshot("run-1");
  assert.deepEqual(fake.markerRequests, [[10, 11]]);
  assert.deepEqual(first.processes, []);

  state.ports.set(11, [{ port: 3000, address: "*" }]);
  const second = await scanner.snapshot("run-1");
  assert.deepEqual(fake.markerRequests, [[10, 11]]);
  assert.deepEqual(second.processes.map((process) => [process.pid, process.origin, process.ports]), [
    [11, "tool-call", [{ port: 3000, address: "*" }]],
  ]);
  assert.equal(second.processes[0].seenSince, "2026-09-03T10:00:00.000Z");

  state.records = [record({ pid: 11, ppid: 1, pgid: 11, startKey: "neu", command: "node app.js" })];
  const third = await scanner.snapshot("run-1");
  assert.deepEqual(fake.markerRequests, [[10, 11], [11]]);
  assert.deepEqual(third.processes.map((process) => [process.pid, process.origin]), [[11, "background"]]);
  assert.deepEqual((await scanner.snapshot("run-1")).processes, third.processes);
});

test("der Beobachter fragt je Takt den Executor jedes Runs und meldet nur Änderungen", async () => {
  const snapshots = new Map<string, RunProcessSnapshot>([["run-1", { runId: "run-1", observedAt: "t0", processes: [] }]]);
  const asked: string[] = [];
  const observer = new RunProcessObserver({
    snapshot: async (runId) => {
      asked.push(runId);
      const snapshot = snapshots.get(runId);
      if (!snapshot) throw new Error(`Kein Stand für ${runId}`);
      return snapshot;
    },
    pollIntervalMs: 60_000,
  });
  const received: RunProcessMessage[] = [];
  const stop = observer.watch("run-1", (message) => received.push(message));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, ["run-1"]);
  assert.deepEqual(received.map((message) => message.kind), ["snapshot"]);

  const late: RunProcessMessage[] = [];
  const stopLate = observer.watch("run-1", (message) => late.push(message));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1, "unveränderter Stand geht nicht noch einmal an den ersten");
  assert.equal(late.length, 1, "ein neuer Abonnent bekommt den Stand sofort");

  snapshots.set("run-1", { runId: "run-1", observedAt: "t1", processes: [{
    id: "11-x", pid: 11, label: "node app.js", command: "node app.js", origin: "background", ports: [], seenSince: "t1",
  }] });
  assert.deepEqual((await observer.observe("run-1")).processes.map((process) => process.pid), [11]);
  const stopThird = observer.watch("run-1", () => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 2, "ein geänderter Stand geht an alle Abonnenten");
  assert.deepEqual(received[1]!.kind === "snapshot" ? received[1]!.snapshot.processes.map((process) => process.pid) : [], [11]);
  assert.deepEqual(observer.watchedRuns(), ["run-1"]);
  stop();
  stopLate();
  stopThird();
  assert.deepEqual(observer.watchedRuns(), []);
  await observer.shutdown();
});

test("ein hängender Executor friert nur seinen Run ein: die anderen melden weiter, seiner scheitert nach der Zeitgrenze", async () => {
  const aborted: string[] = [];
  let ticks = 0;
  let pending = 0;
  const observer = new RunProcessObserver({
    snapshot: (runId, signal) => {
      if (runId === "run-ok") return Promise.resolve({ runId, observedAt: `t${ticks++}`, processes: [] });
      pending++;
      return new Promise((_settle, fail) => signal.addEventListener("abort", () => {
        pending--;
        aborted.push(runId);
        fail(new Error("abgebrochen"));
      }));
    },
    pollIntervalMs: 20,
  });
  const ok: RunProcessMessage[] = [];
  const hanging: RunProcessMessage[] = [];
  const silenced = console.error;
  console.error = () => undefined;
  try {
    const stopHanging = observer.watch("run-hang", (message) => hanging.push(message));
    const stopOk = observer.watch("run-ok", (message) => ok.push(message));
    const started = Date.now();
    while (ticks < 3 && Date.now() - started < 2000) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(ticks >= 3, "der zweite Run wird weiter abgefragt, während der erste hängt");
    assert.equal(ok.length, 1, "unveränderter Stand geht nur einmal hinaus");
    while (hanging.length === 0 && Date.now() - started < 2000) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(hanging[0]?.kind === "error" ? hanging[0].error : "", /nicht innerhalb von 0.1 s beantwortet/);
    assert.deepEqual(aborted.slice(0, 1), ["run-hang"], "die Zeitgrenze bricht die Abfrage beim Executor ab");
    stopOk();
    while (pending === 0 && Date.now() - started < 4000) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(pending > 0, "eine neue Abfrage des hängenden Runs läuft");
    const before = aborted.length;
    stopHanging();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(aborted.length > before, "wer den letzten Beobachter abmeldet, bricht die laufende Abfrage ab");
  } finally {
    console.error = silenced;
    await observer.shutdown();
  }
});

test("ein Fehler beim Executor erreicht die Beobachter des Runs als Fehlermeldung, einmal", async () => {
  const observer = new RunProcessObserver({
    snapshot: () => Promise.reject(new Error("lsof ist nicht installiert; die Prozessüberwachung braucht es")),
    pollIntervalMs: 60_000,
  });
  const received: RunProcessMessage[] = [];
  const silenced = console.error;
  console.error = () => undefined;
  try {
    const stop = observer.watch("run-1", (message) => received.push(message));
    await new Promise((resolve) => setImmediate(resolve));
    stop();
  } finally {
    console.error = silenced;
  }
  assert.deepEqual(received, [{ kind: "error", error: "lsof ist nicht installiert; die Prozessüberwachung braucht es" }]);
  await observer.shutdown();
});

const connection: MethodConnection = {
  id: "connection-1",
  userId: null,
  streamless: false,
  call: () => Promise.reject(new Error("Die Prozessüberwachung ruft niemanden zurück")),
  onClose: () => () => undefined,
};

const context = (rights: readonly string[]): MethodContext => ({
  access: createAccessContext({ enabled: true, user: { id: "operator", label: "Operator", rights: [...rights] } }),
  signal: new AbortController().signal,
  progress: () => undefined,
  connection,
  local: true,
});

test("die Methoden liefern den Stand und der Ereigniskanal den Strom", async () => {
  const snapshot: RunProcessSnapshot = { runId: "run-1", observedAt: "2026-09-03T10:00:00.000Z", processes: [] };
  let listener: ((message: RunProcessMessage) => void) | undefined;
  let stopped = 0;
  const options = {
    terminate: async () => {},
    observer: {
      observe: () => Promise.resolve(snapshot),
      watch: (_runId: string, callback: (message: RunProcessMessage) => void) => {
        listener = callback;
        return () => { stopped += 1; };
      },
    },
    ensureWorkspaceAccess: (_access: unknown, runId: string) => {
      if (runId === "run-gone") throw new Error("Der Run wurde gelöscht");
    },
  };
  const [snapshotMethod, stopMethod] = createProcessMethods(options);
  const channel = createProcessChannel(options);

  assert.equal(snapshotMethod.contract.id, "ragents.processes.snapshot");
  assert.deepEqual(snapshotMethod.contract.rights, ["runs.read", "ragents.processes.read"]);
  assert.equal(stopMethod.contract.id, "ragents.processes.stop");
  assert.deepEqual(stopMethod.contract.rights, ["runs.read", "runs.write", "runs.inspect"]);
  assert.deepEqual(await snapshotMethod.execute({ runId: "run-1" }, context(["runs.read", "ragents.processes.read"])), snapshot);
  await assert.rejects(
    Promise.resolve().then(() => snapshotMethod.execute({ runId: "run-gone" }, context(["runs.read", "ragents.processes.read"]))),
    /gelöscht/,
  );

  assert.equal(channel.contract.id, "ragents.processes");
  assert.deepEqual(channel.contract.rights, ["runs.read", "ragents.processes.read"]);
  const emitted: unknown[] = [];
  const access = createAccessContext({ enabled: false, user: null });
  const stop = await channel.open({ runId: "run-1" }, (data) => emitted.push(data), { access, connection });
  assert.ok(listener, "der Kanal hat keinen Beobachter registriert");
  listener({ kind: "snapshot", snapshot });
  assert.deepEqual(emitted, [{ kind: "snapshot", snapshot }]);
  stop();
  assert.equal(stopped, 1);
  await assert.rejects(
    Promise.resolve().then(() => channel.open({ runId: "run-gone" }, () => {}, { access, connection })),
    /gelöscht/,
  );
});

const startListener = (runId: string): Promise<{ child: ChildProcess; port: number }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", [
      "const server = require('node:net').createServer();",
      "server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));",
      "setTimeout(() => process.exit(0), 30000);",
    ].join("")], {
      detached: true,
      env: { ...process.env, [RUN_MARKER_ENV]: runId },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const port = Number(output.trim());
      if (Number.isInteger(port) && port > 0) resolve({ child, port });
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Der Testprozess endete vorzeitig mit ${code}`)));
  });

test("auf dieser Plattform findet die echte Prozesstabelle einen markierten Prozess samt Port", async () => {
  const runId = `run-live-${process.pid}`;
  const { child, port } = await startListener(runId);
  child.removeAllListeners("exit");
  try {
    const table = processTableForPlatform();
    const inToolCall = new ProcessScanner({ table: () => table, executorPid: process.pid, executorUid: process.getuid?.() });
    const attached = await inToolCall.snapshot(runId);
    assert.deepEqual(attached.processes.map((entry) => [entry.pid, entry.origin, entry.ports]), [
      [child.pid, "tool-call", [{ port, address: "127.0.0.1" }]],
    ]);
    assert.equal(attached.processes[0].label, "node");
    assert.equal((await inToolCall.snapshot("run-other")).processes.length, 0);

    const elsewhere = new ProcessScanner({ table: () => table, executorPid: 1, executorUid: process.getuid?.() });
    const background = await elsewhere.snapshot(runId);
    assert.deepEqual(background.processes.map((entry) => [entry.pid, entry.origin]), [[child.pid, "background"]]);
  } finally {
    child.kill("SIGKILL");
  }
});

test("unter Windows gibt es keine Prozesstabelle, der Aufruf nennt die Ursache", () => {
  assert.throws(() => processTableForPlatform("win32"), /Unter Windows gibt es keine Prozesstabelle/);
  assert.throws(() => processTableForPlatform("freebsd"), /kennt die Plattform freebsd nicht/);
});

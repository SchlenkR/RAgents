import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";

import type { RunProcessMessage, RunProcessPort, RunProcessSnapshot } from "../../../plugins/ragents.processes/contract.ts";
import { RunProcessObserver } from "../../../plugins/ragents.processes/server/observer.ts";
import {
  addressFromHex,
  darwinProcessTable,
  parseDarwinMarkers,
  parseDarwinProcessTable,
  parseLinuxStat,
  parseLinuxTcpTable,
  parseLsofListeners,
  processTableForPlatform,
  ProcessChangedError,
  type ProcessRecord,
  type ProcessTable,
} from "../../../plugins/ragents.processes/server/process-table.ts";
import { createProcessChannel, createProcessRoutes } from "../../../plugins/ragents.processes/server/routes.ts";
import { labelOf, runProcessesFrom } from "../../../plugins/ragents.processes/server/snapshot.ts";
import { RUN_MARKER_ENV } from "../src/plugin-support/run-marker.ts";
import { sanitizedEnv } from "../src/plugin-support/sandbox-tools.ts";
import { capturedJson } from "./runtime-fixture.ts";

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
  const env = sanitizedEnv({ PATH: "/bin" }, { runId: "run-7", workspace: { cwd: "/tmp/work" } });
  assert.equal(env[RUN_MARKER_ENV], "run-7");
  assert.equal(RUN_MARKER_ENV, "RAGENTS_RUN_ID");
});

test("Kinder eines laufenden Werkzeugaufrufs zählen nur mit offenem Port, Hintergrundprozesse immer", () => {
  const records = [
    record({ pid: 100, ppid: SERVER_PID, pgid: 100, command: "/bin/bash -c npm run dev" }),
    record({ pid: 101, ppid: 100, pgid: 100, command: "node /work/node_modules/.bin/vite --port 5173" }),
    record({ pid: 102, ppid: 100, pgid: 100, command: "git status" }),
    record({ pid: 200, ppid: 1, pgid: 200, command: "dotnet /work/UiService.dll" }),
    record({ pid: 300, ppid: 1, pgid: 300, command: "node other.js" }),
    record({ pid: 400, ppid: SERVER_PID, pgid: 400, command: "typescript-language-server --stdio" }),
  ];
  const markers = new Map([[100, "run-1"], [101, "run-1"], [102, "run-1"], [200, "run-1"], [300, "run-2"], [400, "run-1"]]);
  const ports = new Map<number, RunProcessPort[]>([
    [101, [{ port: 5173, address: "*" }, { port: 5173, address: "::1" }]],
  ]);

  const processes = runProcessesFrom({
    runId: "run-1",
    serverPid: SERVER_PID,
    records,
    markerOf: (entry) => markers.get(entry.pid),
    ports,
    firstSeen: (entry) => `2026-09-03T10:00:0${entry.pid % 10}.000Z`,
  });

  assert.deepEqual(processes.map((process) => [process.pid, process.label, process.origin]), [
    [200, "dotnet UiService.dll", "background"],
    [101, "node vite", "tool-call"],
  ]);
  assert.deepEqual(processes[1].ports, [{ port: 5173, address: "*" }, { port: 5173, address: "::1" }]);
});

test("das Label nennt den Interpreter mit seinem Skript, sonst nur das Programm", () => {
  assert.equal(labelOf("node /work/node_modules/.bin/vite --port 5173"), "node vite");
  assert.equal(labelOf("/usr/local/share/dotnet/dotnet run --project src/UiService"), "dotnet run");
  assert.equal(labelOf("/usr/local/share/dotnet/dotnet /work/UiService.dll"), "dotnet UiService.dll");
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

test("macOS fails after three unstable reads and the observer does not cache a missing marker", async () => {
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
  const observer = new RunProcessObserver({ table, serverPid: SERVER_PID, serverUid: 501, pollIntervalMs: 60_000 });
  try {
    await assert.rejects(observer.observe("run-live"), (error: unknown) => {
      assert.ok(error instanceof ProcessChangedError);
      assert.equal(error.pid, 10);
      assert.doesNotMatch(error.message, /secret-marker|PATH|before\.js|after\.js/);
      return true;
    });
    assert.equal(reads, 9);
    stable = true;
    const snapshot = await observer.observe("run-live");
    assert.deepEqual(snapshot.processes.map((process) => process.pid), [10]);
    assert.equal(reads, 12);
  } finally { await observer.shutdown(); }
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

test("der Beobachter liest Marker nur für neue Prozesse und meldet nur Änderungen", async () => {
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
  const observer = new RunProcessObserver({
    table: fake.table,
    serverPid: SERVER_PID,
    serverUid: 501,
    pollIntervalMs: 60_000,
    now: () => new Date(Date.UTC(2026, 8, 3, 10, 0, tick++)),
  });
  const received: RunProcessMessage[] = [];
  const stop = observer.watch("run-1", (message) => received.push(message));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fake.markerRequests, [[10, 11]]);
  assert.equal(received.length, 1);
  assert.equal(received[0].kind, "snapshot");
  assert.deepEqual((received[0] as { snapshot: RunProcessSnapshot }).snapshot.processes, []);

  state.ports.set(11, [{ port: 3000, address: "*" }]);
  const second = await observer.observe("run-1");
  assert.deepEqual(fake.markerRequests, [[10, 11]]);
  assert.deepEqual(second.processes.map((process) => [process.pid, process.origin, process.ports]), [
    [11, "tool-call", [{ port: 3000, address: "*" }]],
  ]);
  assert.equal(second.processes[0].seenSince, "2026-09-03T10:00:00.000Z");

  state.records = [record({ pid: 11, ppid: 1, pgid: 11, startKey: "neu", command: "node app.js" })];
  const third = await observer.observe("run-1");
  assert.deepEqual(fake.markerRequests, [[10, 11], [11]]);
  assert.deepEqual(third.processes.map((process) => [process.pid, process.origin]), [[11, "background"]]);

  const unchanged = await observer.observe("run-1");
  assert.deepEqual(unchanged.processes, third.processes);
  assert.deepEqual(observer.watchedRuns(), ["run-1"]);
  stop();
  assert.deepEqual(observer.watchedRuns(), []);
  await observer.shutdown();
});

test("ein Scanfehler erreicht die Beobachter als Fehlermeldung, einmal", async () => {
  const table: ProcessTable = {
    list: () => Promise.reject(new Error("lsof ist nicht installiert; die Prozessüberwachung braucht es")),
    runMarkers: () => Promise.resolve(new Map()),
    listeningPorts: () => Promise.resolve(new Map()),
  };
  const observer = new RunProcessObserver({ table, serverPid: SERVER_PID, serverUid: 501, pollIntervalMs: 60_000 });
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

test("die Routen liefern den Stand als JSON und der Ereigniskanal den Strom", async () => {
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
    ensureSession: (runId: string) => {
      if (runId === "run-gone") throw new Error("Die Unterhaltung wurde gelöscht");
    },
  };
  const [snapshotRoute, stopRoute] = createProcessRoutes(options);
  const channel = createProcessChannel(options);

  const url = new URL("http://host/api/plugins/ragents.processes/runs/run-1/processes");
  assert.deepEqual(snapshotRoute.requiredRights, ["runs.read", "ragents.processes.read"]);
  assert.equal(stopRoute.id, "ragents.processes.stop");
  assert.ok(snapshotRoute.isApiPath(url.pathname));
  assert.ok(snapshotRoute.matches({ method: "GET" } as IncomingMessage, url));
  assert.ok(!snapshotRoute.matches({ method: "POST" } as IncomingMessage, url));
  const { captured, response } = capturedJson();
  await snapshotRoute.handle({ request: { method: "GET" } as IncomingMessage, response, url });
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, snapshot);

  const gone = capturedJson();
  await snapshotRoute.handle({
    request: { method: "GET" } as IncomingMessage,
    response: gone.response,
    url: new URL("http://host/api/plugins/ragents.processes/runs/run-gone/processes"),
  });
  assert.equal(gone.captured.status, 400);
  assert.deepEqual(gone.captured.body, { error: "Die Unterhaltung wurde gelöscht" });

  assert.deepEqual(channel.requiredRights("processes:run-1"), ["runs.read", "ragents.processes.read"]);
  assert.ok(channel.matches("processes:run-1"));
  assert.ok(!channel.matches("processes:"));
  assert.ok(!channel.matches("run:run-1"));
  const emitted: unknown[] = [];
  const stop = await channel.open("processes:run-1", (data) => emitted.push(data), {} as never);
  assert.ok(listener, "der Kanal hat keinen Beobachter registriert");
  listener({ kind: "snapshot", snapshot });
  assert.deepEqual(emitted, [{ kind: "snapshot", snapshot }]);
  stop();
  assert.equal(stopped, 1);
  await assert.rejects(Promise.resolve().then(() => channel.open("processes:run-gone", () => {}, {} as never)), /gelöscht/);
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
    const inToolCall = new RunProcessObserver({ table, serverPid: process.pid, serverUid: process.getuid?.(), pollIntervalMs: 60_000 });
    const attached = await inToolCall.observe(runId);
    assert.deepEqual(attached.processes.map((entry) => [entry.pid, entry.origin, entry.ports]), [
      [child.pid, "tool-call", [{ port, address: "127.0.0.1" }]],
    ]);
    assert.equal(attached.processes[0].label, "node");
    assert.equal((await inToolCall.observe("run-other")).processes.length, 0);

    const elsewhere = new RunProcessObserver({ table, serverPid: 1, serverUid: process.getuid?.(), pollIntervalMs: 60_000 });
    const background = await elsewhere.observe(runId);
    assert.deepEqual(background.processes.map((entry) => [entry.pid, entry.origin]), [[child.pid, "background"]]);
  } finally {
    child.kill("SIGKILL");
  }
});

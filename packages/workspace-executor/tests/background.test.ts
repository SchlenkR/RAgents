import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  BACKGROUND_TASK_OPERATIONS,
  PROCESS_OPERATIONS,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  hasProcessTable,
  processModule,
  runProcessesFrom,
  sandboxToolsModule,
  workspaceProcessContext,
  type ProcessRecord,
  type WorkspaceProcessSnapshot,
} from "../src/index.ts";
import { processExists } from "../src/managed-process.ts";

const onWindows = process.platform === "win32";

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

const until = async (condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> => {
  const started = Date.now();
  while (!await condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const coded = (code: string) => (error: unknown): boolean => error instanceof WorkspaceOperationError && error.code === code;

/** A node one-liner as a bash command; the marked node process is what the process table can see on every platform. */
const node = (source: string): string => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;

const fixture = async (t: TestContext, modules = [sandboxToolsModule]) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-background-")));
  const workspace = path.join(directory, "workspace");
  const logs = path.join(directory, "logs");
  await mkdir(workspace, { recursive: true });
  const executor = new WorkspaceOperationExecutor({
    modules,
    contextFor: (runId) => Promise.resolve(workspaceProcessContext({
      runId,
      cwd: workspace,
      root: workspace,
      home: { home: path.join(directory, "home") },
      logDirectory: logs,
      hostRoot: undefined,
      additions: { RAGENTS_RUN_ID: runId },
    })),
  });
  t.after(async () => {
    await executor.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const start = async (runId: string, command: string): Promise<string> => {
    const result = await executor.execute(runId, "bash", { command, run_in_background: true, timeout: 120_000 }) as { details?: { backgroundTaskId?: string } };
    const id = result.details?.backgroundTaskId;
    assert.ok(id, JSON.stringify(result));
    assert.equal(textOf(result), `Command running in background with ID: ${id}. task_output reads its new output, task_stop ends it.`);
    return id;
  };
  const output = async (runId: string, id: string): Promise<string> =>
    textOf(await executor.execute(runId, BACKGROUND_TASK_OPERATIONS.output, { task_id: id }));
  const wait = (runId: string, id: string, signal?: AbortSignal) =>
    executor.execute(runId, BACKGROUND_TASK_OPERATIONS.wait, { task_id: id }, { ...(signal ? { signal, untilAborted: true } : {}) });
  return { directory, workspace, logs, executor, start, output, wait };
};

const pidFrom = async (read: () => Promise<string>): Promise<number> => {
  let pid = 0;
  await until(async () => {
    pid = Number(/pid (\d+)/.exec(await read())?.[1] ?? 0);
    return pid > 0;
  });
  return pid;
};

test("a background command returns at once, survives the call, and its output reads incrementally", { skip: onWindows }, async (t) => {
  const f = await fixture(t);
  const id = await f.start("run-1", node("console.log('pid ' + process.pid); setTimeout(() => console.log('second'), 300); setInterval(() => {}, 1000)"));
  assert.match(id, /^b[0-9a-f]{6}$/);
  const collected: string[] = [];
  const pid = await pidFrom(async () => {
    collected.push(await f.output("run-1", id));
    return collected.join("\n");
  });
  assert.equal(processExists(pid), true, "the command keeps running after the call");
  assert.match(collected.at(-1)!, /Status: running$/);
  await until(async () => /second/.test(await f.output("run-1", id).then((text) => {
    collected.push(text);
    return text;
  })));
  assert.doesNotMatch(collected.at(-1)!, /pid \d+/, "a later read returns only the new output");
  assert.equal(await f.output("run-1", id), "(no new output)\n\nStatus: running");
  assert.match(textOf(await f.executor.execute("run-1", "bash", { command: "echo foreground" })), /foreground/);
  assert.equal(processExists(pid), true, "a foreground call does not end a background command");
});

test("the end of a command is observed with its exit code, its output stays readable, and an abort ends only the observation", { skip: onWindows }, async (t) => {
  const f = await fixture(t);
  const observer = new AbortController();
  const id = await f.start("run-1", "sleep 0.3; echo finished; exit 3");
  const aborted = f.wait("run-1", id, observer.signal);
  observer.abort();
  await assert.rejects(aborted);
  assert.deepEqual(await f.wait("run-1", id), { state: "exited", exitCode: 3, signal: null, stopped: false });
  assert.equal(await f.output("run-1", id), "finished\n\nStatus: exited with code 3");
  assert.equal(textOf(await f.executor.execute("run-1", BACKGROUND_TASK_OPERATIONS.stop, { task_id: id })),
    `Background command ${id} had already exited with code 3.`);
});

test("task_stop ends the command with everything it started, and the observation reports the stop", { skip: onWindows }, async (t) => {
  const f = await fixture(t);
  const id = await f.start("run-1", `${node("console.log('pid ' + process.pid); setInterval(() => {}, 1000)")} & wait`);
  const pid = await pidFrom(() => f.output("run-1", id));
  const ended = f.wait("run-1", id);
  assert.equal(textOf(await f.executor.execute("run-1", BACKGROUND_TASK_OPERATIONS.stop, { task_id: id })), `Stopped background command ${id}.`);
  assert.deepEqual(await ended, { state: "exited", exitCode: null, signal: "SIGTERM", stopped: true });
  await until(() => !processExists(pid));
  assert.match(await f.output("run-1", id), /Status: stopped with task_stop$/);
});

test("the stop of the run ends its background commands and removes their output files; an unknown ID names the cause", { skip: onWindows }, async (t) => {
  const f = await fixture(t);
  const id = await f.start("run-1", node("console.log('pid ' + process.pid); setInterval(() => {}, 1000)"));
  const other = await f.start("run-2", node("console.log('pid ' + process.pid); setInterval(() => {}, 1000)"));
  const pid = await pidFrom(() => f.output("run-1", id));
  const otherPid = await pidFrom(() => f.output("run-2", other));
  assert.deepEqual((await readdir(path.join(f.logs, "background"))).sort(), [`${id}.log`, `${other}.log`].sort());
  await f.executor.stopRun("run-1");
  await until(() => !processExists(pid));
  assert.equal(processExists(otherPid), true, "another run keeps its command");
  assert.deepEqual(await readdir(path.join(f.logs, "background")), [`${other}.log`]);
  await assert.rejects(f.output("run-1", id), coded("background-task-unknown"));
  await assert.rejects(f.executor.execute("run-2", BACKGROUND_TASK_OPERATIONS.stop, { task_id: 7 }), coded("background-task-invalid"));
  await f.executor.shutdown();
  await until(() => !processExists(otherPid));
});

test("more new output than one read carries shows its end, starting at a line, and says how much was left out", { skip: onWindows }, async (t) => {
  const f = await fixture(t);
  const id = await f.start("run-1", node("for (let i = 0; i < 3000; i++) console.log('line ' + i + ' ' + 'x'.repeat(20)); console.log('y'.repeat(1500))"));
  assert.deepEqual(await f.wait("run-1", id), { state: "exited", exitCode: 0, signal: null, stopped: false });
  const text = await f.output("run-1", id);
  const lines = text.split("\n");
  assert.match(lines[0]!, /^\[\d+\.\dKB of earlier output left out\]$/);
  assert.match(lines[1]!, /^line \d+ x{20}$/, "the first shown line is a whole line");
  assert.match(text, /line 2999 x{20}\ny{1000} \[line shortened, 500 more characters\]\n\nStatus: exited with code 0$/);
  assert.ok(Buffer.byteLength(text) < 21 * 1024);
});

test("background command groups count as background in the process display, also as direct children of the executor", () => {
  const uid = process.getuid?.() ?? 0;
  const records: ProcessRecord[] = [
    { pid: 20, ppid: 5, pgid: 20, uid, startKey: "a", command: "bash -c npm run dev" },
    { pid: 21, ppid: 20, pgid: 20, uid, startKey: "b", command: "node vite.js" },
    { pid: 30, ppid: 5, pgid: 30, uid, startKey: "c", command: "node build.js" },
  ];
  const processes = runProcessesFrom({
    runId: "run-1",
    executorPid: 5,
    backgroundGroups: new Set([20]),
    records,
    markerOf: () => "run-1",
    ports: new Map(),
    firstSeen: () => "2026-10-03T00:00:00.000Z",
  });
  assert.deepEqual(processes.map((entry) => [entry.pid, entry.origin]), [[20, "background"], [21, "background"]]);
});

test("the process display shows a background command of the run as background, and the process module stop ends it", { skip: onWindows || !hasProcessTable() }, async (t) => {
  const f = await fixture(t, [sandboxToolsModule, processModule()]);
  const runId = `background-display-${process.pid}`;
  const id = await f.start(runId, node("console.log('pid ' + process.pid); setInterval(() => {}, 1000)"));
  const pid = await pidFrom(() => f.output(runId, id));
  const snapshot = await f.executor.execute(runId, PROCESS_OPERATIONS.snapshot, {}) as WorkspaceProcessSnapshot;
  const seen = snapshot.processes.find((entry) => entry.pid === pid);
  assert.ok(seen, JSON.stringify(snapshot.processes));
  assert.equal(seen.origin, "background");
  const ended = f.wait(runId, id);
  await f.executor.execute(runId, PROCESS_OPERATIONS.stop, { processId: seen.id });
  assert.equal((await ended as { stopped?: boolean }).stopped, false, "a stop from the process display is not a task_stop");
});

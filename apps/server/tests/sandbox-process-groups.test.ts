import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { processGroupExists } from "../src/plugin-support/managed-process.ts";
import { createSandboxTools } from "../src/plugin-support/sandbox-tools.ts";

const darwin = process.platform === "darwin";
const permissionError = () => Object.assign(new Error("kill EPERM"), { code: "EPERM" });
const missingError = () => Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(darwin ? "/private/tmp" : os.tmpdir(), "ragents-bash-groups-"));
  const tools = await createSandboxTools("process-group-test", {
    cwd: directory, currentRoot: async () => directory, ensureWritable: async () => directory,
    runOperation: (operation) => operation(),
  }, [], undefined);
  t.after(async () => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await tools.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const bash = tools.find((tool) => (tool as { name: string }).name === "bash") as {
    execute: (id: string, input: { command: string; timeout?: number }, signal?: AbortSignal,
      update?: (result: { content: { text?: string }[] }) => void) => Promise<{ content: { text?: string }[] }>;
  };
  return { bash, tools };
};

const mockProcessTable = (t: TestContext, output: string | Error) => {
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    assert.equal(args[0], "/bin/ps");
    assert.deepEqual(args[1], ["-axo", "pgid=,stat="]);
    const callback = args.at(-1) as (error: Error | null, stdout: string) => void;
    queueMicrotask(() => callback(output instanceof Error ? output : null, typeof output === "string" ? output : ""));
    return {} as ChildProcess;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
};

test("Bash returns output and a nonzero exit code as an ordinary result after normal process completion", async (t) => {
  const { bash } = await fixture(t);
  assert.match(JSON.stringify(await bash.execute("success", { command: "printf 'finished\\n'" })), /finished/);
  const failure = await bash.execute("failure", { command: "printf 'missing dependency\\n' >&2; exit 7" });
  assert.equal(failure.content[0]?.text, "missing dependency\n\n\nCommand exited with code 7");
  const silent = await bash.execute("no-match", { command: "printf 'haystack\\n' | grep needle" });
  assert.equal(silent.content[0]?.text, "(no output)\n\nCommand exited with code 1");
});

test("macOS detects a real zombie-only process group as finished", { skip: !darwin, timeout: 10_000 }, async () => {
  const source = [
    "import os, select, sys",
    "pid = os.fork()",
    "if pid == 0:",
    "    os.setsid()",
    "    os._exit(0)",
    "os.waitid(os.P_PID, pid, os.WEXITED | os.WNOWAIT)",
    "print(pid, flush=True)",
    "select.select([sys.stdin], [], [], 5)",
    "os.waitpid(pid, 0)",
  ].join("\n");
  const parent = childProcess.spawn("python3", ["-c", source], { cwd: "/private/tmp", stdio: ["pipe", "pipe", "pipe"] });
  const finished = new Promise<void>((resolve, reject) => {
    parent.once("error", reject);
    parent.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Zombie fixture exited with ${code}`)));
  });
  parent.stderr.resume();
  try {
    const pid = await new Promise<number>((resolve, reject) => {
      parent.once("error", reject);
      parent.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
      parent.once("close", () => reject(new Error("Zombie fixture exited before reporting its child")));
    });
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    assert.throws(() => process.kill(-pid, 0), { code: "EPERM" });
    assert.equal(await processGroupExists(pid), false);
  } finally {
    parent.stdin.end("reap\n");
    await finished;
  }
});

for (const entry of [
  { name: "missing", rows: "1 Ss\n", exists: false },
  { name: "zombie-only", rows: "987654 Z\n987654 Z+\n1 Ss\n", exists: false },
  { name: "living", rows: "987654 Z\n987654 S+\n", exists: true },
]) test(`macOS resolves EPERM against the ${entry.name} process group`, { skip: !darwin }, async (t) => {
  const originalKill = process.kill.bind(process);
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid === -987654) throw permissionError();
    return originalKill(pid, signal);
  });
  mockProcessTable(t, entry.rows);
  assert.equal(await processGroupExists(987654), entry.exists);
});

for (const output of [new Error("ps denied"), "", "unreadable process row"]) {
  test(`macOS refuses an unavailable or invalid process table: ${String(output)}`, { skip: !darwin }, async (t) => {
    const originalKill = process.kill.bind(process);
    t.mock.method(process, "kill", (pid, signal) => {
      if (pid === -987654) throw permissionError();
      return originalKill(pid, signal);
    });
    mockProcessTable(t, output);
    await assert.rejects(processGroupExists(987654), /ps denied|ungültige Prozessliste/);
  });
}

test("Bash tolerates EPERM only when the process group disappeared between check and signal", { skip: !darwin }, async (t) => {
  const { bash } = await fixture(t);
  const originalKill = process.kill.bind(process);
  let signalled = false;
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid >= 0) return originalKill(pid, signal);
    if (signal === "SIGKILL") { signalled = true; throw permissionError(); }
    if (signal === 0 && signalled) throw missingError();
    return true;
  });
  assert.match(JSON.stringify(await bash.execute("race", { command: "printf 'completed\\n'" })), /completed/);
  assert.equal(signalled, true);
});

test("Bash retains a real permission error when a process group is still alive", { skip: !darwin }, async (t) => {
  const { bash } = await fixture(t);
  const originalKill = process.kill.bind(process);
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid >= 0) return originalKill(pid, signal);
    if (signal === "SIGKILL") throw permissionError();
    return true;
  });
  await assert.rejects(bash.execute("denied", { command: "printf 'completed\\n'" }), /kill EPERM/);
});

test("macOS treats empty or unknown state columns as present, skips unparsable rows and fails only without any row", { skip: !darwin }, async (t) => {
  t.mock.method(process, "kill", (pid: number) => {
    if (pid < 0) throw permissionError();
    return true;
  });
  mockProcessTable(t, "  101 S+\n 29497 \n  202 Z\n 404 ?\n S+\n");
  assert.equal(await processGroupExists(29497), true);
  assert.equal(await processGroupExists(404), true);
  assert.equal(await processGroupExists(101), true);
  assert.equal(await processGroupExists(202), false);
  assert.equal(await processGroupExists(303), false);
  mockProcessTable(t, " S+\n\n");
  await assert.rejects(processGroupExists(101), /ungültige Prozessliste/);
});

test("Bash reports failed process inspection instead of reporting success", { skip: !darwin }, async (t) => {
  const { bash } = await fixture(t);
  const originalKill = process.kill.bind(process);
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid < 0) throw permissionError();
    return originalKill(pid, signal);
  });
  mockProcessTable(t, new Error("ps denied"));
  await assert.rejects(bash.execute("unreadable", { command: "printf 'completed\\n'" }), /ps denied/);
});

test("Bash timeout and shutdown still settle active commands and their groups", { timeout: 10_000 }, async (t) => {
  const { bash, tools } = await fixture(t);
  await assert.rejects(bash.execute("timeout", { command: "sleep 2", timeout: 0.02 }), /Command timed out/);
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const running = bash.execute("shutdown", { command: "printf 'ready\\n'; sleep 2" }, undefined, (result) => {
    if (result.content.some((entry) => entry.text?.includes("ready"))) started();
  });
  await ready;
  await tools.shutdown();
  await running;
  await assert.rejects(bash.execute("after-shutdown", { command: "true" }), /killed/);
});

test("Bash removes a surviving child after its shell has exited", { timeout: 10_000 }, async (t) => {
  const { bash } = await fixture(t);
  const result = await bash.execute("background-child", { command: "sleep 2 >/dev/null 2>&1 & printf 'group=%s child=%s\\n' \"$$\" \"$!\"" });
  const match = /group=(\d+) child=(\d+)/.exec(result.content[0]!.text!);
  assert.ok(match);
  assert.notEqual(match[1], match[2]);
  assert.equal(await processGroupExists(Number(match[1])), false);
});

test("Bash abort waits for group cleanup", { timeout: 10_000 }, async (t) => {
  const { bash } = await fixture(t);
  const abort = new AbortController();
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const running = bash.execute("abort", { command: "printf 'ready group=%s\\n' \"$$\"; sleep 2" }, abort.signal, (result) => {
    if (result.content.some((entry) => entry.text?.includes("ready"))) started();
  });
  await ready;
  abort.abort();
  const result = await running;
  const match = /group=(\d+)/.exec(result.content[0]!.text!);
  assert.ok(match);
  assert.equal(await processGroupExists(Number(match[1])), false);
});

test("Bash rejects promptly when both group termination and child.kill throw", { timeout: 5_000 }, async (t) => {
  const { bash } = await fixture(t);
  const originalKill = process.kill.bind(process);
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid >= 0) return originalKill(pid, signal);
    if (signal === "SIGKILL") throw permissionError();
    return true;
  });
  t.mock.method(childProcess.ChildProcess.prototype, "kill", () => { throw permissionError(); });
  const abort = new AbortController();
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const running = bash.execute("kill-denied", { command: "printf 'ready\\n'; sleep 2" }, abort.signal, (result) => {
    if (result.content.some((entry) => entry.text?.includes("ready"))) started();
  });
  const rejected = assert.rejects(running, /Bash-Prozess konnte nicht beendet werden/);
  await ready;
  abort.abort();
  await rejected;
});

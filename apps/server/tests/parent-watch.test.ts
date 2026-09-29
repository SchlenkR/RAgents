import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { processAlive, watchParentProcess } from "../src/parent-watch.ts";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("without RAGENTS_PARENT_PID there is no watcher", () => {
  let gone = 0;
  const stop = watchParentProcess({ parentPid: undefined, onGone: () => { gone += 1; }, alive: () => false, intervalMs: 1 });
  assert.equal(stop, undefined);
  assert.equal(gone, 0);
});

test("a set but nonsensical parent id is a hard error", () => {
  for (const given of ["", " ", "0", "-1", "1.5", "abc", "12x", `${Number.MAX_SAFE_INTEGER}0`]) {
    assert.throws(() => watchParentProcess({ parentPid: given, onGone: () => undefined }), /RAGENTS_PARENT_PID/, given);
  }
});

test("when the parent process is gone, the host shuts down exactly once", async () => {
  const gone: number[] = [];
  let lives = true;
  const stop = watchParentProcess({ parentPid: "4711", onGone: (pid) => gone.push(pid), alive: () => lives, intervalMs: 1 });
  assert.ok(stop);
  await delay(20);
  assert.deepEqual(gone, []);
  lives = false;
  await delay(20);
  assert.deepEqual(gone, [4711]);
  await delay(20);
  assert.deepEqual(gone, [4711]);
  stop();
});

test("the liveness check recognizes its own process and an ended process", async () => {
  assert.equal(processAlive(process.pid), true);
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  assert.equal(processAlive(child.pid!), false);
});

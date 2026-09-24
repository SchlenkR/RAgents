import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { processAlive, watchParentProcess } from "../src/parent-watch.ts";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("ohne RAGENTS_PARENT_PID gibt es keinen Wächter", () => {
  let gone = 0;
  const stop = watchParentProcess({ parentPid: undefined, onGone: () => { gone += 1; }, alive: () => false, intervalMs: 1 });
  assert.equal(stop, undefined);
  assert.equal(gone, 0);
});

test("eine gesetzte, aber unsinnige Elternkennung ist ein harter Fehler", () => {
  for (const given of ["", " ", "0", "-1", "1.5", "abc", "12x", `${Number.MAX_SAFE_INTEGER}0`]) {
    assert.throws(() => watchParentProcess({ parentPid: given, onGone: () => undefined }), /RAGENTS_PARENT_PID/, given);
  }
});

test("ist der Elternprozess weg, fährt der Host genau einmal herunter", async () => {
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

test("die Lebendprüfung erkennt den eigenen Prozess und einen beendeten Prozess", async () => {
  assert.equal(processAlive(process.pid), true);
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  assert.equal(processAlive(child.pid!), false);
});

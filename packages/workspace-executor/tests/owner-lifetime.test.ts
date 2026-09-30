import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { watchOwnerLifetime } from "../src/owner-lifetime.mjs";

for (const event of ["end", "close", "error"]) {
  test(`stdin ${event} stops once, retaining signal handlers until cleanup finishes`, () => {
    const stdin = new PassThrough();
    const signals = new EventEmitter();
    const stops: string[] = [];
    const release = watchOwnerLifetime({ stdin, signals, parents: [42], alive: () => true, onStop: (reason) => stops.push(reason) });
    stdin.emit(event);
    signals.emit("SIGTERM");
    assert.equal(stops.length, 1);
    assert.equal(signals.listenerCount("SIGHUP"), 1);
    release();
    assert.equal(signals.listenerCount("SIGHUP"), 0);
    assert.equal(stdin.listenerCount("end"), 0);
  });
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM", "disconnect"]) {
  test(`${signal} stops an attached workspace`, () => {
    const signals = new EventEmitter();
    const stops: string[] = [];
    watchOwnerLifetime({ stdin: null, signals, parents: [42], alive: () => true, onStop: (reason) => stops.push(reason) });
    signals.emit(signal);
    assert.equal(stops.length, 1);
  });
}

test("a dead owner stops the workspace even when its immediate parent survives", async () => {
  const seen: number[] = [];
  const stops: string[] = [];
  watchOwnerLifetime({ stdin: null, signals: new EventEmitter(), parents: [42, 43], intervalMs: 5,
    alive: (pid) => { seen.push(pid); return pid === 42; }, onStop: (reason) => stops.push(reason) });
  await delay(20);
  assert.deepEqual(stops, ["parent exited"]);
  assert.deepEqual(seen, [42, 43]);
});

test("detached workspaces ignore stdin, parent death, disconnect, and SIGHUP but honor SIGTERM", async () => {
  const signals = new EventEmitter();
  const stdin = new PassThrough();
  const stops: string[] = [];
  watchOwnerLifetime({ detached: true, stdin, signals, parents: [42], intervalMs: 5,
    alive: () => { throw new Error("Detached workspaces must not check their owner"); }, onStop: (reason) => stops.push(reason) });
  stdin.end();
  signals.emit("disconnect");
  signals.emit("SIGHUP");
  await delay(20);
  assert.deepEqual(stops, []);
  signals.emit("SIGTERM");
  assert.deepEqual(stops, ["SIGTERM"]);
});

test("stdin already closed before ownership starts also stops the workspace", async () => {
  const stdin = new PassThrough();
  stdin.destroy();
  const stops: string[] = [];
  watchOwnerLifetime({ stdin, signals: new EventEmitter(), parents: [42], alive: () => true, onStop: (reason) => stops.push(reason) });
  await delay(0);
  assert.equal(stops.length, 1);
});

test("disposing ownership also cancels a queued initial parent check", async () => {
  const stops: string[] = [];
  const release = watchOwnerLifetime({ stdin: null, signals: new EventEmitter(), parents: [42], alive: () => false, onStop: (reason) => stops.push(reason) });
  release();
  await delay(0);
  assert.deepEqual(stops, []);
});

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { refreshOnChange } from "../src/lib/refresh-on-change.ts";

class Visibility extends EventTarget {
  visibilityState = "visible";
  change(state: string) {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const timers = (t: TestContext) => t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000 });

test("change refresh loads immediately, coalesces nudges and spaces starts by two seconds", async (t) => {
  timers(t);
  const starts: number[] = [];
  const refresh = refreshOnChange(async () => { starts.push(Date.now()); }, new Visibility());
  t.after(refresh.dispose);
  assert.deepEqual(starts, [10_000]);
  await settle();
  for (let index = 0; index < 100; index++) refresh.nudge();
  t.mock.timers.tick(1999);
  assert.equal(starts.length, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(starts, [10_000, 12_000]);
  t.mock.timers.tick(3000);
  refresh.nudge();
  t.mock.timers.tick(249);
  assert.equal(starts.length, 2);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(starts, [10_000, 12_000, 15_250]);
  t.mock.timers.tick(10_000);
  assert.equal(starts.length, 3);
});

test("nudges during a slow refresh cause exactly one follow-up and never overlap", async (t) => {
  timers(t);
  let finish: () => void = () => { throw new Error("No refresh is running"); };
  let starts = 0;
  const refresh = refreshOnChange(() => {
    starts += 1;
    return new Promise<void>((resolve) => { finish = resolve; });
  }, new Visibility());
  t.after(refresh.dispose);
  for (let index = 0; index < 100; index++) refresh.nudge();
  t.mock.timers.tick(5000);
  assert.equal(starts, 1);
  finish();
  await settle();
  t.mock.timers.tick(0);
  assert.equal(starts, 2);
  finish();
  await settle();
  t.mock.timers.tick(10_000);
  assert.equal(starts, 2);
});

test("a quick in-flight refresh still waits until two seconds after its start", async (t) => {
  timers(t);
  let finish!: () => void;
  let starts = 0;
  const refresh = refreshOnChange(() => {
    starts += 1;
    return new Promise<void>((resolve) => { finish = resolve; });
  }, new Visibility());
  t.after(refresh.dispose);
  refresh.nudge();
  finish();
  await settle();
  t.mock.timers.tick(1999);
  assert.equal(starts, 1);
  t.mock.timers.tick(1);
  assert.equal(starts, 2);
  finish();
  await settle();
});

test("hidden pages defer initial loads and all nudges until one visible refresh", async (t) => {
  timers(t);
  const visibility = new Visibility();
  visibility.change("hidden");
  let starts = 0;
  const refresh = refreshOnChange(async () => { starts += 1; }, visibility);
  t.after(refresh.dispose);
  for (let index = 0; index < 100; index++) refresh.nudge();
  t.mock.timers.tick(30_000);
  assert.equal(starts, 0);
  visibility.change("visible");
  t.mock.timers.tick(0);
  await settle();
  assert.equal(starts, 1);
  t.mock.timers.tick(30_000);
  assert.equal(starts, 1);
});

test("hiding cancels a scheduled refresh and revealing refreshes even without a nudge", async (t) => {
  timers(t);
  const visibility = new Visibility();
  let starts = 0;
  const refresh = refreshOnChange(async () => { starts += 1; }, visibility);
  t.after(refresh.dispose);
  await settle();
  refresh.nudge();
  visibility.change("hidden");
  t.mock.timers.tick(10_000);
  assert.equal(starts, 1);
  visibility.change("visible");
  t.mock.timers.tick(0);
  await settle();
  assert.equal(starts, 2);
  visibility.change("hidden");
  visibility.change("visible");
  t.mock.timers.tick(1999);
  assert.equal(starts, 2);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(starts, 3);
});

test("disposal cancels timers, visibility updates and in-flight follow-ups", async (t) => {
  timers(t);
  const visibility = new Visibility();
  let finish!: () => void;
  let starts = 0;
  const refresh = refreshOnChange(() => {
    starts += 1;
    return new Promise<void>((resolve) => { finish = resolve; });
  }, visibility);
  refresh.nudge();
  refresh.dispose();
  finish();
  await settle();
  visibility.change("hidden");
  visibility.change("visible");
  refresh.nudge();
  t.mock.timers.tick(30_000);
  assert.equal(starts, 1);
  const scheduled = refreshOnChange(async () => { starts += 1; }, visibility);
  await settle();
  scheduled.nudge();
  scheduled.dispose();
  t.mock.timers.tick(30_000);
  assert.equal(starts, 2);
});

test("an explicit refresh starts at once after a load and disposal releases queued callers", async (t) => {
  timers(t);
  let finish!: () => void;
  const starts: number[] = [];
  const refresh = refreshOnChange(() => {
    starts.push(Date.now());
    return new Promise<void>((resolve) => { finish = resolve; });
  }, new Visibility());
  let completed = false;
  const waiting = refresh.refresh().then(() => { completed = true; });
  finish();
  await settle();
  t.mock.timers.tick(0);
  assert.deepEqual(starts, [10_000, 10_000]);
  assert.equal(completed, false);
  finish();
  await waiting;
  assert.equal(completed, true);
  refresh.nudge();
  const queued = refresh.refresh();
  t.mock.timers.tick(0);
  assert.equal(starts.length, 3);
  const pending = refresh.refresh();
  refresh.dispose();
  await pending;
  finish();
  await queued;
});

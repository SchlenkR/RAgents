import assert from "node:assert/strict";
import test from "node:test";
import { defineProgram, type ProgramState, type ProgramWorld } from "../src/plugin-support/actor-programs/program-runner.ts";

type Body = Parameters<typeof defineProgram>[1];
type Context = Parameters<Body>[0];
type Calls = Record<string, (input: unknown) => unknown>;

/** Evaluates a program like the host: the state persists between evaluations, writes and run function calls are counted. */
const harness = (body: (ctx: Context) => unknown, options: { messages?: readonly string[]; functions?: Calls } = {}) => {
  const program = defineProgram({
    capabilities: Object.keys(options.functions ?? {}),
    messages: Object.fromEntries((options.messages ?? []).map((name) => [name, { label: name, input: { type: "object" } }])),
  }, body as Body);
  let state: unknown = {};
  let writes = 0;
  const calls: [string, unknown][] = [];
  return {
    get state() { return state as ProgramState; },
    get writes() { return writes; },
    calls,
    set state(value: ProgramState) { state = value; },
    evaluate: (world: Partial<ProgramWorld> & { now: string }) => program.evaluate({ timeZone: "UTC", revision: "first", message: null, files: {}, ...world }, {
      run: { id: "run" }, actor: { id: "actor", handle: "program" }, signal: new AbortController().signal,
      state: { read: () => structuredClone(state), replace: (value) => { state = structuredClone(value); writes += 1; } },
      functions: Object.fromEntries(Object.entries(options.functions ?? {}).map(([name, call]) => [name, async (input?: unknown) => { calls.push([name, input]); return call(input); }])),
      log: () => undefined, throwIfAborted: () => undefined,
    }),
  };
};
const at = (hours: number) => new Date(Date.parse("2026-08-16T12:00:00.000Z") + hours * 3600000).toISOString();

test("useState keeps its first value by position, useStateWith creates it once, and named cells appear under values", async () => {
  let created = 0;
  const program = harness(async (ctx) => {
    const counter = ctx.useState(5, "counter");
    const list = ctx.useStateWith(() => { created += 1; return ["first"]; }, "list");
    counter.set(counter.value + 1);
    list.set([...list.value, "second"]);
    await ctx.waitUntil({ afterMs: 3600000 });
  });
  assert.equal((await program.evaluate({ now: at(0) })).status, "waiting");
  assert.deepEqual(program.state.values, { counter: 6, list: ["first", "second"] });
  assert.deepEqual(program.state.root.slots.slice(0, 2), [{ kind: "useState", first: 5, name: "counter" }, { kind: "useState", first: ["first"], name: "list" }]);
  await program.evaluate({ now: at(0.5) });
  assert.equal(created, 1, "the factory runs only when the cell is created");
  assert.equal(program.writes, 1, "a re-evaluation that ends in the same wait writes nothing");
});

test("a step runs once and later evaluations return its stored result, including an empty one", async () => {
  let runs = 0;
  const program = harness(async (ctx) => {
    const value = await ctx.step(() => { runs += 1; return { draft: `Draft ${runs}` }; });
    const nothing = await ctx.step(() => { runs += 1; });
    await ctx.waitUntil({ afterMs: 60000 });
    return { value, nothing: nothing === undefined };
  });
  await program.evaluate({ now: at(0) });
  await program.evaluate({ now: at(0.001) });
  assert.equal(runs, 2);
  assert.deepEqual(program.state.root.slots.slice(0, 2), [{ kind: "step", done: true, result: { draft: "Draft 1" } }, { kind: "step", done: true }]);
  assert.equal((await program.evaluate({ now: at(1) })).status, "done");
  assert.deepEqual(program.state.result, { value: { draft: "Draft 1" }, nothing: true });
  assert.equal(runs, 2);
});

test("a failed step keeps the progress before it, retries on the next evaluation and names its position", async () => {
  let attempts = 0;
  const program = harness(async (ctx) => {
    await ctx.step(() => "prepared");
    await ctx.step(() => { attempts += 1; if (attempts === 1) throw new Error("Service unavailable."); return "published"; });
  });
  const failed = await program.evaluate({ now: at(0) });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "The step at #1 step failed: Service unavailable.");
  assert.equal(program.state.wakeAt, at(0), "a failed program wants to run again");
  assert.deepEqual(program.state.root.slots, [{ kind: "step", done: true, result: "prepared" }, { kind: "step" }]);
  assert.equal((await program.evaluate({ now: at(1) })).status, "done");
  assert.equal(attempts, 2);
});

test("waitUntil suspends with its wake time and continues once the time has come", async () => {
  const program = harness(async (ctx) => {
    const first = await ctx.waitUntil({ at: at(2) });
    const second = await ctx.waitUntil({ afterMs: 30 * 60000 });
    return [first.at, second.at];
  });
  await program.evaluate({ now: at(0) });
  assert.deepEqual(program.state.waiting, { position: `#0 waitUntil(at ${at(2)})`, kind: "waitUntil", message: null, until: at(2), file: null });
  assert.equal(program.state.wakeAt, at(2));
  await program.evaluate({ now: at(2) });
  assert.equal(program.state.wakeAt, at(2.5), "a duration counts from the first evaluation that reaches it");
  await program.evaluate({ now: at(2.5) });
  assert.equal(program.state.status, "done");
  assert.deepEqual(program.state.result, [at(2), at(2.5)]);
});

test("receive takes a message only while it waits, keeps it, and ends as timeout after its time", async () => {
  const program = harness(async (ctx) => {
    const answer = await ctx.receive("approval", { timeoutMs: 3600000 });
    const second = await ctx.receive("approval", { timeoutMs: 3600000 });
    return [answer, second];
  }, { messages: ["approval"] });
  const early = await program.evaluate({ now: at(0), message: { name: "other", value: {} } });
  assert.equal(early.consumed, false);
  assert.deepEqual(program.state.waiting, { position: '#0 receive("approval")', kind: "receive", message: "approval", until: at(1), file: null });
  const received = await program.evaluate({ now: at(0.5), message: { name: "approval", value: { approved: true } } });
  assert.equal(received.consumed, true);
  assert.equal(program.state.waiting?.position, '#1 receive("approval")', "one message reaches one receive");
  await program.evaluate({ now: at(2) });
  assert.deepEqual(program.state.result, [{ kind: "message", value: { approved: true } }, { kind: "timeout" }]);
  await assert.rejects(harness(async (ctx) => ctx.receive("unknown" as never)).evaluate({ now: at(0) }).then((outcome) => { if (outcome.status === "failed") throw new Error(outcome.error!); }), /names no message of this program/);
});

test("watch asks for the file hash, keeps the first one and finishes when the content hash changes", async () => {
  const program = harness(async (ctx) => (await ctx.watch("/srv/inbox/report.txt")).hash);
  const asked = await program.evaluate({ now: at(0) });
  assert.deepEqual(asked.needs, ["/srv/inbox/report.txt"]);
  await program.evaluate({ now: at(0), files: { "/srv/inbox/report.txt": { hash: "aaa" } } });
  assert.deepEqual(program.state.waiting?.file, { path: "/srv/inbox/report.txt", hash: "aaa" });
  const writes = program.writes;
  await program.evaluate({ now: at(1), files: { "/srv/inbox/report.txt": { hash: "aaa" } } });
  assert.equal(program.writes, writes, "the same content is the same wait");
  await program.evaluate({ now: at(2), files: { "/srv/inbox/report.txt": { hash: null } } });
  assert.equal(program.state.status, "done");
  assert.equal(program.state.result, null, "a deleted file is a change with hash null");
  const denied = await harness(async (ctx) => ctx.watch("/etc/passwd")).evaluate({ now: at(0), files: { "/etc/passwd": { error: "Path outside the working directory" } } });
  assert.equal(denied.status, "failed");
  assert.match(denied.error!, /Path outside the working directory/);
});

test("when keeps the branch state with elsePreserve, drops it with elseForget, and assignments of a dropped branch stay in effect", async () => {
  let condition = true;
  let runs = 0;
  const program = harness(async (ctx) => {
    const total = ctx.useState(0, "total");
    const preserved = await ctx.when(condition, async () => {
      const count = ctx.useState(10);
      count.set(count.value + 1);
      return ctx.step(() => { runs += 1; return count.value; });
    }, ctx.elsePreserve);
    await ctx.when(condition, async () => {
      total.set(total.value + 1);
      await ctx.step(() => { runs += 1; });
    }, ctx.elseForget);
    await ctx.receive("next");
    return [preserved ?? null, total.value];
  }, { messages: ["next"] });
  await program.evaluate({ now: at(0) });
  assert.equal(runs, 2);
  condition = false;
  await program.evaluate({ now: at(1) });
  const [kept, dropped] = program.state.root.slots.slice(1, 3);
  assert.equal(kept?.kind === "when" && kept.then !== undefined, true, "elsePreserve keeps the branch");
  assert.equal(dropped?.kind === "when" && dropped.then === undefined, true, "elseForget drops the branch");
  assert.deepEqual(program.state.values, { total: 1 }, "the dropped branch still counted");
  condition = true;
  await program.evaluate({ now: at(2), message: { name: "next", value: {} } });
  assert.equal(runs, 3, "the preserved branch continues without repeating its step, the forgotten one starts over");
  assert.deepEqual(program.state.result, [11, 2]);
});

test("forEach keeps state per key across reordering and forgets keys that disappear", async () => {
  let items = ["a", "b"];
  const steps: string[] = [];
  const program = harness(async (ctx) => {
    const done = ctx.useState(0, "done");
    await ctx.forEach(items, (item) => item, async (item) => {
      await ctx.step(() => { steps.push(item); });
      done.set(done.value + 1);
    });
    await ctx.receive("next");
  }, { messages: ["next"] });
  await program.evaluate({ now: at(0) });
  items = ["b", "a"];
  await program.evaluate({ now: at(1) });
  assert.deepEqual(steps, ["a", "b"], "a reordered list keeps each item's state");
  items = ["b", "c"];
  await program.evaluate({ now: at(2) });
  assert.deepEqual(steps, ["a", "b", "c"]);
  const loop = program.state.root.slots[1];
  assert.deepEqual(loop?.kind === "forEach" ? loop.items.map((item) => item.key) : [], ["b", "c"]);
  assert.deepEqual(program.state.values, { done: 3 }, "the forgotten item's assignment still counts");
  const duplicate = await harness(async (ctx) => ctx.forEach(["x", "x"], (item) => item, () => undefined)).evaluate({ now: at(0) });
  assert.match(duplicate.error!, /The forEach key "x" occurs twice/);
});

test("a daily wait returns the latest occurrence, wakes at the next one, and a keyed day forgets yesterday", async () => {
  const program = harness(async (ctx) => {
    const approvals = ctx.useState(0, "approvals");
    const today = await ctx.waitUntil({ daily: "08:00", timeZone: "Europe/Berlin" });
    await ctx.forEach([today], (day) => day.at, async () => {
      const answer = await ctx.receive("approval", { timeoutMs: 24 * 3600000 });
      await ctx.when(answer.kind === "message", () => approvals.set(approvals.value + 1), ctx.elseForget);
    });
  }, { messages: ["approval"] });
  await program.evaluate({ now: at(0) });
  assert.equal(program.state.wakeAt, "2026-08-17T06:00:00.000Z");
  await program.evaluate({ now: at(18) });
  await program.evaluate({ now: at(20), message: { name: "approval", value: {} } });
  assert.equal(program.state.status, "done");
  assert.equal(program.state.wakeAt, "2026-08-18T06:00:00.000Z", "the next occurrence wakes the program");
  await program.evaluate({ now: at(42) });
  assert.equal(program.state.waiting?.position, '#2 forEach ["2026-08-18T06:00:00.000Z"] > #0 receive("approval")');
  await program.evaluate({ now: at(43), message: { name: "approval", value: {} } });
  assert.deepEqual(program.state.values, { approvals: 2 });
  await program.evaluate({ now: at(24 * 9 + 18) });
  assert.equal(program.state.waiting?.position, '#2 forEach ["2026-08-26T06:00:00.000Z"] > #0 receive("approval")', "after downtime only the latest day runs");
  const loop = program.state.root.slots[2];
  assert.equal(loop?.kind === "forEach" ? loop.items.length : 0, 1);
});

test("a structure that no longer matches blocks the program with position and both kinds and keeps the recorded state", async () => {
  const cases: [string, (ctx: Context) => Promise<unknown>, (ctx: Context) => Promise<unknown>, RegExp][] = [
    ["other kind", async (ctx) => { await ctx.step(() => 1); await ctx.receive("go"); }, async (ctx) => { await ctx.waitUntil({ afterMs: 1000 }); await ctx.receive("go"); },
      /^This program cannot be continued: at #0 the recorded slot is step, the code now calls waitUntil\(after 1000ms\)\. Restore/],
    ["missing slot", async (ctx) => { await ctx.step(() => 1); await ctx.step(() => 2); }, async (ctx) => { await ctx.step(() => 1); },
      /at #1 the recorded slot is step, the code no longer calls it/],
    ["extra slot", async (ctx) => { await ctx.step(() => 1); }, async (ctx) => { await ctx.step(() => 1); await ctx.step(() => 2); },
      /at #1 the program body ended after 1 slots, the code now calls step there/],
    ["changed key", async (ctx) => { await ctx.receive("go"); }, async (ctx) => { await ctx.receive("stop"); },
      /at #0 the recorded slot is receive\("go"\), the code now calls receive\("stop"\) with another key/],
    ["nested position", async (ctx) => { await ctx.when(true, async () => { await ctx.receive("go"); }, ctx.elseForget); },
      async (ctx) => { await ctx.when(true, async () => { await ctx.step(() => 1); }, ctx.elseForget); },
      /at #0 when then > #0 the recorded slot is receive\("go"\), the code now calls step/],
  ];
  for (const [label, before, after, expected] of cases) {
    let body = before;
    const program = harness((ctx) => body(ctx), { messages: ["go", "stop"] });
    await program.evaluate({ now: at(0) });
    const recorded = program.state;
    body = after;
    const blocked = await program.evaluate({ now: at(1), revision: "second" });
    assert.equal(blocked.status, "blocked", label);
    assert.match(blocked.error!, expected, label);
    assert.deepEqual(program.state.root, recorded.root, `${label}: nothing is reset`);
    assert.equal(program.state.status, "blocked");
    assert.equal(program.state.wakeAt, null);
  }
});

test("a re-evaluation that assigns other values than recorded cannot be continued", async () => {
  let increment = 1;
  const program = harness(async (ctx) => {
    const total = ctx.useState(0);
    total.set(total.value + increment);
    await ctx.receive("go");
  }, { messages: ["go"] });
  await program.evaluate({ now: at(0) });
  increment = 2;
  const blocked = await program.evaluate({ now: at(1) });
  assert.match(blocked.error!, /the program body recorded assignment 1 as #0 useState = 1, the code now assigns #0 useState = 2/);
  increment = 1;
  assert.equal((await program.evaluate({ now: at(2) })).status, "waiting", "the recorded code continues");
});

test("primitives inside a step, run functions outside a step and a when without its else decision fail with a clear cause", async () => {
  const inside = await harness(async (ctx) => ctx.step(async () => ctx.useState(1))).evaluate({ now: at(0) });
  assert.match(inside.error!, /ctx.useState cannot run inside ctx.step/);
  const outside = await harness(async (ctx) => ctx.functions.notify!({}), { functions: { notify: () => null } }).evaluate({ now: at(0) });
  assert.match(outside.error!, /Call ctx.functions.notify inside ctx.step/);
  const missing = await harness(async (ctx) => ctx.when(true, () => 1, undefined as never)).evaluate({ now: at(0) });
  assert.match(missing.error!, /ctx.when needs ctx.elsePreserve or ctx.elseForget/);
  const concurrent = await harness(async (ctx) => Promise.all([ctx.step(() => 1), ctx.step(() => 2)])).evaluate({ now: at(0) });
  assert.match(concurrent.error!, /Await the running ctx.step before ctx.step/);
  const calls = harness(async (ctx) => ctx.step(() => ctx.functions.notify!({ text: "once" })), { functions: { notify: () => null } });
  await calls.evaluate({ now: at(0) });
  await calls.evaluate({ now: at(1) });
  assert.deepEqual(calls.calls, [["notify", { text: "once" }]]);
});

test("a damaged state blocks without being replaced", async () => {
  const program = harness(async (ctx) => ctx.step(() => 1));
  program.state = { version: 2 } as never;
  const outcome = await program.evaluate({ now: at(0) });
  assert.equal(outcome.status, "blocked");
  assert.match(outcome.error!, /The program state is damaged/);
  assert.equal(program.writes, 0);
});

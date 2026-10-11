import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Orchestration, type JsonValue } from "@ragents/engine";
import { ACTOR_TRIGGERS_STATE_ID } from "../src/plugin-support/actor-programs/contract.ts";
import type { ProgramTriggerOptions } from "../../../plugins/ragents.actor-programs/server/triggers.ts";
import { count, programFiles, triggerFixture, until } from "./program-triggers-fixture.ts";

type Watch = NonNullable<ProgramTriggerOptions["watch"]>;
const watcher = () => {
  const listeners = new Map<string, Parameters<Watch>[1]>();
  const stopped: string[] = [];
  const watch: Watch = async (folder, listener) => {
    listeners.set(folder, listener);
    return () => { stopped.push(folder); listeners.delete(folder); };
  };
  return { listeners, stopped, watch };
};

test("a manual trigger runs onInput in its own Node process with input.trigger, and state and progress survive a restart", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("check", programFiles(count));
  assert.equal(f.progress("check").status, "ready");
  await f.trigger("check");
  await assert.rejects(f.trigger("check"), /already has an accepted trigger input/);
  assert.equal(f.progress("check").status, "queued");
  f.scheduler.start();
  await f.settled("check");
  const state = f.state("check");
  assert.equal(state.count, 1);
  assert.notEqual(state.pid, process.pid);
  assert.match(state.key!, new RegExp(`^${f.runId}:${f.actorOf("check")}:1$`));
  assert.equal((await f.status("check")).log.at(-1)?.text, "manual");
  assert.equal(f.progress("check").nextRunAt, null);
  await f.restart();
  assert.deepEqual(f.state("check"), state);
  assert.equal(f.progress("check").lastResult?.outcome, "completed");
  await f.trigger("check");
  await until(() => f.state("check").count === 2);
  assert.deepEqual(f.state("check").reasons, ["manual", "manual"]);
});

test("an ordinary message has no trigger, and triggers need an input handler", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("check", programFiles(count));
  f.scheduler.start();
  f.setup.runtime.enqueueInput(f.ownerContext(), f.runId, { actorId: f.actorOf("check"), content: "Hello" });
  await until(() => f.state("check").count === 1);
  assert.deepEqual(f.state("check").reasons, ["message"]);
  const functionsOnly = { "package.json": JSON.stringify({ name: "functions", private: true, type: "module", ragents: { title: "Functions", backend: "src/server.ts", triggers: { interval: { everySeconds: 60 } } } }),
    "src/server.ts": 'import { Type } from "typebox"; import { defineActor } from "@ragents/server"; export default defineActor({ state: Type.Object({}), functions: {} }, { functions: {} });' };
  await assert.rejects(f.activate("functions", functionsOnly), /Triggers deliver inputs/);
});

test("an overdue interval runs once after a restart with fixed delay; pause lets accepted work finish and removal ends the triggers", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("check", programFiles(`${count} await new Promise((resolve) => setTimeout(resolve, 80));`, { triggers: { interval: { everySeconds: 60 } } }));
  await until(() => f.progress("check").nextRunAt !== null);
  assert.equal(f.progress("check").nextRunAt, new Date(f.time + 60000).toISOString());
  await f.programs.triggers.shutdown();
  f.advance(600000);
  await f.restart();
  await until(() => f.progress("check").status === "queued");
  assert.equal(f.inputs(), 1);
  f.scheduler.start();
  await f.settled("check");
  assert.equal(f.state("check").count, 1);
  assert.equal(f.progress("check").nextRunAt, new Date(f.time + 60000).toISOString());
  f.advance(60000);
  await until(() => f.progress("check").status === "running");
  await f.pause("check", true);
  await until(() => f.progress("check").status === "paused");
  assert.equal(f.state("check").count, 2);
  assert.deepEqual(f.state("check").reasons, ["interval", "interval"]);
  await f.programs.remove(f.ownerContext(), f.runId, "check");
  f.advance(600000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.inputs(), 2);
  assert.ok(f.setup.runtime.events(f.runId).length > 0);
});

test("daily and weekday occurrences persist their zone and recover one overdue occurrence without a catch-up burst", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  const body = `${count} context.log(\`\${trigger?.scheduledAt} \${trigger?.timeZone}\`);`;
  await f.activate("daily", programFiles(body, { triggers: { daily: { at: "08:00", timeZone: "Europe/Berlin" } } }));
  await f.activate("weekly", programFiles(body, { triggers: { weekly: { at: "08:00", days: ["mon"], timeZone: "Asia/Tokyo" } } }));
  await f.trigger("daily");
  f.scheduler.start();
  await f.settled("daily");
  assert.equal(f.progress("daily").nextRunAt, "2026-08-17T06:00:00.000Z");
  await until(() => f.progress("weekly").nextRunAt !== null);
  assert.equal(f.progress("weekly").nextRunAt, "2026-08-16T23:00:00.000Z");
  await f.programs.triggers.shutdown();
  f.advance(9 * 86400000);
  await f.restart();
  await until(() => f.state("daily").count === 2 && f.state("weekly").count === 1);
  await f.settled("daily");
  await f.settled("weekly");
  assert.equal(f.progress("daily").nextRunAt, "2026-08-26T06:00:00.000Z");
  assert.equal(f.progress("weekly").nextRunAt, "2026-08-30T23:00:00.000Z");
  assert.equal((await f.status("daily")).log.at(-1)?.text, "2026-08-17T06:00:00.000Z Europe/Berlin");
  assert.equal((await f.status("weekly")).log.at(-1)?.text, "2026-08-16T23:00:00.000Z Asia/Tokyo");
  assert.equal(f.inputs(), 3);
});

test("a program without time triggers has no timer, and file triggers cannot exceed its folder permissions", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("manual", programFiles(count));
  f.advance(600000);
  assert.equal(f.progress("manual").nextRunAt, null);
  assert.equal(f.inputs(), 0);
  await assert.rejects(f.activate("denied", programFiles(count, { triggers: { fileChange: { folders: [f.directory] } } })), /outside the working directory/);
  f.scheduler.start();
  await f.trigger("manual");
  await f.settled("manual");
  assert.equal((await f.status("manual")).log.at(-1)?.text, "manual");
});

test("a mini-app with a view in a normal run receives interval and file triggers", { timeout: 60000 }, async (t) => {
  const watch = watcher();
  const f = await triggerFixture(t, { watch: watch.watch });
  const folder = await realpath(await mkdir(path.join(f.directory, "inbox"), { recursive: true }).then(() => path.join(f.directory, "inbox")));
  const client = 'import { createRoot } from "react-dom/client"; import { useAppState } from "@ragents/client"; function App() { const state = useAppState(); return <p>{(state.reasons ?? []).join(", ")}</p>; } createRoot(document.getElementById("root")!).render(<App />);';
  await f.activate("board", { ...programFiles(count, { views: [{ id: "main", client: "src/client.tsx" }], permissions: { files: { read: [folder] } }, triggers: { interval: { everySeconds: 300 }, fileChange: { folders: [folder] } } }), "src/client.tsx": client });
  await until(() => watch.listeners.has(folder) && f.progress("board").nextRunAt !== null);
  f.scheduler.start();
  f.advance(300000);
  await until(() => f.state("board").count === 1);
  await f.settled("board");
  watch.listeners.get(folder)!.onChange();
  await until(() => f.state("board").count === 2);
  await f.settled("board");
  assert.deepEqual(f.state("board").reasons, ["interval", "file-change"]);
  const app = f.programs.apps(f.runId, f.actorOf("board"))[0]!;
  assert.deepEqual((app.state.values as { reasons?: string[] }).reasons, ["interval", "file-change"]);
  assert.deepEqual((await f.status("board")).triggers, { interval: { everySeconds: 300 }, fileChange: { folders: [folder] } });
});

test("file triggers combine with intervals, coalesce during work and stop on pause or removal", { timeout: 60000 }, async (t) => {
  const watch = watcher();
  const f = await triggerFixture(t, { watch: watch.watch });
  const folder = await realpath(await mkdir(path.join(f.directory, "watched"), { recursive: true }).then(() => path.join(f.directory, "watched")));
  await f.activate("check", programFiles(count, { permissions: { files: { read: [folder] } }, triggers: { interval: { everySeconds: 60 }, fileChange: { folders: [folder] } } }));
  await until(() => watch.listeners.has(folder));
  const listener = watch.listeners.get(folder)!;
  listener.onChange();
  listener.onChange();
  listener.onChange();
  await until(() => f.inputs() === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  f.scheduler.start();
  await until(() => f.state("check").count === 2);
  await f.settled("check");
  assert.equal(f.inputs(), 2, "one occurrence and one pending occurrence");
  assert.equal((await f.status("check")).log.at(-1)?.text, "file-change");
  assert.equal(f.progress("check").nextRunAt, new Date(f.time + 60000).toISOString());
  f.advance(60000);
  await until(() => f.state("check").count === 3);
  await f.settled("check");
  assert.equal((await f.status("check")).log.at(-1)?.text, "interval");
  await f.pause("check", true);
  assert.equal(watch.listeners.size, 0);
  listener.onChange();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.inputs(), 3);
  await f.pause("check", false);
  assert.equal(watch.listeners.size, 1);
  await f.programs.remove(f.ownerContext(), f.runId, "check");
  await until(() => watch.listeners.size === 0);
  assert.equal(watch.stopped.length, 2);
});

test("a watcher failure blocks only its program and stays visible across a restart", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t, { watch: async () => { throw new Error("The folder cannot be watched."); } });
  await f.activate("watcher", programFiles(count, { permissions: { files: { read: [f.directory] } }, triggers: { fileChange: { folders: [f.directory] } } }));
  await f.activate("healthy", programFiles(count));
  await until(() => f.progress("watcher").status === "blocked");
  assert.match(f.progress("watcher").problem!, /folder cannot be watched/);
  await f.restart();
  f.scheduler.start();
  await f.trigger("healthy");
  await f.settled("healthy");
  assert.equal(f.progress("watcher").status, "blocked");
});

test("a deadline kills a stuck Node process without committing its state or overlapping the next trigger", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("check", programFiles('context.log("Before timeout"); context.state.replace({ count: 99 }); for (;;) {}'));
  f.scheduler.start();
  await f.trigger("check");
  await until(() => f.progress("check").status === "running");
  await new Promise((resolve) => setTimeout(resolve, 200));
  f.advance(31000);
  await f.settled("check", "timeout");
  assert.deepEqual(f.state("check"), {});
  assert.ok((await f.status("check")).log.some((line) => line.text === "Before timeout"));
  await f.activate("check", programFiles(count));
  await f.trigger("check");
  await f.settled("check");
});

test("four trigger inputs run at once in a run and a program never overlaps itself", { timeout: 90000 }, async (t) => {
  const f = await triggerFixture(t);
  for (const index of [0, 1, 2, 3, 4]) await f.activate(`check-${index}`, programFiles(count));
  for (const index of [0, 1, 2, 3]) await f.trigger(`check-${index}`);
  await assert.rejects(f.trigger("check-4"), /4 trigger inputs are already active/);
  await assert.rejects(f.trigger("check-0"), /already has an accepted trigger input/);
  f.scheduler.start();
  await Promise.all([0, 1, 2, 3].map((index) => f.settled(`check-${index}`)));
  assert.equal(new Set([0, 1, 2, 3].map((index) => f.state(`check-${index}`).pid)).size, 4);
  await f.trigger("check-4");
  await f.settled("check-4");
});

test("an accepted occurrence recovers its missing input exactly once before the scheduler starts", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("check", programFiles(count));
  await f.pause("check", false);
  await f.programs.triggers.shutdown();
  const actorId = f.actorOf("check");
  const stored = f.setup.runtime.view(f.runId).pluginStates.find((entry) => entry.pluginId === ACTOR_TRIGGERS_STATE_ID && entry.scope.kind === "actor" && entry.scope.actorId === actorId)!;
  const key = `${f.runId}:${actorId}:1`;
  f.setup.runtime.replacePluginState(f.ownerContext(), f.runId, { pluginId: stored.pluginId, scope: stored.scope,
    state: { ...stored.state as Record<string, JsonValue>, occurrence: 1, accepted: { number: 1, key, commandId: `actor-program-trigger:${key}:before-crash`, reason: "manual", scheduledAt: f.setup.services.now(), timeZone: "UTC" } } });
  await f.restart();
  await until(() => f.inputs() === 1);
  await f.restart();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.inputs(), 1);
  f.scheduler.start();
  await f.settled("check");
  assert.equal(f.state("check").count, 1);
  assert.equal(f.state("check").key, key);
});

test("an engine restart interrupts a claimed trigger input and the triggers finalize it without replay", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("check", programFiles(count));
  await f.trigger("check");
  await f.programs.triggers.shutdown();
  const input = f.setup.runtime.view(f.runId).inputs.find((entry) => entry.content.startsWith("Trigger: "))!;
  const actorId = input.actorId;
  f.setup.runtime.startTurn({ actorId, commandId: "started-before-crash" }, f.runId, actorId, input.id);
  const turn = f.setup.runtime.view(f.runId).turns.find((entry) => entry.actorId === actorId)!;
  f.setup.runtime.appendRuntimeOutput({ actorId, turnId: turn.id, commandId: "output-before-crash" }, f.runId, actorId, { turnId: turn.id, text: "Before restart" });
  f.setup.runtime = new Orchestration(f.setup.journal, f.setup.services);
  await f.restart();
  await until(() => f.progress("check").lastResult !== null);
  const interrupted = await f.status("check");
  assert.equal(interrupted.lastResult?.outcome, "interrupted");
  assert.match(interrupted.lastResult!.summary, /restart of the runtime/);
  assert.deepEqual(interrupted.state, {});
  assert.ok(interrupted.log.some((line) => line.text === "Before restart"));
  await f.restart();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(await f.status("check"), interrupted);
  assert.equal(f.inputs(), 1);
  await f.trigger("check");
  f.scheduler.start();
  await f.settled("check");
  assert.equal(f.state("check").count, 1);
});

test("failed inputs keep their log but discard staged state, and the log ring stays bounded", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("check", programFiles('context.state.replace({ count: 99 }); for (const index of Array.from({ length: 110 }, (_, index) => index)) context.log("line " + index); throw new Error("Expected failure.");'));
  f.scheduler.start();
  await f.trigger("check");
  await f.settled("check", "failed");
  const details = await f.status("check", f.runId, 100);
  assert.deepEqual(details.state, {});
  assert.equal(details.log.length, 100);
  assert.ok(details.droppedLogLines >= 1);
  assert.equal(details.log.at(-1)?.level, "error");
  assert.match(details.lastResult!.summary, /Expected failure/);
  await assert.rejects(f.activate("check", programFiles('const value: number = "wrong"; context.log(value);')), /src\/server.ts:\d+:\d+ TS2322/);
  assert.equal(f.progress("check").lastResult?.outcome, "failed");
});

test("failures back off the next automatic trigger, and resuming clears the backoff", { timeout: 90000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("check", programFiles('context.log("attempt"); throw new Error("Expected failure.");', { triggers: { interval: { everySeconds: 60 } } }));
  await until(() => f.progress("check").nextRunAt !== null);
  f.scheduler.start();
  f.advance(60000);
  await until(() => f.inputs() === 1);
  await f.settled("check", "failed");
  assert.equal(f.progress("check").nextRunAt, new Date(f.time + 60000).toISOString(), "the first backoff matches the interval");
  f.advance(60000);
  await until(() => f.inputs() === 2);
  await f.settled("check", "failed");
  assert.equal(f.progress("check").nextRunAt, new Date(f.time + 120000).toISOString(), "the second failure doubles the delay");
  f.advance(60000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.inputs(), 2, "no trigger during the backoff");
  assert.equal((await f.pause("check", false)).nextRunAt, new Date(f.time + 60000).toISOString());
});

test("a runtime failure of one program leaves another program's input and state intact", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await f.activate("broken", programFiles('context.log("Before failure"); context.state.replace({ count: 99 }); throw new Error("Program execution failed.");'));
  await f.activate("healthy", programFiles(count));
  await f.trigger("broken");
  await f.trigger("healthy");
  f.scheduler.start();
  await Promise.all([f.settled("broken", "failed"), f.settled("healthy")]);
  assert.deepEqual(f.state("broken"), {});
  assert.equal(f.state("healthy").count, 1);
  assert.ok((await f.status("broken")).log.some((line) => line.text === "Before failure"));
});

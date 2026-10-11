import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability } from "@ragents/engine";
import { ACTOR_STATE_ID } from "../src/plugin-support/actor-programs/contract.ts";
import type { ProgramState } from "../src/plugin-support/actor-programs/program-runner.ts";
import type { ProgramTriggerOptions } from "../../../plugins/ragents.actor-programs/server/triggers.ts";
import { invocationResult } from "./actor-runtime-fixture.ts";
import { triggerFixture, until } from "./program-triggers-fixture.ts";

const always = defineToolAvailability({ availability: "always", availabilityDetail: "Test function." }, () => true);
const recorder = () => {
  const drafts: string[] = [];
  const published: string[] = [];
  const tools = () => [
    defineRunFunction({ name: "prepare_draft", label: "Prepare draft", description: "Prepare the draft of a day.", schema: Type.Object({ day: Type.String() }), resultSchema: Type.Object({ text: Type.String() }), available: always,
      run: async (_scope, _id, input) => { drafts.push(input.day); return { text: `Draft for ${input.day}` }; } }),
    defineRunFunction({ name: "publish_draft", label: "Publish draft", description: "Publish a text.", schema: Type.Object({ text: Type.String() }), resultSchema: Type.Null(), available: always,
      run: async (_scope, _id, input) => { published.push(input.text); return null; } }),
  ];
  return { drafts, published, tools };
};
const packageFiles = (server: string, ragents: Record<string, unknown> = {}) => ({
  "package.json": JSON.stringify({ name: "program", private: true, type: "module", ragents: { title: "Program", backend: "src/server.ts", ...ragents } }),
  "src/server.ts": server,
});
const dailyDraft = `import { defineProgram } from "@ragents/server";
import { Type } from "typebox";

export default defineProgram({
  capabilities: ["prepare_draft", "publish_draft"],
  messages: { approval: { label: "Approve the draft", input: Type.Object({ approved: Type.Boolean() }), tool: { name: "approve_draft" } } },
}, async (ctx) => {
  const approvals = ctx.useState(0, "approvals");
  const today = await ctx.waitUntil({ daily: "08:00", timeZone: "Europe/Berlin" });
  await ctx.forEach([today], (day) => day.at, async (day) => {
    const draft = await ctx.step(() => ctx.functions.prepare_draft({ day: day.at }));
    const answer = await ctx.receive("approval", { timeoutMs: 24 * 60 * 60 * 1000 });
    await ctx.when(answer.kind === "message" && answer.value.approved, async () => {
      approvals.set(approvals.value + 1);
      await ctx.step(() => ctx.functions.publish_draft({ text: draft.text }));
    }, ctx.elseForget);
  });
});
`;
type Watch = NonNullable<ProgramTriggerOptions["watch"]>;
const watcher = () => {
  const listeners = new Map<string, Parameters<Watch>[1]>();
  const watch: Watch = async (folder, listener) => {
    listeners.set(folder, listener);
    return () => { listeners.delete(folder); };
  };
  return { listeners, watch };
};
const pause = (milliseconds = 100) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("the daily draft program waits for 08:00 across a reopened journal, publishes an approval exactly once and starts over the next day", { timeout: 180000 }, async (t) => {
  const record = recorder();
  const f = await triggerFixture(t, { tools: record.tools, persistent: true });
  const state = () => f.programs.data(f.runId, f.actorOf("daily-draft")).values as ProgramState;
  const stateRecords = () => f.setup.runtime.events(f.runId).filter((event) => (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") && event.payload.pluginId === ACTOR_STATE_ID).length;
  await f.activate("daily-draft", packageFiles(dailyDraft));
  f.scheduler.start();
  await until(() => state().status === "waiting");
  assert.equal(state().waiting?.position, "#1 waitUntil(daily 08:00 Europe/Berlin)");
  assert.equal(state().wakeAt, "2026-08-17T06:00:00.000Z");
  assert.equal(f.progress("daily-draft").nextRunAt, "2026-08-17T06:00:00.000Z");

  const waiting = state();
  const recorded = f.setup.runtime.events(f.runId).length;
  await f.reopen();
  f.scheduler.start();
  await pause();
  assert.deepEqual(state(), waiting, "the slot tree comes back from the journal");
  assert.equal(f.setup.runtime.events(f.runId).length, recorded, "a restart while waiting writes no journal record");

  f.advance(18 * 3600000);
  await until(() => state().waiting?.kind === "receive");
  await f.settled("daily-draft");
  assert.equal(state().waiting?.position, '#2 forEach ["2026-08-17T06:00:00.000Z"] > #1 receive("approval")');
  assert.equal(state().wakeAt, "2026-08-18T06:00:00.000Z");
  assert.deepEqual(record.drafts, ["2026-08-17T06:00:00.000Z"]);

  const before = stateRecords();
  const tree = state();
  await f.trigger("daily-draft");
  await f.settled("daily-draft");
  assert.equal(stateRecords(), before, "a re-evaluation that ends in the same wait writes no state");
  assert.deepEqual(state(), tree);
  assert.deepEqual(record.drafts, ["2026-08-17T06:00:00.000Z"], "the completed draft step does not run again");

  await f.reopen();
  f.scheduler.start();
  const program = () => f.programs.programs(f.runId).find((entry) => entry.name === "daily-draft")!;
  const approve = async (requestId: string, approved = true) => invocationResult(f.programs, f.runId, program().actorHandle,
    f.programs.startFunctionInvocation(f.runId, program().actorHandle, program().revision, "approval", requestId, { approved }).id);
  assert.deepEqual((await approve("approve-1")).status, "succeeded");
  await until(() => state().status === "done");
  assert.deepEqual(record.published, ["Draft for 2026-08-17T06:00:00.000Z"]);
  assert.deepEqual(state().values, { approvals: 1 });
  const refused = await approve("approve-again");
  assert.equal(refused.status, "failed");
  assert.match(refused.status === "failed" ? refused.error : "", /does not wait for approval now/);

  await f.reopen();
  f.scheduler.start();
  await f.trigger("daily-draft");
  await f.settled("daily-draft");
  assert.deepEqual(record.published, ["Draft for 2026-08-17T06:00:00.000Z"], "publishing ran exactly once");
  assert.equal(record.drafts.length, 1);

  f.advance(24 * 3600000);
  await until(() => state().waiting?.position === '#2 forEach ["2026-08-18T06:00:00.000Z"] > #1 receive("approval")');
  await f.settled("daily-draft");
  assert.deepEqual(record.drafts, ["2026-08-17T06:00:00.000Z", "2026-08-18T06:00:00.000Z"]);
  assert.equal((await approve("approve-2")).status, "succeeded");
  await until(() => state().status === "done");
  assert.deepEqual(state().values, { approvals: 2 }, "the count outside the day survives forgetting yesterday");
  assert.deepEqual(record.published, ["Draft for 2026-08-17T06:00:00.000Z", "Draft for 2026-08-18T06:00:00.000Z"]);
});

test("a rejected or unanswered draft is not published, and the timeout ends the wait", { timeout: 120000 }, async (t) => {
  const record = recorder();
  const f = await triggerFixture(t, { tools: record.tools });
  const state = () => f.programs.data(f.runId, f.actorOf("daily-draft")).values as ProgramState;
  await f.activate("daily-draft", packageFiles(dailyDraft));
  f.scheduler.start();
  await until(() => state().status === "waiting");
  f.advance(18 * 3600000);
  await until(() => state().waiting?.kind === "receive");
  await f.settled("daily-draft");
  const program = f.programs.programs(f.runId)[0]!;
  const tools = f.programs.installedTools({ runId: f.runId, actorId: f.setup.view.ownerId, turnId: null, actor: f.setup.runtime.view(f.runId).actors.find((actor) => actor.id === f.setup.view.ownerId), view: f.setup.runtime.view(f.runId), workspace: f.directory } as never);
  assert.ok(tools.some((tool) => tool.name === "approve_draft"), "the message is a tool for the actors of the room");
  await invocationResult(f.programs, f.runId, program.actorHandle, f.programs.startFunctionInvocation(f.runId, program.actorHandle, program.revision, "approval", "reject", { approved: false }).id);
  await until(() => state().status === "done");
  assert.deepEqual(record.published, []);
  assert.deepEqual(state().values, { approvals: 0 });
  f.advance(24 * 3600000);
  await until(() => state().waiting?.position?.includes("2026-08-18T06:00:00.000Z") === true);
  await f.settled("daily-draft");
  f.advance(24 * 3600000);
  await until(() => state().waiting?.position?.includes("2026-08-19T06:00:00.000Z") === true);
  await f.settled("daily-draft");
  assert.deepEqual(record.published, [], "the unanswered day timed out and the next day began");
  assert.equal(record.drafts.length, 3);
});

test("a watched file wakes its program only when its content hash changes", { timeout: 120000 }, async (t) => {
  const record = recorder();
  const watch = watcher();
  const f = await triggerFixture(t, { tools: record.tools, watch: watch.watch });
  const folder = await realpath(await mkdir(path.join(f.directory, "inbox"), { recursive: true }).then(() => path.join(f.directory, "inbox")));
  const file = path.join(folder, "report.txt");
  await writeFile(file, "first");
  const state = () => f.programs.data(f.runId, f.actorOf("watcher")).values as ProgramState;
  await f.activate("watcher", packageFiles(`import { defineProgram } from "@ragents/server";
export default defineProgram({ capabilities: ["publish_draft"] }, async (ctx) => {
  const changed = await ctx.watch(${JSON.stringify(file)});
  await ctx.step(() => ctx.functions.publish_draft({ text: changed.hash ?? "missing" }));
});
`, { permissions: { files: { read: [folder] } } }));
  f.scheduler.start();
  await until(() => state().status === "waiting" && watch.listeners.has(folder));
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  assert.deepEqual(state().waiting?.file, { path: file, hash: sha("first") });
  const events = f.setup.runtime.events(f.runId).length;
  await writeFile(path.join(folder, "other.txt"), "unrelated");
  await writeFile(file, "first");
  watch.listeners.get(folder)!.onChange();
  await pause();
  assert.equal(f.setup.runtime.events(f.runId).length, events, "a change that leaves the watched content alone writes no journal record");
  await writeFile(file, "second");
  watch.listeners.get(folder)!.onChange();
  await until(() => state().status === "done");
  assert.deepEqual(record.published, [sha("second")]);
  await until(() => !watch.listeners.has(folder));
});

test("a changed structure blocks the program with position and both kinds, keeps its state, and the original code continues it", { timeout: 120000 }, async (t) => {
  const f = await triggerFixture(t);
  const state = () => f.programs.data(f.runId, f.actorOf("flow")).values as ProgramState;
  const original = `import { defineProgram } from "@ragents/server";
import { Type } from "typebox";
export default defineProgram({ messages: { go: { label: "Go", input: Type.Object({}) } } }, async (ctx) => {
  const first = await ctx.step(() => 1);
  await ctx.receive("go");
  return first;
});
`;
  await f.activate("flow", packageFiles(original));
  f.scheduler.start();
  await until(() => state().status === "waiting");
  const recorded = state().root;
  await f.activate("flow", packageFiles(original.replace("await ctx.step(() => 1)", "(await ctx.waitUntil({ afterMs: 1000 })).at.length")));
  await until(() => state().status === "blocked");
  assert.equal(state().error, "This program cannot be continued: at #0 the recorded slot is step, the code now calls waitUntil(after 1000ms). Restore the code that recorded this state, or activate the program under a new name to start over.");
  assert.deepEqual(state().root, recorded, "nothing is reset");
  await until(() => f.progress("flow").status === "blocked");
  assert.match(f.progress("flow").problem ?? "", /at #0 the recorded slot is step, the code now calls waitUntil/);
  assert.equal(f.progress("flow").nextRunAt, null);
  await f.activate("flow", packageFiles(original));
  await until(() => state().status === "waiting");
  assert.equal(state().error, null);
  assert.equal(f.progress("flow").status, "ready");
});

test("activation reports the program guards like type errors, with file, position and code", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  await assert.rejects(f.activate("guarded", packageFiles(`import { defineProgram } from "@ragents/server";
let runs = 0;
export default defineProgram({}, async (ctx) => {
  if (runs > 0) await ctx.step(() => runs);
  const stamp = Date.now();
  ctx.log(stamp);
});
`)), (error: Error) => {
    assert.match(error.message, /^Typecheck of guarded: 3 errors\.$/m);
    assert.match(error.message, /^src\/server\.ts:2:5 RAG1003: let runs is module state/m);
    assert.match(error.message, /^src\/server\.ts:4:23 RAG1001: ctx\.step is inside an if statement/m);
    assert.match(error.message, /^src\/server\.ts:5:17 RAG1002: Date\.now\(\) reads the clock/m);
    return true;
  });
});

test("a package test evaluates its program with createProgramTest, and activation runs it", { timeout: 120000 }, async (t) => {
  const record = recorder();
  const f = await triggerFixture(t, { tools: record.tools });
  const programTest = (expectedApprovals: number) => `import assert from "node:assert/strict";
import test from "node:test";
import { createProgramTest } from "@ragents/server/testing";
import program from "../src/server.ts";

test("an approved draft is published once", async () => {
  const published: string[] = [];
  const run = createProgramTest(program, { now: "2026-08-16T12:00:00.000Z", functions: {
    prepare_draft: ({ day }) => ({ text: "Draft " + day }),
    publish_draft: ({ text }) => { published.push(text); return null; },
  } });
  assert.equal((await run.evaluate()).state.wakeAt, "2026-08-17T06:00:00.000Z");
  assert.equal((await run.evaluate({ now: "2026-08-17T06:00:00.000Z" })).state.waiting?.message, "approval");
  const approved = await run.evaluate({ now: "2026-08-17T07:00:00.000Z", message: { name: "approval", value: { approved: true } } });
  assert.equal(approved.status, "done");
  await run.evaluate({ now: "2026-08-17T08:00:00.000Z" });
  assert.deepEqual(published, ["Draft 2026-08-17T06:00:00.000Z"]);
  assert.deepEqual(run.state.values, { approvals: ${expectedApprovals} });
});
`;
  await f.activate("daily-draft", { ...packageFiles(dailyDraft), "tests/program.test.ts": programTest(1) });
  await f.write("daily-draft", { "tests/program.test.ts": programTest(2) });
  await assert.rejects(f.programs.activate(f.ownerContext(), f.runId, "daily-draft"), /an approved draft is published once/);
});

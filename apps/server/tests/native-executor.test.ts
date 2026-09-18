import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import type { NativeTypeScriptRequest } from "@aicontainer/ragents";

import { scriptProgram } from "../../../packages/ragents/tests/native-executor.ts";
import { nativeExecutorFixture } from "./native-executor-fixture.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";

const requestFor = (source: string, instanceId = "backend"): NativeTypeScriptRequest => ({
  program: scriptProgram(source), input: {}, instanceId,
  context: { runId: "native-review", invocationId: "review", invocationKind: "tool", principal: { id: "agent", kind: "agent" }, capabilities: [] },
});
const noCalls = async (): Promise<never> => { throw new Error("No capability is configured."); };
const waitForFile = async (file: string): Promise<string> => {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const content = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (content !== undefined) return content;
    assert.ok(Date.now() < deadline, `File was not written: ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("aborting a native actor CPU loop waits until the actual host child process has exited", async () => {
  const native = nativeExecutorFixture();
  const controller = new AbortController();
  let childPid: number | undefined;
  try {
    const execution = native.executor.execute({
      program: scriptProgram("export const handle = (_input, context) => { context.log(process.pid); while (true) {} };"),
      input: {},
      context: {
        runId: "native-abort",
        invocationId: "loop",
        invocationKind: "input",
        principal: { id: "actor", kind: "script" },
        capabilities: [],
      },
    }, {
      signal: controller.signal,
      call: async () => { throw new Error("No capability is configured."); },
      log: (value) => {
        childPid = Number(value);
        controller.abort(new Error("Actor stopped"));
      },
    });

    await assert.rejects(execution, /Actor stopped/);
    assert.ok(childPid);
    assert.notEqual(childPid, process.pid);
    assert.throws(() => process.kill(childPid!, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
  } finally {
    await native.close();
  }
});

test("stopping a run interrupts a backend that is still waiting in module initialization", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ragents-native-start-stop-"));
  const native = nativeExecutorFixture(directory);
  const pidFile = path.join(directory, "starting.pid");
  try {
    const request = requestFor(`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await new Promise(() => {}); export const handle = () => 1;`);
    const execution = native.executor.execute(request, { call: noCalls, log: () => undefined });
    const rejected = assert.rejects(execution, /beendet/);
    const pid = Number(await waitForFile(pidFile));
    const first = native.executor.stopRun(request.context.runId);
    const second = native.executor.stopRun(request.context.runId);
    assert.equal(first, second);
    await assert.rejects(native.executor.execute(request, { call: noCalls, log: () => undefined }), /beendet/);
    await Promise.all([first, second, rejected]);
    assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
  } finally { await native.close(); }
});

test("a stopped startup does not create a child after its workspace becomes ready", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ragents-native-late-start-"));
  const prepared = Promise.withResolvers<void>();
  const executor = new NodeTypeScriptExecutor({
    directoryFor: () => path.join(directory, "build"),
    processContextFor: async (runId) => {
      await prepared.promise;
      return { runId, cwd: directory, root: directory, home: directory, env: process.env };
    },
  });
  try {
    const request = requestFor("export const handle = () => 'unexpected';");
    const rejected = assert.rejects(executor.execute(request, { call: noCalls, log: () => undefined }), /beendet/);
    const stopping = executor.stopRun(request.context.runId);
    await new Promise((resolve) => setImmediate(resolve));
    prepared.resolve();
    await Promise.all([rejected, stopping]);
    await assert.rejects(stat(path.join(directory, "build")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally { prepared.resolve(); await executor.shutdown(); await rm(directory, { recursive: true, force: true }); }
});

test("overlapping stops wait for capability completion and reject queued or replacement invocations", { timeout: 10_000 }, async () => {
  const native = nativeExecutorFixture();
  const entered = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<null>();
  let childPid = 0;
  try {
    const base = requestFor("export const handle = async (input, context) => { context.log(process.pid); return input.immediate ? 'ready' : await context.functions.wait({}); };");
    const request = { ...base, context: { ...base.context, capabilities: [{ id: "wait", label: "Wait", description: "Wait", schema: Type.Object({}), resultSchema: Type.Null() }] } };
    const binding = { call: async () => { entered.resolve(); return reply.promise; }, log: (value: unknown) => { childPid = Number(value); } };
    const firstExecution = native.executor.execute(request, binding);
    const rejectedFirst = assert.rejects(firstExecution, /beendet/);
    await entered.promise;
    const queued = native.executor.execute(request, binding);
    const rejectedQueued = assert.rejects(queued, /beendet/);
    const stopping = native.executor.stopInstance(request.context.runId, request.instanceId!);
    assert.equal(stopping, native.executor.stopInstance(request.context.runId, request.instanceId!));
    const stoppingRun = native.executor.stopRun(request.context.runId);
    assert.equal(stoppingRun, native.executor.stopRun(request.context.runId));
    let finished = false;
    void stoppingRun.then(() => { finished = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(finished, false);
    await assert.rejects(native.executor.execute({ ...request, instanceId: "replacement" }, binding), /beendet/);
    reply.resolve(null);
    await Promise.all([stopping, stoppingRun, rejectedFirst, rejectedQueued]);
    assert.throws(() => process.kill(childPid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
    const restarted = await native.executor.execute({ ...request, input: { immediate: true } }, { call: noCalls, log: () => undefined });
    assert.equal(restarted.result, "ready");
  } finally { reply.resolve(null); await native.close(); }
});

test("an IPC log callback failure rejects the invocation and joins the backend process", async () => {
  const native = nativeExecutorFixture();
  let childPid = 0;
  try {
    await assert.rejects(native.executor.execute(requestFor("export const handle = (_input, context) => { context.log(process.pid); while (true) {} };"), {
      call: noCalls, log: (value) => { childPid = Number(value); throw new Error("Log callback failed"); },
    }), /Log callback failed/);
    assert.ok(childPid);
    assert.throws(() => process.kill(childPid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
  } finally { await native.close(); }
});

test("startup process failures retain a bounded stderr tail", async () => {
  const native = nativeExecutorFixture();
  try {
    await assert.rejects(native.executor.execute(requestFor("process.stderr.write('x'.repeat(6000) + ' startup failure detail'); process.exit(23); export const handle = () => 1;"), {
      call: noCalls, log: () => undefined,
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Code 23/);
      assert.match(error.message, /startup failure detail/);
      assert.ok(error.message.length < 4_100);
      return true;
    });
  } finally { await native.close(); }
});

test("an empty capability failure message still rejects the child's call", async () => {
  const native = nativeExecutorFixture();
  try {
    const base = requestFor("export const handle = async (_input, context) => context.functions.fail({}).then(() => 'unexpected success', error => 'caught:' + error.message);");
    const result = await native.executor.execute({ ...base, context: { ...base.context, capabilities: [{ id: "fail", label: "Fail", description: "Fail", schema: Type.Object({}), resultSchema: Type.Null() }] } }, {
      call: async () => { throw new Error(""); }, log: () => undefined,
    });
    assert.equal(result.result, "caught:");
  } finally { await native.close(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_TIMEOUT_MS,
  createBashToolDefinition,
  type BashOperations,
  type BashToolInput,
} from "../src/core/tools/bash.ts";

/** Records the timeout the tool hands its operations; a command either finishes or runs into its timeout. */
const recording = (outcome: "finished" | "timeout" = "finished") => {
  const timeouts: number[] = [];
  const operations: BashOperations = {
    exec: async (_command, _cwd, { onData, timeoutMs }) => {
      timeouts.push(timeoutMs);
      onData(Buffer.from("partial output\n"));
      if (outcome === "timeout") throw new Error(`timeout:${timeoutMs}`);
      return { exitCode: 0 };
    },
  };
  return { timeouts, operations };
};

const call = (definition: ReturnType<typeof createBashToolDefinition>, input: BashToolInput) =>
  definition.execute("call", input, undefined, undefined);

const schemaOf = (definition: ReturnType<typeof createBashToolDefinition>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(definition.parameters)) as Record<string, unknown>;

const timeoutSchemaOf = (definition: ReturnType<typeof createBashToolDefinition>): Record<string, unknown> =>
  (schemaOf(definition).properties as Record<string, Record<string, unknown>>).timeout;

test("the schema has the fields of the standard shell tool in milliseconds and is closed", () => {
  assert.equal(BASH_DEFAULT_TIMEOUT_MS, 120_000);
  assert.equal(BASH_MAX_TIMEOUT_MS, 3_600_000);
  const definition = createBashToolDefinition(".");
  const schema = schemaOf(definition);
  assert.deepEqual(Object.keys(schema.properties as object), ["command", "timeout", "description", "run_in_background", "cwd"]);
  assert.deepEqual(schema.required, ["command"]);
  assert.equal(schema.additionalProperties, false);
  assert.match(definition.description,
    /A command is stopped after 120000 ms unless you pass a larger timeout in milliseconds \(at most 3600000\); builds, test runs, installs and other long commands need one\./);
  assert.deepEqual(timeoutSchemaOf(definition), {
    type: "number",
    exclusiveMinimum: 0,
    maximum: 3_600_000,
    default: 120_000,
    description: "Optional timeout in milliseconds (default 120000, max 3600000)",
  });
});

test("a call without timeout gets the default, a call may pass any positive timeout up to the maximum", async () => {
  const { timeouts, operations } = recording();
  const definition = createBashToolDefinition(".", { operations });
  await call(definition, { command: "true" });
  await call(definition, { command: "true", timeout: 3_600_000, description: "Run nothing" });
  await call(definition, { command: "true", timeout: 500, run_in_background: false });
  assert.deepEqual(timeouts, [120_000, 3_600_000, 500]);
});

test("a timeout above the maximum or not above zero is an input error before anything runs", async () => {
  const { timeouts, operations } = recording();
  const definition = createBashToolDefinition(".", { operations });
  await assert.rejects(call(definition, { command: "dotnet build", timeout: 3_600_001 }), /^Error: Invalid timeout 3600001: the maximum is 3600000 milliseconds$/);
  await assert.rejects(call(definition, { command: "true", timeout: 0 }), /Invalid timeout 0: must be a positive number of milliseconds/);
  await assert.rejects(call(definition, { command: "true", timeout: Number.NaN }), /must be a positive number of milliseconds/);
  assert.deepEqual(timeouts, []);
});

test("run_in_background without background operations is rejected before anything runs and names the alternative", async () => {
  const { timeouts, operations } = recording();
  const definition = createBashToolDefinition(".", { operations });
  await assert.rejects(call(definition, { command: "npm run dev", run_in_background: true }),
    /^Error: run_in_background is not available: .*Run the command in the foreground with a timeout of up to 3600000 ms, or split it into shorter steps\.$/);
  assert.deepEqual(timeouts, []);
});

test("run_in_background starts the command through the background operation and answers with one line and its ID", async () => {
  const { timeouts, operations } = recording();
  const started: Array<{ command: string; cwd: string }> = [];
  const definition = createBashToolDefinition("/work", {
    operations: {
      ...operations,
      background: async (command, cwd) => {
        started.push({ command, cwd });
        return { id: "b1a2b3c" };
      },
    },
  });
  const result = await call(definition, { command: "npm run dev", run_in_background: true, timeout: 500, cwd: "web" });
  assert.deepEqual(result.content, [{ type: "text", text: "Command running in background with ID: b1a2b3c. task_output reads its new output, task_stop ends it." }]);
  assert.deepEqual(result.details, { backgroundTaskId: "b1a2b3c" });
  assert.deepEqual(started, [{ command: "npm run dev", cwd: "/work/web" }]);
  assert.deepEqual(timeouts, [], "timeout applies only to a command in the foreground");
  assert.match(definition.description, /pass run_in_background: true instead of nohup, &, setsid, disown, a detached spawn or a service manager/);
});

test("an operator default replaces the built-in one in description, schema and calls, and may not exceed the maximum", async () => {
  const { timeouts, operations } = recording();
  const definition = createBashToolDefinition(".", { operations, defaultTimeoutMs: 300_000 });
  assert.match(definition.description, /stopped after 300000 ms unless you pass a larger timeout in milliseconds \(at most 3600000\)/);
  assert.equal(timeoutSchemaOf(definition).default, 300_000);
  assert.equal(timeoutSchemaOf(definition).description, "Optional timeout in milliseconds (default 300000, max 3600000)");
  await call(definition, { command: "true" });
  assert.deepEqual(timeouts, [300_000]);
  assert.throws(() => createBashToolDefinition(".", { defaultTimeoutMs: 4_000_000 }), /^Error: Invalid default timeout 4000000: the maximum is 3600000 milliseconds$/);
  assert.throws(() => createBashToolDefinition(".", { defaultTimeoutMs: -1 }), /Invalid default timeout -1: must be a positive number of milliseconds/);
});

test("a stopped command keeps its output and says after how many milliseconds it stopped and what to do", async () => {
  const { operations } = recording("timeout");
  await assert.rejects(call(createBashToolDefinition(".", { operations }), { command: "grep -r needle ." }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "partial output\n\n\nCommand stopped after 120000 ms (timeout). Narrow the command, for example search with rg "
      + "instead of grep -r, or pass a larger timeout, up to 3600000 ms.");
    return true;
  });
  await assert.rejects(call(createBashToolDefinition(".", { operations }), { command: "dotnet build", timeout: 3_600_000 }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Command stopped after 3600000 ms, the maximum timeout\. Narrow the command, for example search with rg instead of grep -r, or split it into shorter steps\.$/);
    return true;
  });
});

test("the local shell stops a command at its timeout", { skip: process.platform === "win32", timeout: 10_000 }, async () => {
  const definition = createBashToolDefinition(process.cwd());
  await assert.rejects(call(definition, { command: "printf 'started\\n'; sleep 5", timeout: 300 }),
    /^Error: started\n\n\nCommand stopped after 300 ms \(timeout\)\./);
});
